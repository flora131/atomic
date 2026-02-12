---
description: Create well-formatted commits with conventional commit format using Sapling.
model: opus
allowed-tools: Bash(sl add:*), Bash(sl status:*), Bash(sl commit:*), Bash(sl diff:*), Bash(sl smartlog:*), Bash(sl amend:*), Bash(sl absorb:*)
argument-hint: [message] | --amend
---

# Smart Sapling Commit

Create well-formatted commit: $ARGUMENTS

## Current Repository State

- Sapling status: !`sl status`
- Current bookmark: !`sl bookmark`
- Recent commits (smartlog): !`sl smartlog -l 5`
- Pending changes: !`sl diff --stat`

## What This Command Does

1. Checks which files have changes with `sl status`
2. If there are untracked files to include, adds them with `sl add`
3. Performs a `sl diff` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit (or the single commit if not split), creates a commit message using conventional commit format

## Key Sapling Differences from Git

- **No staging area**: Sapling commits all pending changes directly (no separate "git add" step for staging)
- **Amend with auto-restack**: `sl amend` automatically rebases descendant commits
- **Smartlog**: Use `sl smartlog` or `sl ssl` for graphical commit history with diff status
- **Absorb**: Use `sl absorb` to intelligently integrate pending changes into the right commits in a stack
- **Stacked Diffs**: Each commit in a stack becomes a separate Phabricator diff when submitted

## Sapling Commit Commands Reference

| Command | Description |
|---------|-------------|
| `sl commit -m "message"` | Create a new commit with message |
| `sl commit -A` | Add untracked files and commit |
| `sl amend` | Amend current commit (auto-rebases descendants) |
| `sl amend --to COMMIT` | Amend changes to a specific commit in stack |
| `sl absorb` | Intelligently absorb changes into stack commits |
| `sl fold --from .^` | Combine parent commit into current |

## Best Practices for Commits

- Follow the Conventional Commits specification as described below.
- Keep commits small and focused - each commit becomes a separate Phabricator diff
- Use `sl amend` freely - Sapling handles rebasing automatically

# Conventional Commits 1.0.0

## Summary

The Conventional Commits specification is a lightweight convention on top of commit messages. It provides an easy set of rules for creating an explicit commit history.

The commit message should be structured as follows:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Commit Types

1. **fix:** patches a bug in your codebase (correlates with PATCH in SemVer)
2. **feat:** introduces a new feature (correlates with MINOR in SemVer)
3. **BREAKING CHANGE:** introduces a breaking API change (correlates with MAJOR in SemVer)
4. Other types: `build:`, `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`

## Examples

### Simple commit
```
docs: correct spelling of CHANGELOG
```

### Commit with scope
```
feat(lang): add Polish language
```

### Breaking change
```
feat!: send an email to the customer when a product is shipped

BREAKING CHANGE: `extends` key in config file is now used for extending other config files
```

## Important Notes

- By default, pre-commit checks (defined in `.pre-commit-config.yaml`) will run to ensure code quality
- IMPORTANT: DO NOT SKIP pre-commit checks
- ALWAYS attribute AI-Assisted Code Authorship
- Before committing, the command will review the diff to ensure the message matches the changes
- When submitting to Phabricator, each commit becomes a separate diff with `Differential Revision:` line added
