# Atomic CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
# Usage with version: iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Version v1.0.0"
#    or: $env:VERSION='v1.0.0'; irm ... | iex
# Usage prerelease: iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Prerelease"
#    or: $env:VERSION='prerelease'; irm ... | iex
# Set $env:GITHUB_TOKEN for authenticated downloads (avoids API rate limits)
#
# Installs the Atomic CLI binary, config data, and all required tooling
# (npm, @playwright/cli, @llamaindex/liteparse).

[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingInvokeExpression', '')]
param(
    [String]$Version = "latest",
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
$BinDir = $(if ($env:BIN_DIR) { $env:BIN_DIR } else { "${Home}\.local\bin" })
$DataDir = $(if ($env:DATA_DIR) { $env:DATA_DIR } elseif ($env:LOCALAPPDATA) { "${env:LOCALAPPDATA}\atomic" } else { "${Home}\AppData\Local\atomic" })
$AtomicHome = $(if ($env:ATOMIC_HOME) { $env:ATOMIC_HOME } else { "${Home}\.atomic" })

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

# --- Tooling helpers ----------------------------------------------------------


function Install-Fnm {
    if (Get-Command fnm -ErrorAction SilentlyContinue) {
        Write-Info "fnm is already installed"
        return $true
    }
    Write-Info "Installing fnm (Fast Node Manager)..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install --id Schniz.fnm -e --silent --accept-source-agreements --accept-package-agreements
            # winget installs to a location already in PATH for new sessions;
            # refresh current session by scanning the user PATH.
            $UserPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
            $env:Path = "${UserPath};${env:Path}"
            if (Get-Command fnm -ErrorAction SilentlyContinue) { return $true }
        } catch { Write-Warn "winget install fnm failed: $_" }
    }
    return $false
}

function Install-NodeViaFnm {
    if (-not (Install-Fnm)) { return $false }
    Write-Info "Installing Node.js LTS via fnm..."
    try {
        fnm install --lts
        fnm use --lts
        # Add fnm-managed Node.js to the current session PATH.
        $FnmEnv = fnm env --shell=powershell 2>$null
        if ($FnmEnv) { $FnmEnv | Invoke-Expression }
        if (Get-Command node -ErrorAction SilentlyContinue) {
            Write-Info "Node.js $(node --version) installed via fnm"
            return $true
        }
    } catch { Write-Warn "fnm install --lts failed: $_" }
    return $false
}

function Install-Npm {
    # Check if a sufficient Node.js (>= 22) is already available.
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $CurrentMajor = [int]((node --version) -replace '^v' -split '\.')[0]
        if ($CurrentMajor -ge 22 -and (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Info "Node.js $(node --version) is already installed (>= 22)"
            return
        }
        Write-Warn "Node.js $(node --version) is too old (need >= 22), upgrading..."
    }

    Write-Info "Installing Node.js/npm..."

    # Preferred: install via fnm (no admin required).
    if (Install-NodeViaFnm) { return }

    # Fallback: direct Node.js installation via package managers.
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
            if ($env:ProgramFiles) { $env:Path = "${env:ProgramFiles}\nodejs;${env:Path}" }
            return
        } catch { Write-Warn "winget install nodejs failed: $_" }
    }
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        try {
            choco install nodejs-lts -y --no-progress
            return
        } catch { Write-Warn "choco install nodejs failed: $_" }
    }
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        try {
            scoop install nodejs-lts
            return
        } catch { Write-Warn "scoop install nodejs failed: $_" }
    }
    Write-Warn "No supported package manager found to install npm - install Node.js manually from https://nodejs.org"
}

function Install-GlobalNpmPackage {
    param([string]$Package)
    Write-Info "Installing ${Package} globally..."
    $NpmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($NpmCmd) {
        try {
            & $NpmCmd.Source install -g $Package
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "npm install -g ${Package} failed: $_" }
    }
    Write-Warn "Could not install ${Package}"
}

function Install-Psmux {
    # Skip if psmux or tmux is already installed
    $Existing = Get-Command psmux -ErrorAction SilentlyContinue
    if (-not $Existing) { $Existing = Get-Command tmux -ErrorAction SilentlyContinue }
    if ($Existing) {
        Write-Info "psmux/tmux is already installed"
        return
    }

    Write-Info "Installing psmux (Windows terminal multiplexer)..."

    # WinGet (preferred)
    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($Winget) {
        try {
            & $Winget.Source install psmux --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "winget install psmux failed: $_" }
    }

    # Scoop
    $Scoop = Get-Command scoop -ErrorAction SilentlyContinue
    if ($Scoop) {
        try {
            & $Scoop.Source bucket add psmux https://github.com/psmux/scoop-psmux 2>$null
            & $Scoop.Source install psmux
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "scoop install psmux failed: $_" }
    }

    # Chocolatey
    $Choco = Get-Command choco -ErrorAction SilentlyContinue
    if ($Choco) {
        try {
            & $Choco.Source install psmux -y --no-progress
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "choco install psmux failed: $_" }
    }

    # Cargo (last resort)
    $Cargo = Get-Command cargo -ErrorAction SilentlyContinue
    if ($Cargo) {
        try {
            & $Cargo.Source install psmux
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "cargo install psmux failed: $_" }
    }

    Write-Warn "Could not install psmux — install it manually from https://github.com/psmux/psmux"
}

function Install-Bun {
    # Skip if bun is already installed
    $Existing = Get-Command bun -ErrorAction SilentlyContinue
    if ($Existing) {
        Write-Info "bun is already installed"
        return
    }

    Write-Info "Installing bun..."

    # WinGet (preferred)
    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($Winget) {
        try {
            & $Winget.Source install Oven-sh.Bun --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "winget install bun failed: $_" }
    }

    # Scoop
    $Scoop = Get-Command scoop -ErrorAction SilentlyContinue
    if ($Scoop) {
        try {
            & $Scoop.Source install bun
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "scoop install bun failed: $_" }
    }

    # npm (last resort)
    $NpmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($NpmCmd) {
        try {
            & $NpmCmd.Source install -g bun
            if ($LASTEXITCODE -eq 0) { return }
        } catch { Write-Debug "npm install bun failed: $_" }
    }

    Write-Warn "Could not install bun — install it manually from https://bun.sh"
}

# Merge-copy the bundled Atomic agents from the extracted config data dir
# into the provider-native global roots (~/.claude/agents, ~/.opencode/agents,
# ~/.copilot/agents). `Copy-Item -Recurse -Force` overwrites files sharing a
# name with a bundled file and leaves any extra user-added files alone.
#
# Copilot's lsp.json is written to ~/.copilot/lsp-config.json per the
# in-binary rename in atomic-global-config.ts.
function Install-GlobalAgents {
    param([string]$ConfigDir)

    Write-Info "Installing bundled Atomic agents into provider global roots..."

    $Pairs = @(
        @{ Src = ".claude/agents";   Dest = "$Home/.claude/agents"   },
        @{ Src = ".opencode/agents"; Dest = "$Home/.opencode/agents" },
        @{ Src = ".github/agents";   Dest = "$Home/.copilot/agents"  }
    )

    foreach ($Pair in $Pairs) {
        $SrcPath = Join-Path $ConfigDir $Pair.Src
        $DestPath = $Pair.Dest
        if (-not (Test-Path $SrcPath)) {
            Write-Warn "Bundled agents missing at ${SrcPath} — skipping ${DestPath}"
            continue
        }
        $null = New-Item -ItemType Directory -Force -Path $DestPath
        try {
            Copy-Item -Recurse -Force -Path (Join-Path $SrcPath "*") -Destination $DestPath
            Write-Info "Synced ${DestPath}"
        } catch {
            Write-Warn "Failed to sync ${DestPath} (non-fatal): $_"
        }
    }

    $LspSrc = Join-Path $ConfigDir ".github/lsp.json"
    $LspDest = "$Home/.copilot/lsp-config.json"
    if (Test-Path $LspSrc) {
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LspDest)
        try {
            Copy-Item -Force -Path $LspSrc -Destination $LspDest
            Write-Info "Synced ${LspDest}"
        } catch {
            Write-Warn "Failed to sync ${LspDest} (non-fatal): $_"
        }
    }

    Write-Success "Global agent configs installed"
}

# Install all bundled skills globally via `npx skills`, then remove the
# source-control variants (gh-*/sl-*) so `atomic init` can install them
# locally per-project based on the user's selected SCM + active agent.
function Install-GlobalSkills {
    $NpxCmd = Get-Command npx -ErrorAction SilentlyContinue
    if (-not $NpxCmd) { $NpxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue }
    if (-not $NpxCmd) {
        Write-Warn "npx not found — skipping global skills install"
        return
    }

    $SkillsRepo = "https://github.com/flora131/atomic.git"
    $AgentFlags = @("-a", "claude-code", "-a", "opencode", "-a", "github-copilot")

    Write-Info "Installing all bundled skills globally via npx skills..."
    $AddArgs = @("--yes", "skills", "add", $SkillsRepo, "--skill", "*", "-g") + $AgentFlags + @("-y")
    try {
        & $NpxCmd.Source @AddArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "'npx skills add' exited with code $LASTEXITCODE (non-fatal)"
            return
        }
    } catch {
        Write-Warn "'npx skills add' failed (non-fatal): $_"
        return
    }

    Write-Info "Removing source-control skill variants globally (installed per-project by 'atomic init')..."
    $RemoveArgs = @(
        "--yes", "skills", "remove",
        "--skill", "gh-commit",
        "--skill", "gh-create-pr",
        "--skill", "sl-commit",
        "--skill", "sl-submit-diff",
        "-g"
    ) + $AgentFlags + @("-y")
    try {
        & $NpxCmd.Source @RemoveArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "'npx skills remove' exited with code $LASTEXITCODE (non-fatal)"
            return
        }
    } catch {
        Write-Warn "'npx skills remove' failed (non-fatal): $_"
        return
    }

    Write-Success "Global skills installed"
}

function Install-Tooling {
    Write-Info "Installing required tooling (npm, psmux, bun, playwright-cli, liteparse)..."

    # Phase 1: core tools
    Install-Npm
    Install-Psmux
    Install-Bun

    # Phase 2: global CLI tools
    Install-GlobalNpmPackage "@playwright/cli@latest"
    Install-GlobalNpmPackage "@llamaindex/liteparse@latest"

    Write-Success "Tooling installed"
}

# Install bundled workflow templates to ~/.atomic/workflows/
# Copies from the config data dir, skipping existing agent directories
# to preserve user customizations.
#
# Layout: .atomic/workflows/<workflow_name>/<agent>/index.ts
function Install-Workflows {
    $SrcDir = Join-Path $DataDir ".atomic" "workflows"
    $DestDir = Join-Path $AtomicHome "workflows"

    if (-not (Test-Path $SrcDir)) {
        return
    }

    Write-Info "Installing workflow templates to ${DestDir}..."
    $null = New-Item -ItemType Directory -Force -Path $DestDir

    # Copy root files (package.json, tsconfig.json, etc.) — always overwrite
    $AgentNames = @("copilot", "opencode", "claude")
    foreach ($Item in (Get-ChildItem -Path $SrcDir -Force -ErrorAction SilentlyContinue)) {
        if ($Item.Name -eq "node_modules") { continue }
        # Skip dotfiles except .gitignore (match TS behavior)
        if ($Item.Name.StartsWith(".") -and $Item.Name -ne ".gitignore") { continue }

        $DestItem = Join-Path $DestDir $Item.Name
        if (-not $Item.PSIsContainer) {
            Copy-Item -Path $Item.FullName -Destination $DestItem -Force
        }
    }

    # Copy per-workflow directories, preserving existing agent implementations
    $Copied = 0
    foreach ($WorkflowDir in (Get-ChildItem -Path $SrcDir -Directory -ErrorAction SilentlyContinue)) {
        if ($WorkflowDir.Name -eq "node_modules") { continue }

        $DestWf = Join-Path $DestDir $WorkflowDir.Name
        $null = New-Item -ItemType Directory -Force -Path $DestWf

        foreach ($SubEntry in (Get-ChildItem -Path $WorkflowDir.FullName -ErrorAction SilentlyContinue)) {
            $DestSub = Join-Path $DestWf $SubEntry.Name
            if (-not $SubEntry.PSIsContainer) {
                # Files within a workflow dir — always overwrite
                Copy-Item -Path $SubEntry.FullName -Destination $DestSub -Force
            } elseif ($SubEntry.Name -in $AgentNames) {
                # Agent directories — skip if already exists
                if (-not (Test-Path $DestSub)) {
                    Copy-Item -Path $SubEntry.FullName -Destination $DestSub -Recurse
                    $Copied++
                }
            } else {
                # Non-agent directories (e.g., helpers/) — always update
                $null = New-Item -ItemType Directory -Force -Path $DestSub
                Copy-Item -Path "$($SubEntry.FullName)\*" -Destination $DestSub -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    # Install SDK dependency
    $SavedLocation = Get-Location
    try {
        if (Get-Command bun -ErrorAction SilentlyContinue) {
            Set-Location $DestDir
            & bun install 2>$null
            if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
        } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
            Set-Location $DestDir
            & npm install 2>$null
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        }
    } catch {
        Write-Warn "Workflow dependency install failed (non-fatal)"
    } finally {
        Set-Location $SavedLocation
    }

    Write-Success "Workflow templates installed (${Copied} new workflow(s))"
}

# -----------------------------------------------------------------------------

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

    # Extract config files to data directory without deleting existing user files
    Write-Info "Installing config files to ${DataDir}..."
    $null = New-Item -ItemType Directory -Force -Path $DataDir
    Expand-Archive -Path $TempConfig -DestinationPath $DataDir -Force

    # Verify installation
    $VersionOutput = & $BinaryPath --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Installation verification failed: $VersionOutput"
    }

    Write-Success "Installed ${BinaryName} ${Version} to ${BinaryPath}"
    Write-Success "Config files installed to ${DataDir}"

    # Install required tooling
    Install-Tooling

    # Install bundled workflow templates to ~/.atomic/workflows/
    Install-Workflows

    # Merge-copy the bundled agent definitions into ~/.claude/agents,
    # ~/.opencode/agents, ~/.copilot/agents (+ ~/.copilot/lsp-config.json).
    # User-added files in those dirs are preserved.
    Install-GlobalAgents -ConfigDir $DataDir

    # Install bundled skills globally, minus the source-control variants
    # (those are installed per-project by `atomic init`).
    Install-GlobalSkills

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
