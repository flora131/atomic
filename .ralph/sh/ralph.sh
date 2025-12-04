#!/usr/bin/env bash

max_iterations=${1:-0}

if [ "$max_iterations" -gt 0 ]; then
    for ((i = 1; i <= max_iterations; i++)); do
        echo "Iteration: $i / $max_iterations"
        ./.ralph/sync.sh
        echo -e "===SLEEP===\n===SLEEP===\n"
        echo "looping"
        sleep 10
    done
else
    while true; do
        ./.ralph/sync.sh
        echo -e "===SLEEP===\n===SLEEP===\n"
        echo "looping"
        sleep 10
    done
fi