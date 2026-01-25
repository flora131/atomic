---
date: 2026-01-19 09:07:34 UTC
researcher: Claude Code Pattern Finder
git_commit: 37a37ca3ac5ec4d7020fab08d2f9b89aef8d3904
branch: lavaman131/feature/atomic-cli
repository: atomic
topic: "Slash Commands Documentation"
tags: [research, codebase, slash-commands, claude, opencode, github-copilot]
status: complete
last_updated: 2026-01-19
last_updated_by: Claude Code Pattern Finder
---

# Slash Commands in the Atomic Codebase

## Overview

This document catalogs all slash commands found in the atomic codebase across three different AI assistant platforms:

1. **Claude Code** (`.claude/commands/`)
2. **GitHub Copilot** (`.github/prompts/`)
3. **OpenCode** (`.opencode/command/`)
4. **Ralph Plugin** (`plugins/ralph/commands/`)

## Command Locations

### Directory Structure

```
atomic/
├── .claude/commands/
│   ├── commit.md
│   ├── create-feature-list.md
│   ├── create-gh-pr.md
│   ├── create-spec.md
│   ├── explain-code.md
│   ├── implement-feature.md
│   └── research-codebase.md
├── .github/prompts/
│   ├── cancel-ralph.prompt.md
│   ├── commit.prompt.md
│   ├── create-feature-list.prompt.md
│   ├── create-gh-pr.prompt.md
│   ├── create-spec.prompt.md
│   ├── explain-code.prompt.md
│   ├── implement-feature.prompt.md
│   ├── ralph-help.prompt.md
│   ├── ralph-loop.prompt.md
│   └── research-codebase.prompt.md
├── .opencode/command/
│   ├── cancel-ralph.md
│   ├── commit.md
│   ├── create-feature-list.md
│   ├── create-gh-pr.md
│   ├── create-spec.md
│   ├── explain-code.md
│   ├── implement-feature.md
│   ├── ralph-help.md
│   └── ralph-loop.md
└── plugins/ralph/commands/
    ├── cancel-ralph.md
    ├── help.md
    └── ralph-loop.md
```

---

## Command Catalog

### 1. /commit

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/commit.md`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/commit.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/commit.md`

**Description:** Create well-formatted commits with conventional commit format.

**Frontmatter Structure (Claude):**
```yaml
---
description: Create well-formatted commits with conventional commit format.
model: opus
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(git log:*)
argument-hint: [message] | --amend
---
```

**Arguments:**
- `[message]` - Optional commit message hint
- `--amend` - Flag to amend the previous commit

**Functionality:**
1. Checks which files are staged with `git status`
2. If 0 files are staged, automatically adds all modified and new files with `git add`
3. Performs a `git diff` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. Creates commit messages using the Conventional Commits specification

**Dynamic Context (uses shell expansion):**
- `!`git status --porcelain`` - Git status
- `!`git branch --show-current`` - Current branch
- `!`git diff --cached --stat`` - Staged changes
- `!`git diff --stat`` - Unstaged changes
- `!`git log --oneline -5`` - Recent commits

---

### 2. /research-codebase

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/research-codebase.md`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/research-codebase.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/research-codebase.md`

**Description:** Document codebase as-is with research directory for historical context.

**Frontmatter Structure (Claude):**
```yaml
---
description: Document codebase as-is with research directory for historical context
model: opus
allowed-tools: AskUserQuestion, Edit, Task, TodoWrite, Write, Bash(git:*), Bash(gh:*), Bash(basename:*), Bash(date:*)
argument-hint: [research-question]
---
```

**Arguments:**
- `[research-question]` - The research question or topic to investigate

**Variable Substitution:**
- `$ARGUMENTS` - Contains the user's research question

**Functionality:**
1. Confirms refined research question with user using `AskUserQuestion` tool
2. Reads any directly mentioned files first
3. Decomposes research into composable areas
4. Spawns parallel sub-agent tasks using specialized agents:
   - `codebase-locator` - Find where files and components live
   - `codebase-analyzer` - Understand how specific code works
   - `codebase-pattern-finder` - Find examples of existing patterns
   - `codebase-research-locator` - Discover research documents
   - `codebase-research-analyzer` - Extract key insights
   - `codebase-online-researcher` - External documentation lookup
5. Synthesizes findings into a research document
6. Outputs to `research/docs/YYYY-MM-DD-topic.md`

**Output Structure:**
```
research/
├── tickets/
│   ├── YYYY-MM-DD-XXXX-description.md
├── docs/
│   ├── YYYY-MM-DD-topic.md
├── notes/
│   ├── YYYY-MM-DD-meeting.md
```

---

### 3. /create-spec

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/create-spec.md`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/create-spec.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/create-spec.md`

**Description:** Create a detailed execution plan for implementing features or refactors in a codebase by leveraging existing research.

**Frontmatter Structure (Claude):**
```yaml
---
description: Create a detailed execution plan for implementing features or refactors in a codebase by leveraging existing research in the specified `research` directory.
model: opus
allowed-tools: Edit, Read, Write, Bash, Task
argument-hint: [research-path]
---
```

**Arguments:**
- `[research-path]` - Path to research directory (defaults to `research/`)

**Variable Substitution:**
- `$ARGUMENTS` - Contains the research path

**Functionality:**
- Creates a Technical Design Document / RFC in the `specs` folder
- Uses research from the specified path
- Utilizes `codebase-research-locator` and `codebase-research-analyzer` agents

**Output Template Sections:**
1. Executive Summary
2. Context and Motivation (Current State, The Problem)
3. Goals and Non-Goals
4. Proposed Solution (High-Level Design)
5. Detailed Design (API Interfaces, Data Model, Algorithms)
6. Alternatives Considered
7. Cross-Cutting Concerns (Security, Observability, Scalability)
8. Migration, Rollout, and Testing
9. Open Questions / Unresolved Issues

---

### 4. /create-feature-list

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/create-feature-list.md`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/create-feature-list.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/create-feature-list.md`

**Description:** Create a detailed `research/feature-list.json` and `research/progress.txt` for implementing features or refactors from a spec.

**Frontmatter Structure (Claude):**
```yaml
---
description: Create a detailed `research/feature-list.json` and `research/progress.txt` for implementing features or refactors in a codebase from a spec.
model: opus
allowed-tools: Edit, Read, Write, Bash
argument-hint: [spec-path]
---
```

**Arguments:**
- `[spec-path]` - Path to the specification document

**Variable Substitution:**
- `$ARGUMENTS` - Contains the spec path

**Functionality:**
1. Removes existing `progress.txt` and `feature-list.json` if they exist
2. Creates empty `progress.txt` for logging development progress
3. Creates `feature-list.json` with features parsed from the spec

**Output JSON Structure:**
```json
{
    "category": "functional",
    "description": "New chat button creates a fresh conversation",
    "steps": [
      "Navigate to main interface",
      "Click the 'New Chat' button",
      "Verify a new conversation is created",
      "Check that chat area shows welcome state",
      "Verify conversation appears in sidebar"
    ],
    "passes": false
}
```

**Categories:** `functional`, `performance`, `ui`, `refactor`

---

### 5. /implement-feature

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/implement-feature.md`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/implement-feature.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/implement-feature.md`

**Description:** Implement a SINGLE feature from `research/feature-list.json` based on the provided execution plan.

**Frontmatter Structure (Claude):**
```yaml
---
description: Implement a SINGLE feature from `research/feature-list.json` based on the provided execution plan.
model: opus
allowed-tools: Bash, Task, Edit, Glob, Grep, NotebookEdit, NotebookRead, Read, Write, SlashCommand
---
```

**Arguments:** None explicitly defined

**Functionality:**
1. **Initialization:**
   - Run `pwd` to see current directory
   - Read `research/progress.txt` for recent work
   - Read `research/feature-list.json` and choose highest-priority unfinished feature
   - Check git logs

2. **Development:**
   - Use Test-Driven Development
   - Follow SOLID principles
   - Apply design patterns (Factory, Builder, Adapter, Facade, Strategy, Observer)
   - Maintain architectural hygiene

3. **Workflow:**
   - Only implement ONE feature then STOP
   - Delegate to debugger agent if errors occur
   - Update `passes` field to `true` after verification
   - Commit using `/commit` command via `SlashCommand` tool
   - Write progress summaries to `research/progress.txt`

4. **Context Management:**
   - Stop if more than 60% of context window is filled

---

### 6. /create-gh-pr

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/create-gh-pr.md`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/create-gh-pr.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/create-gh-pr.md`

**Description:** Commit unstaged changes, push changes, submit a pull request.

**Frontmatter Structure (Claude):**
```yaml
---
description: Commit unstaged changes, push changes, submit a pull request.
model: opus
allowed-tools: Bash(git:*), Bash(gh:*), Glob, Grep, NotebookRead, Read, SlashCommand
argument-hint: [code-path]
---
```

**Arguments:**
- `[code-path]` - Optional path to code changes

**Functionality:**
- Creates logical commits for unstaged changes (via `/commit`)
- Pushes branch to remote
- Creates pull request with proper name and description

---

### 7. /explain-code

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/explain-code.md`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/explain-code.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/explain-code.md`

**Description:** Explain code functionality in detail.

**Frontmatter Structure (Claude):**
```yaml
---
description: Explain code functionality in detail.
model: opus
allowed-tools: Glob, Grep, NotebookRead, Read, ListMcpResourcesTool, ReadMcpResourceTool, mcp__deepwiki__ask_question, WebFetch, WebSearch
argument-hint: [code-path]
---
```

**Arguments:**
- `[code-path]` - Path to the code to explain

**Variable Substitution:**
- `$ARGUMENTS` - Contains the code path

**Analysis Steps:**
1. Code Context Analysis
2. High-Level Overview
3. Code Structure Breakdown
4. Line-by-Line Analysis
5. Algorithm and Logic Explanation
6. Data Structures and Types
7. Framework and Library Usage
8. Error Handling and Edge Cases
9. Performance Considerations
10. Security Implications
11. Testing and Debugging
12. Dependencies and Integrations
13. Common Patterns and Idioms
14. Potential Improvements
15. Related Code and Context
16. Debugging and Troubleshooting

**MCP Tools Used:**
- **DeepWiki** (`ask_question`) - Look up external library documentation
- **WebFetch/WebSearch** - Retrieve web content

**Language-Specific Sections:** JavaScript/TypeScript, Python, Java, C#, Go, Rust

---

## Ralph Wiggum Commands

### 8. /ralph-loop

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/ralph-loop.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/ralph-loop.md`
- `/home/alilavaee/Documents/projects/atomic/plugins/ralph/commands/ralph-loop.md`

**Description:** Start Ralph Wiggum loop in current session - a self-referential AI loop that repeats the same prompt until completion.

**Frontmatter Structure (GitHub Prompts):**
```yaml
---
description: Start Ralph Wiggum loop in current session
tools: ["search", "execute", "edit", "read"]
model: claude-opus-4-5
---
```

**Frontmatter Structure (Claude/Plugin):**
```yaml
---
description: "Start Ralph Wiggum loop in current session"
model: opus
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh:*)", "Bash(powershell -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.ps1:*)"]
hide-from-slash-command-tool: "true"
---
```

**Arguments:**
- `PROMPT` - The prompt to repeat each iteration (default: `/implement-feature`)
- `--max-iterations <n>` - Maximum iterations before auto-stop (0 = unlimited)
- `--completion-promise <text>` - Promise phrase to signal completion (e.g., 'DONE')
- `--feature-list <path>` - Path to feature list JSON (default: `research/feature-list.json`)

**Variable Substitution:**
- `$ARGUMENTS` - Contains all command arguments

**Examples:**
```
/ralph-loop                                    # Uses /implement-feature, runs until all features pass
/ralph-loop --max-iterations 20                # With iteration limit
/ralph-loop "Build a todo API" --completion-promise "DONE" --max-iterations 20
```

**Completion Conditions:**
- `--max-iterations` limit reached
- `<promise>YOUR_PHRASE</promise>` detected in output (must match `--completion-promise`)
- All features in `--feature-list` are passing (unlimited mode)

**State Files (YAML frontmatter format):**
- Claude: `.claude/ralph-loop.local.md`
- GitHub: `.github/ralph-loop.local.md`
- OpenCode: `.opencode/ralph-loop.local.md`

> **Migration Note:** Legacy `.local.json` state files are no longer used. All Ralph state files now use YAML frontmatter markdown format (`.local.md`).

---

### 9. /cancel-ralph

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/cancel-ralph.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/cancel-ralph.md`
- `/home/alilavaee/Documents/projects/atomic/plugins/ralph/commands/cancel-ralph.md`

**Description:** Cancel active Ralph Wiggum loop.

**Frontmatter Structure (GitHub Prompts):**
```yaml
---
description: Cancel active Ralph Wiggum loop
tools: ["execute", "read"]
model: claude-opus-4-5
---
```

**Frontmatter Structure (Claude/Plugin):**
```yaml
---
description: "Cancel active Ralph Wiggum loop"
model: opus
allowed-tools: ["Bash(test -f .claude/ralph-loop.local.md:*)", "Bash(rm .claude/ralph-loop.local.md)", "Read(.claude/ralph-loop.local.md)"]
hide-from-slash-command-tool: "true"
---
```

**Arguments:** None

**Functionality:**
- Archives state to `.github/logs/` (GitHub version)
- Removes state files
- Kills any spawned processes
- Reports cancellation with iteration count

**Shell Command (GitHub version):**
```bash
if [[ "$(uname)" == MINGW* || "$(uname)" == MSYS* || "$(uname)" == CYGWIN* ]]; then 
  powershell -ExecutionPolicy Bypass -File ./.github/scripts/cancel-ralph.ps1
else 
  ./.github/scripts/cancel-ralph.sh
fi
```

---

### 10. /ralph-help

**Found in:**
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/ralph-help.prompt.md`
- `/home/alilavaee/Documents/projects/atomic/.opencode/command/ralph-help.md`
- `/home/alilavaee/Documents/projects/atomic/plugins/ralph/commands/help.md`

**Description:** Explain Ralph Wiggum technique and available commands.

**Frontmatter Structure (GitHub Prompts):**
```yaml
---
description: Explain Ralph Wiggum technique and available commands
tools: ["read"]
model: claude-opus-4-5
---
```

**Arguments:** None

**Content:**
- Explains the Ralph Wiggum technique (pioneered by Geoffrey Huntley)
- Lists available commands (`/ralph-loop`, `/cancel-ralph`, `/ralph-help`)
- Describes use cases (good for well-defined tasks, not good for tasks requiring human judgment)
- Provides links to external resources

---

## Command Structure Patterns

### Frontmatter Fields

| Field | Description | Example Values |
|-------|-------------|----------------|
| `description` | Brief description of command purpose | "Create well-formatted commits with conventional commit format." |
| `model` | AI model to use | `opus`, `claude-opus-4-5`, `anthropic/claude-opus-4-5` |
| `allowed-tools` | Tools the command can use | `Bash(git:*)`, `Edit`, `Read`, `Write`, `Task` |
| `argument-hint` | Hint for expected arguments | `[message] \| --amend`, `[research-path]` |
| `hide-from-slash-command-tool` | Whether to hide from SlashCommand tool | `"true"` |
| `tools` (GitHub) | Array of tool categories | `["search", "execute", "edit", "read"]` |
| `agent` (OpenCode) | Agent to use | `build` |

### Variable Substitution

- `$ARGUMENTS` - User-provided arguments after the command name
- `${CLAUDE_PLUGIN_ROOT}` - Root path of the Claude plugin

### Dynamic Shell Execution

Commands can execute shell commands inline using the syntax:
```
!`shell command here`
```

Example from commit.md:
```markdown
- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
```

### Platform Differences

| Feature | Claude | GitHub Prompts | OpenCode |
|---------|--------|----------------|----------|
| File extension | `.md` | `.prompt.md` | `.md` |
| Directory | `.claude/commands/` | `.github/prompts/` | `.opencode/command/` |
| Model field | `model: opus` | `model: claude-opus-4-5` | `model: anthropic/claude-opus-4-5` |
| Tools field | `allowed-tools:` (string) | `tools:` (array) | N/A |
| Agent field | N/A | N/A | `agent:` |

---

## Code References

- `/home/alilavaee/Documents/projects/atomic/.claude/commands/commit.md:1-245`
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/research-codebase.md:1-207`
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/create-spec.md:1-240`
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/create-feature-list.md:1-43`
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/implement-feature.md:1-81`
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/create-gh-pr.md:1-12`
- `/home/alilavaee/Documents/projects/atomic/.claude/commands/explain-code.md:1-208`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/ralph-loop.prompt.md:1-61`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/cancel-ralph.prompt.md:1-21`
- `/home/alilavaee/Documents/projects/atomic/.github/prompts/ralph-help.prompt.md:1-34`
- `/home/alilavaee/Documents/projects/atomic/plugins/ralph/commands/help.md:1-127`
- `/home/alilavaee/Documents/projects/atomic/plugins/ralph/commands/ralph-loop.md:1-18`
- `/home/alilavaee/Documents/projects/atomic/plugins/ralph/commands/cancel-ralph.md:1-17`

---

## Summary Table

| Command | Arguments | Platforms |
|---------|-----------|-----------|
| `/commit` | `[message] \| --amend` | Claude, GitHub, OpenCode |
| `/research-codebase` | `[research-question]` | Claude, GitHub, OpenCode |
| `/create-spec` | `[research-path]` | Claude, GitHub, OpenCode |
| `/create-feature-list` | `[spec-path]` | Claude, GitHub, OpenCode |
| `/implement-feature` | None | Claude, GitHub, OpenCode |
| `/create-gh-pr` | `[code-path]` | Claude, GitHub, OpenCode |
| `/explain-code` | `[code-path]` | Claude, GitHub, OpenCode |
| `/ralph-loop` | `PROMPT [--max-iterations N] [--completion-promise TEXT] [--feature-list PATH]` | GitHub, OpenCode, Ralph Plugin |
| `/cancel-ralph` | None | GitHub, OpenCode, Ralph Plugin |
| `/ralph-help` | None | GitHub, OpenCode, Ralph Plugin |
