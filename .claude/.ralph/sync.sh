#!/usr/bin/env bash

# Ensure UTF-8 throughout the pipeline
export PYTHONIOENCODING="utf-8"
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"

cat .claude/.ralph/prompt.md | \
    claude -p --output-format=stream-json --verbose --dangerously-skip-permissions --add-dir . | \
    tee -a .claude/.ralph/claude_output.jsonl | \
    uvx --from rich python .claude/.ralph/visualize.py --debug