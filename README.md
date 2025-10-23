# AI Agent Instructions Template

**Pre-built, customizable instruction templates for AI coding agents.** This repo includes ready-to-use AGENTS.md, CLAUDE.md, and PLANS.md files with best practices already written—you just fill in your project-specific details (or let AI do it automatically).

**Don't start from scratch.** Clone these pre-written templates and customize them for your project in minutes, not hours.

**Works with:** Claude Code, Cursor, GitHub Copilot, Windsurf, and more.

---

## Quick Start

### 1. Clone This Repository

```bash
git clone https://github.com/YOUR_USERNAME/agent-instructions.git
cd agent-instructions
```

You now have pre-written AGENTS.md, CLAUDE.md, and PLANS.md templates ready to customize.

### 2. Customize Templates

**Option A: AI Auto-Fill (Recommended)**

Share `metaprompt.txt` with your AI agent and ask:

> *"Please analyze this project and populate all AGENTS.md and CLAUDE.md files using the metaprompt instructions"*

The AI will detect your tech stack, analyze your structure, and auto-fill all `[YOUR_*]` placeholders.

**Option B: Manual Customization**

Browse the template files and replace `[YOUR_*]` placeholders with your project details. The templates already have structure, examples, and guidelines—you just fill in the specifics.

### 3. Configure Your AI Agent

**Claude Code:**
```bash
# CLAUDE.md is automatically loaded from root - already configured!
```

**Cursor:**
```bash
cp AGENTS.md .cursorrules
```

**GitHub Copilot:**
```bash
mkdir -p .github && cp AGENTS.md .github/copilot-instructions.md
```

**Windsurf:**
```bash
cp AGENTS.md .windsurfrules
```

### 4. Start Coding

Your AI agent now understands your project structure, tech stack, and conventions.

---

## What's Included

**Pre-written template files with best practices built-in:**

| Feature | Description |
|---------|-------------|
| **📝 AGENTS.md** | Comprehensive agent instructions template (architecture, tech stack, conventions) |
| **⚙️ CLAUDE.md** | Claude Code-specific template with ExecPlan methodology pre-configured |
| **📋 PLANS.md** | Complete ExecPlan framework based on OpenAI's methodology |
| **📁 Three-Tier Specs** | Organized directory structure for root, frontend, and backend specs |
| **🤖 Metaprompt** | AI tool that auto-fills all `[YOUR_*]` placeholders by analyzing your code |

**You get:** Professional templates with sections, examples, and guidelines already written. Just customize the project-specific parts.

## Repository Structure

```
.
├── metaprompt.txt          # AI analyzes your project and fills templates
├── AGENTS.md               # Root-level agent instructions
├── CLAUDE.md               # Root-level Claude Code configuration
├── DEV_SETUP.md            # Onboarding documentation template
├── specs/                  # Root specs (full-stack features)
│   ├── PLANS.md
│   ├── README.md
│   └── sample-spec-1.md
├── backend/
│   ├── AGENTS.md
│   ├── CLAUDE.md
│   └── specs/              # Backend-only features
└── frontend/
    ├── AGENTS.md
    ├── CLAUDE.md
    └── specs/              # Frontend-only features
```

## Why Use This?

**Problem:** AI agents produce better code when they understand your project, but writing instructions from scratch takes hours.

**Solution:** Start with pre-written templates containing best practices, then customize just the project-specific parts. Or use the metaprompt to auto-fill everything.

**What you get:**
- ✅ **Templates, not blank files** - Architecture sections, code style guidelines, testing approaches already written
- ✅ **Example placeholders** - Clear `[YOUR_FRAMEWORK]` markers show exactly what to customize
- ✅ **AI auto-fill** - Metaprompt analyzes your code and populates templates automatically
- ✅ **Multi-agent support** - Works with Claude Code, Cursor, Copilot, Windsurf

**Results:**
- ⚡ Minutes to configure, not hours of writing from scratch
- 🎯 Professional structure with proven best practices
- 📈 Consistent AI output across your entire team

---

## Key Concepts

### Three-Tier Specs Structure

Organize implementation plans by scope:
- **`specs/`**: Full-stack features spanning frontend and backend
- **`frontend/specs/`**: Frontend-only features and changes
- **`backend/specs/`**: Backend-only features and changes

### ExecPlans (Execution Plans)

Based on [OpenAI's Codex Execution Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md), for complex features:

1. **Determine Scope**: Frontend, backend, or full-stack?
2. **Create Spec File**: Place in appropriate `specs/` directory
3. **Follow PLANS.md**: Use the structure provided
4. **Keep Self-Contained**: Include all context needed
5. **Update as You Go**: Living document approach
6. **Update README**: Link spec in `specs/README.md`

### Using the Metaprompt

The `metaprompt.txt` instructs AI to:
- Scan codebase for tech indicators (package.json, configs, etc.)
- Extract project info (description, commands, patterns)
- Populate all templates with accurate, project-specific data
- Validate completeness (no placeholders left)

**When to use:**
- Initial setup after forking
- After major tech stack changes
- When documentation becomes outdated

---

## FAQ

**Q: Why separate AGENTS.md files for backend/frontend?**
A: Different tech stacks, conventions, and tools. Separate files = focused instructions. Root-level file helps agents determine scope.

**Q: AGENTS.md vs CLAUDE.md?**
A: AGENTS.md works with any AI agent. CLAUDE.md is specifically for Claude Code with ExecPlan methodology built-in.

**Q: Why three specs directories?**
A: Clear separation, smart organization, reduced complexity. Frontend/backend teams work independently. Full-stack features go in root `specs/`.

**Q: Can I use this for a monorepo?**
A: Yes! Place AGENTS.md and CLAUDE.md in each package. The three-tier specs structure scales well.

**Q: Metaprompt or manual?**
A: Metaprompt (fast, accurate) or manual (more control). Many teams use metaprompt for initial setup, then refine manually.

**Q: Can I delete ExecPlans?**
A: Yes, delete PLANS.md files and specs directories if not using. But try it first - many teams find it valuable.

---

## Best Practices

**For AI Agents:**
1. Read full AGENTS.md before starting work
2. Follow documented patterns
3. Use ExecPlans for complex features
4. Update documentation when making architectural changes

**For Developers:**
1. Keep instructions current
2. Be specific, not vague
3. Include code examples
4. Document exceptions
5. Version control your instructions

---

## Credits

- **PLANS.md**: Based on [Codex Execution Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md)
- **Metaprompt**: Inspired by meta-prompting for AI-assisted documentation
- **Three-tier architecture**: Designed for scalable full-stack projects

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Fork, improve, submit PR. Issues specific to your project should be handled in your fork.

---

**Ready?** Fork this repo, run the metaprompt, and give your AI agents the context they need! 🚀
