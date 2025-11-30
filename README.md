# Curated Agents & Commands for AI Coding Assistants

Pre-configured agents, commands, and skills for Claude Code, GitHub Copilot, Kiro, and OpenCode. Copy to your project and start using immediately.

This is *not* an agent, it's infrastructure *for* agents.

---

## Why?

AI coding agents need proven workflows to execute successfully on feature tasks. Without them, agents fall into common failure modes: spiraling over wrong solutions, producing spaghetti code and AI slop, misunderstanding intent. They require a principled approach built on foundational software engineering principles.

### The Problem

Most of our time goes to figuring out *how* to use these AI tools rather than just *using* them.

The promise of AI-assisted development feels empty when you're stuck in an endless loop of context-setting and cleanup.

### What We Built

We spent weeks iterating on support systems: project memory files, sub-agent orchestration, planning templates, and proven workflows—bringing you what developers who get real quality output from AI coding agents are actually doing.

![Architecture](architecture.svg)

---

## The ROI

**1 minute of setup. Zero behavior change. Maximum output.**

- **Minimal set of curated sub-agents** for the most common workflows
- **Skills and commands** that enforce proven software engineering practices
- **Overnight autonomous execution** (Ralph) means waking up to completed features ready for review

This approach highlights the best of SDLC and gets you 40-60% of the way there so you can review, refactor, and continue in a flow state.

---

## Quick Start

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
> "Analyze this codebase and populate the CLAUDE.md (or AGENTS.md) with project-specific context"
```

The AI will analyze your tech stack, patterns, and architecture to fill in the template.

### Step 2: Copy Your Platform's Agent Folder

Copy the folder for your AI coding assistant to your project:

```bash
# For Claude Code
cp -r .claude /path/to/your-project/

# For GitHub Copilot
cp -r .github /path/to/your-project/

# For Kiro
cp -r .kiro /path/to/your-project/

# For OpenCode
cp -r .opencode /path/to/your-project/
```

#### MCP Configuration

Copy the MCP configuration files for recommended MCP servers (deepwiki, playwright):

```bash
cp .mcp.json /path/to/your-project/
cp -r .vscode/ /path/to/your-project/
```

**Important:** If you already have a `.claude/`, `.github/`, `.kiro/`, or `.opencode/` folder in your project, merge the contents carefully rather than overwriting. The `settings.json` files contain tool permissions that you may want to customize.

---

## Platform Reference

| AI Tool | Folder | Context File | Notes |
|---------|--------|--------------|-------|
| Claude Code | `.claude/` | `CLAUDE.md` | Includes settings.json with tool permissions |
| GitHub Copilot | `.github/` | `AGENTS.md` | Uses prompts/ directory structure |
| Kiro | `.kiro/` | `AGENTS.md` | Uses JSON agent configs |
| OpenCode | `.opencode/` | `AGENTS.md` | Uses agent/ and command/ directories |

---

## What's Included

### 6 Curated Agents
- **codebase-analyzer** - Analyzes how code works and implementation details
- **codebase-locator** - Finds specific files, classes, and functions
- **codebase-online-researcher** - Researches external resources and documentation
- **codebase-pattern-finder** - Discovers patterns and existing implementations
- **codebase-research-analyzer** - Synthesizes research data
- **codebase-research-locator** - Locates research info in codebase

### 11 Commands
- `research-codebase` - Deep codebase analysis
- `create-pr` - Create pull requests
- `implement-feature` - Feature implementation workflow
- `explain-code` - Code explanation
- `create-spec` - Specification generation
- `create-feature-list` - Feature breakdown
- `commit` - Git commit workflow
- `compact` - Session summarization
- `create-debug-report` - Debugging assistant
- And more...

### 2 Skills
- **prompt-engineer** - Prompt engineering best practices
- **testing-anti-patterns** - Testing patterns to avoid

---

## Workflow: Chaining Commands and Agents

The architecture diagram above shows how these components work together. Here's how to chain them effectively:

### Research → Plan → Implement → Ship

1. **Research the codebase** - Start with `/research-codebase` to understand existing patterns and architecture. This dispatches locator and analyzer agents to build context.

2. **Create a spec** - Use `/create-spec` to generate an execution plan. The agent references your research and produces a structured plan for review.

3. **Break into features** - Run `/create-feature-list` to decompose the spec into discrete, implementable tasks.

4. **Implement features** - Execute `/implement-feature` for each task. The agent follows your spec, uses the `testing-anti-patterns` skill, and produces incremental commits.

5. **Review and ship** - Use `/create-pr` to package changes. Review the 40-60% complete work, refactor in flow state, and merge.

### Debugging Flow

When issues arise: `/create-debug-report` → analyze with `codebase-analyzer` → fix → `/commit`

### Key Principle

Let agents handle research and boilerplate. You handle architecture decisions and final polish.

---

## Optional: Autonomous Execution (Ralph)

Run AI agents in continuous loops until task completion.

> **Note:** Currently only supported for Claude Code.

See [.ralph/README.md](.ralph/README.md) for setup instructions.

---

## License

MIT

## Credits

Inspiration from

- [Superpowers](https://github.com/obra/superpowers)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Ralph Wiggum Method](https://ghuntley.com/ralph/)
- [OpenAI Codex Cookbook](https://github.com/openai/openai-cookbook)
