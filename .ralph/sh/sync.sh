#!/usr/bin/env bash

output_file=".ralph/claude_output.jsonl"

# Run claude with prompt and capture output
output=$(cat .ralph/prompt.md | \
    claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir .)

# Append to output file
printf "%s\n" "$output" >> "$output_file"

# Pipe to visualize script
printf "%s\n" "$output" | uv run --no-project .ralph/visualize.py --debug

# Check for completion marker and return result
if printf "%s\n" "$output" | grep -q "<promise>COMPLETE</promise>"; then
    exit 0
fi
exit 1