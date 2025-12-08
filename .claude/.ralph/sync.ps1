# Ensure UTF-8 throughout the pipeline
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"

# Set console codepage to UTF-8 (suppressing output)
chcp 65001 | Out-Null

Get-Content .claude/.ralph/prompt.md -Encoding UTF8 |
    claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir . |
    Tee-Object -FilePath .claude/.ralph/claude_output.jsonl -Append |
    uvx --from rich python .claude/.ralph/visualize.py --debug