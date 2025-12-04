---
description: Prepare summary of current state of work completed in preparation for hand off or continuation inside a new session
model: sonnet
allowed-tools: Bash(git:*), Bash(gh:*), Bash(date:*), Glob, Grep, NotebookRead, Read, Write, Edit
---

# Context Compaction & Handoff

Create a high-fidelity summary of the current session for continuation in a new context window.

## Current Session Context

- Current date/time: !`date "+%Y-%m-%d %H:%M:%S %Z"`
- Git branch: !`git branch --show-current`
- Git commit: !`git rev-parse --short HEAD`
- Recent commits: !`git log --oneline -5`
- Modified files: !`git status --porcelain`

## What This Command Does

1. Analyzes the entire conversation chronologically
2. Identifies critical context that must be preserved
3. Discards redundant information (old tool outputs, superseded attempts)
4. Creates a structured handoff document
5. Updates `progress.txt` with a summary of current state

## Analysis Process

Before creating the summary, wrap your analysis in `<analysis>` tags:

1. **Chronological Review**: Walk through each message identifying:
   - User's explicit requests and intents
   - Your approach to addressing requests
   - Key decisions and technical patterns
   - Specific files, code snippets, function signatures

2. **Criticality Assessment**: For each piece of information, ask:
   - Would losing this cause the next agent to make wrong decisions?
   - Is this an architectural decision or just implementation detail?
   - Has this been superseded by later work?

3. **Compression Strategy**:
   - KEEP: Architectural decisions, unresolved bugs, implementation patterns, file paths, summary of failed attempts that led nowhere to not repeat
   - DISCARD: Redundant tool outputs, verbose logs
   - REFERENCE: Use `file:line` syntax instead of full code blocks

## Output Document Structure

Update `progress.txt` with a structured summary like this:

```markdown
---
date: [ISO 8601 datetime with timezone]
git_commit: [Current commit hash]
branch: [Current branch name]
status: [complete | in_progress]
type: handoff
---

# Handoff: {Concise Description}

## 1. Primary Request and Intent
[Detailed description of what the user explicitly asked for]

## 2. Key Technical Concepts
- [Technology/framework 1]
- [Pattern/approach 1]
- [Important constraint 1]

## 3. Files and Code Sections
- `path/to/file.ts:12-45`
  - Why important: [brief explanation]
  - Changes made: [summary, not full diff]
- `path/to/another.ts`
  - Why important: [brief explanation]

## 4. Problem Solving
- Solved: [Problem and solution summary]
- Ongoing: [Current troubleshooting state]
- Root causes discovered: [Important learnings]

## 5. Pending Tasks
- [ ] Task 1 (status: not started | in progress | blocked)
- [ ] Task 2

## 6. Current Work
[Precise description of what was being worked on immediately before compaction]

Most recent file: `path/to/file.ts`
Most recent action: [what you were doing]

## 7. Next Step
[Single, concrete next action - only if directly in line with user's request]

## 8. Verbatim Context
> [Direct quote from recent conversation showing exact task and where you left off]

## 9. Anti-Context (What NOT to Do)
- [Approaches that were tried and failed]
- [Patterns to avoid based on learnings]

---

## For Next Agent: Resumption Protocol

**Before writing any code, you MUST:**

1. Read these files to verify current state (don't trust this summary):
   - `[most critical file 1]`
   - `[most critical file 2]`
2. Run: `git log --oneline -3` to confirm you're at or ahead of commit `[hash]`
3. Your first action should be: [single concrete step]

**Traps to avoid:**
- [Specific mistake that's easy to make given this context]
- [Rejected approach that might seem reasonable]
```

## Best Practices

### What to Preserve (High Recall)
- **Architectural decisions**: "We chose X over Y because..."
- **File relationships**: "Component A depends on B for..."
- **Unresolved issues**: Any bugs, edge cases, or concerns raised
- **User preferences**: Explicit style/approach preferences stated
- **Critical file paths**: Files that were created, modified, or are central to the work
- **Error patterns**: Errors encountered and their resolutions

### What to Discard (Precision)
- **Raw tool outputs**: Once processed, the raw output isn't needed
- **Superseded attempts**: Failed approaches that don't inform future work
- **Verbose logs**: Summarize instead of copying
- **Duplicate information**: If mentioned multiple times, keep the most recent/complete version
- **Exploratory reads**: Files read but found irrelevant

### Reference Format
Prefer concise references over code blocks:
- ✅ DO: `src/components/Button.tsx:42-58` (validation logic)
- ❌ DON'T: Full 50-line code block

Only include code snippets when:
- Showing a specific bug or error
- The exact syntax is critical and non-obvious
- It's a pattern that must be replicated exactly

## Example Handoff

```markdown
---
date: 2025-01-15T14:30:00-08:00
git_commit: abc1234
branch: feature/auth-refactor
status: in_progress
type: handoff
---

# Handoff: OAuth2 Integration with Role-Based Access

## 1. Primary Request and Intent
User requested implementing OAuth2 authentication with Google/GitHub providers,
including role-based access control (admin, user, guest) with JWT tokens.

## 2. Key Technical Concepts
- OAuth2 PKCE flow for SPA security
- JWT with RS256 signing
- Role hierarchy: admin > user > guest
- Middleware pattern for route protection

## 3. Files and Code Sections
- `src/auth/providers/oauth.ts:15-89`
  - Why: Core OAuth flow implementation
  - Changes: Added PKCE challenge generation
- `src/middleware/auth.ts:1-45`
  - Why: Route protection middleware
  - Changes: Created from scratch
- `prisma/schema.prisma:23-35`
  - Why: User model with roles enum

## 4. Problem Solving
- Solved: CORS issue with OAuth callback (added origin to allowed list)
- Ongoing: Token refresh race condition when multiple tabs open
- Root cause: Was using symmetric signing (HS256) which doesn't work with JWKS

## 5. Pending Tasks
- [ ] Implement token refresh logic (in progress)
- [ ] Add rate limiting to auth endpoints
- [ ] Write integration tests for OAuth flow

## 6. Current Work
Implementing automatic token refresh. Last working on
`src/auth/refresh.ts` adding logic to handle concurrent refresh requests.

## 7. Next Step
Complete the mutex-based refresh lock in `src/auth/refresh.ts:34`

## 8. Verbatim Context
> "The refresh token should use a mutex pattern to prevent race conditions
> when multiple tabs try to refresh simultaneously"

## 9. Anti-Context
- Don't use localStorage for tokens (security risk, discussed and rejected)
- Don't implement custom session management (use existing Prisma sessions)

---

## For Next Agent: Resumption Protocol

**Before writing any code, you MUST:**

1. Read these files to verify current state (don't trust this summary):
   - `src/auth/refresh.ts` - may have partial mutex implementation
   - `src/auth/providers/oauth.ts` - verify PKCE is working
2. Run: `git log --oneline -3` to confirm you're at or ahead of commit `abc1234`
3. Your first action should be: Complete the mutex lock at `src/auth/refresh.ts:34`

**Traps to avoid:**
- Don't refactor to use HS256 signing (seems simpler but breaks JWKS)
- Don't add token storage to localStorage (security issue, already rejected)
```

## Important Notes

- **Thoroughness over brevity**: When in doubt, include more context
- **Precision in file references**: Always include line numbers for specific code
- **Explicit next steps**: The next agent should know exactly where to start
- **Preserve the "why"**: Decisions without rationale are easy to accidentally undo
- **No assumptions**: State things explicitly even if they seem obvious