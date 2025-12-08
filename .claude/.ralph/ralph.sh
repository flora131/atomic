#!/usr/bin/env bash

print_usage() {
    cat <<'USAGE'
Usage: ./.claude/.ralph/ralph.sh [max_iterations] [completion_marker]

Arguments:
  max_iterations    Number of loop iterations (0 = infinite, default: 0)
    completion_marker Marker to stop after detecting in .claude/.ralph/claude_output.jsonl
                                        (default: <promise>COMPLETE</promise>)
USAGE
}

if [[ $1 == "-h" || $1 == "--help" ]]; then
    print_usage
    exit 0
fi

max_iterations=${1:-0}
completion_marker=${2:-"<promise>COMPLETE</promise>"}
output_log=".claude/.ralph/claude_output.jsonl"

check_completion() {
    if [ -f "$output_log" ] && grep -q "$completion_marker" "$output_log"; then
        echo "Completion promise detected. Exiting loop."
        return 0
    fi

    return 1
}

if [ "$max_iterations" -gt 0 ]; then
    for ((i = 1; i <= max_iterations; i++)); do
        echo "Iteration: $i / $max_iterations"
        ./.claude/.ralph/sync.sh
        if check_completion; then
            break
        fi
        echo -e "===SLEEP===\n===SLEEP===\n"
        echo "looping"
        sleep 10
    done
else
    while true; do
        ./.claude/.ralph/sync.sh
        if check_completion; then
            break
        fi
        echo -e "===SLEEP===\n===SLEEP===\n"
        echo "looping"
        sleep 10
    done
fi