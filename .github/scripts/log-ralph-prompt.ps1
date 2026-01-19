# Ralph Wiggum User Prompt Submitted Hook
# Logs user prompts for debugging and audit
# User prompt submitted hook

$ErrorActionPreference = "Stop"

# Read hook input from stdin
$InputJson = [Console]::In.ReadToEnd()
$HookInput = $InputJson | ConvertFrom-Json

# Parse input fields
$Timestamp = $HookInput.timestamp
$Cwd = $HookInput.cwd
$Prompt = $HookInput.prompt

# State file location
$RalphStateFile = ".github/ralph-loop.local.json"
$RalphLogDir = ".github/logs"

# Ensure log directory exists
if (-not (Test-Path $RalphLogDir)) {
    New-Item -ItemType Directory -Path $RalphLogDir -Force | Out-Null
}

# Get log level from environment (set in hooks.json)
$LogLevel = if ($env:RALPH_LOG_LEVEL) { $env:RALPH_LOG_LEVEL } else { "INFO" }

# Log user prompt
$LogEntry = @{
    timestamp = $Timestamp
    event = "user_prompt_submitted"
    cwd = $Cwd
    prompt = $Prompt
} | ConvertTo-Json -Compress

Add-Content -Path "$RalphLogDir/ralph-sessions.jsonl" -Value $LogEntry

# If Ralph loop is active, show iteration context
if (Test-Path $RalphStateFile) {
    $State = Get-Content $RalphStateFile -Raw | ConvertFrom-Json
    $Iteration = if ($State.iteration) { $State.iteration } else { 0 }
    $ExpectedPrompt = if ($State.prompt) { $State.prompt } else { "" }

    if ($LogLevel -eq "DEBUG") {
        Write-Host "Ralph loop iteration $Iteration - Prompt received"
        Write-Host "  Expected: $ExpectedPrompt"
        Write-Host "  Received: $Prompt"
    }
}

# Output is ignored for userPromptSubmitted
exit 0
