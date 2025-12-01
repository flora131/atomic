$OutputEncoding = [System.Text.Encoding]::UTF8

Get-Content .ralph\prompt.md -Encoding UTF8 |
    claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir . |
    Tee-Object -FilePath .ralph\claude_output.jsonl -Append |
    uv run --no-project .ralph\visualize.py --debug
