# Sapling SCM Reference Guide

A comprehensive reference for Sapling (sl) commands and their Git equivalents.

## What is Sapling?

Sapling is a modern, scalable source control management (SCM) system developed by Meta (Facebook), designed for large repositories. It provides a user-friendly experience while maintaining compatibility with Git repositories and GitHub.

### Key Differences from Git

| Aspect | Git | Sapling |
|--------|-----|---------|
| **CLI Tool** | `git` | `sl` |
| **Branches** | Native branches | Bookmarks (equivalent to branches) |
| **History View** | `git log` | `sl smartlog` / `sl ssl` (graphical view) |
| **Working Copy** | Full checkout | Optional virtual filesystem (EdenFS) |
| **PR Workflow** | External tools (`gh`) | Built-in `sl pr` commands |
| **Amend Behavior** | Manual rebase of children | Automatic restacking of descendants |

### Architecture Components

1. **Sapling SCM Core**: Handles commands, merge resolution, and context management
2. **EdenFS**: Virtual filesystem for efficient working copies (fetches content on demand)
3. **Mononoke**: High-performance repository storage backend
4. **Interactive Smartlog (ISL)**: Modern UI for visualizing and interacting with repositories

---

## Command Equivalents: Git to Sapling

### Repository Setup

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git clone <url>` | `sl clone <url>` | Auto-detects Git repos from URL scheme |
| `git clone --depth 1` | `sl clone --config git.shallow=1` | Shallow clone support |
| `git init` | `sl init` | Initialize new repository |

**Clone Examples:**
```bash
# Clone a GitHub repository
sl clone https://github.com/facebook/sapling

# Force Git interpretation
sl clone --git https://example.com/repo

# Clone with EdenFS (experimental)
sl clone --eden https://github.com/user/repo
```

---

### Basic Operations

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git status` | `sl status` | Shows M (modified), ! (removed), ? (untracked) |
| `git status --ignored` | `sl status --ignore` | Show ignored files |
| `git add <file>` | `sl add <file>` | Start tracking files |
| `git rm <file>` | `sl remove <file>` or `sl rm` | Remove tracked files |

**Status Output Codes:**
- `M` - Modified
- `!` - Removed/missing
- `?` - Untracked

---

### Committing Changes

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git commit` | `sl commit` or `sl ci` | Commit pending changes |
| `git commit -m "message"` | `sl commit -m "message"` | Commit with message |
| `git commit --amend` | `sl amend --edit` | Amend with message edit |
| `git commit --amend --no-edit` | `sl amend` | Amend without editing message |
| `git commit -C <commit>` | `sl commit -M <commit>` | Reuse commit message |

**Amend Behavior:**
Sapling's `sl amend` automatically rebases descendant commits (children) on top of the amended commit, unless conflicts occur. Use `--rebase` to force or `--no-rebase` to prevent.

```bash
# Amend current commit with all pending changes
sl amend

# Amend with new message
sl amend -m "New commit message"

# Interactive amend (select hunks)
sl amend --interactive

# Undo an amend
sl unamend
```

---

### Viewing History

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git log` | `sl smartlog` or `sl` | Graphical commit view |
| `git log` (with PR info) | `sl ssl` | "Super smartlog" with PR/diff status |
| `git log --oneline` | `sl log -T '{node|short} {desc|firstline}\n'` | Custom template |
| `git show` | `sl show` | Show commit details |
| `git show --name-status` | `sl log --style status -r tip` | Show with file status |
| `git diff` | `sl diff` | Show differences |

**Smartlog Features:**
- `sl ssl` shows GitHub PR status (Approved, Changes Requested, Merged, Closed)
- Shows signal indicators: `✓` (passing), `✗` (failing), `‼` (error), `⋯` (pending)
- Displays commit relationships graphically

---

### Navigation and Checkout

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git checkout <commit>` | `sl goto <commit>` or `sl go` | Switch to commit |
| `git checkout HEAD^` | `sl goto .^` | Go to parent commit |
| `git checkout -f <commit>` | `sl goto -C <commit>` | Force checkout (discard changes) |
| `git checkout -- .` | `sl revert .` | Discard working directory changes |
| `git checkout -p <commit>` | `sl revert -i -r <commit>` | Interactive revert |
| `git checkout -f` | `sl revert --all` | Revert all changes |

---

### Branches (Bookmarks)

In Sapling, **bookmarks** are equivalent to Git branches. They are lightweight, movable labels on commits.

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git branch` | `sl bookmark` or `sl book` | List bookmarks |
| `git branch <name>` | `sl bookmark <name>` | Create active bookmark |
| `git branch -m <old> <new>` | `sl bookmark -m <old> <new>` | Rename bookmark |
| `git branch -d <name>` | `sl hide -B <name>` | Delete bookmark |
| `git branch -r` | `sl bookmark --remote` | List remote branches |

**Bookmark Examples:**
```bash
# Create an active bookmark on current commit
sl book new-feature

# Create an inactive bookmark
sl book -i reviewed

# Create bookmark on another commit
sl book -r .^ tested

# Rename a bookmark
sl book -m old-name new-name
```

---

### Remote Operations

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git pull` | `sl pull` | Download commits (no merge/rebase) |
| `git pull --rebase` | `sl pull --rebase` | Pull and rebase |
| `git push` | `sl push` | Push commits to remote |
| `git push -u origin <branch>` | `sl push --to <branch>` | Push to specific branch |
| `git fetch` | `sl pull` | Sapling's pull only fetches |

**Key Difference:** Unlike `git pull`, Sapling's `sl pull` only downloads commits and does NOT automatically merge or rebase. Use `sl pull --rebase` for Git-like behavior.

```bash
# Pull relevant remote bookmarks
sl pull

# Pull specific bookmark from a source
sl pull my-fork --bookmark my-branch

# Push current commit stack to main
sl push -r . --to main

# Push to new remote branch
sl push --to remote/my-new-feature
```

---

### Stashing

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git stash` | `sl shelve` | Save pending changes |
| `git stash pop` | `sl unshelve` | Restore shelved changes |
| `git stash list` | `sl shelve --list` | List shelved changes |
| `git stash drop <name>` | `sl shelve -d <name>` | Delete shelved changes |

---

### History Editing

| Git Command | Sapling Command | Notes |
|-------------|-----------------|-------|
| `git rebase -i` | `sl histedit` | Interactive history editing |
| `git rebase <base>` | `sl rebase -d <base>` | Rebase onto base |

**Histedit Actions:**
- `pick` - Use/reorder commit
- `drop` - Remove commit
- `mess` - Edit commit message only
- `fold` - Combine with preceding commit
- `roll` - Like fold, but discard description
- `edit` - Edit commit content
- `base` - Checkout and apply subsequent commits

---

## GitHub Integration

Sapling has built-in GitHub PR management through the `sl pr` command family.

### Prerequisites

1. Install GitHub CLI: `gh`
2. Authenticate: `gh auth login --git-protocol https`

### PR Commands

| Command | Description |
|---------|-------------|
| `sl pr submit` | Create or update GitHub PRs from local commits |
| `sl pr pull <PR>` | Import a GitHub PR into local working copy |
| `sl pr link <PR>` | Associate local commit with existing PR |
| `sl pr unlink` | Remove commit's association with PR |
| `sl pr follow` | Mark commit to join nearest descendant's PR |
| `sl pr list` | List GitHub PRs (calls `gh pr list`) |

### PR Workflows

Sapling supports three PR workflows (configurable via `github.pr-workflow`):

1. **CLASSIC**: Uses `main` as base, PR contains multiple commits
2. **SINGLE**: Stacked diffs - each PR contains single commit with synthetic branches
3. **OVERLAP** (default): All PRs share `main` as base, each commit gets its own PR

### Creating PRs

```bash
# Submit current commit as a PR
sl pr submit

# Alternative: Push branch and create PR manually
sl push --to my-feature-branch
# Then use GitHub web or `gh pr create`
```

### Comparison: GitHub CLI vs Sapling

| Task | GitHub CLI (`gh`) | Sapling (`sl`) |
|------|-------------------|----------------|
| Create PR | `gh pr create` | `sl pr submit` |
| List PRs | `gh pr list` | `sl pr list` |
| View PR | `gh pr view` | `sl ssl` (shows PR status) |
| Checkout PR | `gh pr checkout` | `sl pr pull <PR>` |
| Update PR | Push + amend | `sl amend && sl pr submit` |

---

## Helpful Commands

### Getting Help

```bash
# General help
sl help

# Help for specific command
sl help <command>

# Find Sapling equivalent of Git command
sl githelp <git-command>
```

### Useful Aliases

Sapling provides these built-in aliases:
- `sl` = `sl smartlog`
- `ssl` = `sl smartlog` with PR/diff info
- `sl ci` = `sl commit`
- `sl go` = `sl goto`
- `sl book` = `sl bookmark`

---

## Quick Reference Card

```
Clone:      sl clone <url>
Status:     sl status
Add:        sl add <file>
Commit:     sl commit -m "message"
Amend:      sl amend
View Log:   sl ssl
Checkout:   sl goto <commit>
Branch:     sl bookmark <name>
Pull:       sl pull
Push:       sl push --to <branch>
Create PR:  sl pr submit
Stash:      sl shelve / sl unshelve
History:    sl histedit
Help:       sl help <cmd>
Git Help:   sl githelp <git-cmd>
```

---

## Sources and References

- **GitHub Repository**: https://github.com/facebook/sapling
- **DeepWiki Documentation**: https://deepwiki.com/facebook/sapling
- **Search References**:
  - [What is Sapling](https://deepwiki.com/search/what-is-sapling-and-how-does-i_1592a599-2e6b-4a41-a67a-e241c038ac45)
  - [Command Equivalents](https://deepwiki.com/search/what-are-the-equivalent-sl-com_0a1c83d2-5c91-4fd9-a9b6-5d21e947f0a3)
  - [GitHub Integration](https://deepwiki.com/search/how-does-sapling-handle-github_2d2f0fc5-8867-49c8-8275-4f490f6fcd06)
  - [CLI Tool](https://deepwiki.com/search/what-is-the-sl-cli-tool-what-a_5fc46fab-558c-4d3f-b838-0f247f63759e)
  - [Smartlog](https://deepwiki.com/search/what-is-the-sl-smartlog-or-sl_d1c0beb8-5bf1-4071-a87b-c9125fc48b10)
  - [Amend and History](https://deepwiki.com/search/what-is-sl-amend-how-does-sapl_fb7acada-7eee-476b-bfe4-8015a80bcf83)
  - [Cloning](https://deepwiki.com/search/how-do-you-clone-a-repository_b544c5cb-7bca-4588-9ccc-b197871adb81)
  - [Bookmarks](https://deepwiki.com/search/what-are-sapling-bookmarks-how_4757f447-84b7-460c-9752-59ca10215cc5)

---

*Document generated: 2026-02-10*
*Source: facebook/sapling repository via DeepWiki MCP*
