---
description: Implement an execution plan for a codebase.
model: sonnet
allowed-tools: Bash, Task, Edit, Glob, Grep, NotebookEdit, NotebookRead, Read, Write
argument-hint: [exec-plan-path, feature-name, feature-list-path]
---

You are tasked with implementing the execution plan located in **$1** for a SINGLE feature, **$2**, in **$3**.

IMPORTANT: ONLY implement the SINGLE feature then STOP.

Read the provided document as it describes the current state of the codebase. No need to explore the codebase, as the execution already describes the state and you can reference the thoughts folder for further context.