# Task: Analyze this codebase and generate a hierarchical CLAUDE.md structure

## Context & Principles

You are going to help me create a **hierarchical CLAUDE.md system** for this codebase. This is critical for AI coding agents to work efficiently with minimal token usage.

### Core Principles:
1. **Root CLAUDE.md is LIGHTWEIGHT** - Only universal guidance, links to sub-files
2. **Nearest-wins hierarchy** - Agents read the closest CLAUDE.md to the file being edited
3. **JIT (Just-In-Time) indexing** - Provide paths/globs/commands, NOT full content
4. **Token efficiency** - Small, actionable guidance over encyclopedic documentation
5. **Sub-folder CLAUDE.md files have MORE detail** - Specific patterns, examples, commands

## Your Process

### Phase 1: Repository Analysis
First, analyze the codebase structure and provide me with:

1. **Repository type**: Monorepo, multi-package, or simple single project?
2. **Primary technology stack**: Languages, frameworks, key tools
3. **Major directories/packages** that should have their own CLAUDE.md:
   - Apps (e.g., `apps/web`, `apps/api`, `apps/mobile`)
   - Services (e.g., `services/auth`, `services/transcribe`)
   - Packages/libs (e.g., `packages/ui`, `packages/shared`)
   - Workers/jobs (e.g., `workers/queue`, `workers/cron`)
   
4. **Build system**: pnpm/npm/yarn workspaces? Turborepo? Lerna? Or simple?
5. **Testing setup**: Jest, Vitest, Playwright, pytest? Where are tests?
6. **Key patterns to document**:
   - Code organization patterns
   - Important conventions (naming, styling, commits)
   - Critical files that serve as good examples
   - Anti-patterns to avoid

Present this as a **structured map** before generating any CLAUDE.md files.

---

### Phase 2: Generate Root CLAUDE.md

Create a **lightweight root CLAUDE.md** (~100-200 lines max) that includes:

#### Required Sections:

**1. Project Snapshot** (3-5 lines)
- Repo type (monorepo/simple)
- Primary tech stack
- Note that sub-packages have their own CLAUDE.md files

**2. Root Setup Commands** (5-10 lines)
- Install dependencies (root level)
- Build all
- Typecheck all  
- Test all

**3. Universal Conventions** (5-10 lines)
- Code style (TypeScript strict? Prettier? ESLint?)
- Commit format (Conventional Commits?)
- Branch strategy
- PR requirements

**4. Security & Secrets** (3-5 lines)
- Never commit tokens
- Where secrets go (.env patterns)
- PII handling if applicable

**5. JIT Index - Directory Map** (10-20 lines)
Structure like:
```
## JIT Index (what to open, not what to paste)

### Package Structure
- Web UI: `apps/web/` → [see apps/web/CLAUDE.md](apps/web/CLAUDE.md)
- API: `apps/api/` → [see apps/api/CLAUDE.md](apps/api/CLAUDE.md)
- Auth service: `services/auth/` → [see services/auth/CLAUDE.md](services/auth/CLAUDE.md)
- Shared packages: `packages/**/` → [see packages/README.md for details]

### Quick Find Commands
- Search for a function: `rg -n "functionName" apps/** packages/**`
- Find a component: `rg -n "export.*ComponentName" apps/web/src`
- Find API routes: `rg -n "export const (GET|POST)" apps/api`
```

**6. Definition of Done** (3-5 lines)
- What must pass before a PR is ready
- Minimal checklist

---

### Phase 3: Generate Sub-Folder CLAUDE.md Files

For EACH major package/directory identified in Phase 1, create a **detailed CLAUDE.md** that includes:

#### Required Sections:

**1. Package Identity** (2-3 lines)
- What this package/app/service does
- Primary tech/framework for THIS package

**2. Setup & Run** (5-10 lines)
- Install command (if different from root)
- Dev server command
- Build command
- Test command
- Lint/typecheck commands

**3. Patterns & Conventions** (10-20 lines)
**THIS IS THE MOST IMPORTANT SECTION**
- File organization rules (where things go)
- Naming conventions specific to this package
- Preferred patterns with **file examples**:
  ```
  - ✅ DO: Use functional components like `src/components/Button.tsx`
  - ❌ DON'T: Use class components like `src/legacy/OldButton.tsx`
  - ✅ Forms: Copy pattern from `src/components/forms/ContactForm.tsx`
  - ✅ API calls: Use `src/lib/api/client.ts` wrapper, see example in `src/hooks/useUser.ts`
  ```

**4. Touch Points / Key Files** (5-10 lines)
Point to the most important files to understand this package:
```
- Auth logic: `src/auth/provider.tsx`
- API client: `src/lib/api.ts`  
- Types: `src/types/index.ts`
- Config: `src/config.ts`
```

**5. JIT Index Hints** (5-10 lines)
Specific search commands for this package:
```
- Find a React component: `rg -n "export function .*" src/components`
- Find a hook: `rg -n "export const use" src/hooks`
- Find route handlers: `rg -n "export async function (GET|POST)" src/app`
- Find tests: `find . -name "*.test.ts"`
```

**6. Common Gotchas** (3-5 lines, if applicable)
- "Auth requires `NEXT_PUBLIC_` prefix for client-side use"
- "Always use `@/` imports for absolute paths"
- "Database migrations must be run before tests: `pnpm db:migrate`"

**7. Pre-PR Checks** (2-3 lines)
Package-specific command to run before creating a PR:
```
pnpm --filter @repo/web typecheck && pnpm --filter @repo/web test && pnpm --filter @repo/web build
```

---

### Phase 4: Special Considerations

For each CLAUDE.md file, also consider:

**A. Design System / UI Package**
If there's a design system or UI library:
```markdown
## Design System
- Components: `packages/ui/src/components/**`
- Use design tokens from `packages/ui/src/tokens.ts` (never hardcode colors)
- See component gallery: `pnpm --filter @repo/ui storybook`
- Examples:
  - Buttons: Copy `packages/ui/src/components/Button/Button.tsx`
  - Forms: Copy `packages/ui/src/components/Input/Input.tsx`
```

**B. Database / Data Layer**
If there's a database service:
```markdown
## Database
- ORM: Prisma / Drizzle / TypeORM
- Schema: `prisma/schema.prisma`
- Migrations: `pnpm db:migrate`
- Seed: `pnpm db:seed`
- **NEVER** run migrations in tests; use `test-db` script
- Connection: via `src/lib/db.ts` singleton
```

**C. API / Backend Service**
```markdown
## API Patterns
- REST routes: `src/routes/**/*.ts`
- Auth middleware: `src/middleware/auth.ts` (apply to protected routes)
- Validation: Use Zod schemas in `src/schemas/**`
- Error handling: All errors thrown as `ApiError` from `src/lib/errors.ts`
- Example endpoint: See `src/routes/users/get.ts` for full pattern
```

**D. Testing Package**
```markdown
## Testing
- Unit tests: `*.test.ts` colocated with source
- Integration tests: `tests/integration/**`
- E2E tests: `tests/e2e/**` (Playwright)
- Run single test: `pnpm test -- path/to/file.test.ts`
- Coverage: `pnpm test:coverage` (aim for >80%)
- Mock external APIs using `src/test/mocks/**`
```

---

## Output Format

Provide the files in this order:

1. **Analysis Summary** (from Phase 1)
2. **Root CLAUDE.md** (complete, ready to copy)
3. **Each Sub-Folder CLAUDE.md** (one at a time, with file path)

For each file, use this format:

```
---
File: `CLAUDE.md` (root)
---
[full content here]

---
File: `apps/web/CLAUDE.md`  
---
[full content here]

---
File: `services/auth/CLAUDE.md`
---
[full content here]
```

---

## Constraints & Quality Checks

Before generating, verify:

- [ ] Root CLAUDE.md is under 200 lines
- [ ] Root links to all sub-CLAUDE.md files
- [ ] Each sub-file has concrete examples (actual file paths)
- [ ] Commands are copy-paste ready (no placeholders unless unavoidable)
- [ ] No duplication between root and sub-files
- [ ] JIT hints use actual patterns from the codebase (ripgrep, find, glob)
- [ ] Every "✅ DO" has a real file example
- [ ] Every "❌ DON'T" references a real anti-pattern or legacy file
- [ ] Pre-PR checks are single copy-paste commands
