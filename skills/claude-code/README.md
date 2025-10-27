# Claude Code Skills

This directory contains reusable skills for Claude Code. Skills are modular workflows that Claude can use to handle common development tasks systematically.

## Available Skills

### Workflow Skills
- **workflow-tdd** - Test-Driven Development with RED-GREEN-REFACTOR cycle
- **workflow-debugging** - Systematic debugging with root cause analysis

### Architecture Skills
- **architecture-api-design** - REST API design best practices

### Tools Skills
- **tools-git-workflow** - Git workflow, branching, commits, and pull requests

### Domain Skills
- **domain-security** - Security best practices and vulnerability prevention
- **domain-performance** - Performance optimization and profiling

## Installation

### Option 1: Symlink (Recommended)

Symlink allows you to keep skills in this repository while making them available to Claude Code. Changes to skills will automatically be reflected.

```bash
# From the repository root
cd skills/claude-code

# Create skills directory if it doesn't exist
mkdir -p ~/.claude/skills

# Symlink each skill
ln -s "$(pwd)/workflow-tdd" ~/.claude/skills/workflow-tdd
ln -s "$(pwd)/workflow-debugging" ~/.claude/skills/workflow-debugging
ln -s "$(pwd)/architecture-api-design" ~/.claude/skills/architecture-api-design
ln -s "$(pwd)/tools-git-workflow" ~/.claude/skills/tools-git-workflow
ln -s "$(pwd)/domain-security" ~/.claude/skills/domain-security
ln -s "$(pwd)/domain-performance" ~/.claude/skills/domain-performance
```

### Option 2: Copy

Copy skills to your Claude Code skills directory. You'll need to manually update when skills change.

```bash
# From the repository root
cp -r skills/claude-code/* ~/.claude/skills/
```

### Option 3: Use Installation Script

Use the provided installation script from the repository root:

```bash
./skills/install.sh claude-code
```

## Verifying Installation

After installation, restart Claude Code and check that skills are loaded:

```bash
# Skills should appear when Claude starts
# You can also check the skills directory
ls -la ~/.claude/skills/
```

## Using Skills

Claude Code automatically loads skills at startup. When you request something that matches a skill's description, Claude will use that skill.

### Automatic Activation

Skills activate automatically based on context:

```
You: "I need to add email validation to user registration"
Claude: I'm using the workflow-tdd skill to implement this with test-driven development...
```

### Manual Invocation

You can also explicitly request a skill:

```
You: "Use TDD to implement this feature"
You: "Debug this issue systematically"
You: "Review this API design"
```

## Skill Structure

Each skill follows this format:

```yaml
---
name: skill-name
description: Brief description of what the skill does
---

# Skill Name

## Description
Detailed description

## When to Use
- Trigger conditions

## Prerequisites
- Requirements

## Instructions
Step-by-step workflow

## Examples
Concrete usage examples

## Validation
How to verify correct application
```

## Creating Custom Skills

1. Copy a skill directory as a template
2. Modify the SKILL.md file
3. Update frontmatter (name, description)
4. Customize instructions for your needs
5. Add examples relevant to your project
6. Install using symlink or copy method

See `/skills/templates/claude-code-SKILL.md.template` for a blank template.

## Project-Specific Skills

You can also create project-specific skills in your repository:

```bash
# Create project skills directory
mkdir -p .claude/skills/my-custom-skill

# Create SKILL.md
cat > .claude/skills/my-custom-skill/SKILL.md << 'EOF'
---
name: my-custom-skill
description: Custom skill for my project
---

# My Custom Skill
...
EOF
```

Project skills in `.claude/skills/` are automatically available to team members when they clone the repository.

## Skill Categories

### When to Use Each Category

**Workflow** - Procedural development processes
- Use when you need step-by-step guidance through a process
- Examples: TDD, debugging, code review

**Architecture** - Design patterns and system design
- Use when making structural decisions
- Examples: API design, database schema design

**Tools** - Development tool guidance
- Use when working with specific tools
- Examples: Git, testing frameworks, CI/CD

**Domain** - Domain-specific expertise
- Use when specialized knowledge is needed
- Examples: Security, performance, accessibility

## Troubleshooting

### Skills Not Loading

1. **Check skill location:**
   ```bash
   ls -la ~/.claude/skills/
   ```

2. **Verify SKILL.md format:**
   - Must have YAML frontmatter
   - Must have `name` and `description` fields
   - Must be valid markdown

3. **Restart Claude Code:**
   - Skills are loaded at startup
   - Restart after adding new skills

### Symlinks Not Working

1. **Check if symlinks were created correctly:**
   ```bash
   ls -la ~/.claude/skills/
   # Should show arrows pointing to source
   ```

2. **Use absolute paths in ln command:**
   ```bash
   ln -s "$(pwd)/workflow-tdd" ~/.claude/skills/workflow-tdd
   ```

3. **On Windows, use mklink:**
   ```cmd
   mklink /D "%USERPROFILE%\.claude\skills\workflow-tdd" "C:\path\to\repo\skills\claude-code\workflow-tdd"
   ```

## Best Practices

1. **Keep skills focused** - One skill, one responsibility
2. **Write clear descriptions** - Claude uses these to determine when to use the skill
3. **Include examples** - Concrete examples help Claude understand usage
4. **Update regularly** - Keep skills aligned with best practices
5. **Test skills** - Try skills on real tasks to verify they work
6. **Document decisions** - Add rationale for why the skill works this way

## Contributing

To contribute skills back to this repository:

1. Create/modify skills in your fork
2. Test thoroughly with real development tasks
3. Ensure SKILL.md follows the template
4. Submit pull request with description of changes

## Resources

- [Claude Code Documentation](https://docs.claude.com/claude-code)
- [Agent Skills Documentation](https://docs.claude.com/claude-code/skills)
- [Creating Custom Skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills)

## Support

For issues with:
- **Skills in this repo**: Open issue in this repository
- **Claude Code itself**: Visit [Claude Code support](https://support.anthropic.com)
