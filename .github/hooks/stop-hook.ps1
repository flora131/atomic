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

# ============================================================================
# TELEMETRY TRACKING
# ============================================================================
# Track agent session telemetry by detecting custom agents from events.jsonl
# Agents are detected from Copilot's session state directory.
# IMPORTANT: This runs BEFORE Ralph loop check to ensure telemetry is captured
# for all sessions, not just Ralph loop sessions.

# Skip telemetry if not PowerShell 7+
$SKIP_TELEMETRY = $PSVersionTable.PSVersion.Major -lt 7

if (-not $SKIP_TELEMETRY) {
    try {
        # Get script directory and project root for relative imports
        $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

        # Source telemetry helper functions
        $TelemetryHelper = Join-Path $ProjectRoot "bin\telemetry-helper.ps1"

        if (Test-Path $TelemetryHelper) {
            . $TelemetryHelper

            if (Test-TelemetryEnabled) {
                # Detect agents from Copilot session events.jsonl
                $DetectedAgents = Get-CopilotAgents

                if ($DetectedAgents -and $DetectedAgents.Count -gt 0) {
                    # Write telemetry event with detected agents
                    Write-SessionEvent -AgentType "copilot" -Commands $DetectedAgents

                    # Spawn upload process
                    Start-TelemetryUpload
                }
            }
        }
    } catch {
        # Silent failure - telemetry must never break Copilot CLI
        # Debug logging available via ATOMIC_TELEMETRY_DEBUG=1
        if ($env:ATOMIC_TELEMETRY_DEBUG -eq '1') {
            Write-Error "[Telemetry] Failed during session tracking: $_"
        }
    }
}

# ============================================================================
# RALPH LOOP LOGIC
# ============================================================================

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

# Function to detect Copilot agents from session events.jsonl
function Get-CopilotAgents {
    <#
    .SYNOPSIS
        Detects custom agent invocations from Copilot CLI session events

    .DESCRIPTION
        Parses the most recent Copilot session's events.jsonl file to detect
        which custom agents were invoked during the session.
        Uses three detection methods for comprehensive coverage.

    .OUTPUTS
        System.String[] - Array of detected agent names
    #>

    # Copilot session state directory
    $copilotStateDir = Join-Path $env:USERPROFILE ".copilot\session-state"

    # Early exit if Copilot state directory doesn't exist
    if (-not (Test-Path $copilotStateDir)) {
        return @()
    }

    # Find the most recent session directory
    try {
        $latestSession = Get-ChildItem -Path $copilotStateDir -Directory -ErrorAction Stop |
                         Sort-Object LastWriteTime -Descending |
                         Select-Object -First 1
    } catch {
        return @()
    }

    if (-not $latestSession) {
        return @()
    }

    $eventsFile = Join-Path $latestSession.FullName "events.jsonl"

    if (-not (Test-Path $eventsFile)) {
        return @()
    }

    $foundAgents = @()

    # Parse events.jsonl line by line
    try {
        $lines = Get-Content -Path $eventsFile -ErrorAction Stop

        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }

            try {
                $event = $line | ConvertFrom-Json -ErrorAction Stop
                $eventType = $event.type

                # Method 1: Check assistant.message for task tool calls with agent_type
                # This handles natural language invocations like "use explain-code to..."
                if ($eventType -eq 'assistant.message') {
                    $toolRequests = $event.data.toolRequests
                    if ($toolRequests) {
                        foreach ($toolRequest in $toolRequests) {
                            if ($toolRequest.name -eq 'task' -and $toolRequest.arguments.agent_type) {
                                $agentName = $toolRequest.arguments.agent_type
                                $agentFile = ".github\agents\$agentName.md"

                                if (Test-Path $agentFile) {
                                    $foundAgents += "/$agentName"
                                }
                            }
                        }
                    }
                }

                # Method 2: Check tool.execution_complete for agent_name in telemetry
                # This is a fallback that captures agents from tool telemetry
                if ($eventType -eq 'tool.execution_complete') {
                    $agentName = $event.data.toolTelemetry.properties.agent_name
                    if ($agentName) {
                        $agentFile = ".github\agents\$agentName.md"

                        if (Test-Path $agentFile) {
                            $foundAgents += "/$agentName"
                        }
                    }
                }

                # Method 3: Check user.message transformedContent for agent instructions
                # This handles dropdown selections and direct CLI usage (copilot --agent=X)
                if ($eventType -eq 'user.message') {
                    $transformed = $event.data.transformedContent

                    if ($transformed -and $transformed -like '*<agent_instructions>*') {
                        # Extract the header line (first line after <agent_instructions>)
                        $lines = $transformed -split "`n"
                        $instructionsIndex = -1

                        for ($i = 0; $i -lt $lines.Count; $i++) {
                            if ($lines[$i] -match '<agent_instructions>') {
                                $instructionsIndex = $i
                                break
                            }
                        }

                        if ($instructionsIndex -ge 0 -and ($instructionsIndex + 1) -lt $lines.Count) {
                            $headerLine = $lines[$instructionsIndex + 1] -replace '^#\s*', ''

                            # Match against all agent file headers
                            $agentFiles = Get-ChildItem -Path ".github\agents\*.md" -ErrorAction SilentlyContinue

                            foreach ($agentFile in $agentFiles) {
                                # Extract header from agent file (first line starting with #, skip front matter)
                                $content = Get-Content -Path $agentFile.FullName -ErrorAction SilentlyContinue
                                $agentHeader = $null

                                foreach ($contentLine in $content) {
                                    if ($contentLine -match '^#\s+(.+)$') {
                                        $agentHeader = $Matches[1]
                                        break
                                    }
                                }

                                # Match header (case-sensitive exact match)
                                if ($agentHeader -ceq $headerLine) {
                                    $agentName = [System.IO.Path]::GetFileNameWithoutExtension($agentFile.Name)
                                    $foundAgents += "/$agentName"
                                    break
                                }
                            }
                        }
                    }
                }

            } catch {
                # Skip malformed JSON lines
                continue
            }
        }
    } catch {
        # Silent failure on file read errors
        return @()
    }

    # Return unique agents (preserving duplicates for frequency tracking)
    return $foundAgents
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
