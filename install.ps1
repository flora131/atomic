# Atomic CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
# Usage with version: iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Version v1.0.0"
#    or: $env:VERSION='v1.0.0'; irm ... | iex
# Usage prerelease: iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Prerelease"
#    or: $env:VERSION='prerelease'; irm ... | iex
# Set $env:GITHUB_TOKEN for authenticated downloads (avoids API rate limits)
#
# Installs the Atomic CLI binary and config data only.
# Agent config syncing, tooling (bun, uv, cocoindex, playwright), and SDK
# installation are handled automatically on first `atomic init` / `atomic chat`.

[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingInvokeExpression', '')]
param(
    [String]$Version = "latest",
    [String]$InstallDir = "",
    [Switch]$NoPathUpdate = $false,
    [Switch]$Prerelease = $false
)

$ErrorActionPreference = 'Stop'

# Require PowerShell 7+
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "$([char]27)[0;31merror$([char]27)[0m: PowerShell 7 or later is required. You are running PowerShell $($PSVersionTable.PSVersion)."
    Write-Host "$([char]27)[0;31merror$([char]27)[0m: Install PowerShell 7 from https://aka.ms/install-powershell"
    exit 1
}

# Configuration
$GithubRepo = "flora131/atomic"
$BinaryName = "atomic"
$BinDir = $(if ($env:ATOMIC_INSTALL_DIR) { $env:ATOMIC_INSTALL_DIR } elseif ($InstallDir) { $InstallDir } else { "${Home}\.local\bin" })
$DataDir = $(if ($env:LOCALAPPDATA) { "${env:LOCALAPPDATA}\atomic" } else { "${Home}\AppData\Local\atomic" })
$AtomicHome = "${Home}\.atomic"

# Colors for output
$C_RESET = [char]27 + "[0m"
$C_RED = [char]27 + "[0;31m"
$C_GREEN = [char]27 + "[0;32m"
$C_BLUE = [char]27 + "[0;34m"
$C_YELLOW = [char]27 + "[0;33m"

function Write-Info { Write-Host "${C_BLUE}info${C_RESET}: $args" }
function Write-Success { Write-Host "${C_GREEN}success${C_RESET}: $args" }
function Write-Warn { Write-Host "${C_YELLOW}warn${C_RESET}: $args" }
function Write-Err { Write-Host "${C_RED}error${C_RESET}: $args" }

# Detect architecture
$Arch = $env:PROCESSOR_ARCHITECTURE
switch ($Arch) {
    "AMD64" { $Target = "windows-x64.exe" }
    "ARM64" {
        Write-Info "Windows ARM64 detected -- installing arm64-named baseline binary (runs via x64 emulation; requires Windows 11)"
        $Target = "windows-arm64.exe"
    }
    default {
        Write-Err "Unsupported architecture: $Arch"
        Write-Err "Atomic CLI requires 64-bit Windows (x64 or ARM64)"
        exit 1
    }
}

Write-Info "Detected architecture: $Arch"
Write-Info "Installing to: $BinDir"
Write-Info "Config directory: $DataDir"
Write-Info "Atomic home: $AtomicHome"

# Set up authentication for GitHub requests if GITHUB_TOKEN is available
$AuthHeaders = @{}
$CurlAuth = @()
if ($env:GITHUB_TOKEN) {
    $AuthHeaders["Authorization"] = "token $($env:GITHUB_TOKEN)"
    $CurlAuth = @("-H", "Authorization: token $($env:GITHUB_TOKEN)")
}

# Support VERSION env var (e.g., $env:VERSION='v1.0.0'; irm ... | iex)
if ($Version -eq "latest" -and $env:VERSION) {
    if ($env:VERSION -eq "prerelease") {
        $Prerelease = [switch]$true
    } elseif ($env:VERSION -ne "latest") {
        $Version = $env:VERSION
    }
}

# Create install directories
$null = New-Item -ItemType Directory -Force -Path $BinDir
$null = New-Item -ItemType Directory -Force -Path $DataDir

# Get version
if ($Version -eq "latest") {
    Write-Info "Fetching latest version..."
    try {
        if ($Prerelease) {
            $Releases = Invoke-RestMethod "https://api.github.com/repos/${GithubRepo}/releases" -Headers $AuthHeaders
            $Release = $Releases | Where-Object { $_.prerelease -eq $true } | Select-Object -First 1
            if (-not $Release) {
                Write-Err "No prerelease found"
                exit 1
            }
        } else {
            $Release = Invoke-RestMethod "https://api.github.com/repos/${GithubRepo}/releases/latest" -Headers $AuthHeaders
        }
        $Version = $Release.tag_name
    } catch {
        Write-Err "Failed to fetch latest version: $_"
        exit 1
    }
}
if ($Prerelease -and $Version -ne "latest") {
    Write-Info "Installing prerelease: $Version"
} else {
    Write-Info "Installing version: $Version"
}

# Validate version format to prevent URL manipulation
if ($Version -notmatch '^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$') {
    Write-Err "Invalid version format: $Version (expected semver like v1.2.3 or v1.2.3-1)"
    exit 1
}

# Setup URLs
$BaseUrl = "https://github.com/${GithubRepo}/releases/download/${Version}"
$DownloadUrl = "${BaseUrl}/${BinaryName}-${Target}"
$ConfigUrl = "${BaseUrl}/${BinaryName}-config.zip"
$ChecksumsUrl = "${BaseUrl}/checksums.txt"
$BinaryPath = "${BinDir}\${BinaryName}.exe"

# Create temp directory
$TempDir = Join-Path $env:TEMP "atomic-install-$(Get-Random)"
$null = New-Item -ItemType Directory -Force -Path $TempDir
$TempBinary = "${TempDir}\${BinaryName}-${Target}"
$TempConfig = "${TempDir}\${BinaryName}-config.zip"
$TempChecksums = "${TempDir}\checksums.txt"

try {
    # Download binary
    Write-Info "Downloading ${BinaryName} ${Version}..."
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        $CurlArgs = @("-#SfLo", $TempBinary) + $CurlAuth + @($DownloadUrl)
        curl.exe @CurlArgs
        if ($LASTEXITCODE -ne 0) { throw "curl.exe failed with exit code $LASTEXITCODE" }
    } else {
        Write-Info "curl.exe not found, using Invoke-WebRequest..."
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempBinary -UseBasicParsing -Headers $AuthHeaders
    }

    # Download config files
    Write-Info "Downloading config files..."
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        $CurlArgs = @("-#SfLo", $TempConfig) + $CurlAuth + @($ConfigUrl)
        curl.exe @CurlArgs
        if ($LASTEXITCODE -ne 0) { throw "curl.exe failed to download config files with exit code $LASTEXITCODE" }
    } else {
        Invoke-WebRequest -Uri $ConfigUrl -OutFile $TempConfig -UseBasicParsing -Headers $AuthHeaders
    }

    # Download checksums
    Write-Info "Downloading checksums..."
    Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $TempChecksums -UseBasicParsing -Headers $AuthHeaders

    # Verify binary checksum
    Write-Info "Verifying binary checksum..."
    $ExpectedLine = Get-Content $TempChecksums | Where-Object { $_ -match $Target }
    if (-not $ExpectedLine) {
        throw "Could not find checksum for $Target in checksums.txt"
    }
    $ExpectedHash = ($ExpectedLine -split '\s+')[0].ToLower()
    $ActualHash = (Get-FileHash -Path $TempBinary -Algorithm SHA256).Hash.ToLower()

    if ($ActualHash -ne $ExpectedHash) {
        Write-Err "Checksum verification failed!"
        Write-Err "Expected: $ExpectedHash"
        Write-Err "Actual:   $ActualHash"
        exit 1
    }
    Write-Info "Binary checksum verified successfully"

    # Verify config checksum
    Write-Info "Verifying config checksum..."
    $ConfigExpectedLine = Get-Content $TempChecksums | Where-Object { $_ -match "config\.zip" }
    if (-not $ConfigExpectedLine) {
        throw "Could not find checksum for config.zip in checksums.txt"
    }
    $ConfigExpectedHash = ($ConfigExpectedLine -split '\s+')[0].ToLower()
    $ConfigActualHash = (Get-FileHash -Path $TempConfig -Algorithm SHA256).Hash.ToLower()

    if ($ConfigActualHash -ne $ConfigExpectedHash) {
        Write-Err "Config checksum verification failed!"
        Write-Err "Expected: $ConfigExpectedHash"
        Write-Err "Actual:   $ConfigActualHash"
        exit 1
    }
    Write-Info "Config checksum verified successfully"

    # Notice when replacing existing binary
    if (Test-Path $BinaryPath) {
        Write-Info "Replacing existing ${BinaryName} binary at ${BinaryPath}"
    }

    # Install binary
    Move-Item -Force $TempBinary $BinaryPath

    # Extract config files to data directory (clean install)
    Write-Info "Installing config files to ${DataDir}..."
    if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }
    $null = New-Item -ItemType Directory -Force -Path $DataDir
    Expand-Archive -Path $TempConfig -DestinationPath $DataDir -Force

    # Verify installation
    $VersionOutput = & $BinaryPath --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Installation verification failed: $VersionOutput"
    }

    Write-Success "Installed ${BinaryName} ${Version} to ${BinaryPath}"
    Write-Success "Config files installed to ${DataDir}"

    # Persist prerelease channel preference in settings
    $SettingsFile = Join-Path $AtomicHome "settings.json"
    $PrereleaseValue = if ($Prerelease) { $true } else { $false }
    if (Test-Path $SettingsFile) {
        $Settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
        $Settings | Add-Member -NotePropertyName "prerelease" -NotePropertyValue $PrereleaseValue -Force
        $Settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
    } else {
        $null = New-Item -ItemType Directory -Force -Path $AtomicHome
        @{ prerelease = $PrereleaseValue } | ConvertTo-Json | Set-Content $SettingsFile -Encoding UTF8
    }
    if ($Prerelease) {
        Write-Info "Prerelease channel enabled in ${SettingsFile}"
    }

    # Update PATH
    if (-not $NoPathUpdate) {
        $UserPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
        if ($UserPath -notlike "*${BinDir}*") {
            [System.Environment]::SetEnvironmentVariable('Path', "${BinDir};${UserPath}", 'User')
            $env:Path = "${BinDir};${env:Path}"
            Write-Info "Added ${BinDir} to PATH"

            # Broadcast environment change for immediate visibility in new terminals
            try {
                Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
                $result = [UIntPtr]::Zero
                [Win32.NativeMethods]::SendMessageTimeout(
                    [IntPtr]0xFFFF, 0x1A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result
                ) | Out-Null
            } catch {
                Write-Warn "Could not broadcast PATH change. You may need to restart your terminal."
            }

            Write-Host ""
            Write-Warn "Restart your terminal or run: `$env:Path = `"${BinDir};`$env:Path`""
        } else {
            Write-Info "${BinDir} is already in PATH"
        }
    }

    Write-Host ""
    Write-Success "Run 'atomic --help' to get started!"

} catch {
    Write-Err "Installation failed: $_"
    exit 1
} finally {
    # Cleanup
    if (Test-Path $TempDir) {
        Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    }
}
