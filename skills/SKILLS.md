# Skills System Documentation

Comprehensive guide to the multi-agent skills system.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Skill Categories](#skill-categories)
4. [Agent-Specific Implementations](#agent-specific-implementations)
5. [Installation and Setup](#installation-and-setup)
6. [Creating Custom Skills](#creating-custom-skills)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

## Overview

This repository provides a unified skills library for multiple AI coding agents. Skills are reusable workflows and best practices that guide AI agents in performing common development tasks.

### Goals

- **Consistency:** Same workflow across different AI agents
- **Reusability:** Write once, use across projects
- **Quality:** Codified best practices from industry standards
- **Shareability:** Team-wide skills via git
- **Discoverability:** Easy to find and apply relevant skills

### Supported Agents

- **Claude Code:** Anthropic's official CLI (agent system with progressive disclosure)
- **Cursor:** AI-first code editor (rules-based)
- **GitHub Copilot:** GitHub's AI pair programmer (instructions-based)
- **Windsurf:** Codeium's AI IDE (rules and memories)

## Architecture

### Design Principles

1. **Agent-native format:** Each agent uses its preferred format
2. **Content parity:** Same workflow logic, different syntax
3. **Progressive disclosure:** Information revealed as needed (Claude Code)
4. **Symlink-friendly:** Skills stay in repo, linked to agent directories
5. **Git-friendly:** All skills version controlled and shareable

### Directory Structure

```
skills/
├── claude-code/          # Claude Code format
│   ├── workflow-tdd/
│   │   └── SKILL.md      # YAML frontmatter + markdown
│   └── ...
├── cursor/               # Cursor format
│   ├── workflow-tdd.cursorrules  # Plain text
│   └── ...
├── copilot/              # Copilot format
│   ├── workflow-tdd.md   # Markdown instructions
│   └── ...
├── windsurf/             # Windsurf format
│   ├── workflow-tdd.md   # Markdown rules
│   └── ...
├── templates/            # Skill templates
└── install.sh            # Installation script
```

## Skill Categories

### 1. Workflow Skills

Procedural development workflows that guide step-by-step processes.

**workflow-tdd** - Test-Driven Development
- RED-GREEN-REFACTOR cycle
- Write failing test → Implement → Refactor
- Critical rule: Never write implementation before tests

**workflow-debugging** - Systematic Debugging
- Four-phase framework
- Root cause investigation → Pattern analysis → Hypothesis testing → Implementation
- Critical rule: Never propose fix before understanding root cause

### 2. Architecture Skills

Design patterns and system architecture guidance.

**architecture-api-design** - REST API Design
- Resource-oriented design with proper HTTP semantics
- Status codes, pagination, filtering, versioning
- Critical rule: Use nouns for resources, not verbs

### 3. Tools Skills

Development tool guidance and best practices.

**tools-git-workflow** - Git Workflow
- Feature branching, atomic commits, meaningful messages
- Pull request workflow, merge strategies
- Critical rule: Never force push to shared branches

### 4. Domain Skills

Domain-specific expertise and specialized knowledge.

**domain-security** - Security Best Practices
- Input validation, authentication, authorization
- Secrets management, common vulnerability prevention
- Critical rule: Never trust user input

**domain-performance** - Performance Optimization
- Data-driven optimization: measure → optimize → verify
- Database, caching, algorithms, async patterns
- Critical rule: Never optimize without profiling first

## Agent-Specific Implementations

### Claude Code

**Format:** YAML frontmatter + Markdown

```yaml
---
name: skill-name
description: Brief description for discovery
---

# Skill Title

[Markdown content with instructions, examples, validation]
```

**Location:**
- Personal: `~/.claude/skills/` (global)
- Project: `.claude/skills/` (team-shared)

**Discovery:** Progressive disclosure by name/description at startup

**Installation:** Symlink (keeps skills updated with git)

**When to use:**
- Need structured, phase-based workflows
- Want automatic skill discovery
- Using Claude Code CLI

### Cursor

**Format:** Plain text Markdown (no frontmatter)

```markdown
# Rule Title

Instructions in plain text...
```

**Location:**
- `.cursorrules` (single file in project root)
- `.cursor/rules/` (multiple files, can be scoped)

**Discovery:** All rules always active

**Installation:** Copy to project

**When to use:**
- Need simple, always-on rules
- Want scoped rules by directory
- Using Cursor IDE

### GitHub Copilot

**Format:** Markdown instructions

**Location:** `.github/copilot-instructions.md`

**Discovery:** Always active when file present

**Installation:** Copy/combine into single file

**When to use:**
- Need project-wide instructions
- Want to share with team via git
- Using GitHub Copilot

**Advanced:** Copilot Extensions with Skillsets for programmatic skills

### Windsurf

**Format:** Markdown rules

**Location:**
- Settings → Rules (UI)
- `.windsurf/rules.md` (project file)

**Discovery:** Rules always active

**Installation:** Copy to project or add via Settings

**When to use:**
- Need rules with MCP integration
- Want agentic coding (Flow)
- Using Windsurf IDE

## Installation and Setup

### Quick Install

```bash
# Navigate to this repository
cd /path/to/agent-instructions

# Install for specific agent
./skills/install.sh claude-code
./skills/install.sh cursor
./skills/install.sh copilot
./skills/install.sh windsurf

# Or install for all
./skills/install.sh all
```

### Manual Installation

#### Claude Code

```bash
mkdir -p ~/.claude/skills

# Symlink each skill
for skill in skills/claude-code/*/; do
  ln -s "$(pwd)/$skill" ~/.claude/skills/
done
```

#### Cursor

```bash
# In project directory
mkdir -p .cursor/rules
cp skills/cursor/*.cursorrules .cursor/rules/
```

#### Copilot

```bash
# In project directory
mkdir -p .github
cat skills/copilot/*.md > .github/copilot-instructions.md
```

#### Windsurf

```bash
# In project directory
mkdir -p .windsurf
cat skills/windsurf/*.md > .windsurf/rules.md
```

### Verification

- **Claude Code:** `ls ~/.claude/skills/` → Restart Claude Code
- **Cursor:** `ls .cursor/rules/` → Open project in Cursor
- **Copilot:** `ls .github/copilot-instructions.md` → Check Copilot Chat
- **Windsurf:** Check Settings → Rules or `ls .windsurf/rules.md`

## Creating Custom Skills

### 1. Choose Template

```bash
# Copy appropriate template
cp skills/templates/claude-code-SKILL.md.template \
   skills/claude-code/my-skill/SKILL.md
```

### 2. Fill in Metadata

**Claude Code:**
```yaml
---
name: category-skill-name
description: One-line description for discovery
---
```

**Others:** Use title as header

### 3. Structure Content

All skills should include:
1. **Description** - What and why
2. **When to Use** - Trigger conditions
3. **Prerequisites** - Required knowledge/tools
4. **Instructions** - Step-by-step process
5. **Examples** - Concrete usage examples
6. **Validation** - How to verify correct application
7. **Common Pitfalls** - What to avoid

### 4. Write Clear Instructions

- Use imperative mood ("Do X", not "You should do X")
- Number steps sequentially
- Include rationale ("Why") not just actions ("What")
- Show both good and bad examples
- Make critical rules **bold** or CAPS

### 5. Test Thoroughly

- Try skill on real development tasks
- Verify agent applies skill correctly
- Check that examples work as shown
- Get feedback from team

### 6. Install and Iterate

```bash
./skills/install.sh [agent-name]
```

Refine based on usage and feedback.

## Best Practices

### Skill Design

1. **One skill, one responsibility** - Focused skills are clearer
2. **Phase-based structure** - Break complex workflows into phases
3. **Concrete examples** - Show, don't just tell
4. **Validation criteria** - Define "done" clearly
5. **Critical rules** - Highlight non-negotiable practices

### Skill Content

1. **Be prescriptive** - "Do X" not "Consider doing X"
2. **Explain reasoning** - Help agent understand why
3. **Include anti-patterns** - Show what NOT to do
4. **Cross-reference** - Link related skills
5. **Keep current** - Update as best practices evolve

### Team Usage

1. **Commit to git** - Share skills with team
2. **Document decisions** - Record why skills were chosen
3. **Review regularly** - Skills should evolve with codebase
4. **Get buy-in** - Team agreement on practices
5. **Customize for project** - Add project-specific guidance

## Troubleshooting

### Skills Not Being Applied

**Claude Code:**
- Check `~/.claude/skills/` contains skill directories
- Verify SKILL.md has valid YAML frontmatter
- Restart Claude Code

**Cursor:**
- Check `.cursorrules` or `.cursor/rules/` exists
- Verify file extension is `.cursorrules`
- Restart Cursor

**Copilot:**
- Check `.github/copilot-instructions.md` exists
- File must be committed to git
- Check Copilot Chat for attached context

**Windsurf:**
- Check Settings → Rules or `.windsurf/rules.md`
- Restart Windsurf

### Conflicting Instructions

1. **Prioritize:** Order rules by importance
2. **Scope:** Use directory-based scoping (Cursor)
3. **Specificity:** More specific rules override general ones
4. **Consistency:** Ensure rules don't contradict

### Performance Issues

**Large instruction files:**
- Prioritize essential skills
- Remove redundant examples
- Split into focused skills

**Too many skills:**
- Keep only actively used skills
- Archive unused skills
- Combine related small skills

## Contributing Skills

### Contribution Process

1. **Fork repository**
2. **Create skill** using templates
3. **Test thoroughly** on real tasks
4. **Document well** with examples
5. **Submit PR** with description

### Contribution Guidelines

- Follow existing skill format
- Include all standard sections
- Test with multiple agents
- Provide concrete examples
- Explain rationale for practices

### Review Criteria

- **Correctness:** Does it follow best practices?
- **Clarity:** Are instructions clear and actionable?
- **Completeness:** Does it include all standard sections?
- **Examples:** Are examples concrete and working?
- **Testing:** Has it been tested with real code?

## Maintenance

### Updating Skills

1. **Track changes:** Document what changed and why
2. **Test updates:** Verify skills still work
3. **Communicate:** Notify team of breaking changes
4. **Version:** Consider version numbers for major changes

### Deprecating Skills

1. **Mark deprecated:** Add deprecation notice
2. **Suggest alternative:** Point to replacement skill
3. **Grace period:** Keep for reasonable transition time
4. **Remove:** Delete after grace period

## Resources

### Official Documentation

- [Claude Code Skills](https://docs.claude.com/claude-code/skills)
- [Cursor Rules](https://docs.cursor.com/context/rules)
- [GitHub Copilot](https://docs.github.com/copilot)
- [Windsurf Docs](https://docs.windsurf.com/)

### Community

- [Awesome Cursorrules](https://github.com/PatrickJS/awesome-cursorrules)
- [Claude Code GitHub](https://github.com/anthropics/claude-code)
- [Cursor Forum](https://forum.cursor.com/)

## License

MIT License - See LICENSE file for details.
