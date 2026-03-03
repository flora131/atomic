---
name: az-create-pr
description: Commit unstaged changes, push changes, submit an Azure DevOps pull request.
---

# Create Azure DevOps Pull Request

Commit changes, push to remote, and create a pull request on Azure Repos with a conventional commit-style title and comprehensive description: $ARGUMENTS

## Current Repository State

- Azure account: !`az account show --query "user.name" -o tsv 2>/dev/null || echo "NOT_AUTHENTICATED"`
- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Azure DevOps defaults: !`az devops configure --list 2>/dev/null | grep -E "organization|project" || echo "NOT_CONFIGURED"`
- Default branch: !`az repos show --query "defaultBranch" -o tsv 2>/dev/null | sed 's|refs/heads/||' || echo "main"`
- Staged changes: !`git diff --cached --stat`
- Unstaged changes: !`git diff --stat`
- Recent commits on this branch: !`git log --oneline -10`
- Existing PR for branch: !`az repos pr list --source-branch "refs/heads/$(git branch --show-current)" --status active --query "[0].pullRequestId" -o tsv 2>/dev/null || echo "No existing PR"`

## What This Command Does

1. **Auth check**: Run `az account show` to verify Azure CLI authentication.
   - If output is `NOT_AUTHENTICATED`, print the setup guide below and stop:
     ```
     az extension add --name azure-devops
     az login
     az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>
     ```
   - If `NOT_CONFIGURED` appears in the DevOps defaults output, print the following and stop:
     ```
     az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>
     ```
2. **Stage and commit changes** using conventional commit format (follow the az-commit skill conventions)
   - If there are unstaged changes, stage and commit them with appropriate conventional commit messages
   - If multiple distinct logical changes exist, create separate commits for each
   - ALWAYS attribute AI-assisted code authorship in commits
3. **Push the branch** to the remote repository
   - If the current branch is the default branch (main/master), create a new feature branch first
   - Use `git push -u origin <branch>` to set upstream tracking
4. **Analyze all changes** in the branch relative to the base branch
   - Run `git diff origin/<default-branch>...HEAD` to review the full scope of changes
   - Read relevant modified files to understand the context and impact of changes
   - Scan branch name and commit messages for work item IDs (e.g., `#1234`, `AB#1234`)
5. **Generate a PR title** following Conventional Commits format:
   - Format: `<type>[optional scope]: <description>`
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
   - Use `!` after type/scope for breaking changes: `feat(api)!: change response format`
   - Keep the title concise (under 72 characters)
   - For multi-commit PRs, synthesize a higher-level title that captures the overall theme
6. **Generate a PR description** with the structure defined in the PR Description Template below
7. **Create or update the pull request**
   - If PR exists (ID found): `az repos pr update --id <id> --title "TITLE" --description "DESCRIPTION"` (append `--work-items <ids>` if work item IDs were found)
   - If no PR: `az repos pr create --title "TITLE" --description "DESCRIPTION" --source-branch <current> --target-branch <default> --draft` (append `--work-items <ids>` if work item IDs were found)

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
- **Work item references**: If the branch name or commit messages contain work item IDs (e.g., `feature/1234-my-feature`, `AB#1234`), include them via `--work-items` when creating or updating the PR.
- **Holistic analysis**: The PR title should capture the overall intent of the changes, not just list individual commits.
- **Single-commit PRs**: The PR title can mirror the commit message.
- **Multi-commit PRs**: Synthesize a higher-level title that captures the full scope.
- Use markdown formatting in the description for readability.
- PRs are created as drafts by default (`--draft`).

## Important Notes

- By default, pre-commit checks (defined in `.pre-commit-config.yaml`) will run to ensure code quality
  - IMPORTANT: DO NOT SKIP pre-commit checks
- ALWAYS attribute AI-Assisted Code Authorship in commit messages
- Always review the diff before generating the title and description to ensure accuracy
- If `az` CLI is not authenticated, print the setup guide and stop — do not attempt to create a PR
- Use `az account show` to verify auth; never echo or expose tokens
