---
description: Create well-formatted commits with conventional commit format.
---

# Smart Git Commit

Create well-formatted commits following the Conventional Commits specification.

## What This Skill Does

1. Checks which files are staged with `git status`
2. If no files are staged, automatically adds all modified and new files with `git add`
3. Performs a `git diff` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit, creates a commit message using conventional commit format

## Commands to Use

- `git status --porcelain` - Check repository state
- `git branch --show-current` - Get current branch
- `git diff --cached --stat` - View staged changes
- `git diff --stat` - View unstaged changes
- `git log --oneline -5` - View recent commits
- `git add <files>` - Stage files for commit
- `git commit -m "<message>"` - Create commit

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
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks
- `build:` - Build system changes
- `ci:` - CI configuration changes

## Important Notes

- Follow pre-commit checks if configured
- Attribute AI-assisted code authorship with `Assistant-model: Claude Code` trailer
- Review the diff before committing to ensure the message matches the changes
- Break large changes into multiple logical commits when appropriate
