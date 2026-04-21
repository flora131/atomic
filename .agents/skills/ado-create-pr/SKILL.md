---
name: ado-create-pr
description: Commit, push, and open a pull request in Azure DevOps. Use whenever the user wants to open, update, or draft a PR and the project is hosted on Azure DevOps (`dev.azure.com`, `visualstudio.com`, or explicit mentions of ADO, Azure Repos, or work item IDs like `AB#1234`). Links work items to the PR, sets reviewers, and supports draft-by-default.
---

# ADO Create Pull Request

Commit changes, push the branch, and open or update an Azure DevOps pull request with a conventional-commit-style title and a complete description: $ARGUMENTS

## Current state

- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Default branch: !`git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|origin/||' || echo main`
- Staged diff (stat): !`git diff --cached --stat`
- Unstaged diff (stat): !`git diff --stat`
- Recent commits on this branch: !`git log --oneline -10`
- Commits ahead of default: !`git log --oneline origin/$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|origin/||' || echo main)..HEAD 2>/dev/null | head -20`
- Remote URL (to confirm ADO host): !`git remote get-url origin 2>/dev/null || echo "no-remote"`

## Use the Azure DevOps MCP tools

All ADO operations in this workflow go through the Azure DevOps MCP tools — never `az` / `az devops`. When you see tool names like `repo_create_pull_request` or `wit_link_work_item_to_pull_request` below, call the matching Azure DevOps tool from your tool list. If no Azure DevOps MCP tools are loaded in this session, stop and ask the user if they want to fallback to the `az` CLI.

## Workflow

### 1. Stage and commit

Follow the **ado-commit** skill for the commit step — same conventional-commit format, same AI-authorship trailer, same `AB#<id>` work-item trailer rules. Split into multiple commits if the staged diff covers unrelated concerns.

If the user is currently on the default branch (`main` / `master`), switch to a feature branch *before* committing. A reasonable default name is `user/<short-topic>` or `feature/<topic>`; if a work-item ID is known, prefix it: `feature/1234-<topic>`.

### 2. Push

```bash
git push -u origin "$(git branch --show-current)"
```

`-u` sets upstream tracking so subsequent pushes don't need arguments.

### 3. Gather context for the PR

Read the *full* diff against the base branch, not just the last commit — a PR title needs to summarize the whole branch, not one step of it.

```bash
git diff origin/<default-branch>...HEAD
```

Open the files that changed significantly so you can describe the *why* accurately. If there's an existing PR for this branch, fetch it first (see step 5) and edit rather than replace — a human may already have curated the title or description.

### 4. Identify the repo, project, and work items

The MCP tools need identifiers:

- **Project and repository name** — parse from the `origin` remote URL. ADO URLs follow `https://dev.azure.com/<org>/<project>/_git/<repo>` or `https://<org>.visualstudio.com/<project>/_git/<repo>`.
- **Repository ID** — call `repo_get_repo_by_name_or_id` with `{ project, repositoryNameOrId: <repo-name> }`. Use the returned `id` for subsequent calls.
- **Work item IDs** — scan the branch name and every commit subject/body on the branch (`git log origin/<default>..HEAD`) for `AB#<id>`, `#<id>`, or numeric prefixes like `feature/1234-...`. If the user mentioned a work item in the prompt, trust that.

If projects or repos aren't obvious, `core_list_projects` and `repo_list_repos_by_project` let you browse.

### 5. Check for an existing PR

```
repo_list_pull_requests_by_repo_or_project {
  repositoryId: <id>,
  status: "active",
  sourceRefName: "refs/heads/<current-branch>"
}
```

If a result comes back, you're in *update* mode — keep the existing PR's ID and edit in place in step 7. Otherwise you're in *create* mode.

### 6. Generate title and description

**Title** — Conventional Commits, under 72 chars. For a single-commit PR the commit subject works; for a multi-commit PR synthesize a higher-level subject that captures the whole branch.

```
feat(auth): add JWT token refresh endpoint
fix(ui): resolve layout shift on mobile nav
refactor(db): migrate from raw SQL to query builder
feat(api)!: change pagination response shape
```

**Description** — use this template, omitting sections that don't apply:

```markdown
## Summary

[1–2 sentences on what this PR does and why]

## Changes

- [Key change 1]
- [Key change 2]

## Breaking Changes

[What breaks and the migration step — delete this section if none]

## Test Plan

- [How this was verified — commands, manual checks, screenshots]

## Work Items

AB#1234
```

Keep the `AB#<id>` references in the description — ADO parses them and shows the linked work items alongside the PR. You'll *also* link them via MCP in step 8 so the links are first-class, not just string-matched.

### 7. Create or update the PR

**Create (default to draft):**

```
repo_create_pull_request {
  repositoryId: <id>,
  sourceRefName: "refs/heads/<current-branch>",
  targetRefName: "refs/heads/<default-branch>",
  title: "<conventional-commit title>",
  description: "<markdown from template>",
  isDraft: true
}
```

`sourceRefName` and `targetRefName` need the full `refs/heads/` prefix — a common mistake is passing the bare branch name and getting a cryptic 400.

**Update (existing PR):**

```
repo_update_pull_request {
  repositoryId: <id>,
  pullRequestId: <id-from-step-5>,
  title: "<updated title>",
  description: "<updated description>"
}
```

Respect the existing title/description if they're already meaningful — enhance rather than overwrite. If the existing title already follows conventional commits and is accurate, leave it alone.

### 8. Link work items

Even if the description contains `AB#<id>`, explicitly link each work item so it shows up as a structured PR-WorkItem relationship:

```
wit_link_work_item_to_pull_request {
  projectId: <project-id>,
  repositoryId: <repo-id>,
  pullRequestId: <pr-id>,
  workItemId: <work-item-id>
}
```

Call once per work item ID.

### 9. Reviewers (optional)

If the user named reviewers, resolve them to identity IDs and attach:

```
core_get_identity_ids { searchFilter: "<name or email>" }
repo_update_pull_request_reviewers {
  repositoryId: <id>,
  pullRequestId: <id>,
  reviewerIds: [<ids>],
  action: "add"
}
```

Don't auto-assign reviewers the user didn't mention — ADO default reviewer policies usually handle that, and guessing people's IDs is a good way to ping the wrong person.

### 10. Report back

Print the PR's web URL (returned in the create/update response as `url` or `_links.web.href`) so the user can click through. Summarize: branch → target, draft status, work items linked, reviewers added.

## Guidelines

- **Draft by default.** Pass `isDraft: true` unless the user says otherwise. It's easier to mark ready than to walk back a premature review request.
- **Never skip pre-commit hooks.** They run locally during commits created in step 1. A hook failure is the hook earning its keep.
- **Always attribute AI assistance** via the `Assistant-model` trailer on every commit (see the ado-commit skill).
- **Respect existing content.** If updating an existing PR, keep what's already curated; only replace sections that are stale or wrong.
- **Holistic title.** The PR title is one line describing the whole branch. Don't concatenate commit subjects.

## Related Azure DevOps tools

The 10-step workflow above names the tools you need on the happy path. Reach for the ones below when the situation calls for it — don't run them by default. Grouped by the sub-task they unlock.

| Sub-task               | Tool                                                                        | When to reach for it                                                                     |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Locate the repo**    | `core_list_projects`                                                        | Project name isn't obvious from the remote URL                                           |
|                        | `repo_list_repos_by_project`                                                | Multiple repos in the project and you need to pick                                       |
| **Inspect branches**   | `repo_list_branches_by_repo`                                                | Confirm the default / target branch exists before creating the PR                        |
|                        | `repo_get_branch_by_name`                                                   | Pull the latest commit or branch policies on the source branch                           |
|                        | `repo_create_branch`                                                        | Branch off server-side when the user isn't working locally                               |
| **Pick a work item**   | `wit_my_work_items`                                                         | User didn't name one — surface their active items so they can confirm                    |
|                        | `search_workitem`                                                           | Keyword search when the work item ID is uncertain                                        |
|                        | `wit_get_work_item` / `wit_get_work_items_batch_by_ids`                     | Fetch title/state to enrich the PR description (e.g. "Closes AB#1234 — add JWT refresh") |
| **Inspect the change** | `repo_get_pull_request_changes`                                             | Programmatic diff on an existing PR when local `git diff` isn't enough                   |
|                        | `repo_search_commits`                                                       | Verify specific commits landed on the source branch                                      |
|                        | `repo_get_file_content`                                                     | Re-read a file at a specific commit to describe it accurately                            |
| **Fetch the PR**       | `repo_get_pull_request_by_id`                                               | Reload the PR after create/update (web URL, status, policy state)                        |
| **Extra linking**      | `wit_add_artifact_link`                                                     | Link a commit or build to a work item (non-PR relationship)                              |
|                        | `wit_add_work_item_comment`                                                 | Post "PR #N opened" on the work item so watchers see it async                            |
| **Comments & votes**   | `repo_list_pull_request_threads` / `repo_list_pull_request_thread_comments` | Read existing review threads before editing the PR                                       |
|                        | `repo_create_pull_request_thread`                                           | Seed a context comment on the new PR (e.g. testing notes)                                |
|                        | `repo_reply_to_comment`                                                     | Respond to a reviewer inline                                                             |
|                        | `repo_vote_pull_request`                                                    | Approve / wait-for-author / reject on the user's behalf — only when explicitly asked     |
| **CI signal**          | `pipelines_get_build_status`                                                | Check whether the branch's CI is green before un-drafting                                |
|                        | `pipelines_get_build_log`                                                   | Pull logs when CI is red and you're helping diagnose                                     |