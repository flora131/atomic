# Ralph Wiggum Session End Hook (Self-Restarting)
# Tracks iterations, checks completion conditions, spawns next session automatically
#
# This hook implements a self-restarting pattern: when the session ends,
# it spawns a new detached copilot-cli session to continue the loop.
# No external orchestrator required!

$ErrorActionPreference = "Stop"

# Read hook input from stdin
$InputJson = [Console]::In.ReadToEnd()
$HookInput = $InputJson | ConvertFrom-Json

# Parse input fields
$Timestamp = $HookInput.timestamp
$Cwd = $HookInput.cwd
$Reason = if ($HookInput.reason) { $HookInput.reason } else { "unknown" }

# State file location
$RalphStateFile = ".github/ralph-loop.local.json"
$RalphLogDir = ".github/logs"
$RalphContinueFile = ".github/ralph-continue.flag"

# Ensure log directory exists
if (-not (Test-Path $RalphLogDir)) {
    New-Item -ItemType Directory -Path $RalphLogDir -Force | Out-Null
}

# Log session end
$LogEntry = @{
    timestamp = $Timestamp
    event = "session_end"
    cwd = $Cwd
    reason = $Reason
} | ConvertTo-Json -Compress

Add-Content -Path "$RalphLogDir/ralph-sessions.jsonl" -Value $LogEntry

# Check if Ralph loop is active
if (-not (Test-Path $RalphStateFile)) {
    # No active loop - clean exit
    if (Test-Path $RalphContinueFile) {
        Remove-Item $RalphContinueFile -Force
    }
    exit 0
}

# Read current state
$State = Get-Content $RalphStateFile -Raw | ConvertFrom-Json
$Iteration = if ($State.iteration) { [int]$State.iteration } else { 0 }
$MaxIterations = if ($State.maxIterations) { [int]$State.maxIterations } else { 0 }
$CompletionPromise = if ($State.completionPromise) { $State.completionPromise } else { "null" }
$FeatureListPath = if ($State.featureListPath) { $State.featureListPath } else { "research/feature-list.json" }
$Prompt = if ($State.prompt) { $State.prompt } else { "" }
$LastOutputFile = if ($State.lastOutputFile) { $State.lastOutputFile } else { "" }

# Function to check if all features are passing
function Test-AllFeaturesPassing {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $false
    }

    try {
        $Features = Get-Content $Path -Raw | ConvertFrom-Json
        $TotalFeatures = $Features.Count

        if ($TotalFeatures -eq 0) {
            return $false
        }

        $PassingFeatures = ($Features | Where-Object { $_.passes -eq $true }).Count
        $FailingFeatures = $TotalFeatures - $PassingFeatures

        Write-Host "Feature Progress: $PassingFeatures / $TotalFeatures passing ($FailingFeatures remaining)"

        return $FailingFeatures -eq 0
    }
    catch {
        return $false
    }
}

# Function to check for completion promise in last output
function Test-CompletionPromise {
    param([string]$Promise, [string]$OutputFile)

    if ($Promise -eq "null" -or [string]::IsNullOrEmpty($Promise)) {
        return $false
    }

    if (-not (Test-Path $OutputFile)) {
        return $false
    }

    $Content = Get-Content $OutputFile -Raw
    $Match = [regex]::Match($Content, '(?s)<promise>(.*?)</promise>')

    if ($Match.Success) {
        $PromiseText = $Match.Groups[1].Value.Trim() -replace '\s+', ' '
        if ($PromiseText -eq $Promise) {
            Write-Host "Detected completion promise: <promise>$Promise</promise>"
            return $true
        }
    }

    return $false
}

# Check completion conditions
$ShouldContinue = $true
$StopReason = ""

# Check 1: Max iterations reached
if ($MaxIterations -gt 0 -and $Iteration -ge $MaxIterations) {
    $ShouldContinue = $false
    $StopReason = "max_iterations_reached"
    Write-Host "Ralph loop: Max iterations ($MaxIterations) reached." -ForegroundColor Yellow
}

# Check 2: All features passing (only in unlimited mode)
if ($ShouldContinue -and $MaxIterations -eq 0) {
    if (Test-AllFeaturesPassing -Path $FeatureListPath) {
        $ShouldContinue = $false
        $StopReason = "all_features_passing"
        Write-Host "Ralph loop: All features passing! Loop complete." -ForegroundColor Green
    }
}

# Check 3: Completion promise detected
if ($ShouldContinue -and -not [string]::IsNullOrEmpty($LastOutputFile)) {
    if (Test-CompletionPromise -Promise $CompletionPromise -OutputFile $LastOutputFile) {
        $ShouldContinue = $false
        $StopReason = "completion_promise_detected"
        Write-Host "Ralph loop: Completion promise detected! Loop complete." -ForegroundColor Green
    }
}

# Update state and spawn next session (or complete)
if ($ShouldContinue) {
    # Increment iteration for next run
    $NextIteration = $Iteration + 1

    # Update state file
    $State.iteration = $NextIteration
    $State | ConvertTo-Json -Depth 10 | Out-File -FilePath $RalphStateFile -Encoding utf8

    # Keep continue flag for status checking (optional)
    $Prompt | Out-File -FilePath $RalphContinueFile -Encoding utf8

    Write-Host "Ralph loop: Iteration $Iteration complete. Spawning iteration $NextIteration..." -ForegroundColor Cyan

    # Note: Prompt already contains the full prompt with <EXTREMELY_IMPORTANT> block from setup

    # Get current working directory for the spawned process
    $CurrentDir = (Get-Location).Path

    # Escape prompt for PowerShell (double single quotes)
    $EscapedPrompt = $Prompt -replace "'", "''"

    # Build the command to spawn
    # - Start-Sleep: brief delay to let current session fully close
    # - Set-Location: ensure we're in the right directory
    # - Pipe prompt to copilot-cli
    $SpawnCommand = @"
Start-Sleep -Seconds 2
Set-Location -Path '$CurrentDir'
'$EscapedPrompt' | copilot --allow-all-tools --allow-all-paths
"@

    # Spawn new copilot-cli session in background (detached, hidden window)
    # -WindowStyle Hidden: runs without visible window
    # -NoProfile: faster startup
    Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-WindowStyle", "Hidden",
        "-Command", $SpawnCommand
    ) -WindowStyle Hidden

    Write-Host "Ralph loop: Spawned background process for iteration $NextIteration" -ForegroundColor Cyan
}
else {
    # Loop complete - clean up
    if (Test-Path $RalphContinueFile) {
        Remove-Item $RalphContinueFile -Force
    }

    # Archive state file
    $ArchiveFile = "$RalphLogDir/ralph-loop-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    $State | Add-Member -NotePropertyName "completedAt" -NotePropertyValue (Get-Date -Format "o") -Force
    $State | Add-Member -NotePropertyName "stopReason" -NotePropertyValue $StopReason -Force
    $State | ConvertTo-Json -Depth 10 | Out-File -FilePath $ArchiveFile -Encoding utf8

    # Remove active state
    Remove-Item $RalphStateFile -Force

    Write-Host "Ralph loop completed. Reason: $StopReason" -ForegroundColor Green
    Write-Host "State archived to: $ArchiveFile" -ForegroundColor Gray
}

# Log completion status
$LogEntry = @{
    timestamp = (Get-Date -Format "o")
    event = "ralph_iteration_end"
    iteration = $Iteration
    shouldContinue = $ShouldContinue
    stopReason = $StopReason
} | ConvertTo-Json -Compress

Add-Content -Path "$RalphLogDir/ralph-sessions.jsonl" -Value $LogEntry

# Output is ignored for sessionEnd
exit 0
