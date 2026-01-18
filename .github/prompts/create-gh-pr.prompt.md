---
description: Commit unstaged changes, push changes, submit a pull request.
tools: ["execute", "search", "read", "agent"]
model: claude-opus-4-5
argument-hint: [code-path]
---

# Create Pull Request Command

Commit changes using the `/commit` command, push all changes, and submit a pull request.

## Behavior
- Creates logical commits for unstaged changes
- Pushes branch to remote
- Creates pull request with proper name and description of the changes in the PR body
