# Ralph Loop Setup Script
# Creates state file for in-session Ralph loop

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Arguments
)

$ErrorActionPreference = "Stop"

# Parse arguments
$PromptParts = @()
$MaxIterations = 0
$CompletionPromise = "null"
$FeatureListPath = "research/feature-list.json"
$ShowHelp = $false

$i = 0
while ($i -lt $Arguments.Count) {
    $arg = $Arguments[$i]

    switch -Regex ($arg) {
        "^(-h|--help)$" {
            $ShowHelp = $true
            $i++
        }
        "^--max-iterations$" {
            if ($i + 1 -ge $Arguments.Count -or [string]::IsNullOrEmpty($Arguments[$i + 1])) {
                Write-Error @"
Error: --max-iterations requires a number argument

   Valid examples:
     --max-iterations 10
     --max-iterations 50
     --max-iterations 0  (unlimited)

   You provided: --max-iterations (with no number)
"@
                exit 1
            }
            $nextArg = $Arguments[$i + 1]
            if ($nextArg -notmatch '^\d+$') {
                Write-Error @"
Error: --max-iterations must be a positive integer or 0, got: $nextArg

   Valid examples:
     --max-iterations 10
     --max-iterations 50
     --max-iterations 0  (unlimited)

   Invalid: decimals (10.5), negative numbers (-5), text
"@
                exit 1
            }
            $MaxIterations = [int]$nextArg
            $i += 2
        }
        "^--completion-promise$" {
            if ($i + 1 -ge $Arguments.Count -or [string]::IsNullOrEmpty($Arguments[$i + 1])) {
                Write-Error @"
Error: --completion-promise requires a text argument

   Valid examples:
     --completion-promise 'DONE'
     --completion-promise 'TASK COMPLETE'
     --completion-promise 'All tests passing'

   You provided: --completion-promise (with no text)

   Note: Multi-word promises must be quoted!
"@
                exit 1
            }
            $CompletionPromise = $Arguments[$i + 1]
            $i += 2
        }
        "^--feature-list$" {
            if ($i + 1 -ge $Arguments.Count -or [string]::IsNullOrEmpty($Arguments[$i + 1])) {
                Write-Error @"
Error: --feature-list requires a path argument

   Valid examples:
     --feature-list research/feature-list.json
     --feature-list features.json

   You provided: --feature-list (with no path)
"@
                exit 1
            }
            $FeatureListPath = $Arguments[$i + 1]
            $i += 2
        }
        default {
            # Non-option argument - collect as prompt part
            $PromptParts += $arg
            $i++
        }
    }
}

if ($ShowHelp) {
    @"
Ralph Loop - Interactive self-referential development loop

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
  Starts a Ralph Wiggum loop in your CURRENT session. The stop hook prevents
  exit and feeds your output back as input until completion or iteration limit.

  To signal completion, you must output: <promise>YOUR_PHRASE</promise>

  Use this for:
  - Interactive iteration where you want to see progress
  - Tasks requiring self-correction and refinement
  - Learning how Ralph works

EXAMPLES:
  /ralph-loop                       (uses /implement-feature, runs until all features pass)
  /ralph-loop --max-iterations 20   (uses /implement-feature with iteration limit)
  /ralph-loop Build a todo API --completion-promise 'DONE' --max-iterations 20
  /ralph-loop Refactor cache layer  (custom prompt, runs forever)

STOPPING:
  Loop exits when any of these conditions are met:
  - --max-iterations limit reached
  - --completion-promise detected in output
  - All features in --feature-list are passing (when max_iterations = 0)

MONITORING:
  # View current iteration:
  Select-String -Path .claude/ralph-loop.local.md -Pattern '^iteration:'

  # View full state:
  Get-Content .claude/ralph-loop.local.md -Head 10
"@
    exit 0
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

# Create state file for stop hook (markdown with YAML frontmatter)
$claudeDir = ".claude"
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

# Quote completion promise for YAML if it contains special chars or is not null
if (-not [string]::IsNullOrEmpty($CompletionPromise) -and $CompletionPromise -ne "null") {
    $CompletionPromiseYaml = "`"$CompletionPromise`""
} else {
    $CompletionPromiseYaml = "null"
}

$startedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$stateContent = @"
---
active: true
iteration: 1
max_iterations: $MaxIterations
completion_promise: $CompletionPromiseYaml
feature_list_path: $FeatureListPath
started_at: "$startedAt"
---

$Prompt
"@

$stateContent | Out-File -FilePath ".claude/ralph-loop.local.md" -Encoding utf8 -NoNewline

# Output setup message
$maxIterDisplay = if ($MaxIterations -gt 0) { $MaxIterations } else { "unlimited" }
$promiseDisplay = if ($CompletionPromise -ne "null") { "$CompletionPromise (ONLY output when TRUE - do not lie!)" } else { "none (runs forever)" }

@"
Ralph loop activated in this session!

Iteration: 1
Max iterations: $maxIterDisplay
Completion promise: $promiseDisplay

The stop hook is now active. When you try to exit, the SAME PROMPT will be
fed back to you. You'll see your previous work in files, creating a
self-referential loop where you iteratively improve on the same task.

To monitor: Get-Content .claude/ralph-loop.local.md -Head 10

WARNING: This loop cannot be stopped manually! It will run infinitely
    unless you set --max-iterations or --completion-promise.

"@

# Output the initial prompt if provided
if (-not [string]::IsNullOrEmpty($Prompt)) {
    Write-Output ""
    Write-Output $Prompt
}

# Display completion promise requirements if set
if ($CompletionPromise -ne "null") {
    @"

===============================================================
CRITICAL - Ralph Loop Completion Promise
===============================================================

To complete this loop, output this EXACT text:
  <promise>$CompletionPromise</promise>

STRICT REQUIREMENTS (DO NOT VIOLATE):
  Use <promise> XML tags EXACTLY as shown above
  The statement MUST be completely and unequivocally TRUE
  Do NOT output false statements to exit the loop
  Do NOT lie even if you think you should exit

IMPORTANT - Do not circumvent the loop:
  Even if you believe you're stuck, the task is impossible,
  or you've been running too long - you MUST NOT output a
  false promise statement. The loop is designed to continue
  until the promise is GENUINELY TRUE. Trust the process.

  If the loop should stop, the promise statement will become
  true naturally. Do not force it by lying.
===============================================================
"@
}
