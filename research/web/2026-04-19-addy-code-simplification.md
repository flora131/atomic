---
source_url: https://raw.githubusercontent.com/addyosmani/agent-skills/44dac80216da709913fb410f632a65547866346f/skills/code-simplification/SKILL.md
fetched_at: 2026-04-19
fetch_method: markdown-accept-header
topic: Code Simplification skill from addyosmani/agent-skills
---

# code-simplification SKILL.md (verbatim)

---
name: code-simplification
description: Simplifies code for clarity. Use when refactoring code for clarity without changing behavior. Use when code works but is harder to read, maintain, or extend than it should be. Use when reviewing code that has accumulated unnecessary complexity.
---

## When to Use
- After a feature is working and tests pass, but implementation feels heavier than needed
- During code review when readability or complexity issues are flagged
- Deeply nested logic, long functions, or unclear names
- Refactoring code written under time pressure
- Consolidating related logic scattered across files
- After merging changes that introduced duplication
- NOT for: already-clean code; code you don't yet understand; performance-critical paths; code about to be rewritten entirely; mixed with feature work

## Five Principles
1. Preserve Behavior Exactly — same outputs, errors, side effects; all tests pass unmodified
2. Follow Project Conventions — read CLAUDE.md; match neighboring code style
3. Prefer Clarity Over Cleverness — explicit > compact when compact requires a mental pause
4. Maintain Balance — avoid over-inlining, merging unrelated logic, removing useful abstractions
5. Scope to What Changed — default to recently modified code; no drive-by refactors

## Step-by-Step Process
- Step 1: Understand Before Touching (Chesterton's Fence) — answer: responsibility, callers, edge cases, tests, git blame reason
- Step 2: Identify Simplification Opportunities — structural complexity (deep nesting, long functions, nested ternaries, boolean flags, repeated conditionals); naming (generic/abbreviated/misleading names); redundancy (duplicated logic, dead code, unnecessary abstractions)
- Step 3: Apply Changes Incrementally — one simplification at a time; run tests after each; submit refactoring separately from feature/fix; Rule of 500: automate >500 line changes
- Step 4: Verify the Result — compare before/after; ensure diff is clean and reviewable

## Artifacts Produced
- Clean incremental commits (each simplification separate and testable)
- No review report artifact per se — verification is the passing test suite + linter

## Human-in-the-Loop / Developer Approval Gates
- Dead code: do not silently delete uncertain items — ask the developer first.
- Do not broaden scope beyond recently modified code unless explicitly asked.
- Separate refactoring PR from feature/bug PR — this is an implicit approval gate (don't mix).
- If simplified version is harder to understand, revert — no autonomous "improvement" overrides judgment.

## Exit Criteria / Verification Checklist
- [ ] All existing tests pass without modification
- [ ] Build succeeds with no new warnings
- [ ] Linter/formatter passes
- [ ] Each simplification is a reviewable incremental change
- [ ] Diff is clean — no unrelated changes mixed in
- [ ] Simplified code follows project conventions
- [ ] No error handling removed or weakened
- [ ] No dead code left behind (unused imports, unreachable branches)
- [ ] A teammate or review agent would approve as a net improvement

## Cross-References / Supporting Files
- Inspired by the Claude Code Simplifier plugin (anthropics/claude-plugins-official).
- No additional files in this skill directory (SKILL.md only).
