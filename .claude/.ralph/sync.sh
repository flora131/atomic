#!/usr/bin/env bash

cat .ralph/prompt.md | \
    claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir . | \
    tee -a .ralph/claude_output.jsonl | \
    uvx --from rich python .ralph/visualize.py --debug