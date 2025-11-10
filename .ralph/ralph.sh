#!/usr/bin/env bash

while :; do
  ./.ralph/sync.sh
  echo -e "===SLEEP===\n===SLEEP===\n"; echo 'looping';
  sleep 10;
done