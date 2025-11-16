# Infrastructure for AI Coding Agents

**5-minute setup enhances Claude Code, Cursor, Codex, Windsurf, Kiro, Cline, and GitHub Copilot with project context, proven workflows, and autonomous execution capabilities.**

This is *not* an agent, it's infrastructure *for* agents. Works with any AI coding agent on Mac and Windows.

**Demo:** Watch Cursor auto-install the system and invoke debugging skills to solve a real problem.

https://github.com/user-attachments/assets/7dc0e5dd-afcd-4215-9274-a5047c359c8a

**After setup:**
- Prompt naturally—agent auto-selects the right approach
- Simple tasks use your context automatically
- Complex features generate ExecPlans for review
- Specialized work dispatches sub-agents in parallel
- Skills (proven workflows) activate based on prompts
- Ralph (continuous execution) runs agents autonomously overnight

---

## Why?

AI coding agents ship as tools, not systems. Install Cursor or Codex and you get the agent, but no infrastructure.

No proven workflows. No sub-agents. No project context templates.

Developers spend weeks building their setup from scratch, iterating on what works. We've already done that work. 

We built this for developers who need to ship code, not learn new tools.

### The Problem

**Without infrastructure?** You spend hours explaining the same architecture decisions, watching agents violate your conventions, and fixing bugs that proper workflows would have prevented.

The promise of AI-assisted development feels empty when you're stuck in an endless loop of context-setting and cleanup.

### What We Built

We spent weeks iterating on support systems: project memory files, mandatory TDD workflows, sub-agent orchestration, planning templates, and autonomous execution scripts, bringing you what developers who get real quality output from AI coding agents are actually doing.

**The impact was immediate:**

- **100,000 lines of high-quality code in two weeks** (AI handled 80%, we handled the critical 20%)
- **Mandatory TDD caught design bugs** before expensive implementation
- **Parallel sub-agents** eliminated bottlenecks on complex features
- **ExecPlans survived context switches** and team handoffs
- **Skills unlocked 10x engineering velocity** without prescriptive prompting
- **Overnight autonomous execution** meant waking up to completed features ready for review

### How It Works

**One prompt installs everything.** Project memory, proven workflows, 114+ specialized sub-agents, planning systems, and autonomous execution.

**Then you work exactly like before. No new commands to learn. No workflow changes.**

**What happens automatically:**

- Ask to fix a bug → agent invokes systematic debugging skills
- Request a complex feature → Ask the agent to generate an ExecPlans for your review, research, brainstorm with the agent, review and give feedback, and break into milestones. Agent implements complex changes highly effectively.
- Need specialized help → agent dispatches sub-agents (frontend, backend, testing) in parallel contexts
- Want overnight development → enable Ralph to autonomously execute

**You prompt naturally. Infrastructure handles the rest.**

Skills activate when needed. Sub-agents orchestrate themselves. Plans generate on complex features. You review, approve, ship.

### The ROI

5 minutes of setup. Zero behavior change. Maximum output.

We built this from our own experiences working across large enterprise organizations and startups, driven by the desire to extract every possible optimization from our coding tools to ship real high-quality code at velocity. The right infrastructure makes that speed accessible to everyone, not just the few who spend weeks building it from scratch.

---

## Real-World Results

We measured the impact on our production backend service by comparing two development approaches:

**Manual with spec-driven development and prompting** (PRs #1-15, 15 days) vs **Autonomous with agent-instructions repo** (PRs #16-20 + active branch, 6 days)

### Velocity Metrics → Impact

| Metric | Before | After | Key Result |
|--------|--------|-------|------------|
| **Commit Velocity** | 23 commits/day | 162 commits/day | **7x faster iteration cycles** |
| **Development Continuity** | 53% active days | 100% active days | **Zero idle time** - agent iterated on specs in parallel with code |
| **Time to Production** | 15 days | 6 days | **2.5x faster delivery** with higher quality using skills, sub-agents, customized AGENTS.md, and ExecPlans |

### Quality Metrics → Impact

| Metric | Before | After | Key Result |
|--------|--------|-------|------------|
| **PR Success Rate** | 14/15 merged | 5/5 merged | **Rapid iteration** - failed PR fixed within minutes (PR#17→PR#18) via autonomous execution |
| **Technical Debt** | Untracked | 0 TODOs/FIXMEs | **Zero todos** - audit validated and continously refined with agent |
| **Test Coverage** | Basic scaffolding | 457 active tests | **98.7% test success rate** - thorough e2e test coverage |
| **Code Review Time** | Hours to days | Seconds to max 5 hours | **Instant feedback loops** |

### Scale & Execution

**Project Scope:**
- Backend service with distributed architecture
- Multiple subsystems

**Autonomous Period Delivered (6 days):**
- 970 commits across 735 files
- 457 comprehensive tests (unit + integration + e2e)
- Complete API documentation
- High-quality deployment infrastructure

**Manual Period Delivered (15 days):**
- 232 commits across 403 files
- Basic project scaffolding
- Initial proof-of-concept
- 7 days spent on spec writing (development paused)

### Key Transformation

**Sequential → Parallel:**
Manual approach required stopping development to write specs and re-deploy agents. Autonomous approach handled both simultaneously - **7x faster velocity while producing complete documentation.**

**Monolithic → Granular:**
Large 40K+ line changes → Focused incremental commits with **2.3x better testability** with agent-instructions approach

**Reactive → Proactive:**
Untracked debt → **Zero TODOs/FIXMEs** with continuous validation

**Result:** High-quality features added to backend service in 2.5x less time with comprehensive testing, zero TODOs/FIXMEs, and complete documentation maintained throughout.

---

## 5-Minute Setup

### Step 1: Copy Templates to Your Project

Navigate to this repo and copy the essential files to your project:

```bash
# Required: Agent memory (choose one)
cp CLAUDE.md /path/to/your-project/        # For Claude Code
# OR
cp AGENTS.md /path/to/your-project/        # For other agents

# Required: Execution plan templates
cp -r specs /path/to/your-project/

# Optional: Ralph Wiggum autonomous execution
cp -r .ralph /path/to/your-project/

# Optional: MCP and VSCode configs for recommended MCP servers
cp .mcp.json /path/to/your-project/
cp -r .vscode /path/to/your-project/
```

**What each component does:**
- **AGENTS.md/CLAUDE.md**: Contains your project context (architecture, stack, patterns) - agent reads this automatically
- **specs/**: Houses PLANS.md template for complex feature execution plans
- **.ralph/**: Scripts for running agents continuously overnight (autonomous development)
- **.mcp.json**: Model Context Protocol configuration
- **.vscode/**: VSCode settings for AI agents

### Step 2: Auto-Populate Your Project Context

```
Open your project in your AI coding agent and ask:

"Set up agent instructions, skills, and sub-agent support"
```

The agent will:
- Analyze your codebase (tech stack, patterns, dependencies)
- Populate AGENTS.md/CLAUDE.md with your project specifics
- Install Superpowers skills and workflows from [Superpowers](https://github.com/obra/superpowers) and [Anthropic Skills](https://github.com/anthropics/skills)
- Install the custom `prompt-engineer` skill based on Anthropic's prompt engineering overview
- Set up sub-agent orchestration

**Note:** Claude Code has native skills support and auto-detects when to install.

**For Cline Users:** After the agent populates AGENTS.md with your project context, you need to add it to Cline's global rules so it's available in every conversation:
- **Via UI**: Click the `+` button in Cline's Rules tab, then copy the contents of AGENTS.md into the new rule file
- **Via CLI**: Copy AGENTS.md to your global rules directory:
  - **macOS/Linux**: `cp AGENTS.md ~/Documents/Cline/Rules/`
  - **Windows**: `copy AGENTS.md %USERPROFILE%\Documents\Cline\Rules\`

For more details, see [Cline Rules documentation](https://docs.cline.bot/features/cline-rules).

---

## Ralph Wiggum Method: Autonomous Execution

Run AI agents in continuous loops until task completion - no manual intervention required.

> **Note:** Currently only supported for Claude Code. Support for other AI coding assistants coming soon.

**For detailed setup instructions, usage guidelines, and examples, see [.ralph/README.md](.ralph/README.md).**

---

## Core Components

1. **Context Templates** (AGENTS.md, CLAUDE.md, PLANS.md) - Project architecture, conventions, and tech stack
2. **Battle-Tested Workflows** - TDD, debugging, code review from [Superpowers](https://github.com/obra/superpowers) and [Anthropic Skills](https://github.com/anthropics/skills), custom built prompt-engineer based on Anthropic's prompt engineering overview
3. **Sub-Agent Orchestration** - Parallel specialized agents for complex tasks
4. **114+ Custom Specialized Sub-Agents** - Pre-configured expert agents from [Awesome Claude Code Subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) available in the `agent-setup` branch for:
   - **Engineering**: Python Pro, TypeScript Pro, React Specialist, Next.js Developer, Django Developer, Rails Expert, and 40+ more language/framework specialists
   - **Infrastructure & DevOps**: Cloud Architect, Kubernetes Specialist, Terraform Engineer, DevOps Engineer, SRE Engineer, Database Administrator
   - **Security & Testing**: Security Engineer, Penetration Tester, Test Automator, QA Expert, Accessibility Tester, Compliance Auditor
   - **AI/ML**: AI Engineer, ML Engineer, MLOps Engineer, LLM Architect, NLP Engineer, Data Scientist
   - **Architecture & Design**: Microservices Architect, API Designer, GraphQL Architect, Code Reviewer, Refactoring Specialist
   - **Product & Business**: Product Manager, UX Researcher, Business Analyst, SEO Specialist, Content Marketer
   - **Specialized Domains**: Blockchain Developer, Game Developer, Fintech Engineer, IoT Engineer, Legal Advisor
   - **Coordination**: Agent Organizer, Multi-Agent Coordinator, Task Distributor, Error Coordinator, Knowledge Synthesizer
5. **Autonomous Execution** - Ralph Wiggum method for running agents continuously overnight for development

**Setup:** 5 minutes | **Result:** Agents that follow your patterns, auto-generate plans, and work autonomously

---

## FAQ

**Q: Can I use this with an existing project?**
A: Yes! Copy the required files (AGENTS.md/CLAUDE.md and specs/) to your project root, then tell your agent: *"Set up agent instructions, skills, and sub-agent support for this project"*. The agent will analyze your codebase and populate the templates automatically.

**Q: Which file should I use - AGENTS.md or CLAUDE.md?**
A: Use `CLAUDE.md` for Claude Code (includes ExecPlan workflow). Use `AGENTS.md` for other agents (Cursor, Kiro, Windsurf, GitHub Copilot, Codex, Cline).

**Q: Do I need to write execution plans manually?**
A: No. The agent auto-generates plans in `specs/` only when needed for complex features. Simple tasks execute immediately using TDD. The agent uses `specs/PLANS.md` as a template when creating new execution plans.

**Q: How do I use the specs/ directory?**
A: Copy the entire `specs/` directory to your project. When you ask the agent to implement complex features, it will automatically create execution plans in `specs/` (like `specs/notification-system.md`) using the `PLANS.md` template. You don't manually create these - the agent does.

**Q: Do I need Ralph Wiggum (.ralph/) for basic usage?**
A: Ralph is optional and only needed if you want autonomous overnight development.

**Q: Do you have benchmarks or evals?**
A: This repo curates proven practices from Anthropic, Superpowers, and the Claude community with validation from original sources. We've shared our real-world results above showing 7x productivity improvement, 100% development continuity, and zero TODOs/FIXMEs debt on our backend service. We encourage measuring impact on your specific use case using similar before/after metrics.

---

**License:** MIT

**Credits:**

- [Superpowers](https://github.com/obra/superpowers)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Awesome Claude Code Subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
- [OpenAI Codex Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md)
- [Ralph Wiggum](https://ghuntley.com/ralph/)
- [repomirror](https://github.com/repomirrorhq/repomirror)
