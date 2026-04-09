# Atomic CLI Installer for Windows
#
# Installs npm (if needed), bun (if needed), atomic globally, and sets up skills.
#
# Usage:
#   irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO = "https://github.com/flora131/atomic.git"
$SKILLS_AGENTS = @("claude-code", "opencode", "github-copilot")
$SCM_SKILLS_TO_REMOVE = @("gh-commit", "gh-create-pr", "sl-commit", "sl-submit-diff")

$C_BLUE = "`e[1;34m"; $C_GREEN = "`e[1;32m"; $C_YELLOW = "`e[1;33m"; $C_RED = "`e[1;31m"; $C_RESET = "`e[0m"
function Write-Info { Write-Host "${C_BLUE}info${C_RESET}: $args" }
function Write-Success { Write-Host "${C_GREEN}success${C_RESET}: $args" }
function Write-Warn { Write-Host "${C_YELLOW}warn${C_RESET}: $args" }
function Write-Err { Write-Host "${C_RED}error${C_RESET}: $args" }

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'User') + ";" +
                [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
}

# ── npm / Node.js ────────────────────────────────────────────────────────────

function Install-Fnm {
    if (Get-Command fnm -ErrorAction SilentlyContinue) {
        Write-Info "fnm is already installed"
        return $true
    }
    Write-Info "Installing fnm (Fast Node Manager)..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install --id Schniz.fnm -e --silent --accept-source-agreements --accept-package-agreements
            Refresh-Path
            if (Get-Command fnm -ErrorAction SilentlyContinue) { return $true }
        } catch { Write-Warn "winget install fnm failed: $_" }
    }
    return $false
}

function Install-Npm {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $CurrentMajor = [int]((node --version) -replace '^v' -split '\.')[0]
        if ($CurrentMajor -ge 22 -and (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Info "Node.js $(node --version) is already installed (>= 22)"
            return
        }
        Write-Warn "Node.js $(node --version) is too old (need >= 22), upgrading..."
    }

    Write-Info "Installing Node.js/npm..."

    # Preferred: fnm (no admin required)
    if (Install-Fnm) {
        try {
            fnm install --lts
            fnm use --lts
            $FnmEnv = fnm env --shell=powershell 2>$null
            if ($FnmEnv) { $FnmEnv | Invoke-Expression }
            if (Get-Command node -ErrorAction SilentlyContinue) {
                Write-Info "Node.js $(node --version) installed via fnm"
                return
            }
        } catch { Write-Warn "fnm install --lts failed: $_" }
    }

    # Fallback: winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
            if ($env:ProgramFiles) { $env:Path = "${env:ProgramFiles}\nodejs;${env:Path}" }
            return
        } catch { Write-Warn "winget install nodejs failed: $_" }
    }

    # Fallback: chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        try {
            choco install nodejs-lts -y --no-progress
            return
        } catch { Write-Warn "choco install nodejs failed: $_" }
    }

    # Fallback: scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        try {
            scoop install nodejs-lts
            return
        } catch { Write-Warn "scoop install nodejs failed: $_" }
    }

    Write-Warn "No supported package manager found to install npm — install Node.js manually from https://nodejs.org"
}

# ── bun ──────────────────────────────────────────────────────────────────────

function Install-Bun {
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        Write-Info "bun is already installed"
        return
    }

    Write-Info "Installing bun..."

    # WinGet (preferred)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            winget install Oven-sh.Bun --accept-source-agreements --accept-package-agreements
            Refresh-Path
            if (Get-Command bun -ErrorAction SilentlyContinue) { return }
        } catch { Write-Warn "winget install bun failed: $_" }
    }

    # Scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        try {
            scoop install bun
            if (Get-Command bun -ErrorAction SilentlyContinue) { return }
        } catch { Write-Warn "scoop install bun failed: $_" }
    }

    # Official installer
    try {
        powershell -c "irm bun.sh/install.ps1|iex"
        Refresh-Path
        if (Get-Command bun -ErrorAction SilentlyContinue) { return }
    } catch { Write-Warn "bun.sh installer failed: $_" }

    # npm (last resort)
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        try {
            npm install -g bun
            if (Get-Command bun -ErrorAction SilentlyContinue) { return }
        } catch { Write-Warn "npm install bun failed: $_" }
    }

    Write-Err "Could not install bun — install it manually from https://bun.sh"
    exit 1
}

# ── Skills ───────────────────────────────────────────────────────────────────

function Install-Skills {
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        Write-Warn "npx not found — skipping skills install"
        return
    }

    $agentFlags = @()
    foreach ($agent in $SKILLS_AGENTS) {
        $agentFlags += @("-a", $agent)
    }

    Write-Info "Installing bundled skills globally..."
    & npx --yes skills add $REPO --skill '*' -g @agentFlags -y 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "skills install failed (non-fatal)"
        return
    }

    $removeFlags = @()
    foreach ($skill in $SCM_SKILLS_TO_REMOVE) {
        $removeFlags += @("--skill", $skill)
    }

    Write-Info "Removing source-control skill variants globally..."
    & npx --yes skills remove @removeFlags -g @agentFlags -y 2>$null
}

# ── Main ─────────────────────────────────────────────────────────────────────

# Step 1: npm (needed for npx skills)
Install-Npm

# Step 2: bun (required runtime)
Install-Bun

# Step 3: Install atomic
Write-Info "Installing atomic..."
bun add -g atomic@latest
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to install atomic"
    exit 1
}
Write-Success "atomic installed"

# Step 4: Skills
Install-Skills

Write-Success ""
Write-Success "Atomic installed successfully!"
Write-Host ""
Write-Host "  Get started:  atomic init"
Write-Host "  Update later: atomic update"
Write-Host ""
