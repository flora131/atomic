# Task: Analyze this codebase and generate a hierarchical AGENTS.md system

1. **Strict Instruction Hierarchy**: AGENTS.md content is treated as **immutable system rules** with strict priority over user prompts
2. **Hierarchical Memory System**: Reads AGENTS.md files recursively UP from CWD to root, AND discovers them in subdirectories

## Core Principles

1. **AGENTS.md is AUTHORITATIVE** - Treated as system rules, not suggestions
2. **Modular Sections** - Use clear markdown headers to prevent instruction bleeding
3. **Front-load Critical Context** - Large AGENTS.md files provide better instruction adherence
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

**2. Directory Structure for AGENTS.md Files**
Map where AGENTS.md files should exist:
```
root/AGENTS.md                    # Universal project rules
apps/web/AGENTS.md               # Next.js-specific guidance
apps/api/AGENTS.md               # API-specific patterns
services/auth/AGENTS.md          # Auth service specifics
packages/ui/AGENTS.md            # UI library patterns
tests/AGENTS.md                  # Testing-specific rules
```

**3. Dangerous Patterns to Block**
- Files that should never be edited (.env, secrets, prod configs)
- Anti-patterns to warn against

Present this analysis as a **structured map** before generating any files.

---

### Phase 2: Generate Root AGENTS.md

Create a **comprehensive root AGENTS.md** (~200-400 lines) that serves as the constitution:

#### Required Sections:

**1. Project Identity** (5-10 lines)
```markdown
# [Project Name]

## Overview
- **Type**: [Monorepo/Standard project]
- **Stack**: [Primary technologies]
- **Architecture**: [Brief architectural summary]
- **Team Size**: [If relevant]

This AGENTS.md is the authoritative source for development guidelines. 
Subdirectories contain specialized AGENTS.md files that extend these rules.
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
- `bun dev` - Start all development servers
- `bun build` - Build all packages
- `bun test` - Run all tests
- `bun typecheck` - TypeScript validation across project
- `bun lint` - ESLint all code
- `bun lint:fix` - Auto-fix linting issues

### Package-Specific
- `bun --filter @repo/web [command]` - Run command in web package
- `bun --filter @repo/api [command]` - Run command in API package

### Quality Gates (run before PR)
```bash
bun typecheck && bun lint && bun test
```
```

**4. Project Structure Map** (15-30 lines)
```markdown
## Project Structure

### Applications
- **`apps/web/`** → Next.js frontend ([see apps/web/AGENTS.md](apps/web/AGENTS.md))
  - Routes: `app/` directory (App Router)
  - Components: `src/components/`
  - Hooks: `src/hooks/`
  
- **`apps/api/`** → Express API ([see apps/api/AGENTS.md](apps/api/AGENTS.md))
  - Routes: `src/routes/`
  - Middleware: `src/middleware/`
  - Models: `src/models/`

### Packages
- **`packages/ui/`** → Shared UI components ([see packages/ui/AGENTS.md](packages/ui/AGENTS.md))
- **`packages/shared/`** → Shared utilities and types

### Infrastructure
- **`services/auth/`** → Authentication service ([see services/auth/AGENTS.md](services/auth/AGENTS.md))
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
bun why <package-name>

# Find unused dependencies
bunx depcheck
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
- Rebase preferred for local development
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

**9. Directory-Specific AGENTS.md Files** (5-10 lines)
```markdown
## Specialized Context

When working in specific directories, refer to their AGENTS.md:
- Frontend work: [apps/web/AGENTS.md](apps/web/AGENTS.md)
- API development: [apps/api/AGENTS.md](apps/api/AGENTS.md)
- UI components: [packages/ui/AGENTS.md](packages/ui/AGENTS.md)
- Testing: [tests/AGENTS.md](tests/AGENTS.md)

These files provide detailed, context-specific guidance.
```

---

### Phase 3: Generate Subdirectory AGENTS.md Files

For EACH major package/directory, create a **detailed AGENTS.md** (100-200 lines each):

#### Template Structure:

**1. Package Identity** (5 lines)
```markdown
# [Package Name] - [Purpose]

**Technology**: [Framework/language specific to this package]
**Entry Point**: [Main file]
**Parent Context**: This extends [../AGENTS.md](../AGENTS.md)
```

**2. Setup & Commands** (10-15 lines)
```markdown
## Development Commands

### This Package
```bash
# From package directory
bun dev          # Start dev server
bun build        # Build for production
bun test         # Run tests
bun test:watch   # Watch mode
bun typecheck    # Type checking
bun lint         # Lint code
```

### From Root
```bash
bun --filter @repo/package-name dev
bun --filter @repo/package-name test
```

### Pre-PR Checklist
```bash
bun typecheck && bun lint && bun test && bun build
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
bun test

# Run specific file
bun test src/components/Button/Button.test.tsx

# Watch mode
bun test:watch

# Coverage
bun test:coverage
```
```

**8. Pre-PR Validation** (3-5 lines)
```markdown
## Pre-PR Checklist

Run this command before creating a PR:
```bash
bun --filter @repo/package typecheck && \
bun --filter @repo/package lint && \
bun --filter @repo/package test && \
bun --filter @repo/package build
```

All checks must pass + manual testing complete.
```

---

## Output Format

Provide files in this order:

1. **Analysis Summary** (Phase 1)
2. **Root AGENTS.md** (complete file)
3. **Each Subdirectory AGENTS.md** (with full path)

Format each file like:
```
---
File: `AGENTS.md` (root)
Purpose: Universal project rules and navigation
---
[full content]

---
File: `apps/web/AGENTS.md`
Purpose: Next.js-specific development guidance
---
[full content]
```

---

## Quality Checklist

Before finalizing, verify:

- [ ] Root AGENTS.md under 400 lines
- [ ] All subdirectory AGENTS.md files link back to root
- [ ] Every "✅ DO" has a real file example with path
- [ ] Every "❌ DON'T" references actual anti-pattern
- [ ] Commands are copy-paste ready (no placeholders)
- [ ] Hooks target specific patterns (not overly broad)
- [ ] JIT search commands use actual file patterns
- [ ] Security rules clearly stated
- [ ] No duplication between hierarchy levels

---

## Best Practices

**Memory System**:
- Use `#` during sessions to add memories organically
- Review and refactor AGENTS.md frequently
- Keep sections modular to prevent instruction bleeding

**Context Management**:
- Reference specific files rather than reading entire directories

---

## Start Here

Begin by analyzing the codebase and presenting **Phase 1 (Repository Analysis)** as a structured map.

Ask clarifying questions about:
- Which workflows should be automated with hooks?
- Team preferences for testing, linting, formatting?
- Are there legacy patterns that should be explicitly warned against?
- What are the most common repetitive tasks?

Let's build a comprehensive, optimized AGENTS.md hierarchy together.