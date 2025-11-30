# ⛓️ Agent Armory: Automated Procedures and Memory for AI Coding Agents

AI coding agents are exceptionally powerful but have key gaps in principled software engineering, context, and memory. This makes them difficult to use in large codebases or generate higher quality code.

Engineers spend a lot of their time figuring out how to get tools to work for them rather than iterating on and shipping code with AI coding agents.

**This repo automates AI coding agents with an operating procedure and memory.**

We provide the *procedures* that agents use to work on your project based on software engineering best practices, and *specs* that persist as memory of decisions made and lessons learned.

## The Memory Gap

| Memory Type | What It Is | AI Coding Agents Out of the Box | This repo |
|-------------|-----------|---------------|-----------|
| **Semantic** | Facts about code | ✅ "Auth is in /src/auth" | ✅ Via your coding agent |
| **Episodic** | What happened | ⚠️ Fragmented | ✅ Via specs |
| **Procedural** | How to do things | ❌ Missing | ✅ **Our focus** |

This repo enables agents with *how* to work on your code and builds lasting memory through specs.

## The Flywheel

```
Research → Specs → Execution → Outcomes → Specs (persistent memory)
                ↑                                    ↓
                └────────────────────────────────────┘
```

Every feature you ship follows proven software engineering lifecycle best practices. Specs aren't just documentation, they're **persistent memory** that survives sessions and informs future agents.

## How It Works

![Architecture](architecture.svg)

This repo provides three primitives that power the flywheel:

| Primitive | Purpose | Examples |
|-----------|---------|----------|
| **Commands** | Orchestrate the workflow | `/research-codebase`, `/create-spec`, `/implement-feature` |
| **Agents** | Execute specialized tasks | `codebase-analyzer`, `codebase-locator`, `pattern-finder` |
| **Skills** | Inject domain knowledge | `testing-anti-patterns`, `prompt-engineer` |

**Commands** call **Agents** to do the work, while **Skills** ensure they follow best practices. The output? Specs that become memory for the next session. This standard operating procedure enables your AI coding agents to deliver results. You ship code faster and spend less time wrestling with the tools.

---

## 1 Minute Quick Start

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

## Workflow: Research → Plan → Implement → Ship

Follow this end-to-end workflow to go from feature idea to merged PR. Each step is designed for human-in-the-loop review at critical decision points.

### Step 1: Research the Codebase

Before any implementation, build context about existing patterns and architecture.

```bash
# Run the research command with your question
/research-codebase "How does authentication work in this codebase?"
```

**What happens:** The command dispatches `codebase-locator` and `codebase-analyzer` agents to explore your codebase. Results are saved to `research/` directory for reference.

**You review:** Skim the research output. Confirm the agent understood the relevant parts of your codebase.

```bash
# compact the context and information into a progress.txt before continuing 
/compact
```

### Step 2: Create a Specification

Generate an execution plan based on your research.

```bash
# Create a spec referencing your research
/create-spec
```

**What happens:** The agent reads your research from `research/` and `progress.txt` to know what has been done, synthesizes it, and produces a structured specification with:
- Problem statement
- Proposed solution
- Implementation approach
- Edge cases and risks

**You review (CRITICAL):** This is your main decision point. Read the spec carefully. Ask clarifying questions. Request changes. The spec becomes the contract for implementation.

### Step 3: Break Into Features

Decompose the spec into discrete, implementable tasks.

```bash
# Generate feature list from the approved spec
/create-feature-list path/to/spec.md
```

**What happens:** Creates `feature-list.json` and `progress.txt` with:
- Ordered list of features
- Dependencies between features
- Acceptance criteria for each

**You review:** Verify the breakdown makes sense. Reorder if needed. Remove features that are out of scope.

### Step 4: Implement Features (One at a Time)

Execute each feature from your list and compact to keep progress 

```bash
# Implement the next feature
/implement-feature
```

**What happens:** The agent:
1. Reads `feature-list.json` for the next task
2. References the spec for context
3. Uses `testing-anti-patterns` skill to avoid common mistakes
4. Produces incremental commits
5. Updates `claude-progress.txt`

**You review:** After each feature:
- Run the tests: `npm test` (or your test command)
- Check the diff: `git diff HEAD~1`
- If issues, use `/compact` and `/create-debug-report` and fix before continuing

```bash
# Compact between features to manage context
/compact

# Repeat for each feature
/implement-feature
```

### Step 5: Create Pull Request

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

### Debugging Flow

When something breaks during implementation:

```bash
# Generate a debug report
/create-debug-report

# The agent analyzes logs, stack traces, and code
# Fix the issue, then commit
/commit "fix: resolve authentication race condition"
```

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
