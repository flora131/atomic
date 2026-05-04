# Atomic CLI Installer for Windows
#
# Modeled on Claude Code's install.ps1: download a verified prebuilt
# binary from GitHub Releases, then hand off to `atomic install` for
# placement, PATH wiring, mux detection, and shell completions.
#
# Usage:
#   irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
#
# Pin a specific version:
#   $v = "0.4.47"; irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
#
# Works on PowerShell 5.1+ — no ANSI escapes, no background jobs.

param(
    [Parameter(Position=0)]
    [ValidatePattern('^(stable|latest|\d+\.\d+\.\d+(-[^\s]+)?)$')]
    [string]$Target = "latest"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'

if (-not [Environment]::Is64BitProcess) {
    Write-Error "atomic does not support 32-bit Windows. Please use a 64-bit version of Windows."
    exit 1
}

$RELEASES_BASE = "https://github.com/flora131/atomic/releases"
$DOWNLOAD_DIR = Join-Path $env:USERPROFILE ".atomic\downloads"

# Native ARM64 binary on ARM64 Windows; x64 otherwise.
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
    $platform = "windows-arm64"
} else {
    $platform = "windows-x64"
}

if (-not (Test-Path $DOWNLOAD_DIR)) {
    New-Item -ItemType Directory -Force -Path $DOWNLOAD_DIR | Out-Null
}

# Resolve the manifest URL. `latest` and `stable` both go through
# GitHub's `releases/latest/download/<asset>` redirect; pinned versions
# go through `releases/download/v<version>/<asset>`.
if ($Target -eq "latest" -or $Target -eq "stable") {
    $manifestUrl = "$RELEASES_BASE/latest/download/manifest.json"
} else {
    $manifestUrl = "$RELEASES_BASE/download/v$Target/manifest.json"
}

try {
    $manifest = Invoke-RestMethod -Uri $manifestUrl -ErrorAction Stop
}
catch {
    Write-Error "Failed to fetch manifest from $manifestUrl : $_"
    exit 1
}

$version = $manifest.version
$checksum = $manifest.platforms.$platform.checksum
if (-not $checksum) {
    Write-Error "Platform $platform not found in manifest for version $version"
    exit 1
}

# Always download by pinned version URL — `releases/latest/download` is
# unreliable mid-release, and we already know the version from the
# manifest.
$binaryUrl = "$RELEASES_BASE/download/v$version/atomic-$platform.exe"
$binaryPath = Join-Path $DOWNLOAD_DIR "atomic-$version-$platform.exe"

# Retry transient network failures. Mirrors install.sh / install.cmd
# (`curl --retry 3`). Hand-rolled rather than -MaximumRetryCount because
# that flag isn't available on PowerShell 5.1.
$maxAttempts = 3
$attempt = 0
$downloaded = $false
$lastError = $null
while ($attempt -lt $maxAttempts -and -not $downloaded) {
    $attempt++
    try {
        Invoke-WebRequest -Uri $binaryUrl -OutFile $binaryPath -ErrorAction Stop
        $downloaded = $true
    }
    catch {
        $lastError = $_
        if ($attempt -lt $maxAttempts) {
            Start-Sleep -Seconds ([Math]::Min(5, $attempt * 2))
        }
    }
}
if (-not $downloaded) {
    Write-Error "Failed to download binary from $binaryUrl after $maxAttempts attempts: $lastError"
    if (Test-Path $binaryPath) { Remove-Item -Force $binaryPath }
    exit 1
}

$actualChecksum = (Get-FileHash -Path $binaryPath -Algorithm SHA256).Hash.ToLower()
if ($actualChecksum -ne $checksum.ToLower()) {
    Write-Error "Checksum verification failed for $binaryPath (expected $checksum, got $actualChecksum)"
    Remove-Item -Force $binaryPath
    exit 1
}

# Hand off to the binary's `install` subcommand for placement +
# PATH wiring + mux detection + completions. Claude Code does the
# same — it keeps install logic shipped with the binary so older
# bootstraps stay forward-compatible.
Write-Output "Setting up atomic..."
try {
    & $binaryPath install
}
finally {
    try {
        # Wait briefly for any file handles to release before deleting.
        Start-Sleep -Seconds 1
        Remove-Item -Force $binaryPath -ErrorAction SilentlyContinue
    }
    catch {
        Write-Warning "Could not remove temporary file: $binaryPath"
    }
}

Write-Output ""
Write-Output "$([char]0x2705) Installation complete!"
Write-Output ""
