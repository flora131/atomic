# AI Agent Instructions Template

A comprehensive template repository for AI coding agent workflow instructions and development guidelines. Fork this repository to give your AI coding agents context about your project's architecture, coding standards, and development workflows.

## What's Included

This template provides a structured approach to documenting your project for AI coding agents, including:

- **Agent Instruction Files** (`AGENTS.md`): Comprehensive guidelines for how AI agents should work with your codebase
- **Execution Plans** (`PLANS.md`): Methodology for creating detailed, self-contained implementation plans
- **Development Setup** (`DEV_SETUP.md`): Template for onboarding documentation
- **Directory Structure**: Organized file layout for both backend and frontend projects

## Repository Structure

```
.
├── README.md                    # This file
├── LICENSE                      # MIT License
├── DEV_SETUP.md                 # Development setup template
├── backend/
│   ├── AGENTS.md                # Backend agent instructions (template)
│   └── .agent/
│       └── PLANS.md             # Execution plan methodology
└── frontend/
    ├── AGENTS.md                # Frontend agent instructions (template)
    └── .agent/
        └── PLANS.md             # Execution plan methodology
```

## Quick Start

### 1. Fork or Clone This Repository

```bash
git clone https://github.com/YOUR_USERNAME/agent-instructions.git
cd agent-instructions
```

### 2. Customize for Your Project

Replace all template placeholders (marked with `[YOUR_*]` or `<!--TEMPLATE INSTRUCTIONS-->`) with your project-specific information:

- **Project Overview**: Describe what your project does
- **Architecture**: Document your code structure and organization
- **Technology Stack**: List frameworks, libraries, and tools you use
- **Development Guidelines**: Add your team's coding standards
- **Testing Approach**: Specify testing frameworks and practices
- **Tools**: Document any MCP tools or custom utilities available

### 3. Use with Your AI Coding Agent

Different AI coding agents have different requirements for loading instruction files:

#### Claude Code

Claude Code looks for a `CLAUDE.md` file in the project root. You have two options:

1. **Copy approach** (recommended for separate backend/frontend):
   ```bash
   cp backend/AGENTS.md CLAUDE.md
   # or
   cp frontend/AGENTS.md CLAUDE.md
   ```

2. **Symlink approach** (if you want changes to sync):
   ```bash
   ln -s backend/AGENTS.md CLAUDE.md
   # or
   ln -s frontend/AGENTS.md CLAUDE.md
   ```

#### Cursor

Cursor typically uses `.cursorrules` in the project root. Create this file and import or reference your `AGENTS.md`:

```bash
# Option 1: Copy content
cp backend/AGENTS.md .cursorrules

# Option 2: Reference the file
echo "See backend/AGENTS.md for full guidelines" > .cursorrules
```

#### GitHub Copilot

GitHub Copilot can use `.github/copilot-instructions.md`:

```bash
mkdir -p .github
cp backend/AGENTS.md .github/copilot-instructions.md
```

#### Windsurf / Codeium

Windsurf typically looks for a `.windsurfrules` file or similar. Check their documentation for the latest conventions:

```bash
cp backend/AGENTS.md .windsurfrules
```

#### Other AI Agents

For other AI coding agents, consult their documentation for where they expect instruction files. The pattern is usually:
- A file in the project root
- Named according to the agent's convention
- Containing markdown-formatted instructions

## File Organization

### AGENTS.md Files

These are the main instruction files that tell AI agents:
- What your project is and does
- How code is organized (architecture)
- Which technologies and frameworks you use
- Development guidelines and best practices
- Code style and conventions
- Testing requirements
- Available tools and when to use them

**Location**: Place one in each major part of your project (e.g., `backend/AGENTS.md`, `frontend/AGENTS.md`).

### PLANS.md Files

Based on the [OpenAI Cookbook's Codex Execution Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md), these files define how to create detailed, self-contained implementation plans (called "ExecPlans") for complex features.

**Key concepts**:
- Self-contained: Each plan includes all context needed
- Living documents: Updated as work progresses
- Observable outcomes: Focus on demonstrable results
- Milestones: Break work into verifiable steps

**Location**: In `.agent/` subdirectories alongside `AGENTS.md`.

## Customization Guide

### Step 1: Update Project Overview

In each `AGENTS.md`, replace the Project Overview section:

```markdown
# Project Overview

[YOUR_PROJECT_DESCRIPTION]
```

with your actual project description, for example:

```markdown
# Project Overview

This is a Next.js/TypeScript web application for managing developer documentation.
It provides a wiki-style interface with full-text search, version control, and
collaborative editing features.
```

### Step 2: Document Your Architecture

Replace the architecture placeholders with your actual structure:

```markdown
# Architecture

The project follows a standard Next.js App Router structure:
- Route handlers in `src/app/`
- React components in `src/components/`
- UI primitives in `src/components/ui/` (shadcn/ui)
- Utilities in `src/lib/`
- API routes in `src/app/api/`
```

### Step 3: Specify Your Tech Stack

Update the technology stack section:

```markdown
## Technology Stack Focus
* **Next.js 14**: App Router, Server Components, Server Actions
* **TypeScript 5**: Strict mode enabled
* **Tailwind CSS**: Utility-first styling
* **shadcn/ui**: Component library
* **PostgreSQL**: Primary database
* **Prisma**: ORM
```

### Step 4: Add Your Development Commands

Replace package management placeholders:

```markdown
## Package Management

This project uses `npm` as the package manager. Common commands:

- `npm install` - Install dependencies
- `npm run dev` - Start development server
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run build` - Build for production
```

### Step 5: Customize Code Style Guidelines

Add your specific coding standards, patterns, and examples.

### Step 6: Document Available Tools

If you have MCP tools or custom utilities available to the agent, document them:

```markdown
# Tools

- `context7` - Fetch up-to-date library documentation
- `playwright` - Browser automation for E2E tests
- Custom build scripts in `scripts/` directory
```

## ExecPlans (Execution Plans)

The `PLANS.md` files define a methodology for creating detailed implementation plans. When working on complex features:

1. **Create a new ExecPlan file** in the `.agent/`
2. **Follow the skeleton** provided in `PLANS.md`
3. **Keep it self-contained** - include all context needed
4. **Update as you go** - it's a living document
5. **Focus on outcomes** - what will work when you're done?

See the PLANS.md files for complete guidelines.

## Best Practices

### For AI Agents

1. **Read the full AGENTS.md** before starting work on a project
2. **Follow the documented patterns** - don't invent new approaches unless necessary
3. **Use ExecPlans for complex work** - helps maintain context across sessions
4. **Update documentation** when making architectural changes

### For Developers

1. **Keep instructions up to date** - outdated docs confuse agents
2. **Be specific** - vague guidelines lead to inconsistent code
3. **Include examples** - show the preferred patterns
4. **Document exceptions** - explain when rules don't apply
5. **Version your instructions** - commit changes to git

## Credits

- **PLANS.md methodology**: Based on [Codex Execution Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md) from the OpenAI Cookbook
- **Template structure**: Designed for modern AI coding agents (Claude Code, Cursor, GitHub Copilot, etc.)

## Contributing

This is a template repository. If you have suggestions for improving the template structure or documentation:

1. Fork this repository
2. Make your improvements
3. Submit a pull request

For issues specific to your project, customize your fork as needed.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## FAQ

### Why separate AGENTS.md files for backend and frontend?

Different parts of your codebase often have different:
- Technology stacks
- Coding conventions
- Testing approaches
- Available tools

Separate files let you provide focused, relevant instructions for each context.

### Can I use this for a monorepo?

Absolutely! Place an `AGENTS.md` file in each package or workspace that has distinct development guidelines. You can also have a root-level file for shared conventions.

### How often should I update these files?

Update them whenever you:
- Add new frameworks or libraries
- Change architectural patterns
- Establish new coding conventions
- Add new development tools
- Refactor major parts of the codebase

### Can I delete the ExecPlans methodology if I don't use it?

Yes, if you don't plan to use the ExecPlan approach, you can delete the `PLANS.md` files and references to them in `AGENTS.md`. However, we recommend trying it for complex features first, many teams find it valuable.

### What if my AI agent doesn't support loading custom instructions?

You can still use these files as:
- Onboarding documentation for new team members
- A reference you manually provide to the AI in conversations
- Templates for creating smaller, task-specific instructions

## Support

For questions about:
- **This template**: Open an issue in this repository
- **Your specific project**: Customize the template and maintain your own documentation
- **AI coding agents**: Consult the documentation for your specific agent (Claude Code, Cursor, etc.)

---

**Ready to get started?** Fork this repo, customize the templates, and give your AI agents the context they need to write great code for your project!
