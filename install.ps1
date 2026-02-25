# Atomic CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
# Usage with version: iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Version v1.0.0"

param(
    [String]$Version = "latest",
    [String]$InstallDir = "",
    [Switch]$NoPathUpdate = $false
)

$ErrorActionPreference = 'Stop'

# Configuration
$GithubRepo = "flora131/atomic"
$BinaryName = "atomic"
$BinDir = if ($env:ATOMIC_INSTALL_DIR) { $env:ATOMIC_INSTALL_DIR } elseif ($InstallDir) { $InstallDir } else { "${Home}\.local\bin" }
$DataDir = if ($env:LOCALAPPDATA) { "${env:LOCALAPPDATA}\atomic" } else { "${Home}\AppData\Local\atomic" }
$AtomicHome = "${Home}\.atomic"

function Sync-GlobalAgentConfigs {
    param([string]$SourceRoot)

    $claudeDir = Join-Path $AtomicHome ".claude"
    $opencodeDir = Join-Path $AtomicHome ".opencode"
    $copilotDir = Join-Path $AtomicHome ".copilot"

    $null = New-Item -ItemType Directory -Force -Path $claudeDir
    $null = New-Item -ItemType Directory -Force -Path $opencodeDir
    $null = New-Item -ItemType Directory -Force -Path $copilotDir

    Copy-Item -Path (Join-Path $SourceRoot ".claude\*") -Destination $claudeDir -Recurse -Force
    Copy-Item -Path (Join-Path $SourceRoot ".opencode\*") -Destination $opencodeDir -Recurse -Force
    Copy-Item -Path (Join-Path $SourceRoot ".github\*") -Destination $copilotDir -Recurse -Force

    $mcpConfigSource = Join-Path $SourceRoot ".mcp.json"
    if (Test-Path $mcpConfigSource) {
        Copy-Item -Path $mcpConfigSource -Destination (Join-Path $AtomicHome ".mcp.json") -Force
    }

    foreach ($agentDir in @($claudeDir, $opencodeDir, $copilotDir)) {
        $skillsDir = Join-Path $agentDir "skills"
        if (Test-Path $skillsDir) {
            Get-ChildItem -Path $skillsDir -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like "gh-*" -or $_.Name -like "sl-*" } |
                ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
        }
    }

    Remove-Item -Recurse -Force (Join-Path $copilotDir "workflows") -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $copilotDir "dependabot.yml") -ErrorAction SilentlyContinue

    # Install @playwright/cli globally if a package manager is available.
    # Do not install Chromium browsers here; defer to first use.
    Write-Info "Installing @playwright/cli globally (if available)..."
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        bun install -g @playwright/cli@latest 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Failed to install @playwright/cli with bun. Continuing without it."
        }
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        npm install -g @playwright/cli@latest 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Failed to install @playwright/cli with npm. Continuing without it."
        }
    } else {
        Write-Warn "Neither bun nor npm found. Install @playwright/cli manually for web browsing capabilities."
    }
}

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
    "ARM64" { $Target = "windows-arm64.exe" }
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

# Create install directories
$null = New-Item -ItemType Directory -Force -Path $BinDir
$null = New-Item -ItemType Directory -Force -Path $DataDir

# Get version
if ($Version -eq "latest") {
    Write-Info "Fetching latest version..."
    try {
        $Release = Invoke-RestMethod "https://api.github.com/repos/${GithubRepo}/releases/latest"
        $Version = $Release.tag_name
    } catch {
        Write-Err "Failed to fetch latest version: $_"
        exit 1
    }
}
Write-Info "Installing version: $Version"

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
        curl.exe "-#SfLo" $TempBinary $DownloadUrl
        if ($LASTEXITCODE -ne 0) { throw "curl.exe failed with exit code $LASTEXITCODE" }
    } else {
        Write-Info "curl.exe not found, using Invoke-WebRequest..."
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempBinary -UseBasicParsing
    }

    # Download config files
    Write-Info "Downloading config files..."
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        curl.exe "-#SfLo" $TempConfig $ConfigUrl
        if ($LASTEXITCODE -ne 0) { throw "curl.exe failed to download config files with exit code $LASTEXITCODE" }
    } else {
        Invoke-WebRequest -Uri $ConfigUrl -OutFile $TempConfig -UseBasicParsing
    }

    # Download checksums
    Write-Info "Downloading checksums..."
    Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $TempChecksums -UseBasicParsing

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

    # Install binary
    Move-Item -Force $TempBinary $BinaryPath

    # Extract config files to data directory (clean install)
    Write-Info "Installing config files to ${DataDir}..."
    if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }
    $null = New-Item -ItemType Directory -Force -Path $DataDir
    Expand-Archive -Path $TempConfig -DestinationPath $DataDir -Force

    Write-Info "Syncing global agent configs to ${AtomicHome}..."
    Sync-GlobalAgentConfigs -SourceRoot $DataDir

    # Verify installation
    $VersionOutput = & $BinaryPath --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Installation verification failed: $VersionOutput"
    }

    Write-Success "Installed ${BinaryName} ${Version} to ${BinaryPath}"
    Write-Success "Config files installed to ${DataDir}"
    Write-Success "Global agent configs synced to ${AtomicHome}"

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
