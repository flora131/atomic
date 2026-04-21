---
name: ado-commit
description: Create well-formatted conventional commits in a repository hosted on Azure DevOps (ADO / Azure Repos). Use this whenever the user asks to commit changes and the project is on Azure DevOps — dev.azure.com, visualstudio.com, or explicit mentions of ADO, Azure Repos, or work item IDs like `AB#1234`. Automatically appends `AB#<id>` work-item trailers when the branch name or staged changes reference one, and attributes AI-assisted authorship.
---

# ADO Commit

Create a conventional commit on an Azure DevOps-hosted repository: $ARGUMENTS

## Current state

- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Staged diff (stat): !`git diff --cached --stat`
- Unstaged diff (stat): !`git diff --stat`
- Recent commits: !`git log --oneline -5`

## Workflow

The only ADO-specific bits are (a) work-item trailers and (b) the conventions this repo has adopted for talking to reviewers who open PRs in Azure DevOps.

1. **Stage.** If nothing is staged, stage all modified and new files with `git add -A`. If specific files are already staged, commit only those.
2. **Diff.** Run `git diff --cached` to understand the actual change. Read the diff — don't just trust the path names — because the message needs to describe *what changed and why*, not *which files changed*.
3. **Split if needed.** If the staged diff contains multiple unrelated logical changes, propose splitting into separate commits. One commit = one reason to change.
4. **Write the message** in Conventional Commits format (see below), then commit via `git commit --message "<subject>" [--trailer ...]`. Pass trailers with `--trailer` so git formats them correctly; don't cat-heredoc them into the body.
5. **Don't skip pre-commit hooks.** If `.pre-commit-config.yaml` exists, hooks run automatically and their failures are signal, not noise. Never pass `--no-verify`.

## Conventional Commits — quick reference

```
<type>(optional scope): <description>

<optional body>

<optional trailers>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Append `!` after type/scope for breaking changes (e.g. `feat(api)!: change response format`). Keep the subject under 72 characters, imperative mood, no trailing period.

**Examples:**

```
feat(auth): add JWT refresh endpoint
fix(ui): resolve layout shift on mobile nav
refactor(db): migrate from raw SQL to query builder
chore(deps): bump TypeScript to 5.5
feat(api)!: change pagination response shape
```

## Work-item trailers (ADO-specific)

Azure DevOps auto-links commits to work items when the message contains `AB#<id>`. Include one whenever you can identify the target work item, because it keeps the board in sync without anyone clicking around.

**Where to find the ID:**

- **Branch name** — patterns like `feature/1234-...`, `bug/AB1234-...`, `user/name/1234-...` usually encode the work item ID.
- **User input** — if the user mentions "work item 1234" or "this closes 1234", use that.
- **Prior commits on the branch** — run `git log --oneline origin/main..HEAD` and check if earlier commits reference an ID.
- **ADO MCP** — if the project has the `azure-devops` MCP server configured and you're still unsure, call `wit_my_work_items` (or `search_workitem` with a keyword from the change) to surface likely candidates. Ask the user to confirm rather than guessing.

**How to add it** — as a trailer, not in the subject:

```bash
git commit \
  --message "feat(auth): add JWT refresh endpoint" \
  --trailer "AB#1234" \
  --trailer "Assistant-model: Claude Code"
```

If you genuinely can't find a work-item ID, skip the trailer rather than inventing one. A missing trailer is recoverable; a wrong one pollutes the board.

## AI authorship trailer

ADO code reviews often surface in audit contexts, so mark AI-assisted commits honestly. Use an `Assistant-model` trailer rather than `Co-authored-by` — most git tooling validates the latter as an email, and we want to distinguish *assistance* from *authorship*:

```
Assistant-model: Claude Code
```

Add it every time you commit on the user's behalf.

## Putting it together

```bash
git add -A
git diff --cached --stat          # sanity check
git commit \
  --message "fix(parser): handle nested escape sequences" \
  --trailer "AB#5678" \
  --trailer "Assistant-model: Claude Code"
git log -1                        # show the user the result
```
