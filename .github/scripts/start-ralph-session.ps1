# Ralph Wiggum Session Start Hook
# Detects active Ralph loops and logs session information
# Reference: gh-copilot-cli-docs/configuration.md - Session start hook

$ErrorActionPreference = "Stop"

# Read hook input from stdin (JSON format per gh-copilot-cli-docs/configuration.md)
$InputJson = [Console]::In.ReadToEnd()
$Input = $InputJson | ConvertFrom-Json

# Parse input fields
$Timestamp = $Input.timestamp
$Cwd = $Input.cwd
$Source = if ($Input.source) { $Input.source } else { "unknown" }
$InitialPrompt = $Input.initialPrompt

# State file location (using .github convention for GitHub Copilot)
$RalphStateFile = ".github/ralph-loop.local.json"
$RalphLogDir = ".github/logs"

# Ensure log directory exists
if (-not (Test-Path $RalphLogDir)) {
    New-Item -ItemType Directory -Path $RalphLogDir -Force | Out-Null
}

# Log session start
$LogEntry = @{
    timestamp = $Timestamp
    event = "session_start"
    cwd = $Cwd
    source = $Source
    initialPrompt = $InitialPrompt
} | ConvertTo-Json -Compress

Add-Content -Path "$RalphLogDir/ralph-sessions.jsonl" -Value $LogEntry

# Check if Ralph loop is active
if (Test-Path $RalphStateFile) {
    $State = Get-Content $RalphStateFile -Raw | ConvertFrom-Json

    $Iteration = if ($State.iteration) { $State.iteration } else { 0 }
    $MaxIterations = if ($State.maxIterations) { $State.maxIterations } else { 0 }
    $CompletionPromise = if ($State.completionPromise) { $State.completionPromise } else { "null" }
    $Prompt = if ($State.prompt) { $State.prompt } else { "" }

    # Output status message (visible to agent per gh-copilot-cli-docs/about.md)
    Write-Host "Ralph loop active - Iteration $Iteration" -ForegroundColor Cyan

    if ($MaxIterations -gt 0) {
        Write-Host "  Max iterations: $MaxIterations"
    } else {
        Write-Host "  Max iterations: unlimited"
    }

    if ($CompletionPromise -ne "null") {
        Write-Host "  Completion promise: $CompletionPromise"
    }

    Write-Host "  Prompt: $Prompt"

    # If this is a resume, increment iteration
    if ($Source -eq "resume" -or $Source -eq "startup") {
        $NewIteration = $Iteration + 1

        # Update state file with new iteration
        $State.iteration = $NewIteration
        $State | ConvertTo-Json -Depth 10 | Out-File -FilePath $RalphStateFile -Encoding utf8

        Write-Host "Ralph loop continuing at iteration $NewIteration" -ForegroundColor Cyan
    }
}

# Output is ignored for sessionStart per gh-copilot-cli-docs/configuration.md
exit 0
