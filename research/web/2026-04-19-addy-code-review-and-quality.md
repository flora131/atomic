---
source_url: https://raw.githubusercontent.com/addyosmani/agent-skills/44dac80216da709913fb410f632a65547866346f/skills/code-review-and-quality/SKILL.md
fetched_at: 2026-04-19
fetch_method: markdown-accept-header
topic: Code Review and Quality skill from addyosmani/agent-skills
---

# code-review-and-quality SKILL.md (verbatim)

---
name: code-review-and-quality
description: Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch.
---

## When to Use
- Before merging any PR or change
- After completing a feature implementation
- When another agent or model produced code to evaluate
- When refactoring existing code
- After any bug fix (review fix and regression test)

## Five-Axis Review
1. Correctness — spec match, edge cases, error paths, test accuracy
2. Readability & Simplicity — naming, control flow, line count, abstractions
3. Architecture — patterns, module boundaries, duplication, dependency direction
4. Security — input validation, secrets, auth/authz, injection, external data treated as untrusted
5. Performance — N+1 queries, unbounded loops, async, re-renders, pagination

## Step-by-Step Process
- Step 1: Understand the Context
- Step 2: Review the Tests First
- Step 3: Review the Implementation (five axes)
- Step 4: Categorize Findings (severity labels)
- Step 5: Verify the Verification

## Artifacts Produced
- Annotated review with labeled findings per severity
- Review checklist (completed markdown)
- Dead code inventory (with ask-before-delete prompt)
- Verification story (what changed, how verified)

## Human-in-the-Loop / Developer Approval Gates

### Severity Labels (verbatim)
| Prefix | Meaning | Author Action |
|--------|---------|---------------|
| *(no prefix)* | Required change | Must address before merge |
| **Critical:** | Blocks merge | Security vulnerability, data loss, broken functionality |
| **Nit:** | Minor, optional | Author may ignore — formatting, style preferences |
| **Optional:** / **Consider:** | Suggestion | Worth considering but not required |
| **FYI** | Informational only | No action needed — context for future reference |

### When Developer Must Approve
- All Critical issues must be resolved before merge.
- All Important (unlabeled required) issues must be resolved or explicitly deferred with justification.
- Dead code: agent must ASK before deleting ("Should I remove these now-unused elements: [list]?").
- Multi-model review pattern: "Human makes the final call" after Model A writes and Model B reviews.
- Do not accept "I'll clean it up later" — require cleanup before submission unless genuine emergency.

## Exit Criteria / Verification Checklist
- [ ] All Critical issues resolved
- [ ] All Important issues resolved or explicitly deferred with justification
- [ ] Tests pass
- [ ] Build succeeds
- [ ] Verification story documented

## Cross-References / Supporting Files
- `references/security-checklist.md` (for detailed security review)
- `references/performance-checklist.md` (for performance review checks)
- Cross-references to `security-and-hardening` and `performance-optimization` skills
- No additional files in this skill directory (SKILL.md only).
