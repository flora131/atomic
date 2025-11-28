---
description: Initialize a new git branch for development based on the current task or feature being worked on. This command helps create a structured branch name and switches to that branch as well as initializing the initial environment with an init script and claude-progress.txt file to log progress.
model: sonnet
allowed-tools: Edit, Task, TodoWrite, Write
---

1. If a `claude-progress.txt` file already exists in the repository root, remove it.
2. Create an empty `claude-progress.txt` file to log your development progress.
3. 