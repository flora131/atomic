# AI Agent Development System

**Pre-configured toolkit that gives AI agents your project context, proven workflows, and autonomous execution capabilities. Give your AI agents access to sub-agents and skills in minutes.**

## Core Components

1. **Context Templates** (AGENTS.md, CLAUDE.md, PLANS.md) - Project architecture, conventions, and tech stack
2. **Battle-Tested Workflows** - TDD, debugging, code review from [Superpowers](https://github.com/obra/superpowers) and [Anthropic Skills](https://github.com/anthropics/skills)
3. **Sub-Agent Orchestration** - Parallel specialized agents for complex tasks
4. **114+ Custom Specialized Sub-Agents** - Pre-configured expert agents available in the `agent-setup` branch for:
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

## 5-Minute Setup

### Step 1: Copy Templates to Your Project

Navigate to this repo and copy the essential files to your project:

```bash
# Required: Agent memory (choose one)
cp CLAUDE.md /path/to/your-project/        # For Claude Code
# OR
cp AGENTS.md /path/to/your-project/        # For other agents

# Required: Execution plan templates
cp -r specs/ /path/to/your-project/

# Optional: Ralph Wiggum autonomous execution
cp -r .ralph/ /path/to/your-project/

# Optional: MCP and VSCode configs for recommended MCP servers
cp .mcp.json /path/to/your-project/
cp -r .vscode/ /path/to/your-project/
```

**What each component does:**
- **AGENTS.md/CLAUDE.md**: Contains your project context (architecture, stack, patterns) - agent reads this automatically
- **specs/**: Houses PLANS.md template for complex feature execution plans
- **.ralph/**: Scripts for running agents continuously overnight (autonomous development)
- **.mcp.json**: Model Context Protocol configuration
- **.vscode/**: VSCode settings for AI agents

### Step 2: Auto-Populate Your Project Context

Open your project in your AI coding assistant and ask:

*"Set up Superpowers skills and sub-agent support for this project"*

The agent will:
- Analyze your codebase (tech stack, patterns, dependencies)
- Populate AGENTS.md/CLAUDE.md with your project specifics
- Install Superpowers skills and workflows from [Superpowers](https://github.com/obra/superpowers) and [Anthropic Skills](https://github.com/anthropics/skills)
- Set up sub-agent orchestration

**Note:** Claude Code has native skills support and auto-detects when to install.

---

## Ralph Wiggum Method: Autonomous Execution

Run AI agents in continuous loops until task completion - no manual intervention required.

**Prerequisites:** You must have copied `.ralph/` to your project (see Step 1 above).

**How it works:** Agent reads `.ralph/prompt.md`, executes tasks, iterates until done, manages its own context.

### Usage

1. **Update `.ralph/prompt.md`** with your implementation instructions
   - Keep it concise - reference detailed specs from `specs/` directory
   - Example prompt in the prompt.md folder

2. **Test one iteration:**
   ```bash
   cd /path/to/your-project
   ./.ralph/sync.sh
   ```
   Verifies the agent can read your prompt and execute successfully

3. **Run continuously:**
   ```bash
   ./.ralph/ralph.sh
   ```
   Agent loops, working until task completion

**Best Practices:** One task per loop, clear completion criteria, reference specific specs from `specs/`

**Results:** Ships 6 repos overnight at YC hackathons, builds programming languages, autonomously migrates codebases

---

## How Everything Works

Once configured, templates provide context automatically for **every request** - no repeated prompting needed. Skills are all automatically discoverable for accelerated development.

### Simple Requests
Handled instantly with AGENTS.md context:
- "Add error handling to login" → Agent knows your patterns
- "Fix TypeScript error" → Agent understands your type system
- "Refactor component" → Agent follows your conventions

### Complex Features
Agent auto-generates execution plans:
- "Build notification system" → Creates detailed plan in `specs/`, implements systematically
- "Add real-time collaboration" → Designs architecture, validates before coding
- Ralph can run specs autonomously for development with human review

**You don't write plans.** The agent handles straightforward work with TDD. It only creates execution plans when complexity requires structured planning.

---

## What's Included

| Component          | Purpose                                                                       | Required? |
| ------------------ | ----------------------------------------------------------------------------- | --------- |
| **AGENTS.md**      | Project context for any AI agent (architecture, stack, patterns)              | Yes       |
| **CLAUDE.md**      | Claude Code-specific instructions with ExecPlan workflow                      | Yes*      |
| **specs/**         | Directory containing PLANS.md template for execution plans                    | Yes       |
| **specs/PLANS.md** | Template for complex feature execution plans - agent creates copies as needed | Yes       |
| **.ralph/**        | Scripts for autonomous overnight development                                  | Optional  |
| **.mcp.json**      | Model Context Protocol configuration                                          | Optional  |
| **.vscode/**       | VSCode settings for AI agents                                                 | Optional  |

*Use CLAUDE.md for Claude Code OR AGENTS.md for other agents (Cursor, Windsurf, GitHub Copilot, Codex)

**How specs/ works:**
- Agent auto-generates execution plans in `specs/` when features are complex
- Uses `specs/PLANS.md` as template
- Creates files like `specs/notification-system.md`, `specs/auth-refactor.md`, etc.
- Updates `specs/README.md` with links to all specs

---

## Repository Structure

```
.
├── AGENTS.md      # Agent memory (all agents)
├── CLAUDE.md      # Claude Code memory
├── specs/         # Feature plans & templates
│   ├── PLANS.md   # Template for execution plans
│   └── README.md  # Index of all specs
├── .ralph/        # Autonomous execution scripts (optional)
│   ├── prompt.md  # Your instructions for Ralph
│   ├── sync.sh    # Single iteration
│   └── ralph.sh   # Continuous loop
├── .vscode/       # VSCode settings (optional)
└── .mcp.json      # MCP config (optional)
```

---

## FAQ

**Q: Can I use this with an existing project?**
A: Yes! Copy the required files (AGENTS.md/CLAUDE.md and specs/) to your project root, then tell your agent: *"Set up Superpowers skills and sub-agent support for this project"*. The agent will analyze your codebase and populate the templates automatically.

**Q: Which file should I use - AGENTS.md or CLAUDE.md?**
A: Use `CLAUDE.md` for Claude Code (includes ExecPlan workflow). Use `AGENTS.md` for other agents (Cursor, Windsurf, GitHub Copilot, Codex).

**Q: Do I need to write execution plans manually?**
A: No. The agent auto-generates plans in `specs/` only when needed for complex features. Simple tasks execute immediately using TDD. The agent uses `specs/PLANS.md` as a template when creating new execution plans.

**Q: How do I use the specs/ directory?**
A: Copy the entire `specs/` directory to your project. When you ask the agent to implement complex features, it will automatically create execution plans in `specs/` (like `specs/notification-system.md`) using the `PLANS.md` template. You don't manually create these - the agent does.

**Q: Do I need Ralph Wiggum (.ralph/) for basic usage?**
A: Ralph is optional and only needed if you want autonomous overnight development. 

---

**License:** MIT

**Credits:** [Superpowers](https://github.com/obra/superpowers) • [Anthropic Skills](https://github.com/anthropics/skills) • [OpenAI Codex Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md) • [Ralph Wiggum](https://ghuntley.com/ralph/) • [repomirror](https://github.com/repomirrorhq/repomirror)
