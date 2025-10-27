# Windsurf Rules and Instructions

This directory contains reusable rules for Windsurf (formerly Codeium). These instructions guide Windsurf's AI assistance and code generation.

## Available Rules

### Workflow Rules
- **workflow-tdd.md** - Test-Driven Development guidance
- **workflow-debugging.md** - Systematic debugging approach

### Architecture Rules
- **architecture-api-design.md** - REST API design principles

### Tools Rules
- **tools-git-workflow.md** - Git workflow best practices

### Domain Rules
- **domain-security.md** - Security guidelines
- **domain-performance.md** - Performance optimization

## Installation

Windsurf supports "Rules" and "Memories" for customizing AI behavior.

### Method 1: Add via Windsurf Settings

1. Open Windsurf
2. Go to Settings → Rules
3. Create new rule for each category
4. Paste content from respective `.md` files

### Method 2: Project-Specific Rules File

Create a rules file in your project:

```bash
# Create project rules
mkdir -p .windsurf
cat skills/windsurf/*.md > .windsurf/rules.md
```

### Method 3: Use Installation Script

```bash
./skills/install.sh windsurf
```

## Verifying Installation

1. Open Windsurf
2. Check Settings → Rules to see loaded rules
3. Windsurf will apply these rules to suggestions

## Using Rules

### Automatic Application

Windsurf automatically applies loaded rules to:
- Code completions
- Chat responses
- Code generation
- Refactoring suggestions

### Explicit Reference

Reference specific rules in chat:

```
"Implement this using TDD workflow"
"Debug this issue systematically"
"Design this API following REST principles"
```

## Windsurf Features

### Cascade (AI Chat)

Rules guide Cascade's responses:
- Explain code
- Generate implementations
- Suggest improvements
- Answer questions

### Flow (Agentic Coding)

Rules influence Flow's autonomous coding:
- Multi-file editing
- Complex refactorings
- Feature implementation

### Autocomplete

Rules guide inline completions based on context

### MCP Integration

Windsurf supports Model Context Protocol (MCP) for custom tools:
- Connect external services
- Add custom commands
- Integrate with APIs

## Customizing Rules

### Adding Project-Specific Guidelines

Combine skills with project conventions:

```markdown
# Project Rules for Windsurf

## Tech Stack
- React 18, TypeScript, Node.js, PostgreSQL

## TDD Workflow
[Copy from workflow-tdd.md]

## Project-Specific Patterns

### Database Queries
Always use our query builder:
```javascript
const users = await db.query('users').where({ active: true });
```

### File Organization
- Components: `src/components/`
- Hooks: `src/hooks/`
- Utils: `src/utils/`
```

## Best Practices

1. **Keep rules focused** - Clear, actionable guidelines
2. **Use examples** - Show patterns you want
3. **Update regularly** - Keep aligned with codebase
4. **Test effectiveness** - Verify rules improve suggestions
5. **Organize by category** - Group related rules

## Troubleshooting

### Rules Not Applied

1. **Check Rules in Settings** - Verify rules are loaded
2. **Restart Windsurf** - Reload rules
3. **Simplify rules** - Start with fewer, focused rules

### Conflicting Rules

1. **Prioritize** - Order rules by importance
2. **Be specific** - Add context about when each applies
3. **Remove duplicates** - Don't repeat guidelines

## Differences from Other Agents

| Feature | Windsurf | Claude Code | Cursor |
|---------|----------|-------------|--------|
| Format | Markdown rules | YAML + Markdown | Plain text |
| Location | Settings or project | `~/.claude/skills/` | `.cursorrules` |
| Discovery | Always active | Progressive | Always active |
| Agents | Flow (agentic) | Built-in | Composer |

## MCP Integration

Windsurf supports MCP servers for enhanced functionality:

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://context7.com/mcp"
    }
  }
}
```

This allows integration with external tools and APIs.

## Tips for Effective Rules

1. **Start minimal** - Begin with core rules, expand later
2. **Use concrete examples** - Show expected patterns
3. **Be consistent** - Align with actual codebase
4. **Leverage Flow** - Rules help autonomous coding
5. **Combine with Memories** - Store project-specific context

## Resources

- [Windsurf Documentation](https://docs.windsurf.com/)
- [Windsurf Flows](https://windsurf.com/flows)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Codeium Community](https://discord.gg/codeium)

## Support

For issues with:
- **Rules in this repo**: Open issue in this repository
- **Windsurf itself**: Visit [Windsurf support](https://codeium.com/support)
