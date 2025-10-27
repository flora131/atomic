# GitHub Copilot Instructions

This directory contains reusable instruction files for GitHub Copilot. These instructions guide Copilot's code suggestions and chat responses.

## Available Instructions

### Workflow Instructions
- **workflow-tdd.md** - Test-Driven Development guidance
- **workflow-debugging.md** - Systematic debugging approach

### Architecture Instructions
- **architecture-api-design.md** - REST API design principles

### Tools Instructions
- **tools-git-workflow.md** - Git workflow best practices

### Domain Instructions
- **domain-security.md** - Security guidelines
- **domain-performance.md** - Performance optimization

## Installation

### Method 1: Copy into .github/copilot-instructions.md (Recommended)

GitHub Copilot reads instructions from `.github/copilot-instructions.md` in your repository:

```bash
# Create .github directory if it doesn't exist
mkdir -p .github

# Combine instructions into single file
cat skills/copilot/workflow-tdd.md \
    skills/copilot/workflow-debugging.md \
    skills/copilot/architecture-api-design.md \
    skills/copilot/tools-git-workflow.md \
    skills/copilot/domain-security.md \
    skills/copilot/domain-performance.md \
    > .github/copilot-instructions.md
```

### Method 2: Selective Instructions

Copy only the instructions relevant to your project:

```bash
mkdir -p .github

# Example: Only TDD and Security
cat skills/copilot/workflow-tdd.md \
    skills/copilot/domain-security.md \
    > .github/copilot-instructions.md
```

### Method 3: Use Template

Start with the template and add project-specific instructions:

```bash
cp skills/copilot/copilot-instructions-template.md .github/copilot-instructions.md
# Then edit to add project-specific details
```

### Method 4: Use Installation Script

```bash
./skills/install.sh copilot
```

## Verifying Installation

1. Open repository in VS Code with Copilot installed
2. Open Copilot Chat
3. Look for attached context showing `.github/copilot-instructions.md`
4. Copilot will now follow these instructions

## Using Instructions

### Automatic Application

Copilot automatically applies instructions from `.github/copilot-instructions.md` to:
- Code completions
- Chat responses
- Code explanations

### Explicit Reference

You can reference specific guidelines in Copilot Chat:

```
"Implement email validation following our TDD workflow"
"Design this API endpoint following our REST principles"
"Review this code for security issues per our guidelines"
```

## Customizing Instructions

### Adding Project-Specific Details

Edit `.github/copilot-instructions.md` to add:

```markdown
# Project Name Copilot Instructions

## Tech Stack
- React, TypeScript, Node.js, PostgreSQL

## [Include skill instructions here]

## Project-Specific Patterns

### Database Access
Always use our custom query builder:
```javascript
const users = await db.query('users').where({ active: true });
```

### Component Structure
All components follow this pattern:
- Component file: `ComponentName.tsx`
- Styles: `ComponentName.module.css`
- Tests: `ComponentName.test.tsx`
```

### Combining Multiple Sources

Merge skills with your project conventions:

```markdown
# Copilot Instructions

## General Guidelines
[Copy from skills/copilot/]

## Project-Specific Rules
[Your custom rules]

## Team Conventions
[Your team's agreed-upon practices]
```

## GitHub Copilot Features

### Copilot Chat

Instructions guide chat responses:
- Explain code
- Suggest improvements
- Answer questions
- Generate code

### Copilot Completions

Instructions influence inline suggestions:
- Function implementations
- Test cases
- Documentation
- Refactorings

### Copilot Extensions

For advanced needs, consider creating a Copilot Extension with Skillsets (see GitHub documentation).

## Best Practices

1. **Keep instructions focused** - Clear, specific guidance
2. **Use examples** - Show patterns you want Copilot to follow
3. **Update regularly** - Keep aligned with project evolution
4. **Test effectiveness** - Try generating code to verify instructions work
5. **Share with team** - Instructions in `.github/` are shared via git
6. **Document reasoning** - Explain WHY certain patterns are preferred

## Troubleshooting

### Instructions Not Applied

1. **Verify file location:**
   ```bash
   ls -la .github/copilot-instructions.md
   ```

2. **Check file is committed:**
   ```bash
   git status
   ```

3. **Restart VS Code** to reload instructions

4. **Check Copilot Chat** for attached context indicator

### Instructions Too Long

GitHub Copilot has token limits. If instructions are too long:
1. Prioritize most important guidelines
2. Remove redundant examples
3. Link to full documentation for details

## Differences from Other Agents

| Feature | GitHub Copilot | Claude Code | Cursor |
|---------|---------------|-------------|--------|
| Location | `.github/copilot-instructions.md` | `~/.claude/skills/` | `.cursorrules` |
| Format | Markdown | YAML + Markdown | Plain text |
| Scope | Repository | Global or project | Project |
| Discovery | Always active | Progressive | Always active |

## Tips for Effective Instructions

1. **Start simple** - Begin with core guidelines, expand as needed
2. **Use concrete examples** - Show don't tell
3. **Be consistent** - Align instructions with actual codebase
4. **Get feedback** - Ask team if Copilot suggestions improved
5. **Iterate** - Refine instructions based on results

## Resources

- [GitHub Copilot Documentation](https://docs.github.com/copilot)
- [Customizing GitHub Copilot](https://docs.github.com/copilot/customizing-copilot)
- [Copilot Extensions](https://github.com/features/copilot/extensions)
- [Copilot Skillsets](https://docs.github.com/en/copilot/building-copilot-extensions/building-copilot-skillsets)

## Support

For issues with:
- **Instructions in this repo**: Open issue in this repository
- **GitHub Copilot itself**: Visit [GitHub Copilot support](https://support.github.com/)
