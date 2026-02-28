# Atomic

<p align="center">
  <img src="assets/atomic.png" alt="Atomic" width="800">
</p>

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/flora131/atomic)

Ship complex features with AI agents that actually understand your codebase. Research, spec, implement — then wake up to completed code ready for review.

---

## Key Principle

**You own the decisions. Agents own the execution.**

- Review specs before implementation (architecture decisions)
- Review code after each feature (quality gate)
- The 60-80% rule: agents get you most of the way, you provide the polish
- Play around with the agents and use them as your swiss army knife

---

## Video Overview

[![Atomic Video Overview](https://img.youtube.com/vi/Lq8-qzGfoy4/maxresdefault.jpg)](https://www.youtube.com/watch?v=Lq8-qzGfoy4)

---

## What Engineers Use Atomic For

### Ship Complex Features End-to-End

Not just bug fixes — scoped, multi-file features that require architectural understanding:

- Database migrations across large codebases
- Entire new services (building a complete GraphRAG service from scratch)
- Features spanning dozens of files that need to understand existing patterns first
- Trying different implementation approaches — spec it out, try one framework, revert, try another

The workflow: `/research-codebase` → review → `/create-spec` → review → `/ralph` (manual or autonomous implementation) → `/gh-create-pr`. Wake up to completed features ready for review.

Works on macOS, Linux, and Windows.

### Deep Codebase Research & Root Cause Analysis

You know the pain:

- **Hours lost** hunting through unfamiliar code manually and not seeing real gains in productivity with coding agents
- **Agents missing key files** even when you know they're relevant
- **Repeating yourself** — mentioning the same file over and over, only for the agent to ignore it
- **Context window blown** before you've even started the real work
- **Files too large to paste** — so you just... can't share the context you need

The `/research-codebase` command dispatches specialized sub-agents to do the hunting for you:

- Understand how authentication flows work in an unfamiliar codebase
- Track down root causes by analyzing code paths across dozens of files
- Search through docs, READMEs, and inline documentation in your repo
- Get up to speed on a new project in minutes instead of hours

This is the fastest path to value — install, run one command, get answers.

### Explore Multiple Implementation Approaches

When you're evaluating libraries, exploring implementation approaches, or need best practices before building, Atomic's research phase pulls in external knowledge — not just your codebase — to inform the spec and implementation plan.

**Example: Researching three GraphRAG implementation approaches in parallel**

```bash
# Run 3 parallel research sessions in separate terminals
atomic chat -a claude "/research-codebase Research implementing GraphRAG using \
  LangChain's graph retrieval patterns. Look up langchain-ai/langchain for \
  graph store integrations, chunking strategies, and retrieval patterns. \
  Document how this would integrate with our existing vector store."

atomic chat -a claude "/research-codebase Research implementing GraphRAG using \
  Microsoft's GraphRAG library. Look up microsoft/graphrag for their \
  community detection, entity extraction, and summarization pipeline. \
  Document the infrastructure requirements and how it fits our data model."

atomic chat -a claude "/research-codebase Research implementing GraphRAG using \
  LlamaIndex's property graph index. Look up run-llama/llama_index for \
  their KnowledgeGraphIndex and property graph patterns. Document trade-offs \
  vs our current RAG implementation."
```

**What happens:** Each agent spawns specialized codebase research sub-agents that query DeepWiki for the specified repos, pull external documentation, and cross-reference with your existing codebase patterns and logic. You get three research documents.

**From there:** Run `/create-spec` on each research doc in parallel terminals. Then spin up three git worktrees and run `/ralph` in each. Wake up to three complete implementations on separate branches — review, benchmark, and choose the winner.

> **Note:** This workflow works identically with `atomic chat -a opencode` and `atomic chat -a copilot`.

---

## Table of Contents

- [What Engineers Use Atomic For](#what-engineers-use-atomic-for)
- [Quick Start Guide](#quick-start-guide)
- [The Flywheel](#the-flywheel)
- [How It Works](#how-it-works)
- [Commands, Agents, and Skills](#commands-agents-and-skills)
- [TUI Features](#tui-features)
- [Supported Coding Agents](#supported-coding-agents)
- [Autonomous Execution (Ralph)](#autonomous-execution-ralph)
- [Configuration Files](#configuration-files)
- [Updating Atomic](#updating-atomic)
- [Uninstalling Atomic](#uninstalling-atomic)
- [Telemetry](#telemetry)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Workflow Authoring Guide](docs/workflow-authors-getting-started.md)
- [Contributing Guide](#contributing-guide)
- [License](#license)
- [Credits](#credits)

---

## Quick Start Guide

### Prerequisites

- **Operating Systems**: macOS, Linux, or Windows (with PowerShell)
- **At least one coding agent installed**:
    - [Claude Code](https://code.claude.com/docs/en/quickstart)
    - [OpenCode](https://opencode.ai)
    - [GitHub Copilot CLI](https://github.com/features/copilot/cli)

### Step 1: Install Atomic

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

### Step 2: Initialize Your Project

```bash
cd your-awesome-project
atomic init
```

Select your coding agent when prompted. The CLI configures your project automatically.

### Step 3: Generate Context Files

Start a chat session and run `/init` to generate `CLAUDE.md` and `AGENTS.md`:

```bash
atomic chat -a <claude|opencode|copilot>
```

```
/init
```

The `/init` command explores your codebase using sub-agents and generates documentation tailored to your project. These files give coding agents the context they need to work effectively.

### Step 4: Ship Features

```
Research → Spec → Implement → (Debug) → PR
```

**Research the codebase:**

```
/research-codebase [Describe your feature or question]
/clear
```

Review: Confirm the agent understood your codebase and requirements.

**Create a specification:**

```
/create-spec [research-path]
/clear
```

Review (**critical**): This is your main decision point. The spec becomes the contract.

**Implement features:**

```
/ralph "<prompt-or-spec-path>"
```

**Commit and ship:**

```
/gh-commit
/gh-create-pr
```

**Debugging:** If something breaks during implementation, use the debugging agent:

```
Use the debugging agent to create a debugging report for [insert error message here].
```

Then follow the debugging report to resolve the issue.

### Advanced Installation

<details>
<summary>Install a specific version</summary>

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash -s -- v1.0.0
```

**Windows PowerShell:**

```powershell
iex "& { $(irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1) } -Version v1.0.0"
```

</details>

<details>
<summary>Custom install directory</summary>

**macOS / Linux:**

```bash
ATOMIC_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
$env:ATOMIC_INSTALL_DIR = "C:\tools"; irm https://raw.githubusercontent.com/flora131/atomic/main/install.ps1 | iex
```

</details>

<details>
<summary>Source control selection</summary>

During `atomic init`, you'll be prompted to select your source control system:

| SCM Type              | CLI Tool | Code Review       | Use Case                     |
| --------------------- | -------- | ----------------- | ---------------------------- |
| GitHub / Git          | `git`    | Pull Requests     | Most open-source projects    |
| Sapling + Phabricator | `sl`     | Phabricator Diffs | Meta-style stacked workflows |

The selection is saved to `.atomic/settings.json` and configures the appropriate commit and code review commands.

**Sapling + Phabricator:**

1. Ensure `.arcconfig` exists in your repository root
2. Use `/sl-commit` for commits and `/sl-submit-diff` for code review

**Note for Windows users:** Sapling templates use the full path `& 'C:\Program Files\Sapling\sl.exe'` to avoid conflicts with PowerShell's built-in `sl` alias.

</details>

---

## The Flywheel

```
Research → Specs → Execution → Outcomes → Specs (persistent memory)
                ↑                                    ↓
                └────────────────────────────────────┘
```

Every feature follows this cycle. Specs and research become memory for future sessions.

---

## How It Works

[![Architecture](assets/architecture.svg)](assets/architecture.svg)

---

## Commands, Agents, and Skills

### CLI Commands

Top-level Atomic CLI commands.

| Command                    | Description                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| `atomic init`              | Interactive setup                                               |
| `atomic chat`              | Start TUI chat with a coding agent (default command)            |
| `atomic config set <k> <v>` | Set CLI configuration values (example: telemetry opt-in/out)    |
| `atomic update`            | Self-update Atomic (binary installs only)                       |
| `atomic uninstall`         | Remove Atomic installation (binary installs only)               |

#### `atomic chat` Flags

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `-a, --agent <name>` | `"claude"` | Agent to chat with (`claude`, `opencode`, `copilot`) |
| `-w, --workflow` | `false` | Enable graph workflow mode |
| `-t, --theme <name>` | `"dark"` | UI theme (`dark`, `light`) |
| `-m, --model <name>` | (none) | Model to use for the chat session |
| `[prompt...]` | (none) | Initial prompt to send |

#### `atomic init` Flags

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `-a, --agent <name>` | (none) | Pre-select agent (skips interactive prompt) |

### Slash Commands

User-invocable chat commands for workflows, built-ins, and skills.

| Command              | Arguments               | Description                                                   |
| -------------------- | ----------------------- | ------------------------------------------------------------- |
| `/help`              |                         | Show all available commands                                   |
| `/clear`             |                         | Clear all messages and reset session                          |
| `/compact`           |                         | Compact context to reduce token usage                         |
| `/model`             | `[model\|list\|select]` | View/switch active model                                      |
| `/mcp`               | `[enable\|disable]`     | View and toggle MCP servers                                   |
| `/theme`             | `[dark\|light]`         | Toggle between dark and light theme                           |
| `/exit`              |                         | Exit the chat application                                     |
| `/init`              |                         | Generate `CLAUDE.md` and `AGENTS.md` by exploring codebase   |
| `/research-codebase` | `"<question>"`          | Analyze codebase and document findings                        |
| `/create-spec`       | `"<research-path>"`     | Generate technical specification                              |
| `/explain-code`      | `"<path>"`              | Explain code section in detail                                |
| `/gh-commit`         |                         | Create a Git commit using Git/GitHub workflow                 |
| `/gh-create-pr`      |                         | Commit, push, and open a GitHub pull request                  |
| `/sl-commit`         |                         | Create a Sapling commit                                       |
| `/sl-submit-diff`    |                         | Submit Sapling changes to Phabricator                         |
| `/ralph`             | `"<prompt>"`            | Run autonomous implementation workflow                        |

### Agents

Sub-agents that execute specialized tasks. These are invoked automatically by commands or can be requested directly.

| Agent                        | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `codebase-analyzer`          | Analyze implementation details of specific components |
| `codebase-locator`           | Locate files, directories, and components for a task  |
| `codebase-pattern-finder`    | Find similar implementations and usage examples       |
| `codebase-online-researcher` | Research questions using web sources                  |
| `codebase-research-analyzer` | Deep dive on research topics                          |
| `codebase-research-locator`  | Discover relevant documents in `research/` directory  |
| `debugger`                   | Debug errors, test failures, and unexpected behavior  |

### Skills

Domain knowledge applied during work. These are automatically invoked when relevant.

| Skill                   | Purpose                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `testing-anti-patterns` | Prevent common testing mistakes (mock misuse, test pollution)                    |
| `prompt-engineer`       | Apply best practices when creating or improving prompts                          |
| `frontend-design`       | Create distinctive, production-grade frontend interfaces with high design quality |

### TUI Features

The Atomic TUI chat interface includes several features for an enhanced development experience.

#### Keyboard Shortcuts

| Shortcut | Action |
| -------- | ------ |
| `Ctrl+O` | Open transcript view |
| `Ctrl+C` | Interrupt current operation |

#### Themes

Switch between dark and light themes:

```bash
# Via CLI flag
atomic chat -a claude --theme light

# Via slash command in chat
/theme dark
```

#### @Mentions

Reference files in your messages using `@` mentions. The TUI provides autocomplete suggestions as you type.

#### Verbose Mode

Toggle verbose output to see detailed agent activity, tool calls, and token usage.

---

## Supported Coding Agents

| Agent              | CLI Command               | Folder       | Context File |
| ------------------ | ------------------------- | ------------ | ------------ |
| Claude Code        | `atomic chat -a claude`   | `.claude/`   | `CLAUDE.md`  |
| OpenCode           | `atomic chat -a opencode` | `.opencode/` | `AGENTS.md`  |
| GitHub Copilot CLI | `atomic chat -a copilot`  | `.github/`   | `AGENTS.md`  |

---

## Autonomous Execution (Ralph)

<p align="center">
  <img src="assets/ralph-wiggum.jpg" alt="Ralph Wiggum" width="600">
</p>

The [Ralph Wiggum Method](https://ghuntley.com/ralph/) enables multi-hour autonomous coding sessions. After approving your spec and feature list, let Ralph work in the background while you focus on other tasks.

### How It Works

1. Create and approve your spec (`/create-spec`)
2. Start the workflow (`/ralph "<prompt-or-spec-path>"`)
3. Ralph executes a 3-phase graph-based workflow:
   - **Phase 1 — Task Decomposition**: A `planner` sub-agent breaks the spec/prompt into a structured task list with dependency tracking
   - **Phase 2 — Worker Loop**: Dispatches `worker` sub-agents for ready tasks (those with no blocking dependencies), executing up to 100 iterations
   - **Phase 3 — Review & Fix**: A `reviewer` sub-agent audits the implementation; if issues are found, a `fixer` sub-agent generates corrective tasks that re-enter the worker loop

### Usage

```
/ralph "<prompt-or-spec-path>"
```

| Argument     | Description                                           |
| ------------ | ----------------------------------------------------- |
| `"<prompt>"` | Prompt or path to a spec file (required for new runs) |

### Chat Interface

Ralph runs inside the Atomic TUI chat interface:

```bash
# Start chat with your preferred agent: claude, opencode, or copilot
atomic chat -a <claude|opencode|copilot>

# Or even specify agent and theme
atomic chat -a opencode --theme <light/dark>
```

### Examples

```
# Start a new workflow with a prompt
/ralph "Build a REST API for user management"

# Start from a spec file
/ralph "specs/my-feature.md"
```

---

## Configuration Files

### `.atomic/settings.json`

Atomic stores project-level configuration in `.atomic/settings.json`. This file is created automatically during `atomic init`.

Configuration resolution for project defaults:

1. Local override: `.atomic/settings.json`
2. Global fallback: `~/.atomic/settings.json`

Atomic no longer reads or writes `.atomic.json`.

**Example `.atomic/settings.json`:**

```json
{
    "version": 1,
    "agent": "claude",
    "scm": "github",
    "lastUpdated": "2026-02-12T12:00:00.000Z"
}
```

**Fields:**

| Field         | Type   | Description                                             |
| ------------- | ------ | ------------------------------------------------------- |
| `version`     | number | Config schema version (currently `1`)                   |
| `agent`       | string | Selected coding agent (`claude`, `opencode`, `copilot`) |
| `scm`         | string | Source control type (`github`, `sapling`)               |
| `lastUpdated` | string | ISO 8601 timestamp of last configuration update         |

**Note:** You generally don't need to edit this file manually. Use `atomic init` to reconfigure your project.

### Agent-Specific Files

Each agent has its own configuration folder:

| Agent          | Folder       | Skills              | Context File |
| -------------- | ------------ | ------------------- | ------------ |
| Claude Code    | `.claude/`   | `.claude/skills/`   | `CLAUDE.md`  |
| OpenCode       | `.opencode/` | `.opencode/skills/` | `AGENTS.md`  |
| GitHub Copilot | `.github/`   | `.github/skills/`   | `AGENTS.md`  |

---

## Updating Atomic

### Native installation (Recommended)

If you installed Atomic using the native install script, you can update using the built-in command:

```bash
# Update to the latest version
atomic update
```

### bun installation

Use your package manager to update:

```bash
# Using bun
bun upgrade @bastani/atomic
```

---

## Uninstalling Atomic

### Native installation (CLI command)

If you installed Atomic using the native install script, you can uninstall using the built-in command:

```bash
# Preview what will be removed (no changes made)
atomic uninstall --dry-run

# Uninstall Atomic
atomic uninstall

# Keep configuration data, only remove binary
atomic uninstall --keep-config

# Skip confirmation prompt
atomic uninstall --yes  # or -y
```

The uninstall command will:

- Remove the Atomic binary from `~/.local/bin/atomic` (or your custom install directory)
- Remove configuration data from `~/.local/share/atomic` (unless `--keep-config` is used)
- Remove Atomic-managed global agent configs from `~/.atomic/.claude`, `~/.atomic/.opencode`, and `~/.atomic/.copilot` (unless `--keep-config` is used)
- Display instructions for removing the PATH entry from your shell configuration

### Native installation (manual)

If the CLI command is not available, you can manually remove the files:

**macOS, Linux:**

```bash
rm -f ~/.local/bin/atomic
rm -rf ~/.local/share/atomic
rm -rf ~/.atomic/.claude ~/.atomic/.opencode ~/.atomic/.copilot
```

If you installed to a custom directory, remove the binary from that location instead.

**Windows PowerShell:**

```powershell
Remove-Item "$env:USERPROFILE\.local\bin\atomic.exe" -Force
Remove-Item "$env:LOCALAPPDATA\atomic" -Recurse -Force
Remove-Item "$env:USERPROFILE\.atomic\.claude" -Recurse -Force
Remove-Item "$env:USERPROFILE\.atomic\.opencode" -Recurse -Force
Remove-Item "$env:USERPROFILE\.atomic\.copilot" -Recurse -Force
```

### bun installation

```bash
# Using bun
bun remove -g @bastani/atomic
```

### Clean up configuration files (optional)

> **Warning:** Removing configuration files will delete all your project-specific settings, skills, and agents configured by Atomic.

To remove Atomic configuration files from a project:

**macOS, Linux:**

```bash
# For Claude Code
rm -rf .claude/ CLAUDE.md

# For OpenCode
rm -rf .opencode/ AGENTS.md

# For GitHub Copilot
rm -f .github/copilot-instructions.md
```

**Windows PowerShell:**

```powershell
# For Claude Code
Remove-Item -Path ".claude" -Recurse -Force
Remove-Item -Path "CLAUDE.md" -Force

# For OpenCode
Remove-Item -Path ".opencode" -Recurse -Force
Remove-Item -Path "AGENTS.md" -Force

# For GitHub Copilot
Remove-Item -Path ".github\copilot-instructions.md" -Force
```

---

## Telemetry

Atomic collects anonymous usage telemetry to help improve the product. All data is anonymous and privacy-respecting.

### What We Collect

- Command names (init, help, config, etc.)
- Agent type (claude, opencode, copilot)
- Success/failure status
- Session and workflow metrics (duration, feature count)

### What We NEVER Collect

- Your prompts or queries
- File paths or code content
- IP addresses or location data
- Personal identifiable information

### Privacy Features

- **Anonymous ID**: A stable but non-identifiable ID derived from machine characteristics
- **Local logging**: Telemetry is stored locally as JSONL files before any remote transmission
- **CI auto-disable**: Telemetry is automatically disabled in CI environments (`CI=true`)
- **First-run consent**: You're prompted to opt-in during your first use of `atomic init`

### Data Storage

Telemetry data is stored locally before being sent:

| Platform | Local Log Path                                     |
| -------- | -------------------------------------------------- |
| Windows  | `%APPDATA%\atomic\telemetry\`                      |
| macOS    | `~/Library/Application Support/atomic/telemetry/`  |
| Linux    | `~/.local/share/atomic/telemetry/` (XDG compliant) |

### Opt-Out Methods

You can disable telemetry at any time using any of these methods:

```bash
# Using the config command
atomic config set telemetry false

# Using environment variables (shell)
export ATOMIC_DISABLE_TELEMETRY=1
```

**Windows PowerShell:**

```powershell
# Set environment variable for current session
$env:ATOMIC_DISABLE_TELEMETRY = "1"

# Or set permanently for your user
[Environment]::SetEnvironmentVariable("ATOMIC_DISABLE_TELEMETRY", "1", "User")
```

To re-enable telemetry:

```bash
atomic config set telemetry true
# Or remove the environment variables
unset ATOMIC_DISABLE_TELEMETRY
```

### Programmatic Configuration

If you're integrating Atomic into your tooling:

```typescript
import { loadTelemetryConfig, isTelemetryEnabled } from "@bastani/atomic";

// Check if telemetry is enabled
if (isTelemetryEnabled()) {
    // Telemetry will be collected
}

// Load full configuration
const config = loadTelemetryConfig();
console.log(config.enabled); // boolean
console.log(config.localLogPath); // platform-specific path
```

---

## Troubleshooting

**Git Identity Error:** Configure git identity:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

**Windows Command Resolution:** If agents fail to spawn on Windows, ensure the agent CLI is in your PATH. Atomic uses `Bun.which()` to resolve command paths, which handles Windows `.cmd`, `.exe`, and `.bat` extensions automatically.

**Generating CLAUDE.md/AGENTS.md:** `atomic init` does not create `CLAUDE.md` or `AGENTS.md`. Run `/init` inside a chat session to generate these files. The command explores your codebase and produces project-specific documentation for coding agents.

**Shift+Enter Not Inserting Newline:** Atomic uses layered newline detection in chat input.

- **Kitty protocol (VS Code path):** In VS Code's integrated terminal, keep `terminal.integrated.enableKittyKeyboardProtocol` enabled so Shift+Enter is sent as a modified Enter key.
- **modifyOtherKeys (supported terminals):** In terminals like GNOME Terminal, xterm, Alacritty, WezTerm, and iTerm2, Atomic enables `modifyOtherKeys` mode automatically to preserve Shift+Enter multiline behavior.
- **Universal fallback:** Use `Ctrl+J` to insert a newline in any terminal.
- **Last resort:** If your terminal does not provide modified Enter sequences, end the line with `\` and press Enter to continue on a new line.

**Best Practice:** Run Ralph in a separate [git worktree](https://git-scm.com/docs/git-worktree) to isolate autonomous execution from your main development session:

```bash
# Create a worktree for Ralph
git worktree add ../my-project-ralph feature-branch

# Run Ralph in the worktree
cd ../my-project-ralph
atomic chat -a claude
# then type: /ralph "Build the auth module"
```

This keeps your main workspace free for other work while Ralph runs autonomously.

---

## FAQ

### How Atomic Differs from Spec-Kit

[Spec Kit](https://github.com/github/spec-kit) is GitHub's toolkit for "Spec-Driven Development" where specifications become executable artifacts. While both projects aim to improve AI-assisted development, they solve different problems:

| Aspect                 | Spec-Kit                                                        | Atomic                                                                                                                      |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Primary Focus**      | Greenfield projects - building new features from specifications | **Large existing codebases and greenfield** - understanding patterns before implementing                                    |
| **First Step**         | `/speckit.constitution` - define project principles             | `/research-codebase` - analyze existing architecture and patterns                                                           |
| **Memory Model**       | Per-feature specs in `.specify/specs/`                          | Flywheel of active, semantic, and procedural memory: `Research → Specs → Execution → Outcomes` with `progress.txt` tracking |
| **Agent Architecture** | Single agent executes slash commands via shell scripts          | **Specialized sub-agents**: `codebase-analyzer`, `codebase-locator`, `codebase-pattern-finder`                              |
| **Human Review**       | Implicit in workflow                                            | **Explicit checkpoints** with "You review (CRITICAL)" markers                                                               |
| **Debugging**          | Not addressed                                                   | Dedicated debugging agent workflow                                                                                          |
| **Autonomous Runs**    | Not available                                                   | **Ralph** for overnight feature implementation                                                                              |

**When to choose Atomic:**

- Working with an existing, large codebase where you need to discover patterns first and greenfield projects
- Need session continuity, context management, and built-in memory
- Want explicit human-in-the-loop checkpoints
- Need debugging workflows when implementations fail
- Want autonomous overnight execution (Ralph) for coding agents

---

## Contributing Guide

See [DEV_SETUP.md](DEV_SETUP.md) for development setup, testing guidelines, and contribution workflow.
For custom workflow authoring, see [docs/workflow-authors-getting-started.md](docs/workflow-authors-getting-started.md).

---

## License

MIT

## Credits

- [Superpowers](https://github.com/obra/superpowers)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Ralph Wiggum Method](https://ghuntley.com/ralph/)
- [OpenAI Codex Cookbook](https://github.com/openai/openai-cookbook)
- [HumanLayer](https://github.com/humanlayer/humanlayer)
