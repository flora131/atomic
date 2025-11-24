# Task: Analyze this codebase and generate a hierarchical CLAUDE.md system optimized for Claude Code

## Critical Context: Claude Code is Different from Other Agents

Claude Code has unique capabilities that set it apart from generic AGENTS.md:

1. **Strict Instruction Hierarchy**: CLAUDE.md content is treated as **immutable system rules** with strict priority over user prompts
2. **Hierarchical Memory System**: Reads CLAUDE.md files recursively UP from CWD to root, AND discovers them in subdirectories
3. **Hooks System**: Lifecycle hooks (PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop) for deterministic automation
4. **Model Context Protocol (MCP)**: Native integration with external tools, databases, and APIs
5. **Custom Slash Commands**: Repeatable workflows stored in `.claude/commands/`
6. **Subagents**: Specialized agents with isolated context windows and tool permissions
7. **Extended Thinking**: Can use long-form reasoning with extended context windows (1M+ tokens)

## Core Principles

1. **CLAUDE.md is AUTHORITATIVE** - Treated as system rules, not suggestions
2. **Modular Sections** - Use clear markdown headers to prevent instruction bleeding
3. **Front-load Critical Context** - Large CLAUDE.md files provide better instruction adherence
4. **Hierarchical Strategy**: Root = universal rules; Subdirs = specific context
5. **Token Efficiency Through Structure** - Use sections to keep related instructions together
6. **Living Documentation** - Use `#` key during sessions to add memories organically

---

## Your Process

### Phase 1: Comprehensive Repository Analysis

Analyze the codebase and provide:

**1. Repository Architecture**
- Type: Monorepo, multi-package, or standard single project?
- Tech stack: Primary languages, frameworks, build systems
- Testing infrastructure: Frameworks, where tests live, coverage requirements
- CI/CD: GitHub Actions, GitLab CI, custom pipelines?

**2. Claude Code-Specific Analysis**
Identify opportunities for:
- **Hooks**: What should always run (formatting, linting, tests)?
- **MCP Servers**: External tools needed (GitHub, Slack, databases, APIs)?
- **Custom Commands**: Repeated workflows (deploy, migrate, review)?
- **Subagents**: Specialized tasks (testing agent, review agent, docs agent)?

**3. Directory Structure for CLAUDE.md Files**
Map where CLAUDE.md files should exist:
```
root/CLAUDE.md                    # Universal project rules
apps/web/CLAUDE.md               # Next.js-specific guidance
apps/api/CLAUDE.md               # API-specific patterns
services/auth/CLAUDE.md          # Auth service specifics
packages/ui/CLAUDE.md            # UI library patterns
tests/CLAUDE.md                  # Testing-specific rules
```

**4. Dangerous Patterns to Block**
- Commands that should be blocked via hooks (rm -rf, force push, etc.)
- Files that should never be edited (.env, secrets, prod configs)
- Anti-patterns to warn against

**5. Tool Permissions Strategy**
- What tools should Claude have by default?
- What requires explicit permission?
- Security boundaries

Present this analysis as a **structured map** before generating any files.

---

### Phase 2: Generate Root CLAUDE.md

Create a **comprehensive root CLAUDE.md** (~200-400 lines) that serves as the constitution:

#### Required Sections:

**1. Project Identity** (5-10 lines)
```markdown
# [Project Name]

## Overview
- **Type**: [Monorepo/Standard project]
- **Stack**: [Primary technologies]
- **Architecture**: [Brief architectural summary]
- **Team Size**: [If relevant]

This CLAUDE.md is the authoritative source for development guidelines. 
Subdirectories contain specialized CLAUDE.md files that extend these rules.
```

**2. Universal Rules (MUST/SHOULD/MUST NOT)** (10-20 lines)
Use clear RFC-2119 language with emphasis:
```markdown
## Universal Development Rules

### Code Quality (MUST)
- **MUST** write TypeScript in strict mode
- **MUST** include tests for all new features
- **MUST** run pre-commit hooks before committing
- **MUST NOT** commit secrets, API keys, or tokens

### Best Practices (SHOULD)  
- **SHOULD** prefer functional components over class components
- **SHOULD** use descriptive variable names (no single letters except loops)
- **SHOULD** keep functions under 50 lines
- **SHOULD** extract complex logic into separate functions

### Anti-Patterns (MUST NOT)
- **MUST NOT** use `any` type without explicit justification
- **MUST NOT** bypass TypeScript errors with `@ts-ignore`
- **MUST NOT** push directly to main branch
```

**3. Core Commands** (10-20 lines)
```markdown
## Core Commands

### Development
- `pnpm dev` - Start all development servers
- `pnpm build` - Build all packages
- `pnpm test` - Run all tests
- `pnpm typecheck` - TypeScript validation across project
- `pnpm lint` - ESLint all code
- `pnpm lint:fix` - Auto-fix linting issues

### Package-Specific
- `pnpm --filter @repo/web [command]` - Run command in web package
- `pnpm --filter @repo/api [command]` - Run command in API package

### Quality Gates (run before PR)
```bash
pnpm typecheck && pnpm lint && pnpm test
```
```

**4. Project Structure Map** (15-30 lines)
```markdown
## Project Structure

### Applications
- **`apps/web/`** → Next.js frontend ([see apps/web/CLAUDE.md](apps/web/CLAUDE.md))
  - Routes: `app/` directory (App Router)
  - Components: `src/components/`
  - Hooks: `src/hooks/`
  
- **`apps/api/`** → Express API ([see apps/api/CLAUDE.md](apps/api/CLAUDE.md))
  - Routes: `src/routes/`
  - Middleware: `src/middleware/`
  - Models: `src/models/`

### Packages
- **`packages/ui/`** → Shared UI components ([see packages/ui/CLAUDE.md](packages/ui/CLAUDE.md))
- **`packages/shared/`** → Shared utilities and types

### Infrastructure
- **`services/auth/`** → Authentication service ([see services/auth/CLAUDE.md](services/auth/CLAUDE.md))
- **`.github/workflows/`** → CI/CD pipelines

### Testing
- Unit tests: Colocated with source (`*.test.ts`)
- Integration: `tests/integration/`
- E2E: `tests/e2e/` (Playwright)
```

**5. Quick Find Commands** (JIT Index) (10-15 lines)
```markdown
## Quick Find Commands

### Code Navigation
```bash
# Find a component
rg -n "export (function|const) .*Button" apps/web/src

# Find API endpoint
rg -n "export (async )?function (GET|POST)" apps/api/src

# Find hook usage
rg -n "use[A-Z]" apps/web/src

# Find type definition
rg -n "^export (type|interface)" packages/shared/src
```

### Dependency Analysis
```bash
# Check package dependencies
pnpm why <package-name>

# Find unused dependencies
npx depcheck
```
```

**6. Security & Secrets** (5-10 lines)
```markdown
## Security Guidelines

### Secrets Management
- **NEVER** commit tokens, API keys, or credentials
- Use `.env.local` for local secrets (already in .gitignore)
- Use environment variables for CI/CD secrets
- PII must be redacted in logs

### Safe Operations
- Review generated bash commands before execution
- Confirm before: git force push, rm -rf, database drops
- Use staging environment for risky operations
```

**7. Git Workflow** (5-10 lines)
```markdown
## Git Workflow

- Branch from `main` for features: `feature/description`
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`
- PRs require: passing tests, type checks, lint, and 1 approval
- Squash commits on merge
- Delete branches after merge
```

**8. Testing Strategy** (5-10 lines)
```markdown
## Testing Requirements

- **Unit tests**: All business logic (aim for >80% coverage)
- **Integration tests**: API endpoints and database operations  
- **E2E tests**: Critical user paths
- Run tests before committing (enforced by pre-commit hook)
- New features require tests before review
```

**9. Available Tools** (5-10 lines)
```markdown
## Available Tools

You have access to:
- Standard bash tools (rg, git, node, pnpm, etc.)
- GitHub CLI (`gh`) for issues, PRs, releases
- Database CLI (based on project needs)
- [List any MCP servers configured]

### Tool Permissions
- ✅ Read any file
- ✅ Write code files
- ✅ Run tests, linters, type checkers
- ❌ Edit .env files (ask first)
- ❌ Force push (ask first)
- ❌ Delete databases (ask first)
```

**10. Directory-Specific CLAUDE.md Files** (5-10 lines)
```markdown
## Specialized Context

When working in specific directories, refer to their CLAUDE.md:
- Frontend work: [apps/web/CLAUDE.md](apps/web/CLAUDE.md)
- API development: [apps/api/CLAUDE.md](apps/api/CLAUDE.md)
- UI components: [packages/ui/CLAUDE.md](packages/ui/CLAUDE.md)
- Testing: [tests/CLAUDE.md](tests/CLAUDE.md)

These files provide detailed, context-specific guidance.
```

---

### Phase 3: Generate Subdirectory CLAUDE.md Files

For EACH major package/directory, create a **detailed CLAUDE.md** (100-200 lines each):

#### Template Structure:

**1. Package Identity** (5 lines)
```markdown
# [Package Name] - [Purpose]

**Technology**: [Framework/language specific to this package]
**Entry Point**: [Main file]
**Parent Context**: This extends [../CLAUDE.md](../CLAUDE.md)
```

**2. Setup & Commands** (10-15 lines)
```markdown
## Development Commands

### This Package
```bash
# From package directory
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm test         # Run tests
pnpm test:watch   # Watch mode
pnpm typecheck    # Type checking
pnpm lint         # Lint code
```

### From Root
```bash
pnpm --filter @repo/package-name dev
pnpm --filter @repo/package-name test
```

### Pre-PR Checklist
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
```

**3. Architecture & Patterns** (20-40 lines) **MOST IMPORTANT**
```markdown
## Architecture

### Directory Structure
```
src/
├── components/        # React components
│   ├── forms/        # Form components
│   ├── layout/       # Layout components
│   └── shared/       # Shared/common components
├── hooks/            # Custom React hooks
├── lib/              # Utilities and helpers
├── types/            # TypeScript definitions
└── styles/           # Global styles
```

### Code Organization Patterns

#### Components
- ✅ **DO**: Functional components with hooks
  - Example: `src/components/Button/Button.tsx`
  - Pattern: One component per file
  - Co-locate tests: `Button.test.tsx`
  
- ❌ **DON'T**: Class components
  - Legacy example: `src/legacy/OldButton.tsx` (avoid this pattern)

#### State Management
- ✅ Use Zustand for global state
  - Example store: `src/stores/userStore.ts`
  - Pattern: Create stores in `src/stores/`
  - Hook pattern: `const user = useUserStore()`

#### Data Fetching
- ✅ Use TanStack Query (React Query)
  - Example: `src/hooks/useUsers.ts`
  - Pattern: Custom hooks for queries
  - Mutations in same hook file

#### Styling
- ✅ Tailwind utility classes only
- ✅ Use design tokens from `src/styles/tokens.ts`
- ❌ **NEVER** hardcode colors, use tokens:
  ```tsx
  // ❌ DON'T
  <div className="bg-blue-500">
  
  // ✅ DO
  <div className="bg-primary">
  ```

#### Forms
- ✅ Use React Hook Form + Zod validation
  - Example: `src/components/forms/LoginForm.tsx`
  - Schema pattern: `src/schemas/loginSchema.ts`
```

**4. Key Files & Touch Points** (10-15 lines)
```markdown
## Key Files

### Core Files (understand these first)
- `src/app/layout.tsx` - Root layout, providers
- `src/lib/api/client.ts` - API client configuration
- `src/types/index.ts` - Shared TypeScript types
- `src/styles/tokens.ts` - Design system tokens

### Authentication
- `src/auth/provider.tsx` - Auth context provider
- `src/middleware/auth.ts` - Auth middleware
- `src/hooks/useAuth.ts` - Auth hook

### Common Patterns
- API calls: See `src/hooks/useUsers.ts` for pattern
- Forms: Copy `src/components/forms/ContactForm.tsx`
- Tables: Copy `src/components/tables/UserTable.tsx`
```

**5. JIT Search Hints** (10-15 lines)
```markdown
## Quick Search Commands

### Find Components
```bash
# Find component definition
rg -n "^export (function|const) .*Component" src/components

# Find component usage
rg -n "<ComponentName" src/

# Find props interface
rg -n "interface.*Props" src/components
```

### Find Hooks
```bash
# Custom hooks
rg -n "export const use[A-Z]" src/hooks

# Hook usage
rg -n "use[A-Z].*=" src/
```

### Find Routes (Next.js App Router)
```bash
# Find route handlers
rg -n "export async function (GET|POST|PUT|DELETE)" src/app

# Find page components
find src/app -name "page.tsx"
```

### Find Styles
```bash
# Find Tailwind usage
rg -n "className=" src/ | grep -E "(bg-|text-|border-)"

# Find inline styles (should be rare)
rg -n "style=" src/
```
```

**6. Common Gotchas** (5-10 lines)
```markdown
## Common Gotchas

- **Environment Variables**: Client-side vars need `NEXT_PUBLIC_` prefix
- **Absolute Imports**: Always use `@/` prefix for imports from `src/`
- **Server Components**: Default in Next.js 13+, add `"use client"` only when needed
- **Dynamic Routes**: Params are async in Next.js 15+
- **Database Queries**: Always use transactions for multi-step operations
- **File Uploads**: Max 10MB, check size before processing
```

**7. Package-Specific Testing** (10-15 lines)
```markdown
## Testing Guidelines

### Unit Tests
- Location: Colocated with source (`Component.test.tsx`)
- Framework: Vitest + Testing Library
- Pattern: Test user behavior, not implementation
- Example: See `src/components/Button/Button.test.tsx`

### Integration Tests
- Location: `tests/integration/`
- Test API integration, database operations
- Use test database: `TEST_DATABASE_URL`

### E2E Tests  
- Location: `tests/e2e/`
- Framework: Playwright
- Run before major releases

### Running Tests
```bash
# Run all tests
pnpm test

# Run specific file
pnpm test src/components/Button/Button.test.tsx

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```
```

**8. Pre-PR Validation** (3-5 lines)
```markdown
## Pre-PR Checklist

Run this command before creating a PR:
```bash
pnpm --filter @repo/package typecheck && \
pnpm --filter @repo/package lint && \
pnpm --filter @repo/package test && \
pnpm --filter @repo/package build
```

All checks must pass + manual testing complete.
```

---

### Phase 4: Generate Claude Code-Specific Configuration

**1. Hooks Configuration** (`.claude/settings.json`)
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Editing: $CLAUDE_FILE_PATHS'"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command", 
            "command": "if [[ \"$CLAUDE_TOOL_INPUT\" == *\"rm -rf\"* ]]; then echo 'BLOCKED: Dangerous command' && exit 2; fi"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "if [[ \"$CLAUDE_FILE_PATHS\" =~ \\.(ts|tsx)$ ]]; then prettier --write \"$CLAUDE_FILE_PATHS\" 2>/dev/null || true; fi"
          }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "if [[ \"$CLAUDE_FILE_PATHS\" =~ \\.test\\.(ts|tsx)$ ]]; then pnpm test \"$CLAUDE_FILE_PATHS\" 2>/dev/null || true; fi"
          }
        ]
      }
    ]
  }
}
```

**2. Custom Slash Commands** (`.claude/commands/`)

Create these command files:

**`.claude/commands/review.md`**
```markdown
Perform a comprehensive code review of recent changes:

1. Check code follows our TypeScript and React conventions from CLAUDE.md
2. Verify proper error handling and loading states
3. Ensure accessibility standards are met (ARIA labels, keyboard nav)
4. Review test coverage for new functionality
5. Check for security vulnerabilities (XSS, SQL injection, auth bypasses)
6. Validate performance implications (bundle size, render cycles)
7. Confirm documentation is updated

Provide specific, actionable feedback with file/line references.
```

**`.claude/commands/fix-issue.md`**
```markdown
Analyze and fix GitHub issue: $ARGUMENTS

Steps:
1. Use `gh issue view $ARGUMENTS` to get issue details
2. Understand the problem and requirements
3. Search codebase for relevant files using `rg`
4. Read CLAUDE.md in relevant directories for patterns
5. Implement fix following established patterns
6. Write/update tests to verify fix
7. Run type checking and linting
8. Create descriptive commit message
9. Push and create PR with `gh pr create`

Remember to follow our testing and code quality standards.
```

**`.claude/commands/migrate-db.md`**
```markdown
Create a database migration: $ARGUMENTS

1. Create migration file: `pnpm db:migration:create "$ARGUMENTS"`
2. Write migration up/down in generated file
3. Review migration for safety (no data loss)
4. Test migration: `pnpm db:migrate`
5. Verify schema changes: `pnpm db:schema:inspect`
6. Run tests to ensure compatibility
7. Document breaking changes if any
8. Commit migration file

CRITICAL: Never run migrations on production without approval.
```

**3. MCP Server Recommendations**

Based on the project, recommend MCP servers:

```markdown
## Recommended MCP Servers

### For This Project
```bash
# GitHub integration (issues, PRs, repos)
claude mcp add --scope user github -- npx -y @modelcontextprotocol/server-github

# Web search and documentation
claude mcp add --scope user context7 -- npx -y context7-mcp

# Sequential thinking for complex decisions
claude mcp add --scope user sequential-thinking -- npx -y @modelcontextprotocol/server-sequential-thinking
```

### Project-Specific `.mcp.json`
Create this file in project root (commit to git):
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```
```

**4. Subagent Recommendations** (if applicable)

```markdown
## Suggested Subagents

### Testing Agent (`.claude/agents/tester.json`)
- **Purpose**: Run and debug tests
- **Tools**: Read, Bash (test commands only)
- **System Prompt**: Focused on test-driven development

### Review Agent (`.claude/agents/reviewer.json`)
- **Purpose**: Code review and quality checks
- **Tools**: Read, Grep
- **System Prompt**: Security, performance, best practices focus

### Docs Agent (`.claude/agents/docs.json`)
- **Purpose**: Generate and update documentation
- **Tools**: Read, Write (docs only)
- **System Prompt**: Clear, concise technical writing
```

---

## Output Format

Provide files in this order:

1. **Analysis Summary** (Phase 1)
2. **Root CLAUDE.md** (complete file)
3. **Hooks Configuration** (`.claude/settings.json`)
4. **Custom Commands** (each `.claude/commands/*.md` file)
5. **Each Subdirectory CLAUDE.md** (with full path)
6. **MCP Setup Guide** (commands to run)
7. **Optional: Subagent Configurations**

Format each file like:
```
---
File: `CLAUDE.md` (root)
Purpose: Universal project rules and navigation
---
[full content]

---
File: `apps/web/CLAUDE.md`
Purpose: Next.js-specific development guidance
---
[full content]

---
File: `.claude/settings.json`
Purpose: Hooks configuration for automation
---
[full content]
```

---

## Quality Checklist

Before finalizing, verify:

- [ ] Root CLAUDE.md under 400 lines
- [ ] All subdirectory CLAUDE.md files link back to root
- [ ] Every "✅ DO" has a real file example with path
- [ ] Every "❌ DON'T" references actual anti-pattern
- [ ] Commands are copy-paste ready (no placeholders)
- [ ] Hooks target specific patterns (not overly broad)
- [ ] Custom commands use `$ARGUMENTS` correctly
- [ ] JIT search commands use actual file patterns
- [ ] Security rules clearly stated
- [ ] Tool permissions explicitly defined
- [ ] MCP servers appropriate for project needs
- [ ] No duplication between hierarchy levels

---

## Claude Code-Specific Best Practices

**Memory System**:
- Use `#` during sessions to add memories organically
- Review and refactor CLAUDE.md monthly
- Keep sections modular to prevent instruction bleeding

**Hooks Strategy**:
- PreToolUse: Validation and safety checks
- PostToolUse: Formatting, linting, auto-testing
- Start conservative, expand based on needs

**Context Management**:
- Use `/clear` between unrelated tasks
- Use `/compact` for long sessions
- Reference specific files with `@` rather than reading entire directories

**Custom Commands**:
- Start with 3-5 most common workflows
- Use descriptive names (e.g., `/fix-issue`, not `/fi`)
- Include validation steps in commands

---

## Start Here

Begin by analyzing the codebase and presenting **Phase 1 (Repository Analysis)** as a structured map.

Ask clarifying questions about:
- Which workflows should be automated with hooks?
- What external tools need MCP integration?
- Any specific security concerns or dangerous operations?
- Team preferences for testing, linting, formatting?
- Are there legacy patterns that should be explicitly warned against?
- What are the most common repetitive tasks?

Let's build a comprehensive, Claude Code-optimized CLAUDE.md hierarchy together.