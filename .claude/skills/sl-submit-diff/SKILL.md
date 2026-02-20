---
name: sl-submit-diff
description: Submit commits as Phabricator diffs for code review using Sapling.
---

# Submit Diff (Sapling + Phabricator)

Submit commits to Phabricator for code review using `jf submit` (Meta) or `arc diff` (open-source).

<EXTREMELY_IMPORTANT>

> **Windows Note:** Use the full path to `sl.exe` to avoid conflicts with PowerShell's built-in `sl` alias for `Set-Location`.
> </EXTREMELY_IMPORTANT>

## What This Skill Does

1. If there are uncommitted changes, first run `/commit` to create a commit
2. Submit commits to Phabricator using `jf submit` (or `arc diff`)
3. Each commit in the stack becomes a separate Phabricator diff (D12345)
4. Commit messages are updated with `Differential Revision:` link

## Commands to Use

- `sl status` - Check for uncommitted changes
- `sl ssl` - View commits with diff status
- `jf submit` - Submit commits to Phabricator
- `sl diff --since-last-submit` - View changes since last submission

## Common Operations

| Task                    | Command                           |
| ----------------------- | --------------------------------- |
| Submit current commit   | `jf submit`                       |
| Update diff after amend | `sl amend && jf submit`           |
| View diff status        | `sl ssl`                          |
| Check sync status       | `sl log -T '{syncstatus}\n' -r .` |
| Get diff ID             | `sl log -T '{phabdiff}\n' -r .`   |

## Diff Status Values

- `Needs Review` - Awaiting reviewer feedback
- `Accepted` - Ready to land
- `Needs Revision` - Reviewer requested changes
- `Committed` - Diff has been landed
- `Abandoned` - Diff was closed without landing

## Stacked Diffs

Sapling naturally supports stacked commits. When submitting:

- Each commit gets its own Phabricator diff (D12345, D12346, D12347)
- Diffs are linked with proper dependency relationships
- Reviewers can review each diff independently

## Prerequisites

1. **`.arcconfig`** must exist in repository root with Phabricator URL
2. **`~/.arcrc`** must contain authentication credentials
3. **`fbcodereview`** extension must be enabled in Sapling config

## Important Notes

- Unlike GitHub PRs, Phabricator diffs are tied to commits via `Differential Revision:`
- Use `sl diff --since-last-submit` to see what changed since last submission
- The ISL (Interactive Smartlog) web UI also supports submitting diffs
