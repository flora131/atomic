---
name: sl-commit
description: Create well-formatted commits with conventional commit format using Sapling.
---

# Smart Sapling Commit

Create well-formatted commits following the Conventional Commits specification using Sapling SCM.

<EXTREMELY_IMPORTANT>

> **Windows Note:** Use the full path to `sl.exe` to avoid conflicts with PowerShell's built-in `sl` alias for `Set-Location`.
> </EXTREMELY_IMPORTANT>

## What This Skill Does

1. Checks which files have changes with `sl status`
2. If there are untracked files to include, adds them with `sl add`
3. Performs a `sl diff` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit, creates a commit message using conventional commit format

## Commands to Use

- `sl status` - Check repository state
- `sl bookmark` - Get current bookmark
- `sl smartlog -l 5` - View recent commits with graphical history
- `sl diff --stat` - View pending changes
- `sl add <files>` - Add untracked files
- `sl commit -m "<message>"` - Create commit

## Key Sapling Differences from Git

- **No staging area**: Sapling commits all pending changes directly
- **Amend with auto-restack**: `sl amend` automatically rebases descendant commits
- **Smartlog**: Use `sl smartlog` or `sl ssl` for graphical commit history
- **Absorb**: Use `sl absorb` to intelligently integrate pending changes
- **Stacked Diffs**: Each commit becomes a separate Phabricator diff

## Sapling Commit Commands Reference

| Command                  | Description                                     |
| ------------------------ | ----------------------------------------------- |
| `sl commit -m "message"` | Create a new commit with message                |
| `sl commit -A`           | Add untracked files and commit                  |
| `sl amend`               | Amend current commit (auto-rebases descendants) |
| `sl amend --to COMMIT`   | Amend changes to a specific commit in stack     |
| `sl absorb`              | Intelligently absorb changes into stack commits |

## Conventional Commits Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**

- `feat:` - New feature (MINOR version bump)
- `fix:` - Bug fix (PATCH version bump)
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Important Notes

- Follow pre-commit checks if configured
- Keep commits small and focused - each becomes a separate Phabricator diff
- Use `sl amend` freely - Sapling handles rebasing automatically
- Attribute AI-assisted code authorship
