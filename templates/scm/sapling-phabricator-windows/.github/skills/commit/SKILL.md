---
description: Create well-formatted commits with conventional commit format using Sapling (Windows).
---

# Smart Sapling Commit (Windows)

Create well-formatted commits following the Conventional Commits specification using Sapling SCM.

> **Windows Note:** Use full path `& 'C:\Program Files\Sapling\sl.exe'` to avoid conflicts with PowerShell's `sl` alias.

## What This Skill Does

1. Checks which files have changes with `& 'C:\Program Files\Sapling\sl.exe' status`
2. If there are untracked files to include, adds them with `& 'C:\Program Files\Sapling\sl.exe' add`
3. Performs a diff to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit, creates a commit message using conventional commit format

## Commands to Use (Windows)

- `& 'C:\Program Files\Sapling\sl.exe' status` - Check repository state
- `& 'C:\Program Files\Sapling\sl.exe' bookmark` - Get current bookmark
- `& 'C:\Program Files\Sapling\sl.exe' smartlog -l 5` - View recent commits
- `& 'C:\Program Files\Sapling\sl.exe' diff --stat` - View pending changes
- `& 'C:\Program Files\Sapling\sl.exe' add <files>` - Add untracked files
- `& 'C:\Program Files\Sapling\sl.exe' commit -m "<message>"` - Create commit

## Key Sapling Differences from Git

- **No staging area**: Sapling commits all pending changes directly
- **Amend with auto-restack**: `sl amend` automatically rebases descendant commits
- **Smartlog**: Use `sl smartlog` or `sl ssl` for graphical commit history
- **Absorb**: Use `sl absorb` to intelligently integrate pending changes
- **Stacked Diffs**: Each commit becomes a separate Phabricator diff

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
