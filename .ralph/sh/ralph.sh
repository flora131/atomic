#!/usr/bin/env bash

max_iterations=0

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --max-iterations) max_iterations="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

count=0

while :; do
  if [ "$max_iterations" -gt 0 ] && [ "$count" -ge "$max_iterations" ]; then
      echo "Reached max iterations ($max_iterations)"
      break
  fi
  ((count++))
  echo "Iteration: $count"

  ./.ralph/sync.sh
  if [ $? -eq 0 ]; then
    echo -e "\033[0;32m===COMPLETE===\033[0m"
    echo "Detected <promise>COMPLETE</promise> - exiting loop"
    break
  fi

  echo -e "===SLEEP===\n===SLEEP===\n"; echo 'looping';
  sleep 10;
done