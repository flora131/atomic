---
description: Submit commits as Phabricator diffs for code review using Sapling.
model: opus
allowed-tools: Bash(sl:*), Bash(jf:*), Glob, Grep, NotebookRead, Read, SlashCommand
argument-hint: [--update "message"]
---

# Submit Diff Command (Sapling + Phabricator)

Submit commits to Phabricator for code review using `jf submit` (Meta) or `arc diff` (open-source Phabricator).

## Current Repository State

- Sapling status: !`sl status`
- Current bookmark: !`sl bookmark`
- Recent commits with diff status: !`sl ssl`
- Pending changes: !`sl diff --stat`

## Behavior

1. If there are uncommitted changes, first run `/commit` to create a commit
2. Submit commits to Phabricator using `jf submit` (or `arc diff` for open-source Phabricator)
3. Each commit in the stack becomes a separate Phabricator diff (D12345)
4. Commit messages are updated with `Differential Revision:` link

## Sapling + Phabricator Workflow

The `jf submit` command (Meta's internal tool) submits commits to Phabricator for code review. For open-source Phabricator deployments, `arc diff` serves the same purpose. Note: there is no top-level `sl submit` CLI command in Sapling — submission is handled by these external tools or the ISL web UI.

The submission process:
- Creates a new diff if none exists for the commit
- Updates existing diff if one is already linked (via `Differential Revision:` in commit message)
- Handles stacked diffs with proper dependency relationships

### Common Operations

| Task | Command |
|------|---------|
| Submit current commit | `jf submit` |
| Submit as draft | Via ISL web UI only (no CLI flag) |
| Update diff after amend | `sl amend && jf submit` |
| View diff status | `sl ssl` (shows diff status in smartlog) |
| Check sync status | `sl log -T '{syncstatus}\n' -r .` |
| Get diff ID | `sl log -T '{phabdiff}\n' -r .` |
| View changes since last submit | `sl diff --since-last-submit` |

### Diff Status Values

The `{phabstatus}` template keyword shows:
- `Needs Review` - Awaiting reviewer feedback
- `Accepted` - Ready to land
- `Needs Revision` - Reviewer requested changes
- `Needs Final Review` - Waiting for final approval
- `Committed` - Diff has been landed
- `Committing` - Landing recently succeeded
- `Abandoned` - Diff was closed without landing
- `Unpublished` - Draft diff
- `Landing` - Currently being landed
- `Recently Failed to Land` - Landing attempt failed

## Stacked Diffs

Sapling naturally supports stacked commits. When submitting:
- Each commit in the stack gets its own Phabricator diff (D12345, D12346, D12347)
- Diffs are linked with proper dependency relationships
- Reviewers can review each diff independently

```bash
# Create a stack
sl commit -m "feat: add base functionality"
sl commit -m "feat: add validation layer"
sl commit -m "feat: add error handling"

# Submit entire stack
jf submit
```

## Prerequisites

1. **`.arcconfig`** must exist in repository root with Phabricator URL
2. **`~/.arcrc`** must contain authentication credentials
3. **`fbcodereview`** extension must be enabled in Sapling config

## Configuration Verification

```bash
# Verify .arcconfig exists
cat .arcconfig

# Verify authentication
sl log -T '{phabstatus}\n' -r .  # Should not error
```

## After Diff is Approved

Once a diff is accepted in Phabricator:
1. The diff can be "landed" (merged to main branch)
2. Sapling automatically marks landed commits as hidden
3. Use `sl ssl` to verify the diff shows as `Committed`

## Notes

- Unlike GitHub PRs, Phabricator diffs are tied to commits via the `Differential Revision:` line
- Use `sl diff --since-last-submit` to see what changed since last submission
- The ISL (Interactive Smartlog) web UI also supports submitting diffs
