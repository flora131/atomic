---
description: Prepare summary of current state of work completed in preparation for hand off or continuation inside a new session.
agent: build
model: anthropic/claude-sonnet-4-5
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
- DO: `src/components/Button.tsx:42-58` (validation logic)
- DON'T: Full 50-line code block

Only include code snippets when:
- Showing a specific bug or error
- The exact syntax is critical and non-obvious
- It's a pattern that must be replicated exactly

## Important Notes

- **Thoroughness over brevity**: When in doubt, include more context
- **Precision in file references**: Always include line numbers for specific code
- **Explicit next steps**: The next agent should know exactly where to start
- **Preserve the "why"**: Decisions without rationale are easy to accidentally undo
- **No assumptions**: State things explicitly even if they seem obvious
