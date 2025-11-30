---
description: Create a new branch, commit changes, and submit a pull request.
agent: build
model: anthropic/claude-sonnet-4-5
---

# Create Pull Request Command

Create a new branch, commit changes, and submit a pull request.

## Current Repository State

- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Staged changes: !`git diff --cached --stat`
- Unstaged changes: !`git diff --stat`
- Recent commits: !`git log --oneline -5`

## Behavior

1. Creates a new branch based on current changes
2. Formats modified files using project formatter
3. Analyzes changes and automatically splits into logical commits when appropriate
4. Each commit focuses on a single logical change or feature
5. Creates descriptive commit messages for each logical unit
6. Pushes branch to remote
7. Creates pull request with proper summary and test plan

## Guidelines for Automatic Commit Splitting

- Split commits by feature, component, or concern
- Keep related file changes together in the same commit
- Separate refactoring from feature additions
- Ensure each commit can be understood independently
- Multiple unrelated changes should be split into separate commits

## PR Creation Format

When creating the PR, use this format:

```
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]
EOF
)"
```

## Important Notes

- Always run tests before creating PR
- Ensure all CI checks pass
- Include relevant issue references
- Add reviewers if specified
- Return the PR URL when complete
