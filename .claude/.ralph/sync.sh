#!/usr/bin/env bash

cat .claude/.ralph/prompt.md | \
    claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir . | \
    tee -a .claude/.ralph/claude_output.jsonl | \
    uvx --from rich python .claude/.ralph/visualize.py --debug