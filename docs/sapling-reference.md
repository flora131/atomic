# Sapling Source Control Reference Guide

A comprehensive reference for Facebook's Sapling SCM, including Git command mappings and Sapling-specific features.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Git to Sapling Command Mapping](#git-to-sapling-command-mapping)
4. [Sapling-Specific Commands](#sapling-specific-commands)
5. [Key Concepts](#key-concepts)
6. [GitHub Integration](#github-integration)
7. [Workflow Patterns](#workflow-patterns)
8. [Configuration](#configuration)
9. [References](#references)

---

## Overview

### What is Sapling?

Sapling is a modern, scalable source control management (SCM) system developed by Facebook (Meta). It is designed for performance, especially with large repositories, and evolved from Mercurial.

**Key Differentiators from Git:**

| Aspect | Git | Sapling |
|--------|-----|---------|
| **Architecture** | Monolithic | Modular (SCM Core + EdenFS + Mononoke) |
| **Large Repo Support** | Limited | Native via EdenFS virtual filesystem |
| **UI** | CLI-focused | CLI + Interactive Smartlog (ISL) + VS Code |
| **Branching Model** | Branches | Bookmarks (similar to Mercurial) |
| **History Editing** | `rebase -i`, `commit --amend` | Rich set: `amend`, `absorb`, `fold`, `split`, `histedit` |
| **Stacked Diffs** | Not native | First-class support via `sl pr` |

### Architecture Components

1. **Sapling SCM Core**: Handles versioning logic, command processing, merge handling
2. **EdenFS**: Virtual filesystem that fetches content on demand (crucial for large repos)
3. **Mononoke**: High-performance repository storage backend
4. **Interactive Smartlog (ISL)**: Web-based GUI for visualization and operations

---

## Installation

### macOS

```bash
# Using Homebrew
brew install sapling

# Recommended: increase open files limit
# Add to ~/.bash_profile and ~/.zshrc:
ulimit -n 1048576
```

### Linux (Ubuntu 22.04)

```bash
curl -L -o sapling.deb https://github.com/facebook/sapling/releases/latest/download/sapling_<version>_amd64.Ubuntu22.04.deb
sudo apt install -y ./sapling.deb
```

### Linux (Arch via AUR)

```bash
yay -S sapling-scm-bin
```

### Windows

1. Download `sapling_windows` ZIP from GitHub releases
2. Extract to `C:\Program Files\Sapling`
3. Add to PATH: `setx PATH "$env:PATH;C:\Program Files\Sapling" -m`
4. **Requirements**: Git for Windows, Node.js v16+

### Building from Source

**Requirements**: Make, g++, Rust, Node.js, Yarn

```bash
git clone https://github.com/facebook/sapling
cd sapling/eden/scm
make oss
./sl --help
```

---

## Git to Sapling Command Mapping

### Quick Reference Table

| Operation | Git Command | Sapling Command | Notes |
|-----------|-------------|-----------------|-------|
| **Initialize** | `git init` | `sl init` | |
| **Clone** | `git clone <url>` | `sl clone <url>` | Works with Git repos |
| **Status** | `git status` | `sl status` | |
| **Add files** | `git add <files>` | `sl add <files>` | |
| **Commit** | `git commit -m "msg"` | `sl commit -m "msg"` | |
| **Amend commit** | `git commit --amend` | `sl amend` | More powerful in Sapling |
| **Push** | `git push` | `sl push --to <bookmark>` | |
| **Pull** | `git pull` | `sl pull` | Does not update working copy |
| **Fetch** | `git fetch` | `sl pull` | Sapling's pull is like fetch |
| **Checkout/Switch** | `git checkout <ref>` | `sl goto <ref>` | |
| **Create branch** | `git branch <name>` | `sl bookmark <name>` | Sapling uses bookmarks |
| **Delete branch** | `git branch -d <name>` | `sl hide -B <name>` | |
| **Rename branch** | `git branch -m old new` | `sl bookmark -m old new` | |
| **View log** | `git log` | `sl log` | |
| **Smart log** | N/A | `sl smartlog` / `sl sl` | Sapling-specific |
| **Diff** | `git diff` | `sl diff` | |
| **Rebase** | `git rebase <base>` | `sl rebase -d <dest>` | |
| **Interactive rebase** | `git rebase -i` | `sl histedit` | More powerful |
| **Stash** | `git stash` | `sl shelve` | |
| **Unstash** | `git stash pop` | `sl unshelve` | |
| **Drop stash** | `git stash drop` | `sl shelve -d <name>` | |
| **Revert file** | `git checkout -- <file>` | `sl revert <file>` | |
| **Reset soft** | `git reset --soft HEAD^` | `sl uncommit` | |
| **Cherry-pick** | `git cherry-pick <commit>` | `sl graft <commit>` | |
| **Blame** | `git blame <file>` | `sl blame <file>` | |
| **Show commit** | `git show <commit>` | `sl show <commit>` | |
| **Reuse commit msg** | `git commit -C <rev>` | `sl commit -M <rev>` | |

### Getting Help with Git Commands

```bash
# Translate any Git command to Sapling
sl githelp -- <git-command>

# Examples:
sl githelp -- commit
sl githelp -- git checkout my_file.txt baef1046b
sl githelp -- git rebase --skip
```

---

## Sapling-Specific Commands

### History Manipulation

| Command | Description | Example |
|---------|-------------|---------|
| `sl amend` | Meld pending changes into current commit | `sl amend` or `sl amend -m "new message"` |
| `sl absorb` | Intelligently distribute changes to appropriate commits in stack | `sl absorb` |
| `sl uncommit` | Move current commit's changes back to working copy | `sl uncommit` |
| `sl fold` | Combine current commit with its predecessor | `sl fold` |
| `sl split` | Split a commit into multiple commits | `sl split` |
| `sl histedit` | Interactive history editing (reorder, combine, delete) | `sl histedit` |
| `sl metaedit` | Edit commit message without changing content | `sl metaedit` |

### Visibility Commands

| Command | Description | Example |
|---------|-------------|---------|
| `sl hide` | Hide commits (not deleted, just hidden from view) | `sl hide <commit>` |
| `sl unhide` | Make hidden commits visible again | `sl unhide <commit>` |

### Navigation

| Command | Description | Example |
|---------|-------------|---------|
| `sl goto` | Update working copy to a commit | `sl goto <commit>` |
| `sl next` | Go to next commit in stack | `sl next` |
| `sl prev` | Go to previous commit in stack | `sl prev` |

### Visualization

| Command | Description | Example |
|---------|-------------|---------|
| `sl smartlog` / `sl sl` | Show relevant commit subgraph | `sl sl` |
| `sl web` | Launch Interactive Smartlog GUI | `sl web` |

### GitHub Integration

| Command | Description | Example |
|---------|-------------|---------|
| `sl pr submit` | Create/update GitHub PRs from commits | `sl pr submit` |
| `sl pr pull` | Import a PR into working copy | `sl pr pull <url>` |
| `sl pr link` | Link commit to existing PR | `sl pr link` |
| `sl pr unlink` | Remove PR association | `sl pr unlink` |
| `sl pr follow` | Mark commits to join descendant's PR | `sl pr follow` |

---

## Key Concepts

### Smartlog

The smartlog displays a relevant subgraph of your commits, focusing on what matters:
- Your draft (unpublished) commits
- Important bookmarks (main, master, stable)
- The current working copy location

```bash
# View smartlog in terminal
sl smartlog
# or shorthand
sl sl

# Launch web-based Interactive Smartlog
sl web
```

### Stacks

A **stack** is a linear series of commits representing related changes. Sapling is optimized for working with stacks:

```
o  commit 3 (top of stack)
|
o  commit 2
|
o  commit 1 (bottom of stack)
|
o  main (public)
```

**Stack operations:**
- `sl absorb` - Automatically distribute changes to correct commits in stack
- `sl fold` - Combine commits in stack
- `sl split` - Break apart commits
- `sl histedit` - Reorder/edit stack interactively
- `sl pr submit --stack` - Submit entire stack as PRs

### Bookmarks vs Branches

Sapling uses **bookmarks** instead of Git branches:
- Bookmarks are lightweight pointers to commits
- Local bookmarks starting with "remote/" track remote state
- Sapling discourages local bookmarks named "main" (use remote/main instead)

```bash
# Create bookmark
sl bookmark my-feature

# List bookmarks
sl bookmarks

# Delete bookmark
sl bookmark -d my-feature
```

### Draft vs Public Commits

- **Draft**: Local commits that haven't been pushed
- **Public**: Commits that have been pushed to remote

Draft commits can be freely amended, rebased, or hidden. Public commits should not be modified.

### Hidden Commits

Unlike Git where `reset --hard` can lose commits, Sapling's `hide` command makes commits invisible but keeps them recoverable:

```bash
# Hide a commit
sl hide <commit>

# View hidden commits
sl log --hidden

# Recover hidden commit
sl unhide <commit>
```

---

## GitHub Integration

### Prerequisites

1. Install GitHub CLI: `brew install gh` (or equivalent)
2. Authenticate: `gh auth login --git-protocol https`
3. Ensure you have a Personal Access Token (PAT) with repo access

### Cloning GitHub Repos

```bash
sl clone https://github.com/owner/repo
```

### Two PR Workflows

#### 1. `sl pr` - Stacked Diffs (Recommended)

Best for iterative development with stacked changes:

```bash
# Create commits
sl commit -m "Part 1: Add data model"
sl commit -m "Part 2: Add API endpoints"
sl commit -m "Part 3: Add UI components"

# Submit all as linked PRs
sl pr submit --stack

# Update PRs after changes
sl amend  # or sl absorb
sl pr submit
```

**Workflow modes** (configured via `github.pr-workflow`):
- `overlap` (default): Each commit gets a PR, all share common base
- `single`: Each PR contains exactly one commit
- `classic`: Traditional multi-commit PR

#### 2. `sl push` - Traditional Branch-Based

More explicit control, uses GitHub web UI for PR creation:

```bash
# Push to remote branch
sl push --to my-feature

# Force push after amending
sl push -f --to my-feature
```

### Reviewing PRs

For stacked diffs, Meta recommends using [ReviewStack](https://reviewstack.dev/) for better visualization.

---

## Workflow Patterns

### Basic Development Workflow

```bash
# 1. Clone repository
sl clone https://github.com/org/repo
cd repo

# 2. Pull latest changes
sl pull

# 3. Go to main
sl goto main

# 4. Make changes and commit
sl add .
sl commit -m "Add feature X"

# 5. Push or create PR
sl pr submit
# or
sl push --to feature-branch
```

### Stacked Development Workflow

```bash
# Start from main
sl goto main
sl pull

# Create stack of commits
sl commit -m "Step 1: Database schema"
sl commit -m "Step 2: Backend API"
sl commit -m "Step 3: Frontend UI"

# Submit all as PRs
sl pr submit --stack

# After review feedback, amend any commit
sl goto <commit-to-fix>
# make changes
sl amend

# Re-submit updated stack
sl goto <top-of-stack>
sl pr submit --stack
```

### Using Absorb for Stack Updates

```bash
# You have a stack of 3 commits
# Make changes that belong to different commits in the stack
# Sapling figures out which changes go where
sl absorb

# Review what absorb did
sl sl
```

### Interactive History Editing

```bash
# Edit the last N commits interactively
sl histedit

# Actions available:
# - pick: keep commit as-is
# - drop: remove commit
# - mess/reword: edit commit message
# - fold: combine with previous
# - roll: fold but discard message
# - edit: pause to amend
```

---

## Configuration

### Configuration Locations

1. **Per-repository**: `.sl/config` (not version controlled)
2. **Per-user**: `~/.slconfig` or `~/.config/sapling/sapling.conf`
3. **Per-system**: `/etc/sapling/config`

### Key Configuration Options

```ini
[ui]
username = Your Name <your.email@example.com>
# Enable verbose output
verbose = true

[github]
# PR workflow: overlap, single, or classic
pr-workflow = overlap

[remotefilelog]
# Cache location
cachepath = ~/.sl_cache

[extensions]
# Enable extensions
smartlog = true
```

### Debug Configuration

```bash
# Show all config with sources
sl config --debug
```

---

## Interactive Smartlog (ISL)

### Launching ISL

```bash
# Start web GUI (default port 3011)
sl web

# Specify port
sl web --port 8080

# Keep in foreground
sl web -f

# Kill existing server
sl web --kill
```

### VS Code Extension

Install the Sapling VS Code extension for:
- Integrated ISL sidebar
- Inline blame
- Diff comments
- Commit operations

**Key VS Code commands:**
- `Sapling: Open Interactive Smartlog`
- `Sapling: Focus ISL Sidebar`
- `Sapling: Open Comparison View`

---

## References

### Official Sources

- **GitHub Repository**: https://github.com/facebook/sapling
- **Documentation**: https://sapling-scm.com/docs/
- **DeepWiki**: https://deepwiki.com/facebook/sapling

### DeepWiki Documentation Pages

- [Overview](https://deepwiki.com/facebook/sapling#1)
- [User Interfaces](https://deepwiki.com/facebook/sapling#4)
- [Interactive Smartlog (ISL)](https://deepwiki.com/facebook/sapling#4.1)
- [EdenFS Virtual Filesystem](https://deepwiki.com/facebook/sapling#5)
- [EdenFS CLI and Management](https://deepwiki.com/facebook/sapling#5.3)
- [Mononoke Server Backend](https://deepwiki.com/facebook/sapling#6)

### Key Source Files (from DeepWiki analysis)

- `eden/scm/README.md` - Installation and build instructions
- `website/docs/introduction/installation.md` - Detailed installation steps
- `website/docs/commands/` - Command documentation
- `eden/scm/sapling/ext/histedit.py` - Histedit extension
- `eden/scm/ghstack/sapling_shell.py` - Git-to-Sapling command translation
- `addons/vscode/package.json` - VS Code extension configuration

---

## Quick Start Cheat Sheet

```bash
# Clone a repo
sl clone https://github.com/org/repo

# Check status
sl status

# View smart commit graph
sl sl

# Make a commit
sl add <files>
sl commit -m "message"

# Amend last commit
sl amend

# Move to another commit
sl goto <commit>

# Create a PR
sl pr submit

# Pull latest changes
sl pull

# Rebase on main
sl rebase -d main

# Launch GUI
sl web

# Get help for any Git command
sl githelp -- <git-command>
```
