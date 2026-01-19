# Ralph Wiggum Stop Hook
# Prevents session exit when a ralph-loop is active
# Feeds Claude's output back as input to continue the loop

$ErrorActionPreference = "Stop"

# Read hook input from stdin (advanced stop hook API)
$HookInput = $input | Out-String

# Check if ralph-loop is active
$RalphStateFile = ".claude/ralph-loop.local.md"

if (-not (Test-Path $RalphStateFile)) {
    # No active loop - allow exit
    exit 0
}

# Read state file content
$stateContent = Get-Content $RalphStateFile -Raw

# Parse markdown frontmatter (YAML between ---) and extract values
$frontmatterMatch = [regex]::Match($stateContent, '(?s)^---\r?\n(.*?)\r?\n---')
if (-not $frontmatterMatch.Success) {
    Write-Error "Ralph loop: State file corrupted - no valid frontmatter"
    Remove-Item $RalphStateFile -Force
    exit 0
}

$frontmatter = $frontmatterMatch.Groups[1].Value

# Extract values from frontmatter
function Get-FrontmatterValue {
    param([string]$Content, [string]$Key, [string]$Default = "")
    $match = [regex]::Match($Content, "(?m)^${Key}:\s*(.*)$")
    if ($match.Success) {
        $value = $match.Groups[1].Value.Trim()
        # Strip surrounding quotes if present
        if ($value -match '^"(.*)"$') {
            return $Matches[1]
        }
        return $value
    }
    return $Default
}

$Iteration = Get-FrontmatterValue -Content $frontmatter -Key "iteration" -Default "0"
$MaxIterations = Get-FrontmatterValue -Content $frontmatter -Key "max_iterations" -Default "0"
$CompletionPromise = Get-FrontmatterValue -Content $frontmatter -Key "completion_promise" -Default "null"
$FeatureListPath = Get-FrontmatterValue -Content $frontmatter -Key "feature_list_path" -Default "research/feature-list.json"

# Validate numeric fields before arithmetic operations
if ($Iteration -notmatch '^\d+$') {
    Write-Host "Warning: Ralph loop: State file corrupted" -ForegroundColor Yellow
    Write-Host "   File: $RalphStateFile"
    Write-Host "   Problem: 'iteration' field is not a valid number (got: '$Iteration')"
    Write-Host ""
    Write-Host "   This usually means the state file was manually edited or corrupted."
    Write-Host "   Ralph loop is stopping. Run /ralph-loop again to start fresh."
    Remove-Item $RalphStateFile -Force
    exit 0
}

if ($MaxIterations -notmatch '^\d+$') {
    Write-Host "Warning: Ralph loop: State file corrupted" -ForegroundColor Yellow
    Write-Host "   File: $RalphStateFile"
    Write-Host "   Problem: 'max_iterations' field is not a valid number (got: '$MaxIterations')"
    Write-Host ""
    Write-Host "   This usually means the state file was manually edited or corrupted."
    Write-Host "   Ralph loop is stopping. Run /ralph-loop again to start fresh."
    Remove-Item $RalphStateFile -Force
    exit 0
}

$IterationInt = [int]$Iteration
$MaxIterationsInt = [int]$MaxIterations

# Check if max iterations reached
if ($MaxIterationsInt -gt 0 -and $IterationInt -ge $MaxIterationsInt) {
    Write-Host "Ralph loop: Max iterations ($MaxIterations) reached."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Check if all features are passing (only when max_iterations = 0, i.e., infinite mode)
function Test-AllFeaturesPassing {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $false
    }

    try {
        $features = Get-Content $Path -Raw | ConvertFrom-Json
        $totalFeatures = $features.Count

        if ($totalFeatures -eq 0) {
            Write-Host "ERROR: $Path is empty." -ForegroundColor Red
            return $false
        }

        $passingFeatures = ($features | Where-Object { $_.passes -eq $true }).Count
        $failingFeatures = $totalFeatures - $passingFeatures

        Write-Host "Feature Progress: $passingFeatures / $totalFeatures passing ($failingFeatures remaining)"

        return $failingFeatures -eq 0
    }
    catch {
        Write-Host "ERROR: Failed to parse $Path : $_" -ForegroundColor Red
        return $false
    }
}

if ($MaxIterationsInt -eq 0 -and (Test-AllFeaturesPassing -Path $FeatureListPath)) {
    Write-Host "All features passing! Exiting loop."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Get transcript path from hook input
try {
    $hookData = $HookInput | ConvertFrom-Json
    $TranscriptPath = $hookData.transcript_path
}
catch {
    Write-Host "Warning: Ralph loop: Failed to parse hook input" -ForegroundColor Yellow
    Remove-Item $RalphStateFile -Force
    exit 0
}

if (-not (Test-Path $TranscriptPath)) {
    Write-Host "Warning: Ralph loop: Transcript file not found" -ForegroundColor Yellow
    Write-Host "   Expected: $TranscriptPath"
    Write-Host "   This is unusual and may indicate a Claude Code internal issue."
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Read last assistant message from transcript (JSONL format - one JSON per line)
$transcriptLines = Get-Content $TranscriptPath
$assistantLines = $transcriptLines | Where-Object { $_ -match '"role":"assistant"' }

if ($assistantLines.Count -eq 0) {
    Write-Host "Warning: Ralph loop: No assistant messages found in transcript" -ForegroundColor Yellow
    Write-Host "   Transcript: $TranscriptPath"
    Write-Host "   This is unusual and may indicate a transcript format issue"
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

$lastLine = $assistantLines | Select-Object -Last 1

if ([string]::IsNullOrEmpty($lastLine)) {
    Write-Host "Warning: Ralph loop: Failed to extract last assistant message" -ForegroundColor Yellow
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Parse JSON with error handling
try {
    $lastMessage = $lastLine | ConvertFrom-Json
    $textContents = $lastMessage.message.content | Where-Object { $_.type -eq "text" }
    $LastOutput = ($textContents | ForEach-Object { $_.text }) -join "`n"
}
catch {
    Write-Host "Warning: Ralph loop: Failed to parse assistant message JSON" -ForegroundColor Yellow
    Write-Host "   Error: $_"
    Write-Host "   This may indicate a transcript format issue"
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

if ([string]::IsNullOrEmpty($LastOutput)) {
    Write-Host "Warning: Ralph loop: Assistant message contained no text content" -ForegroundColor Yellow
    Write-Host "   Ralph loop is stopping."
    Remove-Item $RalphStateFile -Force
    exit 0
}

# Check for completion promise (only if set)
if ($CompletionPromise -ne "null" -and -not [string]::IsNullOrEmpty($CompletionPromise)) {
    # Extract text from <promise> tags
    $promiseMatch = [regex]::Match($LastOutput, '(?s)<promise>(.*?)</promise>')
    if ($promiseMatch.Success) {
        $promiseText = $promiseMatch.Groups[1].Value.Trim() -replace '\s+', ' '

        if ($promiseText -eq $CompletionPromise) {
            Write-Host "Ralph loop: Detected <promise>$CompletionPromise</promise>"
            Remove-Item $RalphStateFile -Force
            exit 0
        }
    }
}

# Not complete - continue loop with SAME PROMPT
$NextIteration = $IterationInt + 1

# Extract prompt (everything after the closing ---)
$promptMatch = [regex]::Match($stateContent, '(?s)^---\r?\n.*?\r?\n---\r?\n(.*)$')
if (-not $promptMatch.Success -or [string]::IsNullOrEmpty($promptMatch.Groups[1].Value.Trim())) {
    Write-Host "Warning: Ralph loop: State file corrupted or incomplete" -ForegroundColor Yellow
    Write-Host "   File: $RalphStateFile"
    Write-Host "   Problem: No prompt text found"
    Write-Host ""
    Write-Host "   This usually means:"
    Write-Host "     - State file was manually edited"
    Write-Host "     - File was corrupted during writing"
    Write-Host ""
    Write-Host "   Ralph loop is stopping. Run /ralph-loop again to start fresh."
    Remove-Item $RalphStateFile -Force
    exit 0
}

$PromptText = $promptMatch.Groups[1].Value.Trim()

# Update iteration in frontmatter
$updatedContent = $stateContent -replace '(?m)^iteration:\s*\d+', "iteration: $NextIteration"
$updatedContent | Out-File -FilePath $RalphStateFile -Encoding utf8 -NoNewline

# Build system message with iteration count and completion promise info
if ($CompletionPromise -ne "null" -and -not [string]::IsNullOrEmpty($CompletionPromise)) {
    $SystemMsg = "Ralph iteration $NextIteration | To stop: output <promise>$CompletionPromise</promise> (ONLY when statement is TRUE - do not lie to exit!)"
} else {
    $SystemMsg = "Ralph iteration $NextIteration | No completion promise set - loop runs infinitely"
}

# Append critical instructions to prompt
$PromptText = "$PromptText

<EXTREMELY_IMPORTANT>
- Implement features incrementally, make small changes each iteration.
  - Only work on the SINGLE highest priority feature at a time.
  - Use the ``feature-list.json`` file if it is provided to you as a guide otherwise create your own ``feature-list.json`` based on the task.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
</EXTREMELY_IMPORTANT>"

# Output JSON to block the stop and feed prompt back
$output = @{
    decision = "block"
    reason = $PromptText
    systemMessage = $SystemMsg
} | ConvertTo-Json -Compress

Write-Output $output

# Exit 0 for successful hook execution
exit 0
