# Ralph Loop Setup Script
# Creates state file for Ralph loop with GitHub Copilot hooks

$ErrorActionPreference = "Stop"

# Parse arguments
$PromptParts = @()
$MaxIterations = 0
$CompletionPromise = "null"
$FeatureListPath = "research/feature-list.json"

$i = 0
while ($i -lt $args.Count) {
    switch ($args[$i]) {
        "-h" {
            Write-Host @"
Ralph Loop - Interactive self-referential development loop for GitHub Copilot

USAGE:
  /ralph-loop [PROMPT...] [OPTIONS]

ARGUMENTS:
  PROMPT...    Initial prompt to start the loop (default: /implement-feature)

OPTIONS:
  --max-iterations <n>           Maximum iterations before auto-stop (default: unlimited)
  --completion-promise '<text>'  Promise phrase (USE QUOTES for multi-word)
  --feature-list <path>          Path to feature list JSON (default: research/feature-list.json)
  -h, --help                     Show this help message

DESCRIPTION:
  Starts a Ralph Wiggum loop using GitHub Copilot hooks. The sessionEnd hook
  tracks iterations and signals completion to an external orchestrator.

  NOTE: Unlike Claude Code, GitHub Copilot hooks cannot block session exit.
  Use an external loop for full Ralph behavior:
    while (Test-Path .github/ralph-continue.flag) {
      `$Prompt = Get-Content .github/ralph-continue.flag
      `$Prompt | copilot --allow-all-tools --allow-all-paths
    }

STOPPING:
  Loop exits when any of these conditions are met:
  - --max-iterations limit reached
  - --completion-promise detected in output
  - All features in --feature-list are passing (when max_iterations = 0)
"@
            exit 0
        }
        "--help" {
            # Same as -h
            exit 0
        }
        "--max-iterations" {
            $i++
            if ($i -ge $args.Count) {
                Write-Error "Error: --max-iterations requires a number argument"
                exit 1
            }
            $MaxIterations = [int]$args[$i]
            $i++
        }
        "--completion-promise" {
            $i++
            if ($i -ge $args.Count) {
                Write-Error "Error: --completion-promise requires a text argument"
                exit 1
            }
            $CompletionPromise = $args[$i]
            $i++
        }
        "--feature-list" {
            $i++
            if ($i -ge $args.Count) {
                Write-Error "Error: --feature-list requires a path argument"
                exit 1
            }
            $FeatureListPath = $args[$i]
            $i++
        }
        default {
            $PromptParts += $args[$i]
            $i++
        }
    }
}

# Join all prompt parts with spaces
$Prompt = $PromptParts -join " "

# Default to /implement-feature if no prompt provided
if ([string]::IsNullOrEmpty($Prompt)) {
    $Prompt = "/implement-feature"
}

# If using /implement-feature, verify feature list exists
if ($Prompt -eq "/implement-feature" -and -not (Test-Path $FeatureListPath)) {
    Write-Error @"
Error: Feature list not found at: $FeatureListPath

   The /implement-feature prompt requires a feature list to work.

   To fix this, either:
     1. Create the feature list: /create-feature-list
     2. Specify a different path: --feature-list <path>
     3. Use a custom prompt instead
"@
    exit 1
}

# Ensure .github directory exists
if (-not (Test-Path ".github")) {
    New-Item -ItemType Directory -Path ".github" -Force | Out-Null
}

# Create state file (JSON format for GitHub Copilot hooks)
$State = @{
    active = $true
    iteration = 1
    maxIterations = $MaxIterations
    completionPromise = $CompletionPromise
    featureListPath = $FeatureListPath
    prompt = $Prompt
    startedAt = (Get-Date -Format "o")
}

$State | ConvertTo-Json -Depth 10 | Out-File -FilePath ".github/ralph-loop.local.json" -Encoding utf8

# Create continue flag for orchestrator
$Prompt | Out-File -FilePath ".github/ralph-continue.flag" -Encoding utf8

# Output setup message
$MaxIterDisplay = if ($MaxIterations -gt 0) { $MaxIterations } else { "unlimited" }
$PromiseDisplay = if ($CompletionPromise -ne "null") { "$CompletionPromise (ONLY output when TRUE!)" } else { "none (runs forever)" }

Write-Host @"
Ralph loop activated for GitHub Copilot!

Iteration: 1
Max iterations: $MaxIterDisplay
Completion promise: $PromiseDisplay
Feature list: $FeatureListPath

State file: .github/ralph-loop.local.json
Continue flag: .github/ralph-continue.flag

NOTE: GitHub Copilot hooks track state but cannot block session exit.
For full Ralph loop behavior, use an external orchestrator:

  while (Test-Path .github/ralph-continue.flag) {
    `$Prompt = Get-Content .github/ralph-continue.flag
    `$Prompt | copilot --allow-all-tools --allow-all-paths
  }

"@

# Output the initial prompt
if (-not [string]::IsNullOrEmpty($Prompt)) {
    Write-Host ""
    Write-Host $Prompt
}

# Display completion promise requirements if set
if ($CompletionPromise -ne "null") {
    Write-Host ""
    Write-Host "==========================================="
    Write-Host "CRITICAL - Ralph Loop Completion Promise"
    Write-Host "==========================================="
    Write-Host ""
    Write-Host "To complete this loop, output this EXACT text:"
    Write-Host "  <promise>$CompletionPromise</promise>"
    Write-Host ""
    Write-Host "STRICT REQUIREMENTS:"
    Write-Host "  - Use <promise> XML tags EXACTLY as shown"
    Write-Host "  - The statement MUST be completely TRUE"
    Write-Host "  - Do NOT output false statements to exit"
    Write-Host "==========================================="
}
