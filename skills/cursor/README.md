# Cursor Rules

This directory contains reusable rules for Cursor AI. Rules are instructions that guide Cursor's behavior when writing and reviewing code.

## Available Rules

### Workflow Rules
- **workflow-tdd.cursorrules** - Test-Driven Development with RED-GREEN-REFACTOR cycle
- **workflow-debugging.cursorrules** - Systematic debugging with root cause analysis

### Architecture Rules
- **architecture-api-design.cursorrules** - REST API design best practices

### Tools Rules
- **tools-git-workflow.cursorrules** - Git workflow, branching, commits, and pull requests

### Domain Rules
- **domain-security.cursorrules** - Security best practices and vulnerability prevention
- **domain-performance.cursorrules** - Performance optimization and profiling

## Installation

Cursor supports rules in two locations:

### Option 1: Project-Specific Rules (Recommended for teams)

Copy rules to your project's `.cursor/rules/` directory:

```bash
# From the repository root
mkdir -p .cursor/rules
cp skills/cursor/*.cursorrules .cursor/rules/

# Rules are now available to anyone who clones the repository
```

### Option 2: Single .cursorrules File

Combine rules into a single `.cursorrules` file in your project root:

```bash
# From the repository root
cat skills/cursor/*.cursorrules > .cursorrules
```

### Option 3: Use Installation Script

Use the provided installation script from the repository root:

```bash
./skills/install.sh cursor
```

## Verifying Installation

1. Open your project in Cursor
2. Rules in `.cursor/rules/` or `.cursorrules` are automatically loaded
3. Cursor will follow these rules when generating code

## Using Rules

### Automatic Activation

Cursor automatically applies loaded rules to all code generation and suggestions.

### Manual Reference

You can explicitly reference rules in your prompts:

```
"Follow TDD workflow to implement email validation"
"Use the debugging workflow to investigate this issue"
"Design this API following REST best practices"
```

## Rule Format

Cursor rules use plain text markdown format:

```markdown
# Rule Title

Description of when to apply this rule.

## Key Principles

- Principle 1
- Principle 2

## Examples

Concrete examples showing good and bad patterns.
```

## Combining Multiple Rules

You can use multiple rules together:

```bash
# Combine workflow rules
cat workflow-tdd.cursorrules workflow-debugging.cursorrules > combined-workflow.cursorrules
```

## Creating Custom Rules

1. Create a new `.cursorrules` file
2. Write instructions in plain text markdown
3. Add examples showing good and bad patterns
4. Place in `.cursor/rules/` directory

Example custom rule:

```markdown
# Custom Project Rules

## Database Queries

Always use the project's query builder:

```javascript
// ✅ Good
const users = await db.query('users').where({ active: true });

// ❌ Bad
const users = await db.raw('SELECT * FROM users WHERE active = true');
```

## Naming Conventions

- Components: PascalCase (UserProfile.tsx)
- Functions: camelCase (getUserProfile)
- Constants: UPPER_SNAKE_CASE (MAX_RETRIES)
```

## Scoped Rules

Cursor supports scoped rules using directory nesting:

```
.cursor/
  rules/
    api/
      validation.cursorrules  # Only applies when editing files in api/
    frontend/
      components.cursorrules  # Only applies when editing files in frontend/
```

## Rule Priority

When multiple rules apply:
1. More specific (nested) rules take precedence
2. Project rules override global preferences
3. Explicit prompts override rules

## Best Practices

1. **Keep rules focused** - One rule, one responsibility
2. **Include examples** - Show good and bad patterns
3. **Be specific** - Clear instructions produce better results
4. **Update regularly** - Keep rules aligned with best practices
5. **Test rules** - Try rules on real code to verify they work
6. **Document reasoning** - Explain WHY, not just WHAT

## Troubleshooting

### Rules Not Being Applied

1. **Check file location:**
   ```bash
   ls -la .cursor/rules/
   # or
   ls -la .cursorrules
   ```

2. **Verify file extension:** Must be `.cursorrules`

3. **Check file format:** Plain text markdown, no special encoding

4. **Restart Cursor:** Rules are loaded at startup

### Rules Conflicting

1. **Remove duplicate rules:** Don't have the same rule in multiple locations
2. **Make rules more specific:** Add context about when to apply each rule
3. **Prioritize:** Use directory structure for scoped rules

## Differences from Claude Code Skills

| Feature | Claude Code Skills | Cursor Rules |
|---------|-------------------|--------------|
| Format | YAML frontmatter + markdown | Plain text markdown |
| Location | `~/.claude/skills/` or `.claude/skills/` | `.cursor/rules/` or `.cursorrules` |
| Discovery | Progressive disclosure by name/description | All rules always active |
| Activation | Automatic or manual by name | Automatic for all rules |

## Tips for Effective Rules

1. **Start broad, refine later** - Begin with general rules, add specifics as needed
2. **Use examples liberally** - Show don't tell
3. **Combine related rules** - Group related concerns
4. **Test incrementally** - Add one rule at a time and verify
5. **Get team buy-in** - Rules work best when team agrees on conventions

## Resources

- [Cursor Rules Documentation](https://docs.cursor.com/context/rules)
- [Awesome Cursorrules](https://github.com/PatrickJS/awesome-cursorrules)
- [Cursor Community Forum](https://forum.cursor.com/)

## Support

For issues with:
- **Rules in this repo**: Open issue in this repository
- **Cursor itself**: Visit [Cursor Community Forum](https://forum.cursor.com/)
