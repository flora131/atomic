# ⚛️ Atomic: Automated Procedures and Memory for AI Coding Agents

<p align="center">
  <img src="atomic.png" alt="Atomic" width="200">
</p>

AI coding agents are exceptionally powerful but have key gaps in principled software engineering, context, and memory. This makes them difficult to use in large codebases or generate higher quality code.

Engineers spend a lot of their time figuring out how to get tools to work for them rather than iterating on and shipping code with AI coding agents.

This project is named 'Atomic' for its approach of decomposing complex goals into discrete, manageable steps. By following core Software Development Lifecycle (SDLC) principles, it creates a foundation for effectively steering AI coding agents. This approach enables engineers to transition from vibe coding to true AI-assisted development.

**This repo automates AI coding agents with an operating procedure and memory.**

We provide the *procedures* that agents use to work on your project based on software engineering best practices, and *specs* that persist as memory of decisions made and lessons learned.

---

## 📽️ Video Overview

[![Atomic Video Overview](https://img.youtube.com/vi/Lq8-qzGfoy4/maxresdefault.jpg)](https://www.youtube.com/watch?v=Lq8-qzGfoy4)

---

## 📑 Table of Contents

- [📽️ Video Overview](#️-video-overview)
- [🧠 The Memory Gap](#the-memory-gap)
- [🔄 The Flywheel](#the-flywheel)
- [⚙️ How It Works](#how-it-works)
- [⚡ 1 Minute Quick Start](#1-minute-quick-start)
- [📋 Our Procedure - Follow Step-by-Step After Install](#our-procedure-follow-step-by-step-or-use-commands-and-sub-agents-in-repo-to-build-your-own)
- [📈 The ROI](#the-roi)
- [🖥️ Platform Reference](#platform-reference)
- [📦 What's Included](#whats-included)
- [🆚 How Atomic Differs from Spec Kit](#how-atomic-differs-from-spec-kit)
- [🔧 Troubleshooting](#troubleshooting)
- [📄 License](#license)
- [🙏 Credits](#credits)

---

## The Memory Gap

This repo helps fill the episodic and procedural gaps.

| Memory Type    | What It Is       | AI Coding Agents Out of the Box | This repo                   |
| -------------- | ---------------- | ------------------------------- | --------------------------- |
| Semantic       | Facts about code | "Auth is in /src/auth"          | Via your coding agent       |
| **Episodic**   | What happened    | ⚠️ Fragmented                    | ✅ Via specs, progress files |
| **Procedural** | How to do things | ❌ Missing                       | ✅ Via automated procedure   |

This repo enables agents with *how* to work on your code and builds lasting memory through specs.

## The Flywheel

```
Research → Specs → Execution → Outcomes → Specs (persistent memory)
                ↑                                    ↓
                └────────────────────────────────────┘
```

Every feature you ship follows proven software engineering lifecycle best practices. Specs aren't just documentation, they're **persistent memory** that survives sessions and informs future agents.

## How It Works

[![Architecture](architecture.svg)](architecture.svg)

This repo provides three resources that power the flywheel:

| Resources    | Purpose                   | Examples                                                   |
| ------------ | ------------------------- | ---------------------------------------------------------- |
| **Commands** | Orchestrate the agents    | `/research-codebase`, `/create-spec`, `/implement-feature` |
| **Agents**   | Execute specialized tasks | `codebase-analyzer`, `codebase-locator`, `pattern-finder`  |
| **Skills**   | Inject domain knowledge   | `testing-anti-patterns`, `prompt-engineer`                 |

**Commands** call **Agents** to do the work, while **Skills** ensure they follow best practices. The output? Specs that become memory for the next session. This standard operating procedure enables your AI coding agents to deliver results. You ship code faster and spend less time wrestling with the tools.

---

## 1 Minute Quick Start

### Install the necessary dependencies

[bun](https://bun.sh/docs/installation) - JavaScript runtime for MCP servers (more efficient startup). If you prefer, you can use `npx` instead by adjusting the commands in `.mcp.json` and `.vscode/mcp.json`.

[Docker](https://docs.docker.com/get-docker/) - Required for local MCP servers. Ensure Docker is installed and running.

### Sandboxed Environment for Claude Code

The commands in this repo require Claude Code to run with permissions bypassed (`--dangerously-skip-permissions` or via `.claude/settings.json`). For a safer development environment, use our pre-configured devcontainer with network restrictions and security boundaries:

```bash
cp -r .devcontainer /path/to/your-project/
```

Open your project in VS Code and select "Reopen in Container" when prompted.

### Step 1: Populate Your Project Context

Copy the appropriate context file to your project root and ask your AI assistant to populate it:

```bash
# For Claude Code
cp CLAUDE.md /path/to/your-project/

# For other AI tools (GitHub Copilot, Kiro, OpenCode)
cp AGENTS.md /path/to/your-project/
```

Then open your project in your AI coding assistant and ask:

```
> "Analyze this project and populate the CLAUDE.md (or AGENTS.md) with project-specific context"

NOTE: If you only want to populate CLAUDE.md with a subset of folders and not your entire repo, please add and specify to the prompt above.
```

The AI will analyze your tech stack, patterns, and architecture to fill in the template.

### Step 2: Copy Your Platform's Agent Folder

Copy the folder for your AI coding assistant to your project's root directory (where your `package.json` or main config file lives):

```bash
# For Claude Code
cp -r .claude /path/to/your-project-root/

# For GitHub Copilot
cp -r .github /path/to/your-project-root/

# For Kiro
cp -r .kiro /path/to/your-project-root/

# For OpenCode
cp -r .opencode /path/to/your-project-root/
```

#### MCP Configuration

Copy the MCP configuration files for recommended MCP servers (deepwiki, playwright):

```bash
cp .mcp.json /path/to/your-project/
cp -r .vscode/ /path/to/your-project/
```

**Important:** If you already have a `.claude/`, `.github/`, `.kiro/`, or `.opencode/` folder in your project, merge the contents carefully rather than overwriting. The `settings.json` files contain tool permissions that you may want to customize.

### Optional: Autonomous Execution (Ralph)

Run Claude Code autonomously in continuous loops. ONLY AFTER approving your spec and feature list, let Ralph work in the background or overnight while you focus on other tasks. The key is crisp, well-defined instructions coupled with human review. Learn more below!

> **Note:** Currently only supported for Claude Code. Supports both Mac/Linux and Windows PowerShell.

**Required:** [uv](https://docs.astral.sh/uv/getting-started/installation/#installing-uv) - Python package manager

See [.claude/.ralph/README.md](.claude/.ralph/README.md) for setup instructions.

---

## Our Procedure (Follow step-by-step or use commands and sub-agents in repo to build your own)

Follow our automated procedure below, built on top of the Research, Plan, Implement workflow, to go from feature idea to merged PR. Each step is designed for human-in-the-loop review at critical decision points.

### Step 1: Research the Codebase & Review Research

Before any implementation, build context about existing patterns and architecture.

```bash
# Run the research command with your prompt for both brownfield and greenfield projects

  # With a description of what you're building
  /research-codebase "I'm building a real-time collaboration tool with WebSocket support, document versioning, and role-based permissions. Research best practices and architecture patterns for these requirements."
  # Or reference your PRD
  /research-codebase "Research implementation approaches for the requirements outlined in docs/prd.md"
```

**What happens:** The command dispatches `codebase-locator` and `codebase-analyzer` agents to explore your codebase. Results are saved to `research/` directory for reference.

**You review:** Review the research output. Confirm the agent understood the relevant parts of your codebase and overall requirements. Fix anything that may be missing.

```bash
# compact the context and information into a progress.txt before continuing 
/compact
```

### Step 2: Create a Specification & Thoroughly Review Specification

Generate an execution plan based on your research.

```bash
# Create a spec referencing your research
/create-spec research/research.md
```

**What happens:** The agent reads your research from `research/` and `progress.txt` to know what has been done, synthesizes it, and produces a structured specification.

**You review (CRITICAL):** This is your main decision point. Read the spec carefully. Ask clarifying questions. Request changes. The spec becomes the contract for implementation.

### Step 3: Break Into Features & Review Features 

Decompose the spec into discrete, implementable tasks.

```bash
# Generate feature list from the approved spec
/create-feature-list path/to/spec.md
```

**What happens:** Creates `feature-list.json` and `progress.txt` with:
- Ordered list of features
- Dependencies between features
- Acceptance criteria for each

**You review (CRITICAL):** Verify the breakdown makes sense. Reorder if needed. Remove features that are out of scope.

### Step 4: Implement Features (One at a Time or via Claude Code Ralph Loop)
Execute each feature from your list and compact to keep progress 

```bash
# Implement the next feature
/implement-feature feature-list.json
```
** Important NOTE**: at the end of the /implement-feature slash command you will notice that we commit the changes in a specific format. This is not hallucination and we recommend not changing this pattern. We commit and do so in this format so that the agent can more easily track the work it has done and search for recent commits more effectively, respectively. The prefixes we add to commit messages enable the model to identify changes. Removing the behavior to commit or changing the messages can result in undesired behvior and hallucations with lower feature quality or poor completion rates.

**Optional for Claude Code users:** Use [Ralph](.claude/.ralph/README.md) to run `/implement-feature` in a loop for fully autonomous feature implementation in Claude Code.

**What happens:** The agent:
1. Reads `feature-list.json` for the next task
2. References the spec for context
3. Uses `testing-anti-patterns` skill to avoid common mistakes
4. Produces incremental commits
5. Updates `progress.txt`

**You review:** After each feature:
- Run the tests: `npm test` (or your test command)
- Check the diff: `git diff HEAD~1`
- If issues, use `/compact` and `/create-debug-report` and fix before continuing


### Step 5: Move to next feature
```bash
# If continuing the same feature and exceeding token window for a hand off
/compact

# If moving to the next feature, reset the context window
/new

# Then implement the next feature
/implement-feature feature-list.json
```

### Step 6: Debugging Flow

If something breaks during implementation that the agent did not catch, you can manually debug:

```bash
# Generate a debug report
/create-debug-report "<context of what is broken>"

```

The agent analyzes logs, stack traces, and code. Then prompt your agent:

> Use the debug report to add a new feature to feature-list.json that marks the bug as the highest priority to fix and sets its `passes` field to `false`.

```bash
# Then compact, reset context window, and run implement feature again:

/compact
/new
/implement-feature feature-list.json
```

### Step 7: Create Pull Request

Package all changes for review. Try to do this for each feature to keep commits clean and DO NOT commit directly to main.

```bash
# Create the PR with all your commits
/create-pr
```

**What happens:** Creates a PR with:
- Summary of changes
- Link to spec
- Test plan
- Screenshots (if applicable)

**You review:** This is where you apply the final 40% of effort:
- Review the full diff
- Refactor code that doesn't meet your standards
- Add missing tests or documentation
- Merge when satisfied

### Session Management

Keep your context clean throughout:

```bash
# Compact after completing major steps (spec review, each feature)
/compact

# This summarizes work done and prepares for handoff or continuation
```

### Key Principle

**You own the decisions. Agents own the execution.**

- Review specs before implementation (architecture decisions)
- Review code after each feature (quality gate)
- Use `/compact` to manage context between steps
- The 40-60% rule: agents get you most of the way, you provide the polish
- Play around with the agents and use them as your swiss army knife

---

## The ROI

**1 minute of setup. Maximum output.**

- **Minimal set of curated sub-agents** for the most common workflows
- **Skills and commands** that enforce proven software engineering practices
- **Overnight autonomous execution** (Ralph) means waking up to completed features ready for review

This approach highlights the best of SDLC and gets you 40-60% of the way there so you can review, refactor, and continue in a flow state.

---

## Platform Reference

| AI Tool        | Folder       | Context File | Notes                                           |
| -------------- | ------------ | ------------ | ----------------------------------------------- |
| Claude Code    | `.claude/`   | `CLAUDE.md`  | Includes settings.json with tool permissions    |
| GitHub Copilot | `.github/`   | `AGENTS.md`  | Uses prompts/ directory for commands            |
| Kiro           | `.kiro/`     | `AGENTS.md`  | Uses JSON agent configs + prompts/ for commands |
| OpenCode       | `.opencode/` | `AGENTS.md`  | Uses agent/ and command/ directories            |

---

## What's Included

### 6 Curated Agents
- **codebase-analyzer** - Analyzes how code works and implementation details
- **codebase-locator** - Finds specific files, classes, and functions
- **codebase-online-researcher** - Researches external resources and documentation
- **codebase-pattern-finder** - Discovers patterns and existing implementations
- **codebase-research-analyzer** - Synthesizes research data
- **codebase-research-locator** - Locates research info in codebase

### 9 Commands
- `research-codebase` - Deep codebase analysis
- `create-pr` - Create pull requests
- `implement-feature` - Feature implementation workflow
- `explain-code` - Code explanation
- `create-spec` - Specification generation
- `create-feature-list` - Feature breakdown
- `commit` - Git commit workflow
- `compact` - Session summarization
- `create-debug-report` - Debugging assistant

### 2 Skills
- **prompt-engineer** - Prompt engineering best practices
- **testing-anti-patterns** - Testing patterns to avoid

---

## How Atomic Differs from Spec-Kit

[Spec-Kit](https://github.com/github/spec-kit) is GitHub's toolkit for "Spec-Driven Development" where specifications become executable artifacts. While both projects aim to improve AI-assisted development, they solve different problems:

| Aspect | Spec-Kit | Atomic |
|--------|----------|--------|
| **Primary Focus** | Greenfield projects - building new features from specifications | **Large existing codebases and greenfield** - understanding patterns before implementing |
| **First Step** | `/speckit.constitution` - define project principles | `/research-codebase` - analyze existing architecture and patterns |
| **Memory Model** | Per-feature specs in `.specify/specs/` | Flywheel of active, semantic, and procedural memory: `Research → Specs → Execution → Outcomes` with `progress.txt` tracking |
| **Agent Architecture** | Single agent executes slash commands via shell scripts | **Specialized sub-agents**: `codebase-analyzer`, `codebase-locator`, `codebase-pattern-finder` |
| **Human Review** | Implicit in workflow | **Explicit checkpoints** with "You review (CRITICAL)" markers |
| **Debugging** | Not addressed | Dedicated `/create-debug-report` workflow |
| **Autonomous Runs** | Not available | **Ralph** for overnight feature implementation |

**When to choose Atomic:**
- Working with an existing, large codebase where you need to discover patterns first and greenfield projects
- Need session continuity, context management, and built-in memory
- Want explicit human-in-the-loop checkpoints
- Need debugging workflows when implementations fail
- Want autonomous overnight execution (Ralph) for Claude Code

---

## Troubleshooting

### Git Identity Error
If you see an error like `Error: Bash command failed for pattern "!git config user.name":` when running slash commands, make sure you configure your git identity:

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## License

MIT

## Credits

Learnings from

- [Superpowers](https://github.com/obra/superpowers)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Ralph Wiggum Method](https://ghuntley.com/ralph/)
- [OpenAI Codex Cookbook](https://github.com/openai/openai-cookbook)
- [HumanLayer](https://github.com/humanlayer/humanlayer)
