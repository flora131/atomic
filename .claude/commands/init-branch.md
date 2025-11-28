---
description: Initialize a new git branch for development based on the current task or feature being worked on. This command helps create a structured branch name and switches to that branch as well as initializing the initial environment with an init script and claude-progress.txt file to log progress.
model: sonnet
allowed-tools: AskUserQuestion, Edit, Task, TodoWrite, Write, Bash(git:*), Bash(gh:*), Bash(basename:*), Bash(date:*)
argument-hint: [feature-name]
---