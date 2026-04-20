---
date: 2026-04-19 22:20:00 PDT
researcher: flora131
git_commit: 9a31362884b20d8832d32155043fde303896644c
branch: flora131/feature/add-addy-osmani-harness
repository: atomic-add-addy-osmani-harness
topic: "Addy Osmani agent-skills end-to-end workflow — skill chain, artifacts, and HITL gates"
tags: [research, external, addy-osmani, agent-skills, workflow-creator, skill-chaining, hitl, sdlc, claude-code-plugin]
status: complete
last_updated: 2026-04-19
last_updated_by: flora131
sources:
  repo: https://github.com/addyosmani/agent-skills
  ref: 44dac80216da709913fb410f632a65547866346f
---

# Research — Addy Osmani `agent-skills` Workflow

## Research Question

> We want to create a workflow for Addy Osmani's series of skills that he chains together into the workflow he's created in `https://github.com/addyosmani/agent-skills`. For each of the top-level skills there are skills underneath that power the top-level skill. Do proper research into his exact workflow and how it works and at what parts there may need to be human-in-the-loop gates or review from the developer, etc., and then document his workflow end-to-end. The goal is to have a research document to refer to with this information that we can pass to our workflow-creator skill to automate his EXACT workflow leveraging his EXACT skills.

## Summary

`addyosmani/agent-skills` is a Claude Code plugin (also usable with Cursor, Gemini CLI, Copilot, OpenCode, Windsurf, Kiro, and any agent that accepts Markdown) that packages the software-development lifecycle into **7 slash commands** as entry points, which activate **21 skills** organized into **6 phases** (DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP). The chaining is not implicit — the meta-skill `using-agent-skills` is loaded at `SessionStart` via a hook and defines an explicit **11-step lifecycle sequence** plus a decision tree that maps task intent to skills. Each slash command in `.claude/commands/` invokes one or more skills in a prescribed order. **Human-in-the-loop (HITL) gates are concentrated at four boundaries**: (1) spec approval after DEFINE, (2) plan approval after PLAN, (3) code-review approval before merge, and (4) staged-rollout checkpoints during SHIP. Three agent personas (`code-reviewer`, `test-engineer`, `security-auditor`) act as specialized reviewers. Two non-trivial hook systems (`SDD-CACHE` for `WebFetch` caching tied to `source-driven-development`; `SIMPLIFY-IGNORE` for block-level protection tied to `code-simplification`) manage cross-session state.

The workflow is designed for faithful automation: skills are *processes*, not reference docs, every skill ends with a verification checklist producing evidence (tests passing, build output, measurements), and every skip-worthy step is guarded by an anti-rationalization table. The decision-tree routing and explicit per-phase artifacts (`SPEC.md`, `tasks/plan.md`, `tasks/todo.md`, ADRs, pre-launch checklist) make it feasible to model each phase as an Atomic workflow stage with human-gate nodes between phases.

---

## Top-Level Structure

### Repository layout (ref `44dac802`)

```
agent-skills/
├── .claude-plugin/
│   ├── plugin.json        # Plugin metadata + commands path
│   └── marketplace.json   # Marketplace entry: addy-agent-skills
├── .claude/
│   └── commands/          # 7 slash commands (entry points)
├── .github/               # (copilot-instructions etc.)
├── agents/                # 3 personas (code-reviewer, test-engineer, security-auditor)
├── docs/                  # Setup guides per tool + skill-anatomy
├── hooks/
│   ├── hooks.json         # Registers SessionStart hook only (default)
│   ├── session-start.sh   # Injects using-agent-skills SKILL.md into every session
│   ├── sdd-cache-pre.sh   # PreToolUse WebFetch — conditional HEAD, 304 short-circuit
│   ├── sdd-cache-post.sh  # PostToolUse WebFetch — write ETag/Last-Modified JSON cache
│   ├── SDD-CACHE.md       # Docs for the above
│   ├── simplify-ignore.sh # PreRead + PostEdit/Write + Stop — block-level protection
│   └── SIMPLIFY-IGNORE.md # Docs for the above
├── references/
│   ├── testing-patterns.md
│   ├── security-checklist.md
│   ├── performance-checklist.md
│   └── accessibility-checklist.md
└── skills/                # 21 skills (one dir each, SKILL.md per dir)
```

### The 7 slash commands (entry points)

Source: `.claude/commands/*.md`. Each is a single markdown file with YAML frontmatter (`description:`) plus prose that *invokes* one or more skills and lays out the numbered steps the agent must follow.

| Command | Primary skill invoked | Co-invoked skills | Output artifact |
|---------|-----------------------|-------------------|-----------------|
| `/spec` | `spec-driven-development` | — | `SPEC.md` in repo root (**user must confirm**) |
| `/plan` | `planning-and-task-breakdown` | — | `tasks/plan.md` + `tasks/todo.md` |
| `/build` | `incremental-implementation` | `test-driven-development`; falls back to `debugging-and-error-recovery` on failure | Per-slice commits |
| `/test` | `test-driven-development` | `browser-testing-with-devtools` (browser bugs) | Red → Green tests; Prove-It reproduction test for bugs |
| `/review` | `code-review-and-quality` | `security-and-hardening`, `performance-optimization` | Structured review with Critical / Important / Suggestion labels |
| `/code-simplify` | `code-simplification` | `code-review-and-quality` (post-simplification review) | Incremental refactor commits (behavior-preserving) |
| `/ship` | `shipping-and-launch` | pulls in security / performance / a11y checklists | Completed pre-launch checklist + rollback plan |

### The 21 skills grouped by phase

Source: `skills/<name>/SKILL.md`. 20 "core" skills plus the `using-agent-skills` meta-skill.

- **Define (2):** `idea-refine`, `spec-driven-development`
- **Plan (1):** `planning-and-task-breakdown`
- **Build (6):** `incremental-implementation`, `test-driven-development`, `context-engineering`, `source-driven-development`, `frontend-ui-engineering`, `api-and-interface-design`
- **Verify (2):** `browser-testing-with-devtools`, `debugging-and-error-recovery`
- **Review (4):** `code-review-and-quality`, `code-simplification`, `security-and-hardening`, `performance-optimization`
- **Ship (5):** `git-workflow-and-versioning`, `ci-cd-and-automation`, `deprecation-and-migration`, `documentation-and-adrs`, `shipping-and-launch`
- **Meta (1):** `using-agent-skills`

### The 3 agent personas (`agents/*.md`)

| Persona | Role | Invoked during | Output |
|---------|------|----------------|--------|
| `code-reviewer` | Staff Engineer — five-axis review (correctness, readability, architecture, security, performance) | `/review` | Markdown report with Verdict (APPROVE / REQUEST CHANGES) + Critical / Important / Suggestion findings (`[File:line]` refs) |
| `test-engineer` | QA Engineer — test strategy, Prove-It bug reproduction, 5-scenario-per-function coverage | `/test`, `/build` | New/updated tests + coverage analysis with Critical / High / Medium / Low priority |
| `security-auditor` | Security Engineer — OWASP Top 10, threat modeling, severity-tiered findings | `/review`, `/ship`, any new auth/data/integration | Security Audit Report with severity bands (Critical → Info) + PoC for Critical/High |

### Hooks (`hooks/hooks.json`)

Out-of-the-box the plugin registers **only** the `SessionStart` hook. The two advanced hook systems (`SDD-CACHE`, `SIMPLIFY-IGNORE`) are documented but left for the user to register in `.claude/settings.json`.

| Hook | Event(s) | Effect |
|------|----------|--------|
| `session-start.sh` | `SessionStart` | Reads `skills/using-agent-skills/SKILL.md` and injects it as an `IMPORTANT` priority message so the agent always knows the skill-discovery decision tree. |
| `sdd-cache-{pre,post}.sh` (opt-in) | `PreToolUse` / `PostToolUse` on `WebFetch` | Deduplicates doc fetches for `source-driven-development` using HTTP `ETag`/`Last-Modified` (never a TTL). Cache at `.claude/sdd-cache/<sha256(url)>.json`. |
| `simplify-ignore.sh` (opt-in) | `PreToolUse Read`, `PostToolUse Edit\|Write`, `Stop` | Replaces `simplify-ignore-start … simplify-ignore-end` blocks with opaque `BLOCK_<hash>` placeholders before reads so `code-simplification` never sees protected code; expands them back after writes; restores originals on `Stop`. |

---

## The End-to-End Workflow

### Canonical lifecycle sequence (from `using-agent-skills`)

The meta-skill states the sequence verbatim:

```
1. idea-refine
2. spec-driven-development
3. planning-and-task-breakdown
4. context-engineering
5. source-driven-development
6. incremental-implementation
7. test-driven-development
8. code-review-and-quality
9. git-workflow-and-versioning
10. documentation-and-adrs
11. shipping-and-launch
```

Skills not in this linear list (`frontend-ui-engineering`, `api-and-interface-design`, `browser-testing-with-devtools`, `debugging-and-error-recovery`, `code-simplification`, `security-and-hardening`, `performance-optimization`, `ci-cd-and-automation`, `deprecation-and-migration`) activate *conditionally* per the decision tree (UI work, API work, browser work, error recovery, simplification after a feature, etc.).

### The gated phase diagram (from `spec-driven-development`)

```
SPECIFY --> PLAN --> TASKS --> IMPLEMENT
   |          |        |          |
   v          v        v          v
 Human      Human    Human      Human
 reviews    reviews  reviews    reviews
```

Each phase transition requires explicit human sign-off on the artifact produced in the prior phase.

### End-to-end walk-through (command-by-command)

#### Phase 0 — Session start (hook)
- `session-start.sh` fires and injects `skills/using-agent-skills/SKILL.md` as `IMPORTANT` context so the agent sees the decision tree and the 6 always-active operating behaviors (Surface Assumptions, Manage Confusion Actively, Push Back When Warranted, Enforce Simplicity, Maintain Scope Discipline, Verify Don't Assume).
- **HITL:** None — automatic.

#### Phase 1 — DEFINE

**Optional pre-step: `/idea-refine` (`idea-refine` skill).** Three phases (Understand & Expand → Evaluate & Converge → Sharpen & Ship). Uses `AskUserQuestion` to elicit 3-5 sharpening questions and **"does NOT proceed until answered."** Produces `docs/ideas/<idea-name>.md` *only if the user confirms*.

**Required step: `/spec` (`spec-driven-development`).** Agent asks clarifying questions (objective, users, features, stack, boundaries). Spec must cover six areas: Objective, Commands, Project Structure, Code Style, Testing Strategy, Boundaries. Output: `SPEC.md` at repo root.

- **HITL GATE 1 (blocking):** `/spec` explicitly instructs the agent to "Save the spec as SPEC.md in the project root and **confirm with the user before proceeding**." The skill reinforces this with a verification checklist item: *"The human has reviewed and approved the spec."*
- Anti-rationalization: surface assumptions block ends with "Correct me now or I'll proceed with these."

#### Phase 2 — PLAN

**`/plan` (`planning-and-task-breakdown`).** Agent enters **plan mode (read-only; no code changes)**, identifies the dependency graph, slices work **vertically** (one complete path per task, not horizontal layers), writes each task with acceptance criteria + verification step + dependencies + files + scope, adds checkpoint blocks every 2-3 tasks, orders high-risk tasks early.

- Output artifacts: `tasks/plan.md` (detailed plan) and `tasks/todo.md` (task list).
- Task sizing rules: XS=1 file, S=1-2, M=3-5, L=5-8 (break down), XL=8+ (always break down); break further if task title contains "and".
- **HITL GATE 2 (blocking):** The command instructs "Present the plan for human review" and the skill's verification checklist includes: *"The human has reviewed and approved the plan."*
- Each checkpoint block in the plan is itself a mid-phase review hook: *"Review with human before proceeding."*

#### Phase 3 — BUILD

**Primary: `/build` (`incremental-implementation` + `test-driven-development`).** For each task from the plan:

1. Read the task's acceptance criteria
2. Load relevant context (invokes `context-engineering`: 5-level hierarchy — rules files → spec/arch docs → relevant source → error output → conversation history)
3. **RED** — write a failing test (must actually fail; passing immediately proves nothing)
4. **GREEN** — implement the minimum code to pass the test
5. Run the full test suite (regression check)
6. Run the build (compilation check)
7. Commit with descriptive message (invokes `git-workflow-and-versioning`: atomic commits, ~100 lines, `feat`/`fix`/`refactor`/`test`/`docs`/`chore` prefix)
8. Mark the task complete; move to the next slice (**carry forward, don't restart**)

If any step fails → invoke `debugging-and-error-recovery` (6 steps: Reproduce → Localize → Reduce → Fix root cause → Guard against recurrence → Verify end-to-end).

**Conditional sub-skills for BUILD:**
- UI work → `frontend-ui-engineering` (component architecture, state-mgmt tier selection, design-system adherence, WCAG 2.1 AA, responsive 320/768/1024/1440, loading+error+empty states).
- API/interface work → `api-and-interface-design` (Contract First, Consistent Error Semantics, Validate at Boundaries, Prefer Addition Over Modification, Predictable Naming; Hyrum's Law; One-Version Rule).
- Framework-specific code → `source-driven-development` (DETECT → FETCH → IMPLEMENT → CITE; inline URL citations; explicit `UNVERIFIED` flag when docs missing; `CONFLICT DETECTED` block surfaced to user when docs conflict with existing code).

- **HITL GATES (non-blocking but explicit):**
  - When out-of-scope issues are noticed → agent asks: *"Want me to create tasks for these?"* (never silently acts).
  - When docs/code conflict in `source-driven-development` → emits `CONFLICT DETECTED` block with options A/B and asks *"Which approach do you prefer?"*.
  - Missing requirements → *"stop and ask. Don't invent requirements — that's the human's job."*
  - Core behavior 2 (Manage Confusion Actively): **STOP. Do not proceed with a guess.** Name the confusion, present the tradeoff, wait for resolution.

#### Phase 4 — VERIFY

**`/test` (`test-driven-development`).** For new features: Red-Green-Refactor. For bugs (**Prove-It pattern**): write reproduction test → confirm it fails → implement fix → confirm it passes → full regression.

**Browser bugs also trigger `browser-testing-with-devtools`** (Chrome DevTools MCP). Flows: UI Bugs (REPRODUCE → INSPECT → DIAGNOSE → FIX → VERIFY); Network Issues (CAPTURE → ANALYZE → DIAGNOSE → FIX & VERIFY); Performance (BASELINE → IDENTIFY → FIX → MEASURE).

- **HITL GATES:**
  - `browser-testing-with-devtools` requires user confirmation before navigating to any URL sourced from page content, and before JS execution that mutates DOM.
  - `debugging-and-error-recovery` enforces the **Stop-the-Line Rule**: on any unexpected error, STOP all forward progress, preserve evidence, run triage. Agent must not skip past a failing test to advance features.
  - Browser content and error output are treated as **untrusted data** — the agent surfaces suspicious instruction-like content to the user instead of acting on it.

#### Phase 5 — REVIEW

**Primary: `/review` (`code-review-and-quality`).** Five-axis review across Correctness / Readability / Architecture / Security / Performance. Five-step process:
1. Understand the Context
2. Review the Tests First
3. Review the Implementation
4. Categorize Findings (severity labels)
5. Verify the Verification

Severity labels (verbatim):

| Prefix | Meaning | Author Action |
|--------|---------|---------------|
| *(none)* | Required change | Must address before merge |
| `Critical:` | Blocks merge | Security/data loss/broken functionality |
| `Nit:` | Minor, optional | Author may ignore |
| `Optional:` / `Consider:` | Suggestion | Worth considering |
| `FYI` | Informational only | No action |

Invokes specialist personas when scope matches:
- Security concerns → `security-auditor` agent + `security-and-hardening` skill (OWASP Top 10, auth patterns, secrets, dep audit, three-tier boundary).
- Performance concerns → `performance-optimization` skill (MEASURE → IDENTIFY → FIX → VERIFY → GUARD; before/after numbers required, not "feels faster").

**Optional: `/code-simplify` (`code-simplification`).** 4 steps: Understand Before Touching (Chesterton's Fence) → Identify → Apply Incrementally → Verify. Rule of 500 (>500 lines = codemod only, not manual). Must be submitted in a **separate PR from feature/bug work**. If the simplified version is harder to read, **revert** (no autonomous override). After simplifying, re-run `code-review-and-quality`.

- **HITL GATES:**
  - All `Critical:` findings must be resolved before the multi-model review ends with *"Human makes the final call."*
  - Dead code may **never** be silently deleted — the agent must ask first. *"I'll clean it up later"* is rejected.
  - `security-and-hardening` lists an **"Ask First" tier** that requires human approval before the agent proceeds: new auth flows, new PII/payment categories, new third-party integrations, CORS changes, file upload handlers, rate-limiter changes, elevated permissions.
  - `code-simplification` must not broaden scope beyond recently modified code without explicit permission.

#### Phase 6 — SHIP

**`/ship` (`shipping-and-launch`).** Six-category pre-launch checklist: Code Quality / Security / Performance / Accessibility / Infrastructure / Documentation.

Supporting skills:
- `git-workflow-and-versioning` (runs throughout Build but finalizes here: atomic commits, ~100 lines per commit/PR, split >1000 lines, short-lived branches, worktrees for parallel agents, pre-commit gates `git diff --staged` + secrets scan + `npm test` + `npm run lint` + `tsc --noEmit`).
- `ci-cd-and-automation` (pipeline: lint → typecheck → unit tests → build → integration → E2E → security audit → bundle size; GitHub Actions workflow on PR + push to main; service containers for integration tests; preview deployments; rollback workflow via `workflow_dispatch`; Dependabot/Renovate; pipeline <10 min).
- `documentation-and-adrs` (ADRs in `docs/decisions/ADR-NNN-<title>.md`; lifecycle PROPOSED → ACCEPTED → SUPERSEDED; JSDoc; OpenAPI/Swagger; README; CHANGELOG Added/Fixed/Changed).
- `deprecation-and-migration` (only when removing old code: 5 gating questions → advisory vs compulsory → build replacement first → announce → migrate via Strangler / Adapter / Feature Flag → verify zero usage → remove).

Staged rollout sequence (verbatim): staging deploy + full suite → staging smoke → production deploy (flag OFF) + health check → **team enable (24h monitor)** → **canary 5% (24-48h)** → gradual increase → full rollout → **1-week monitor** → remove flag within 2 weeks.

Rollout decision thresholds at each stage: error rate, P95 latency, client JS errors, business metrics — advance / hold / roll back.

- **HITL GATES (densest in the workflow):**
  - Pre-launch checklist sign-off — all six categories must be green before deploying.
  - Manual smoke test of critical flows in staging before enabling in production.
  - 24-hour monitoring window when enabling for the team.
  - Canary advance/hold/rollback decision at each percentage step.
  - Rollback decision on red-threshold trigger.
  - *"Someone monitoring the deploy for the first hour"* — listed as a red flag if absent.
  - *"It's Friday afternoon, let's ship it"* — named red flag.
  - Branch protection: ≥1 approval required to merge (also enforced by `ci-cd-and-automation`).
  - ADR acceptance: Status moves from `PROPOSED` → `Accepted` only via human review.
  - Deprecation announcement is itself a communication gate — humans/downstream teams must receive the notice before removal proceeds.

---

## HITL Gate Inventory (for workflow-creator)

This table is the load-bearing reference for the workflow-creator: each gate is where an Atomic workflow node should pause for developer input / approval before advancing.

| # | Phase | Gate name | Skill / Command | Blocking? | Artifact required |
|---|-------|-----------|-----------------|-----------|-------------------|
| G1 | DEFINE | Idea direction confirmation (optional) | `idea-refine` | Blocks save of `docs/ideas/*.md` | One-pager draft |
| G2 | DEFINE | Spec approval | `/spec` / `spec-driven-development` | **Blocks Phase 2** | `SPEC.md` |
| G3 | PLAN | Plan approval | `/plan` / `planning-and-task-breakdown` | **Blocks Phase 3** | `tasks/plan.md` + `tasks/todo.md` |
| G4 | PLAN | Per-checkpoint review (every 2-3 tasks) | `planning-and-task-breakdown` | Blocks next task batch | Checkpoint checklist |
| G5 | BUILD | Out-of-scope surfacing | `incremental-implementation` | Non-blocking; asks "Want me to create tasks for these?" | — |
| G6 | BUILD | Doc/code conflict decision | `source-driven-development` | **Blocks file write** | `CONFLICT DETECTED` block |
| G7 | BUILD | Missing requirement stop-and-ask | `context-engineering` / `using-agent-skills` #2 | **Blocks progress** | Confusion/question text |
| G8 | BUILD | Inline Plan confirmation | `context-engineering` | Non-blocking but explicit | "Executing unless you redirect" |
| G9 | VERIFY | Browser URL / DOM-mutation confirmation | `browser-testing-with-devtools` | **Blocks navigation/JS** | User confirmation |
| G10 | VERIFY | Stop-the-Line trigger | `debugging-and-error-recovery` | **Halts all forward progress** | Preserved evidence |
| G11 | REVIEW | `Ask First` tier sign-off (auth / PII / integrations / CORS / uploads / rate limits / permissions) | `security-and-hardening` | **Blocks implementation** | Written approval |
| G12 | REVIEW | Critical finding resolution | `code-review-and-quality` | **Blocks merge** | All Critical: addressed |
| G13 | REVIEW | Dead code deletion approval | `code-review-and-quality`, `code-simplification` | **Blocks delete** | Developer confirmation |
| G14 | REVIEW | Final merge call | `code-review-and-quality` | **Blocks merge** | "Human makes the final call" |
| G15 | SHIP | Pre-launch 6-category checklist sign-off | `shipping-and-launch` | **Blocks deploy** | Checklist (green all) |
| G16 | SHIP | Staging smoke test | `shipping-and-launch` | **Blocks prod deploy** | Manual pass |
| G17 | SHIP | Team-enable 24h monitor | `shipping-and-launch` | **Blocks canary** | Monitoring OK |
| G18 | SHIP | Canary advance / hold / rollback (at each %) | `shipping-and-launch` | **Blocks next stage** | Threshold table |
| G19 | SHIP | Rollback decision | `shipping-and-launch` / `ci-cd-and-automation` | Immediate execute on red | `workflow_dispatch` trigger |
| G20 | SHIP | ADR acceptance (PROPOSED→Accepted) | `documentation-and-adrs` | Blocks doc merge | Reviewed ADR |
| G21 | SHIP | PR approval + branch protection | `ci-cd-and-automation` / `git-workflow-and-versioning` | **Blocks merge to main** | ≥1 reviewer |
| G22 | SHIP | Deprecation announcement + migration verification | `deprecation-and-migration` | Blocks removal | Zero-usage proof |

Also "universal" per the `using-agent-skills` meta-skill (active in every phase):

- **Surface Assumptions block** ending *"Correct me now or I'll proceed with these"* (non-blocking; the absence of correction is consent).
- **Push Back When Warranted** — agent challenges; developer has final authority.
- **Verify, Don't Assume** — every phase has an evidence requirement (tests pass, build output, measurement numbers).

---

## Per-Skill Quick Reference (for faithful automation)

### DEFINE

**`idea-refine`** — Process: (1) restate as "How Might We" → (2) `AskUserQuestion` 3-5 sharpening Qs → (3) generate 5-8 variations (Inversion, Constraint removal, Audience shift, Combination, Simplification, 10x version, Expert lens) → (4) cluster to 2-3 directions → (5) stress-test (user value/feasibility/differentiation) → (6) surface assumptions → (7) ship one-pager. Artifact: `docs/ideas/<name>.md`. Supporting files: `examples.md`, `frameworks.md`, `refinement-criteria.md`, `scripts/idea-refine.sh`.

**`spec-driven-development`** — 4 gated phases: SPECIFY → PLAN → TASKS → IMPLEMENT. Spec covers six areas (Objective, Commands, Project Structure, Code Style, Testing Strategy, Boundaries). Artifact: `SPEC.md`. Boundaries have three tiers (Always / Ask First / Never).

### PLAN

**`planning-and-task-breakdown`** — 5 steps: Enter Plan Mode (read-only) → Identify Dependency Graph → Slice Vertically → Write Tasks (acceptance/verification/deps/files/scope) → Order and Checkpoint. Artifacts: `tasks/plan.md` + `tasks/todo.md`. Sizing: XS/S/M/L/XL.

### BUILD

**`incremental-implementation`** — The Increment Cycle: Implement → Test → Verify → Commit → Next slice. Slicing: Vertical (preferred), Contract-First, Risk-First. Per-increment checklist (tests/build/types/lint pass, descriptive commit).

**`test-driven-development`** — RED → GREEN → REFACTOR. Prove-It for bugs. Test pyramid 80/15/5 (unit/integration/E2E). Test sizes. DAMP over DRY. Beyoncé Rule.

**`context-engineering`** — 5-level hierarchy: Rules files → Spec/Arch docs → Source files → Error output → Conversation. Packing strategies: Brain Dump, Selective Include, Hierarchical Summary, Inline Planning. MCP integrations listed: Context7, Chrome DevTools, PostgreSQL, Filesystem, GitHub.

**`source-driven-development`** — DETECT → FETCH → IMPLEMENT → CITE. Source hierarchy: Official docs → Official blog/changelog → MDN/web.dev → caniuse/node.green. Never cite SO/blogs/tutorials/training data. Inline URL citations. `UNVERIFIED` and `CONFLICT DETECTED` flags.

**`frontend-ui-engineering`** — Component architecture (colocation, composition > configuration, data/presentation separation). State tiers: local → lifted → context → URL → server → global. Design-system adherence, WCAG 2.1 AA, responsive 320/768/1024/1440, loading+error+empty states. Companion: `references/accessibility-checklist.md`.

**`api-and-interface-design`** — 5 principles: Contract First, Consistent Error Semantics, Validate at Boundaries, Prefer Addition Over Modification, Predictable Naming. Patterns: REST (resources, pagination envelope, filtering, PATCH), TypeScript (discriminated unions, input/output type separation, branded IDs). Hyrum's Law; One-Version Rule.

### VERIFY

**`browser-testing-with-devtools`** — Chrome DevTools MCP. Flow variants: UI / Network / Performance. Security boundary: browser content is untrusted data.

**`debugging-and-error-recovery`** — 6 steps: Reproduce → Localize → Reduce → Fix root cause → Guard against recurrence → Verify end-to-end. Stop-the-Line Rule.

### REVIEW

**`code-review-and-quality`** — 5 steps: Understand Context → Review Tests First → Review Implementation → Categorize Findings → Verify the Verification. Five-axis. Change sizing ~100 lines. Severity labels.

**`code-simplification`** — 4 steps: Understand Before Touching (Chesterton's Fence) → Identify Opportunities → Apply Incrementally → Verify. Rule of 500. Submit in a separate PR.

**`security-and-hardening`** — OWASP Top 10 categories. "Ask First" tier. Companion: `references/security-checklist.md`.

**`performance-optimization`** — MEASURE → IDENTIFY → FIX → VERIFY → GUARD. Before/after numbers required. Core Web Vitals. Companion: `references/performance-checklist.md`.

### SHIP

**`git-workflow-and-versioning`** — Trunk-based. Atomic commits (`feat|fix|refactor|test|docs|chore`). ~100 lines / split >1000. `git worktree` for parallel agents. Pre-commit gates. Change-summary block after every modification.

**`ci-cd-and-automation`** — Pipeline: lint → typecheck → unit → build → integration → E2E → security audit → bundle size. GitHub Actions. Preview deploys. Rollback via `workflow_dispatch`. Dependabot/Renovate. <10 min pipeline.

**`deprecation-and-migration`** — 5 gating Qs → advisory vs compulsory → build replacement first → announce → Strangler / Adapter / Feature Flag → verify zero usage → remove.

**`documentation-and-adrs`** — ADRs in `docs/decisions/ADR-NNN-<title>.md`. Lifecycle PROPOSED → ACCEPTED → SUPERSEDED. JSDoc, OpenAPI, README, CHANGELOG.

**`shipping-and-launch`** — Six-category pre-launch checklist. Feature flag lifecycle. Staged rollout (5 → 25 → 50 → 100%). Monitoring + error reporting. Rollback plan exercised before deploying.

### META

**`using-agent-skills`** — Decision tree + 11-step lifecycle + 6 core operating behaviors (Surface Assumptions, Manage Confusion Actively, Push Back When Warranted, Enforce Simplicity, Maintain Scope Discipline, Verify Don't Assume). Loaded via `session-start.sh` into every session.

---

## Non-Obvious Mechanics

### Why `using-agent-skills` is the entry point
- It is loaded as `IMPORTANT` priority context at every `SessionStart` via `hooks/session-start.sh`, so the agent cannot "forget" the lifecycle. An Atomic replica should inject this content at workflow start.

### Why `SDD-CACHE` exists
- `source-driven-development` fetches official docs via `WebFetch` on every session. Without a cache, the same doc pages are fetched repeatedly. The cache uses **HTTP validators (ETag/Last-Modified)** — never TTL — so freshness is delegated to the origin server. A `304 Not Modified` from a conditional `HEAD` short-circuits the WebFetch, restoring the cached body as if the fetch had just happened.

### Why `SIMPLIFY-IGNORE` exists
- `code-simplification` is overzealous by default. Developers mark blocks with `simplify-ignore-start: <reason>` / `simplify-ignore-end`. Before read, the hook replaces the block with an opaque `BLOCK_<hash>` placeholder; after edit, the hook restores it. If the agent deletes a placeholder, a warning is emitted. On `Stop`, all backups are restored so the on-disk file never contains placeholders post-session.

### Artifact handoff between phases
- `SPEC.md` (DEFINE) → read by `/plan` in PLAN → referenced in every `/build` task in BUILD.
- `tasks/todo.md` (PLAN) → iterated in `/build` in BUILD.
- Commit history (BUILD) → reviewed in `/review` in REVIEW.
- Review approval + ADRs + CHANGELOG (REVIEW/SHIP) → inputs to `/ship` checklist in SHIP.

These are *living documents* during development and may be deleted pre-merge if not wanted long-term (per `docs/getting-started.md`).

### Skill invocation across coding assistants
- Claude Code: slash commands (`/spec` etc.) in `.claude/commands/`.
- OpenCode: no slash commands — `AGENTS.md` defines implicit mapping (feature → `spec-driven-development` then `incremental-implementation` + `test-driven-development`; bug → `debugging-and-error-recovery`; etc.).
- Cursor / Gemini / Copilot / Windsurf / Kiro: skills loaded as rules files. All share the same `SKILL.md` processes.

---

## Fidelity Notes for Automating with Atomic `workflow-creator`

To automate Addy's **exact** workflow in an Atomic workflow file (`defineWorkflow().run().compile()` with `ctx.stage()`), the minimum required mapping is:

1. **Prime the session** with the `using-agent-skills` SKILL.md content (mirrors `session-start.sh`).
2. **Stage per phase** — one `ctx.stage()` per lifecycle command (`spec`, `plan`, `build`, `test`, `review`, `ship`, plus optional `idea-refine` and `code-simplify`), each pre-loaded with the specific skills the command activates.
3. **Insert an `AskUserQuestion`-equivalent HITL node** at each of the 22 HITL gates above. The critical blocking gates are G2 (spec), G3 (plan), G11 (Ask First tier), G12 (Critical findings), G14 (final merge call), G15-G19 (ship gates). The others can be automated with sensible defaults but should be surfaced.
4. **Mirror the gate semantics**: blocking gates halt stage advancement until developer replies; non-blocking surfacings emit a message but continue.
5. **Preserve evidence artifacts at each gate** — `SPEC.md`, `tasks/plan.md`, test output, review report, pre-launch checklist, rollback plan. The workflow's output should include these artifacts, not just a final diff.
6. **Conditional sub-stages** — UI → `frontend-ui-engineering`; API → `api-and-interface-design`; browser verify → `browser-testing-with-devtools`; any failure → `debugging-and-error-recovery`; framework-specific code → `source-driven-development`; security-sensitive → `security-and-hardening` + `security-auditor`; performance → `performance-optimization`; simplification → `code-simplification` then re-review.
7. **Agent personas** — when the workflow invokes review, spawn sub-agents loaded with `agents/code-reviewer.md`, `agents/test-engineer.md`, `agents/security-auditor.md` as system prompts.
8. **Hook replicas** — session-start inject is mandatory for fidelity; SDD-CACHE and SIMPLIFY-IGNORE are optional but dramatically improve quality for repos that hit them.
9. **Anti-rationalization table enforcement** — each stage should surface its skill's "Common Rationalizations" so the agent sees its own excuses pre-empted. These are embedded inside each SKILL.md and will be loaded automatically when the skill is invoked.
10. **Evidence-based verification** — every stage's exit criteria must return structured evidence (test output, build result, measurement numbers, screenshot, checklist JSON).

---

## Code References (external — `addyosmani/agent-skills` at `44dac80216da709913fb410f632a65547866346f`)

### Commands
- [.claude/commands/spec.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude/commands/spec.md)
- [.claude/commands/plan.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude/commands/plan.md)
- [.claude/commands/build.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude/commands/build.md)
- [.claude/commands/test.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude/commands/test.md)
- [.claude/commands/review.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude/commands/review.md)
- [.claude/commands/code-simplify.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude/commands/code-simplify.md)
- [.claude/commands/ship.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude/commands/ship.md)

### Skills (SKILL.md per dir)
- [skills/using-agent-skills/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/using-agent-skills/SKILL.md)
- [skills/idea-refine/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/idea-refine/SKILL.md)
- [skills/spec-driven-development/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/spec-driven-development/SKILL.md)
- [skills/planning-and-task-breakdown/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/planning-and-task-breakdown/SKILL.md)
- [skills/incremental-implementation/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/incremental-implementation/SKILL.md)
- [skills/test-driven-development/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/test-driven-development/SKILL.md)
- [skills/context-engineering/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/context-engineering/SKILL.md)
- [skills/source-driven-development/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/source-driven-development/SKILL.md)
- [skills/frontend-ui-engineering/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/frontend-ui-engineering/SKILL.md)
- [skills/api-and-interface-design/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/api-and-interface-design/SKILL.md)
- [skills/browser-testing-with-devtools/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/browser-testing-with-devtools/SKILL.md)
- [skills/debugging-and-error-recovery/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/debugging-and-error-recovery/SKILL.md)
- [skills/code-review-and-quality/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/code-review-and-quality/SKILL.md)
- [skills/code-simplification/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/code-simplification/SKILL.md)
- [skills/security-and-hardening/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/security-and-hardening/SKILL.md)
- [skills/performance-optimization/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/performance-optimization/SKILL.md)
- [skills/git-workflow-and-versioning/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/git-workflow-and-versioning/SKILL.md)
- [skills/ci-cd-and-automation/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/ci-cd-and-automation/SKILL.md)
- [skills/deprecation-and-migration/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/deprecation-and-migration/SKILL.md)
- [skills/documentation-and-adrs/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/documentation-and-adrs/SKILL.md)
- [skills/shipping-and-launch/SKILL.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/skills/shipping-and-launch/SKILL.md)

### Agents
- [agents/code-reviewer.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/agents/code-reviewer.md)
- [agents/test-engineer.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/agents/test-engineer.md)
- [agents/security-auditor.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/agents/security-auditor.md)

### Hooks
- [hooks/hooks.json](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/hooks/hooks.json)
- [hooks/session-start.sh](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/hooks/session-start.sh)
- [hooks/SDD-CACHE.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/hooks/SDD-CACHE.md)
- [hooks/sdd-cache-pre.sh](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/hooks/sdd-cache-pre.sh)
- [hooks/sdd-cache-post.sh](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/hooks/sdd-cache-post.sh)
- [hooks/SIMPLIFY-IGNORE.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/hooks/SIMPLIFY-IGNORE.md)
- [hooks/simplify-ignore.sh](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/hooks/simplify-ignore.sh)

### Reference checklists
- [references/testing-patterns.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/references/testing-patterns.md)
- [references/security-checklist.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/references/security-checklist.md)
- [references/performance-checklist.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/references/performance-checklist.md)
- [references/accessibility-checklist.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/references/accessibility-checklist.md)

### Plugin / docs
- [.claude-plugin/plugin.json](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude-plugin/plugin.json)
- [.claude-plugin/marketplace.json](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/.claude-plugin/marketplace.json)
- [CLAUDE.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/CLAUDE.md)
- [AGENTS.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/AGENTS.md)
- [docs/getting-started.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/docs/getting-started.md)
- [docs/skill-anatomy.md](https://github.com/addyosmani/agent-skills/blob/44dac80216da709913fb410f632a65547866346f/docs/skill-anatomy.md)

---

## Cached Source Documents

Full verbatim copies of every SKILL.md, agent persona, and hook doc have been persisted under `research/web/` so future work avoids re-fetching:

- `research/web/2026-04-19-addy-using-agent-skills.md`
- `research/web/2026-04-19-addy-idea-refine.md`
- `research/web/2026-04-19-addy-spec-driven-development.md`
- `research/web/2026-04-19-addy-planning-and-task-breakdown.md`
- `research/web/2026-04-19-addy-incremental-implementation.md`
- `research/web/2026-04-19-addy-test-driven-development.md`
- `research/web/2026-04-19-addy-context-engineering.md`
- `research/web/2026-04-19-addy-source-driven-development.md`
- `research/web/2026-04-19-addy-frontend-ui-engineering.md`
- `research/web/2026-04-19-addy-api-and-interface-design.md`
- `research/web/2026-04-19-addy-browser-testing-with-devtools.md`
- `research/web/2026-04-19-addy-debugging-and-error-recovery.md`
- `research/web/2026-04-19-addy-code-review-and-quality.md`
- `research/web/2026-04-19-addy-code-simplification.md`
- `research/web/2026-04-19-addy-security-and-hardening.md`
- `research/web/2026-04-19-addy-performance-optimization.md`
- `research/web/2026-04-19-addy-git-workflow-and-versioning.md`
- `research/web/2026-04-19-addy-ci-cd-and-automation.md`
- `research/web/2026-04-19-addy-deprecation-and-migration.md`
- `research/web/2026-04-19-addy-documentation-and-adrs.md`
- `research/web/2026-04-19-addy-shipping-and-launch.md`
- `research/web/2026-04-19-addy-agent-code-reviewer.md`
- `research/web/2026-04-19-addy-agent-test-engineer.md`
- `research/web/2026-04-19-addy-agent-security-auditor.md`
- `research/web/2026-04-19-addy-hooks-sdd-cache.md`
- `research/web/2026-04-19-addy-hooks-simplify-ignore.md`

---

## Related Research

- [2026-02-02-atomic-builtin-workflows-research.md](./2026-02-02-atomic-builtin-workflows-research.md) — Atomic's built-in workflows design
- [2026-02-05-pluggable-workflows-sdk-design.md](./2026-02-05-pluggable-workflows-sdk-design.md) — Pluggable workflow SDK
- [2026-02-11-workflow-sdk-implementation.md](./2026-02-11-workflow-sdk-implementation.md) — Workflow SDK
- [2026-02-08-skill-loading-from-configs-and-ui.md](./2026-02-08-skill-loading-from-configs-and-ui.md) — How Atomic loads skills
- [2026-02-25-skills-directory-structure.md](./2026-02-25-skills-directory-structure.md) — Agent-skill dir conventions
- [2026-04-14-hil-detection-implementation-research.md](./2026-04-14-hil-detection-implementation-research.md) — HIL detection design in Atomic

## Open Questions

1. Should the Atomic workflow inline the full text of each SKILL.md into the stage system prompt, or rely on the agent's built-in skill-loading mechanism per provider (Claude Code plugin vs OpenCode `AGENTS.md` vs Copilot `.github/copilot-instructions.md`)? The plugin.json approach is cleanest for Claude Code but does not port directly to other providers.
2. SDD-CACHE and SIMPLIFY-IGNORE hooks rely on project-local `.claude/` state — how should an Atomic harness expose them? As optional features in the workflow config, or as separate slash commands?
3. For sub-agent review (`code-reviewer`, `test-engineer`, `security-auditor`), should Atomic spawn foreground or background sub-agents? The reviewer personas are ~3 KB system prompts — lightweight.
4. The workflow assumes a pre-existing git repo with `npm`/`bun` tooling — non-JS projects will need alternate verification commands per phase. Should this be detected or configured?
5. `idea-refine` uses `AskUserQuestion`, which maps cleanly to Atomic's question node, but the 5-8 variation generation is model-heavy. Is there value in letting the user bypass `idea-refine` entirely when the idea is already refined?
