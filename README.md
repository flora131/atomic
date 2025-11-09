# AI Agent Instructions Template

**Pre-built templates that make AI agents write better code with less back-and-forth.**

## The Problem
AI coding agents (Claude Code, Cursor, Copilot, Windsurf) produce higher-quality code when they understand your project's architecture, conventions, and tech stack. But explaining this context every time—or writing instruction docs from scratch—wastes hours.

## This Solution
Ready-to-use instruction templates (AGENTS.md, CLAUDE.md, PLANS.md) with best practices already written. You customize project-specific details quickly, and your AI agent immediately:
- ✅ Follows your patterns without repeated prompting
- ✅ Handles simple requests instantly with context
- ✅ Auto-generates execution plans for complex features
- ✅ Scales across your team with zero per-request overhead

**ROI:** 5-minute setup saves 2+ hours/week in context-explaining and back-and-forth.

---

## 5-Minute Setup

### 1. Clone This Repo

```bash
git clone https://github.com/flora131/agent-instructions.git
```

### 2. Add Skills + Sub-Agent + Claude Code Commands Support

Extend your AI agent with proven workflows from [Superpowers](https://github.com/obra/superpowers).

**Supported:** All agents (Claude Code, Cursor, Windsurf, GitHub Copilot, Codex)
**Notes**:
- Commands are only supported in Claude Code at the moment.
- Claude Code has native skills support - no setup needed!
  - Auto detects if skills exist and asks you to install from the Superpowers repo.

**One-minute setup**

As you use your AI coding assistant, it should auto detect the required installation by cloning the `agent-setup` branch in this repo. You can also explicitly ask it:

*"Set up Superpowers skills and sub-agent support for this project"*

The AI analyzes the focused context (tech stack, patterns, dependencies in that directory) and populates templates in a few minutes.

## How It Works

### One-Time Setup, Zero Ongoing Overhead

Once configured, templates provide context for **every request** automatically.

**Simple requests:** Handled instantly with AGENTS.md context
- "Add error handling to login" → AI knows your patterns, no explanation needed
- "Fix TypeScript error" → AI understands your type system
- "Refactor component" → AI follows established conventions

**Complex features:** AI auto-generates structured execution plans
- "Build notification system" → Creates detailed plan in `specs/`, implements systematically
- "Add real-time collaboration" → Designs architecture, validates before coding

**You don't write individual plans.** Templates handle straightforward work using spec and test driven development. AI creates plans only when complexity requires it.

---

## What's Included

| Component     | Purpose                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| **AGENTS.md** | Project context: architecture, tech stack, conventions (works with any AI agent) |
| **CLAUDE.md** | Claude Code-specific instructions with ExecPlan workflow                         |
| **PLANS.md**  | Template for complex feature execution plans                                     |

**Result:** Professional templates with best practices built-in. You customize project specifics, not structure.

---

## Repository Structure

```
.
├── AGENTS.md               # Agents Memory (Github Copilot, Codex, Cursor, Windsurf)
├── CLAUDE.md               # Claude Code Memory 
├── specs/                  # Feature plans
│   └── PLANS.md            # Execution plan template
├── .vscode/                # Optional: VSCode settings for AI agents
│   └── mcp.json            # MCP configuration for GitHub Copilot and other agents
├── .mcp.json               # MCP configuration for Claude Code
```

---

## FAQ

**Q: What if I have an existing project?**
A: Already handled by the agent instructions. Just add all the repo files to your project and run your coding agent. Make sure to have the `AGENTS.md` or `CLAUDE.md` files copied from this repo so that your coding agent knows how to setup skills and sub-agents. 

---

**License:** MIT

**Credits:** PLANS.md based on [OpenAI's Codex Execution Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md)
