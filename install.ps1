# Atomic CLI Installer for Windows
#
# Bootstrap installer for systems that don't already have bun. Installs
# bun (if missing) and then installs atomic from npm via bun. The CLI
# silently syncs tooling deps and bundled skills on first launch — see
# src/services/system/auto-sync.ts.
#
# If you already have bun, you can skip this script entirely:
#   bun install -g @bastani/atomic@latest
#
# Usage:
#   irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$PACKAGE = "@bastani/atomic@latest"

# ── Rendering helpers ───────────────────────────────────────────────────────
#
# Mirrors install.sh's spinner + bracketed progress bar UI. Commands run
# as background PowerShell jobs so we can animate a braille spinner while
# they execute. Output is captured and only surfaced on failure. Falls
# back to plain line-at-a-time rendering when stdout isn't a TTY.

$script:StepTotal = 0
$script:StepIndex = 0

# Colour codes — disabled when NO_COLOR is set (https://no-color.org)
#
# Palette follows Catppuccin semantics (see .impeccable.md):
#   blue   → in-flight "progress" (accent)
#   green  → completed success
#   red    → failed
#   yellow → warning
if ($null -ne $env:NO_COLOR -and $env:NO_COLOR -ne "") {
    $script:C_RESET = ""; $script:C_DIM = ""; $script:C_BOLD = ""
    $script:C_RED = ""; $script:C_GREEN = ""; $script:C_YELLOW = ""
    $script:C_BLUE = ""; $script:C_CYAN = ""
} else {
    $script:C_RESET  = "`e[0m"
    $script:C_DIM    = "`e[2m"
    $script:C_BOLD   = "`e[1m"
    $script:C_RED    = "`e[31m"
    $script:C_GREEN  = "`e[32m"
    $script:C_YELLOW = "`e[33m"
    $script:C_BLUE   = "`e[34m"
    $script:C_CYAN   = "`e[36m"
}

function Write-Info { param($msg) Write-Host "  ${C_CYAN}info${C_RESET} $msg" }
function Write-Warn { param($msg) Write-Host "  ${C_YELLOW}warn${C_RESET} $msg" }
function Write-Err2 { param($msg) Write-Host "  ${C_RED}error${C_RESET} $msg" }

function Get-Bar {
    param(
        [int]$Completed,
        [int]$Total,
        [ValidateSet("progress", "success", "error")][string]$State = "progress"
    )
    $width = 30
    $filled = [Math]::Min($width, [int]($Completed * $width / [Math]::Max(1, $Total)))
    $empty  = $width - $filled
    $bar = ""

    $hasTrueColor = ($env:COLORTERM -eq "truecolor" -or $env:COLORTERM -eq "24bit")
    if ($hasTrueColor -and $filled -gt 0 -and ($null -eq $env:NO_COLOR -or $env:NO_COLOR -eq "")) {
        switch ($State) {
            "success" { $sr=126; $sg=201; $sb=138; $er=166; $eg=227; $eb=161 }
            "error"   { $sr=224; $sg=108; $sb=136; $er=243; $eg=139; $eb=168 }
            default   { $sr=242; $sg=196; $sb=120; $er=249; $eg=226; $eb=175 }
        }
        for ($i = 0; $i -lt $filled; $i++) {
            if ($filled -gt 1) {
                $t = $i / ($filled - 1)
            } else {
                $t = 1.0
            }
            $r = [int]($sr + ($er - $sr) * $t)
            $g = [int]($sg + ($eg - $sg) * $t)
            $b = [int]($sb + ($eb - $sb) * $t)
            $bar += "`e[38;2;${r};${g};${b}m■"
        }
        $bar += "`e[0m"
    } else {
        $fill = switch ($State) {
            "success" { $script:C_GREEN }
            "error"   { $script:C_RED }
            default   { $script:C_YELLOW }
        }
        $bar = "${fill}$('■' * $filled)${C_RESET}"
    }

    return "${bar}${C_DIM}$('･' * $empty)${C_RESET}"
}

function Format-Line {
    param(
        [string]$Glyph,
        [int]$Fill,
        [ValidateSet("progress", "success", "error")][string]$State = "progress",
        [string]$Label
    )
    $bar = Get-Bar -Completed $Fill -Total $script:StepTotal -State $State
    $pct = if ($script:StepTotal -gt 0) { [int]($Fill * 100 / $script:StepTotal) } else { 0 }
    $pctStr = $pct.ToString().PadLeft(3)
    return "  $Glyph  $bar  ${C_DIM}${pctStr}%${C_RESET}  $Label"
}

# Run a ScriptBlock with a spinner; capture output; surface only on failure.
#
# Returns $true on success, $false on failure. Advances $script:StepIndex
# only on success so the progress bar tells the truth about where we are.
function Invoke-Step {
    param(
        [string]$Label,
        [ScriptBlock]$Action
    )

    $completed = $script:StepIndex
    $stepNo = $completed + 1
    $isTty = -not [Console]::IsOutputRedirected

    # Non-TTY fallback: plain line output.
    if (-not $isTty) {
        Write-Host -NoNewline "  [$stepNo/$($script:StepTotal)] $Label "
        $logFile = [System.IO.Path]::GetTempFileName()
        try {
            & $Action *>&1 | Out-File -FilePath $logFile -Encoding utf8
            if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {
                Write-Host "${C_RED}failed${C_RESET}"
                Get-Content $logFile | ForEach-Object { Write-Host "      $_" }
                return $false
            }
            Write-Host "${C_GREEN}ok${C_RESET}"
            $script:StepIndex++
            return $true
        } finally {
            Remove-Item $logFile -ErrorAction SilentlyContinue
        }
    }

    # TTY path: spin while the action runs as a background job.
    $logFile = [System.IO.Path]::GetTempFileName()
    $job = Start-Job -ScriptBlock {
        param($actText, $log)
        try {
            & ([ScriptBlock]::Create($actText)) *>&1 | Out-File -FilePath $log -Encoding utf8
            if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        } catch {
            $_ | Out-File -FilePath $log -Encoding utf8 -Append
            exit 1
        }
    } -ArgumentList $Action.ToString(), $logFile

    $frames = @('⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏')
    $i = 0
    [Console]::Write("`e[?25l")  # hide cursor
    try {
        while ($job.State -eq 'Running') {
            $f = $frames[$i % 10]
            $line = Format-Line -Glyph "${C_BLUE}$f${C_RESET}" -Fill $completed -State "progress" -Label $Label
            [Console]::Write("`r`e[2K$line")
            Start-Sleep -Milliseconds 80
            $i++
        }
        Receive-Job $job -ErrorAction SilentlyContinue | Out-Null
        $succeeded = ($job.State -eq 'Completed')
        [Console]::Write("`r`e[2K")
        if ($succeeded) {
            $script:StepIndex++
            $line = Format-Line -Glyph "${C_GREEN}✓${C_RESET}" -Fill $script:StepIndex -State "success" -Label "${C_DIM}$Label${C_RESET}"
            Write-Host $line
            return $true
        } else {
            $line = Format-Line -Glyph "${C_RED}✗${C_RESET}" -Fill $completed -State "error" -Label $Label
            Write-Host $line
            if (Test-Path $logFile) {
                Get-Content $logFile -Tail 15 | ForEach-Object {
                    Write-Host "    ${C_DIM}$_${C_RESET}"
                }
            }
            return $false
        }
    } finally {
        [Console]::Write("`e[?25h")  # show cursor
        Remove-Job $job -Force -ErrorAction SilentlyContinue
        Remove-Item $logFile -ErrorAction SilentlyContinue
    }
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'User') + ";" +
                [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
}

# ── Installers ──────────────────────────────────────────────────────────────

function Install-Bun {
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        Write-Info "bun already installed"
        return $true
    }

    # WinGet (preferred)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $ok = Invoke-Step -Label "Installing bun (winget)" -Action {
            winget install Oven-sh.Bun --accept-source-agreements --accept-package-agreements
        }
        Refresh-Path
        if ($ok -and (Get-Command bun -ErrorAction SilentlyContinue)) { return $true }
        Write-Warn "winget install bun failed, trying scoop"
    }

    # Scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        $ok = Invoke-Step -Label "Installing bun (scoop)" -Action { scoop install bun }
        if ($ok -and (Get-Command bun -ErrorAction SilentlyContinue)) { return $true }
        Write-Warn "scoop install bun failed, trying bun.sh installer"
    }

    # Official installer
    $ok = Invoke-Step -Label "Downloading bun" -Action {
        powershell -c "irm bun.sh/install.ps1 | iex"
    }
    Refresh-Path
    if ($ok -and (Get-Command bun -ErrorAction SilentlyContinue)) { return $true }

    Write-Err2 "Could not install bun — install it manually from https://bun.sh"
    return $false
}

function Install-Completions {
    $profileDir = Split-Path $PROFILE -Parent
    if (-not (Test-Path $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }

    # Cache the script to disk once; $PROFILE dot-sources it on shell
    # start. Avoids spawning the bun runtime per-session just to print
    # a static string, which `| Invoke-Expression` forces every time.
    $cacheDir = Join-Path $HOME ".atomic\completions"
    if (-not (Test-Path $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }
    $scriptPath = Join-Path $cacheDir "atomic.ps1"
    atomic completions powershell | Out-File -FilePath $scriptPath -Encoding utf8

    $marker = '# Atomic CLI completions (cached)'

    # Strip legacy pipe-to-Invoke-Expression snippet if present.
    if ((Test-Path $PROFILE) -and
        (Select-String -Path $PROFILE -Pattern 'atomic completions powershell \| Invoke-Expression' -Quiet)) {
        $filtered = Get-Content $PROFILE | Where-Object {
            $_ -notmatch '^# Atomic CLI completions$' -and
            $_ -notmatch 'atomic completions powershell \| Invoke-Expression'
        }
        Set-Content -Path $PROFILE -Value $filtered
    }

    if ((Test-Path $PROFILE) -and
        (Select-String -Path $PROFILE -Pattern ([regex]::Escape($marker)) -Quiet)) {
        return  # already installed
    }
    Add-Content -Path $PROFILE -Value "`n$marker`nif (Test-Path `"$scriptPath`") { . `"$scriptPath`" }"
}

# Cache the GitHub MCP token once per day so `gh auth token` isn't
# forked on every shell spawn. Mirrors the bash/zsh helper installed
# by install.sh.
function Install-GhTokenCache {
    $cacheDir = Join-Path $HOME ".atomic"
    if (-not (Test-Path $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }
    $scriptPath = Join-Path $cacheDir "gh-token-cache.ps1"

    $helperBody = @'
# Atomic: cache `gh auth token` for 24h to avoid shelling out on every
# shell spawn. Refreshes the cache lazily when it's missing or stale.
function Set-GitHubToken {
    if ($env:GITHUB_PERSONAL_ACCESS_TOKEN) { return }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { return }

    $cache = Join-Path $HOME '.atomic\gh-auth-token'
    if ((Test-Path $cache) -and
        ((Get-Date) - (Get-Item $cache).LastWriteTime).TotalMinutes -lt 1440) {
        $env:GITHUB_PERSONAL_ACCESS_TOKEN = [System.IO.File]::ReadAllText($cache).Trim()
        return
    }

    $tok = & gh auth token 2>$null
    if ($LASTEXITCODE -eq 0 -and $tok) {
        New-Item -ItemType Directory -Force -Path (Split-Path $cache) | Out-Null
        [System.IO.File]::WriteAllText($cache, $tok.Trim())
        $env:GITHUB_PERSONAL_ACCESS_TOKEN = $tok.Trim()
    }
}

Set-GitHubToken
'@

    Set-Content -Path $scriptPath -Value $helperBody -Encoding utf8

    $profileDir = Split-Path $PROFILE -Parent
    if (-not (Test-Path $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }

    $marker = '# Atomic CLI gh auth token cache'
    if ((Test-Path $PROFILE) -and
        (Select-String -Path $PROFILE -Pattern ([regex]::Escape($marker)) -Quiet)) {
        return
    }
    Add-Content -Path $PROFILE -Value "`n$marker`nif (Test-Path `"$scriptPath`") { . `"$scriptPath`" }"
}

# ── Main ────────────────────────────────────────────────────────────────────

# Count upcoming steps so the progress bar is honest.
$script:StepTotal = 3  # atomic install + completions + gh token cache
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    $script:StepTotal++
}

Write-Host ""

if (-not (Install-Bun)) { exit 1 }

# Embed the package name as a literal so the scriptblock needs no closure.
$atomicAction = [ScriptBlock]::Create("bun install -g '$PACKAGE'")
$ok = Invoke-Step -Label "Installing @bastani/atomic" -Action $atomicAction
if (-not $ok) {
    Write-Err2 "Failed to install atomic"
    exit 1
}

# Best-effort: don't fail the install if completions can't be set up
$ok = Invoke-Step -Label "Installing shell completions" -Action { Install-Completions }
if (-not $ok) {
    Write-Warn "Could not install PowerShell completions — run: atomic completions powershell | Invoke-Expression"
}

# Best-effort: gh token caching speeds up shell startup for MCP users
$ok = Invoke-Step -Label "Installing gh auth token cache" -Action { Install-GhTokenCache }
if (-not $ok) {
    Write-Warn "Could not install gh auth token cache"
}

Write-Host ""
Write-Host "  ${C_GREEN}✓${C_RESET} ${C_BOLD}Atomic installed successfully${C_RESET}"
Write-Host ""
Write-Host "    Get started:  ${C_CYAN}atomic chat -a <agent>${C_RESET}"
Write-Host ""
Write-Host "    ${C_DIM}Tooling deps and skills are synced silently on first launch.${C_RESET}"
Write-Host "    ${C_DIM}To upgrade later: bun update -g @bastani/atomic${C_RESET}"
Write-Host ""
