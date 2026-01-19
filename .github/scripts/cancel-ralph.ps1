# Cancel Ralph Loop Script
# Removes state file, continue flag, and kills any spawned processes

$ErrorActionPreference = "Stop"

$RalphStateFile = ".github/ralph-loop.local.json"
$RalphContinueFile = ".github/ralph-continue.flag"
$RalphLogDir = ".github/logs"

# Function to kill Ralph-related processes
function Stop-RalphProcesses {
    Write-Host "Stopping spawned processes..." -ForegroundColor Yellow

    # Kill any gh.exe processes (GitHub CLI)
    $ghProcesses = Get-Process -Name "gh" -ErrorAction SilentlyContinue
    if ($ghProcesses) {
        $ghProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host "  Killed gh.exe processes." -ForegroundColor Gray
    }

    # Kill any PowerShell processes that were spawned for Ralph loop
    # Look for hidden PowerShell windows running gh copilot
    $psProcesses = Get-Process -Name "powershell", "pwsh" -ErrorAction SilentlyContinue |
        Where-Object {
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
                $cmdLine -and ($cmdLine -like "*gh copilot*" -or $cmdLine -like "*ralph*")
            } catch {
                $false
            }
        }

    if ($psProcesses) {
        $psProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host "  Killed spawned PowerShell processes." -ForegroundColor Gray
    }

    if (-not $ghProcesses -and -not $psProcesses) {
        Write-Host "  No Ralph-related processes found." -ForegroundColor Gray
    }
}

# Check if Ralph loop is active
if (-not (Test-Path $RalphStateFile)) {
    Write-Host "No active Ralph loop found."

    # Still try to kill any orphaned processes
    Write-Host "Checking for orphaned Ralph processes..."
    Stop-RalphProcesses
    exit 0
}

# Read current state
$State = Get-Content $RalphStateFile -Raw | ConvertFrom-Json
$Iteration = if ($State.iteration) { $State.iteration } else { 0 }
$Prompt = if ($State.prompt) { $State.prompt } else { "" }
$StartedAt = if ($State.startedAt) { $State.startedAt } else { "" }

# Ensure log directory exists
if (-not (Test-Path $RalphLogDir)) {
    New-Item -ItemType Directory -Path $RalphLogDir -Force | Out-Null
}

# Archive state file
$ArchiveFile = "$RalphLogDir/ralph-loop-cancelled-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$State | Add-Member -NotePropertyName "cancelledAt" -NotePropertyValue (Get-Date -Format "o") -Force
$State | Add-Member -NotePropertyName "stopReason" -NotePropertyValue "user_cancelled" -Force
$State | ConvertTo-Json -Depth 10 | Out-File -FilePath $ArchiveFile -Encoding utf8

# Remove state files
Remove-Item $RalphStateFile -Force
if (Test-Path $RalphContinueFile) {
    Remove-Item $RalphContinueFile -Force
}

# Kill any spawned Ralph processes
Stop-RalphProcesses

Write-Host ""
Write-Host "Cancelled Ralph loop (was at iteration $Iteration)" -ForegroundColor Green
Write-Host ""
Write-Host "Details:"
Write-Host "  Started at: $StartedAt"
Write-Host "  Prompt: $Prompt"
Write-Host "  State archived to: $ArchiveFile"
Write-Host ""
Write-Host "All Ralph processes have been terminated." -ForegroundColor Green
