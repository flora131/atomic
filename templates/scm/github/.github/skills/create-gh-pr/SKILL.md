---
description: Commit unstaged changes, push changes, submit a pull request.
---

# Create Pull Request

Commit changes, push to remote, and create a GitHub pull request.

## What This Skill Does

1. Creates logical commits for any unstaged changes using the `/commit` skill
2. Pushes the current branch to remote with tracking
3. Creates a pull request with a proper title and description

## Commands to Use

- `git status` - Check for uncommitted changes
- `git push -u origin <branch>` - Push branch to remote
- `gh pr create --title "<title>" --body "<body>"` - Create pull request

## Pull Request Format

```
## Summary
<1-3 bullet points describing the changes>

## Test plan
- [ ] Test item 1
- [ ] Test item 2
```

## Important Notes

- Ensure all changes are committed before creating the PR
- The PR title should follow conventional commit format when possible
- Include a clear summary of what changes are included
- Add a test plan with verification steps
- Return the PR URL when complete
