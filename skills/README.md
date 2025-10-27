# Skills for AI Coding Agents

A comprehensive library of reusable development skills and workflows for Claude Code, Cursor, GitHub Copilot, and Windsurf.

## Quick Start

### 1. Choose Your Agent

Select the agent(s) you use:
- **Claude Code** - Skills installed globally at `~/.claude/skills/`
- **Cursor** - Rules in `.cursor/rules/` or `.cursorrules`
- **GitHub Copilot** - Instructions in `.github/copilot-instructions.md`
- **Windsurf** - Rules in Settings or `.windsurf/rules.md`

### 2. Install Skills

**Using the installation script (recommended):**

```bash
# Install for specific agent
./skills/install.sh claude-code
./skills/install.sh cursor
./skills/install.sh copilot
./skills/install.sh windsurf

# Or install for all agents
./skills/install.sh all
```

**Manual installation:** See agent-specific README files in each directory.

### 3. Verify Installation

- **Claude Code:** Restart Claude Code, skills load automatically
- **Cursor:** Open project, rules apply automatically
- **Copilot:** Check Copilot Chat for attached `.github/copilot-instructions.md`
- **Windsurf:** Check Settings → Rules

## Available Skills

### Workflow Skills

**Test-Driven Development (TDD)**
- RED-GREEN-REFACTOR cycle
- Write tests first, watch them fail, implement, refactor
- Prevents untested code

**Systematic Debugging**
- Four-phase debugging framework
- Root cause investigation → Pattern analysis → Hypothesis testing → Implementation
- Fixes root causes, not symptoms

### Architecture Skills

**API Design**
- REST API best practices
- Resource-oriented URLs, proper HTTP methods, status codes
- Consistent response formatting, versioning

### Tools Skills

**Git Workflow**
- Feature branching, atomic commits, meaningful messages
- Pull request workflow, merge strategies
- Safety practices (no force push to main!)

### Domain Skills

**Security Best Practices**
- Input validation, authentication, authorization
- Secrets management, HTTPS enforcement
- Common vulnerability prevention (SQL injection, XSS, CSRF)

**Performance Optimization**
- Data-driven optimization approach
- Profile first, optimize bottlenecks, verify improvements
- Database optimization, caching, algorithm improvements

## Directory Structure

```
skills/
  claude-code/          # Claude Code skills (YAML + Markdown)
    workflow-tdd/
      SKILL.md
    workflow-debugging/
    architecture-api-design/
    tools-git-workflow/
    domain-security/
    domain-performance/
    README.md

  cursor/               # Cursor rules (plain text)
    workflow-tdd.cursorrules
    workflow-debugging.cursorrules
    architecture-api-design.cursorrules
    tools-git-workflow.cursorrules
    domain-security.cursorrules
    domain-performance.cursorrules
    README.md

  copilot/              # GitHub Copilot instructions (Markdown)
    workflow-tdd.md
    workflow-debugging.md
    architecture-api-design.md
    tools-git-workflow.md
    domain-security.md
    domain-performance.md
    copilot-instructions-template.md
    README.md

  windsurf/             # Windsurf rules (Markdown)
    workflow-tdd.md
    workflow-debugging.md
    architecture-api-design.md
    tools-git-workflow.md
    domain-security.md
    domain-performance.md
    README.md

  templates/            # Templates for creating new skills
    claude-code-SKILL.md.template
    cursor-rule.template
    copilot-instruction.template
    windsurf-rule.template

  install.sh            # Installation script
  README.md             # This file
  SKILLS.md             # Comprehensive documentation
```

## Installation Methods

### Claude Code (Global)

Skills are symlinked to `~/.claude/skills/` so they work across all projects:

```bash
./skills/install.sh claude-code
```

### Cursor (Project-Specific)

Rules copied to `.cursor/rules/` in your project:

```bash
# Navigate to project root
cd /path/to/your/project

# Install rules
./path/to/agent-instructions/skills/install.sh cursor
```

### GitHub Copilot (Project-Specific)

Instructions combined into `.github/copilot-instructions.md`:

```bash
# Navigate to project root
cd /path/to/your/project

# Install instructions
./path/to/agent-instructions/skills/install.sh copilot

# Commit to share with team
git add .github/copilot-instructions.md
git commit -m "Add Copilot instructions"
```

### Windsurf (Project-Specific)

Rules combined into `.windsurf/rules.md`:

```bash
# Navigate to project root
cd /path/to/your/project

# Install rules
./path/to/agent-instructions/skills/install.sh windsurf
```

## Creating Custom Skills

1. **Copy a template:**
   ```bash
   cp skills/templates/claude-code-SKILL.md.template \
      skills/claude-code/my-custom-skill/SKILL.md
   ```

2. **Edit the skill:**
   - Update frontmatter (name, description)
   - Write instructions specific to your needs
   - Add concrete examples
   - Define validation criteria

3. **Install:**
   ```bash
   ./skills/install.sh claude-code
   ```

## Agent Comparison

| Feature | Claude Code | Cursor | Copilot | Windsurf |
|---------|-------------|--------|---------|----------|
| Format | YAML + Markdown | Plain text | Markdown | Markdown |
| Location | `~/.claude/skills/` | `.cursorrules` | `.github/` | Settings |
| Scope | Global or project | Project | Project | Project |
| Discovery | Progressive (by name/description) | Always active | Always active | Always active |
| Installation | Symlink (stays updated) | Copy | Copy | Copy |

## Best Practices

1. **Start with core skills** - Install TDD, Debugging, Security first
2. **Customize for your project** - Add project-specific guidelines
3. **Share with team** - Commit skills to project repository
4. **Update regularly** - Keep skills aligned with best practices
5. **Test effectiveness** - Verify skills improve code quality

## Troubleshooting

### Skills Not Loading

- **Claude Code:** Restart Claude Code, check `ls ~/.claude/skills/`
- **Cursor:** Check `.cursor/rules/` exists and contains `.cursorrules` files
- **Copilot:** Verify `.github/copilot-instructions.md` exists and is committed
- **Windsurf:** Check Settings → Rules

### Symlinks Not Working (Claude Code)

On Windows, use mklink:
```cmd
mklink /D "%USERPROFILE%\.claude\skills\workflow-tdd" "C:\path\to\repo\skills\claude-code\workflow-tdd"
```

### Instructions Too Long (Copilot)

Copilot has token limits. Prioritize most important skills:
```bash
# Install only essential skills
cat skills/copilot/workflow-tdd.md \
    skills/copilot/domain-security.md \
    > .github/copilot-instructions.md
```

## Contributing

To contribute new skills:

1. Fork this repository
2. Create skill using template
3. Test thoroughly with real development tasks
4. Submit pull request with description

See `SKILLS.md` for detailed contribution guidelines.

## Resources

- **Claude Code:** [https://docs.claude.com/claude-code/skills](https://docs.claude.com/claude-code/skills)
- **Cursor:** [https://docs.cursor.com/context/rules](https://docs.cursor.com/context/rules)
- **GitHub Copilot:** [https://docs.github.com/copilot](https://docs.github.com/copilot)
- **Windsurf:** [https://docs.windsurf.com/](https://docs.windsurf.com/)

## License

MIT License - See LICENSE file for details

## Support

- **Issues with skills:** [Open issue in this repository](../../issues)
- **Agent-specific issues:** See agent documentation
