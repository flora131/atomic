$outputFile = ".ralph/claude_output.jsonl"

# Run claude with prompt and capture output
$output = Get-Content .ralph/prompt.md | 
    claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir .

# Append to output file
$output | Add-Content -Path $outputFile

# Pipe to visualize script
$output | uv run --no-project .ralph/visualize.py --debug

# Check for completion marker and return result
if ($output -match '<promise>COMPLETE</promise>') {
    return $true
}
return $false
