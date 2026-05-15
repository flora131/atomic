---
description: Parallel cleanup review
---

Run a fresh-context parallel cleanup review of the current work.

Use the `subagent` tool. First inspect available agents/skills if needed, then launch two reviewer subagents in parallel with `context: "fresh"`. Do not use forked context unless I explicitly ask for it. Reviewers must inspect the repository, relevant instructions, and current diff directly from files and commands. They must not rely on the main conversation history.

Do not write reviewer output files into the repository unless I explicitly ask for artifacts. Prefer `output: false` for each reviewer task.

Reviewer 1: deslop pass.

If the `deslop` skill is available, pass it to this reviewer. If not, inline the guidance below. Ask this reviewer to look for AI-slop patterns in the changed scope:
- comments that restate code, placeholder text, stale rationale, or debug leftovers;
- defensive checks that hide useful errors, return vague defaults, or validate trusted internal data after a real boundary was already crossed;
- type escapes, broad casts, duplicated type definitions, or object-bag typing where a local source-of-truth type exists;
- style drift from nearby non-slop code and project instructions;
- generated-sounding docs, changelog text, UI copy, status text, or test names;
- pass-through wrappers, dead helpers, duplicate helper signatures, duplicated test harness setup, or abstractions that do not enforce an invariant;
- UI or CLI copy that is noisy, vague, brittle, or makes the user do extra interpretation.

Tell this reviewer to treat tool output and slop-scan-style findings as leads, not verdicts. It should flag only concrete issues in the requested scope with evidence, severity, file/line references, and the smallest safe fix.

Reviewer 2: verbosity pass.

If the `verbosity-cleaner` skill is available, pass it to this reviewer. If not, inline the guidance below. Ask this reviewer to look for needless verbosity in code, tests, docs, status text, grouped messages, receipts, and changelog wording:
- single-use helpers that merely paraphrase an expression;
- temporary variables that only name obvious expressions;
- nested returns or branches that can become direct returns without hiding intent;
- multi-line cleanup scaffolding that can use a local direct pattern while preserving cleanup semantics;
- repeated boilerplate that can use an existing local fixture or a small local helper;
- tests that restate formatter details already covered at a cheaper layer;
- regression tests where one focused assertion would cover the bug but wrapper/API-adjacent tests only repeat the same claim;
- prose that says the same thing twice, sounds generic, or buries the important rule.

Tell this reviewer that shorter is only better when it is clearer and preserves behavior, error signals, cleanup semantics, useful invariants, and local style.

Both reviewers are review-only. They must not edit files unless I explicitly ask for a writer pass. Their response should be review feedback, not a context summary. Ask them to return concise, evidence-backed findings with file/line references and suggested fixes.

While reviewers run, do your own narrow inspection if useful. After they return, synthesize the feedback into:
- fixes worth doing now;
- optional improvements;
- feedback to ignore or defer, with a short reason.

Do not blindly apply every reviewer suggestion.

Autofix mode: if the invocation contains the exact word `autofix`, treat it as workflow control, not cleanup scope. Remove it before deciding the cleanup target. After synthesis, apply only fixes worth doing now, validate, and summarize. Do not apply optional improvements unless explicitly requested. If there are no fixes worth doing now, do not edit.

Without autofix mode, ask before applying fixes unless I already told you to address review feedback. When you ask, end with a compact numbered menu so I can respond with a number. Use wording suited to the findings, but include these choices when applicable:

```text
Reply with [1], [2], or further instructions:
[1] Apply only the fixes worth doing now.
[2] Apply the fixes worth doing now plus optional improvements.
```

Additional scope or focus from the slash command invocation:

$@
