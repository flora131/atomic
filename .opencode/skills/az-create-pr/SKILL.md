---
name: az-create-pr
description: Commit unstaged changes, push changes, submit an Azure DevOps pull request.
---

# Create Azure DevOps Pull Request

Commit changes, push to remote, and create an Azure DevOps pull request with a conventional commit-style title and comprehensive description: $ARGUMENTS

## Current Repository State

- Azure DevOps auth: !`az account show --query "user.name" -o tsv 2>/dev/null || echo "NOT_AUTHENTICATED"`
- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Default branch: !`az repos show --query "defaultBranch" -o tsv 2>/dev/null | sed 's|refs/heads/||' || git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|origin/||' || echo main`
- Staged changes: !`git diff --cached --stat`
- Unstaged changes: !`git diff --stat`
- Recent commits on this branch: !`git log --oneline -10`
- Existing PR for branch: !`az repos pr list --source-branch $(git branch --show-current) --status active --query "[0].{id:pullRequestId,title:title}" -o json 2>/dev/null || echo "No existing PR"`
- Commits ahead of default: !`git log --oneline origin/main..HEAD 2>/dev/null | head -20`

## Prerequisites

If the auth check above shows `NOT_AUTHENTICATED`, stop and print this setup guide:

```
Azure DevOps CLI is not configured. Run these commands to set up:

  az extension add --name azure-devops
  az login
  az devops configure --defaults organization=https://dev.azure.com/<YOUR_ORG> project=<YOUR_PROJECT>
```

Do NOT proceed with PR creation until authentication is confirmed.

## What This Command Does

1. **Stage and commit changes** using conventional commit format (follow the az-commit skill conventions)
    - If there are unstaged changes, stage and commit them with appropriate conventional commit messages
    - If multiple distinct logical changes exist, create separate commits for each
    - ALWAYS attribute AI-assisted code authorship in commits
2. **Push the branch** to the remote repository
    - If the current branch is the default branch (main/master), create a new feature branch first
    - Use `git push -u origin <branch>` to set upstream tracking
3. **Analyze all changes** in the branch relative to the base branch
    - Run `git diff origin/<default-branch>...HEAD` to review the full scope of changes
    - Read relevant modified files to understand the context and impact of changes
4. **Generate a PR title** following Conventional Commits format:
    - Format: `<type>[optional scope]: <description>`
    - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
    - Use `!` after type/scope for breaking changes: `feat(api)!: change response format`
    - Keep the title concise (under 72 characters)
    - For multi-commit PRs, synthesize a higher-level title that captures the overall theme
5. **Generate a PR description** with the structure defined in the PR Description Template below
6. **Scan for work item IDs** in branch name and commit messages
    - Look for patterns like `#1234`, `AB#1234`, or numeric IDs in branch names (e.g., `feature/1234-my-feature`)
    - These will be passed via `--work-items` flag
7. **Create or update the pull request**
    - If no PR exists for this branch: `az repos pr create --title "TITLE" --description "DESCRIPTION" --source-branch <current> --target-branch <default> --draft`
    - If a PR already exists: `az repos pr update --id <id> --title "TITLE" --description "DESCRIPTION"`
    - Include `--work-items <ids>` if work item IDs were found

## PR Title Examples

```
feat(auth): add JWT token refresh endpoint
fix(ui): resolve layout shift on mobile navigation
docs: update API reference for v2 endpoints
refactor(db): migrate from raw SQL to query builder
feat(api)!: change pagination response format
chore(deps): bump TypeScript to 5.x
```

## PR Description Template

Use this structure for the PR body. Omit sections that are not applicable.

```markdown
## Summary

[1-2 sentence overview of what this PR does and why]

## Changes

- [Key change 1]
- [Key change 2]
- [Key change 3]

## Breaking Changes

[Describe what breaks and required migration steps]

## Notes

[Additional context, testing instructions, or deployment considerations]
```

## Guidelines

- **Respect existing content**: If the PR title already follows conventional commit format, keep it unless it's inaccurate. If a PR already has a meaningful description, enhance it rather than replace it entirely.
- **Work item references**: If the branch name contains a work item ID (e.g., `feature/1234-add-auth`), include `--work-items 1234` in the create/update command.
- **Holistic analysis**: The PR title should capture the overall intent of the changes, not just list individual commits.
- **Single-commit PRs**: The PR title can mirror the commit message.
- **Multi-commit PRs**: Synthesize a higher-level title that captures the full scope.
- **Draft by default**: Always create PRs as drafts using `--draft` flag.
- Use markdown formatting in the description for readability.

## Important Notes

- By default, pre-commit checks (defined in `.pre-commit-config.yaml`) will run to ensure code quality
    - IMPORTANT: DO NOT SKIP pre-commit checks
- ALWAYS attribute AI-Assisted Code Authorship in commit messages
- Always review the diff before generating the title and description to ensure accuracy
- If `az` CLI is not authenticated or the azure-devops extension is not installed, prompt the user with the setup guide above
- Use `az repos pr create` (not `gh pr create`) — this is an Azure DevOps repository