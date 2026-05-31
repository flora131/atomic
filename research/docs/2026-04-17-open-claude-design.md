---
date: 2026-04-17 11:09:30 PDT
researcher: Claude (Opus 4.6)
git_commit: 200d34dc71f85663a560c1d17aab66a40dd9e5b8
branch: flora131/feature/open-claude-design
repository: atomic-open-claude-design
topic: "Open Claude Design — open-source replica of Anthropic's Claude Design using the Atomic workflow SDK"
tags: [research, workflow, claude-design, design-tool, open-source, sdk]
status: complete
last_updated: 2026-04-17
last_updated_by: Claude (Opus 4.6)
---

# Open Claude Design — Research Document

## Research Question

Anthropic Labs released Claude Design (https://www.anthropic.com/news/claude-design-anthropic-labs) on April 17, 2026. The goal is to create an open-source replica of this product using the Atomic workflow SDK, offered as a built-in workflow called `open-claude-design` alongside the existing `deep-research-codebase` and `ralph` workflows.

## Summary

Claude Design is a 6-phase AI-powered design tool that enables conversational visual design — from design system onboarding through generation, refinement, and handoff to Claude Code. This research maps every phase to existing Atomic workflow SDK primitives and identifies what already exists in the codebase vs. what needs to be built. The Atomic SDK's `defineWorkflow().for<"claude">().run().compile()` pattern, combined with `ctx.stage()` for sub-agent orchestration, provides the full runtime needed to implement this workflow. The existing skills (`impeccable`, `critique`, `shape`, `playwright-cli`, etc.) and agent types (`planner`, `orchestrator`, `reviewer`, `worker`, `debugger`) cover ~70% of the required capabilities.

---

## Part 1: Claude Design — Official Workflow (6 Phases)

Source: [Anthropic Announcement](https://www.anthropic.com/news/claude-design-anthropic-labs)

Claude Design's workflow is NOT the 4-phase model initially hypothesized (research/planning/implementation/validation). It is a **6-phase creative flow**:

### Phase 1: Design System Onboarding — "Your brand, built in"

| Aspect | Detail |
|---|---|
| **What happens** | Claude reads the team's codebase and design files, constructs a design system (colors, typography, components) |
| **User interaction** | Human-in-the-loop at each major decision — user approves or requests changes to each design element |
| **Output** | Structured design system representation (not raw files) |
| **Key behaviors** | Auto-applied to every subsequent project; supports multiple design systems per team; refine-able over time |
| **Data privacy** | Stores representation only; code is never uploaded to Anthropic servers |

### Phase 2: Import — "Import from anywhere"

| Aspect | Detail |
|---|---|
| **Input methods** | Text prompt, image upload, document upload (DOCX/PPTX/XLSX), codebase reference, **web capture tool** (scrapes live website) |
| **User interaction** | User chooses inputs; no approval gate — proceeds directly to generation |
| **Key capability** | Web capture tool scrapes visual elements from live URLs so prototypes match the real product |

### Phase 3: Generation — First Version

| Aspect | Detail |
|---|---|
| **What happens** | Claude generates the first version using design system + input + conversation context |
| **Output types** | Interactive prototypes, wireframes/mockups, pitch decks, marketing collateral, **frontier design** (voice/video/shaders/3D/AI) |
| **Model** | Claude Opus 4.7 (vision model, 2576px max long edge, 98.5% XBOW visual-acuity) |

### Phase 4: Refinement — "Refine with fine-grained controls"

| Aspect | Detail |
|---|---|
| **Mechanisms** | Chat conversation, inline comments, direct text editing, Claude-generated adjustment sliders/knobs, drawing/annotation, global change propagation |
| **Distinctive feature** | Claude generates context-specific sliders (spacing, color, layout) per design — live tweaking without prompting |
| **Iteration** | Multiple rounds; Brilliant example: 20+ prompts in other tools → 2 prompts in Claude Design |

### Phase 5: Collaboration — "Collaborate"

| Aspect | Detail |
|---|---|
| **Share modes** | Private, view-only link, edit access (multi-user Claude conversation) |
| **Key capability** | Group conversation — multiple team members interact with Claude simultaneously |

### Phase 6: Export and Handoff

| Aspect | Detail |
|---|---|
| **Export formats** | Internal URL, folder, Canva (fully editable), PDF, PPTX, standalone HTML |
| **Claude Code handoff** | Packages design + design intent + tokens + component specs into a bundle passable to Claude Code |
| **Key differentiator** | Closed loop: exploration → prototype → production code within Anthropic's ecosystem |

### Design Plugin Commands (Claude Code/Cowork)

Source: [GitHub Plugin Repository](https://github.com/anthropics/knowledge-work-plugins/tree/main/design)

| Command | Description |
|---|---|
| `/critique` | Structured design feedback: usability, visual hierarchy, accessibility, consistency |
| `/design-system` | Audit, document, or extend component libraries and tokens |
| `/handoff` | Developer handoff specs: measurements, tokens, states, interactions, edge cases |
| `/ux-copy` | Write/review microcopy, error messages, empty states, onboarding flows |
| `/accessibility` | WCAG 2.1 AA compliance audit with severity ratings |
| `/research-synthesis` | Condense user research into actionable insights |

---

## Part 2: Existing Atomic Workflow SDK — Architecture

### Workflow Definition Pattern

```
src/sdk/workflows/builtin/<workflow-name>/
├── claude/index.ts      ← defineWorkflow().for<"claude">().run().compile()
├── copilot/index.ts     ← defineWorkflow().for<"copilot">().run().compile()
├── opencode/index.ts    ← defineWorkflow().for<"opencode">().run().compile()
└── helpers/
    ├── prompts.ts        ← All prompt builders
    ├── review.ts         ← Domain-specific logic
    └── git.ts            ← Utility helpers
```

**Key API surface:**

| Primitive | Purpose |
|---|---|
| `defineWorkflow({ name, description, inputs })` | Create workflow builder with typed inputs |
| `.for<"claude">()` | Narrow agent type for TypeScript inference |
| `.run(async (ctx) => { ... })` | Define the workflow entry point |
| `.compile()` | Seal into `WorkflowDefinition` consumed by CLI |
| `ctx.stage(options, clientOpts, sessionOpts, callback)` | Spawn a sub-agent session |
| `ctx.transcript(handle)` | Read completed session output |
| `s.session.query(prompt, sdkOpts?)` | Send prompt to agent (visible or headless) |
| `s.save(sessionId)` | Persist session transcript |
| `extractAssistantText(result, afterIndex)` | Extract text from headless query result |

### Stage Types

| Type | Config | Behavior |
|---|---|---|
| **Visible** | `{ name: "...", headless: false }` + `clientOpts.chatFlags` | Spawns tmux window, visible in graph |
| **Headless** | `{ name: "...", headless: true }` + `sdkOpts: { agent, permissionMode }` | In-process via Agent SDK, invisible in graph |

### Parallel Execution

`Promise.all([ctx.stage(...), ctx.stage(...)])` — stages spawned in the same synchronous frame become siblings in the graph. The `GraphFrontierTracker` auto-infers topology from execution order.

### Existing Built-in Workflows

**Ralph** (`src/sdk/workflows/builtin/ralph/claude/index.ts`):
- Plan → Orchestrate → Review → Debug loop with bounded iteration (MAX_LOOPS=10)
- Uses visible stages for planner, orchestrator, reviewer, debugger
- Uses headless stages for infrastructure discovery (locator, analyzer, pattern-finder)
- Parallel reviewer passes (2 reviewers, merged results)
- Exit condition: both reviewers agree code is clean

**deep-research-codebase** (`src/sdk/workflows/builtin/deep-research-codebase/claude/index.ts`):
- Scout → per-partition specialist fan-out → aggregator
- Pure deterministic synthesis (no LLM call for concatenation)
- Six specialist agents: locator, pattern-finder, analyzer, online-researcher, research-locator, research-analyzer

### Available Agent Types

These are defined as `.md` files in `.claude/agents/`:

| Agent | Role |
|---|---|
| `orchestrator` | Delegate to sub-agents for complex tasks |
| `planner` | Author technical design documents / RFCs |
| `reviewer` | Code review with structured JSON output |
| `debugger` | Error investigation and root cause analysis |
| `worker` | Single task implementation |
| `codebase-locator` | Find files and components |
| `codebase-analyzer` | Analyze implementation details |
| `codebase-pattern-finder` | Find existing patterns and examples |
| `codebase-research-locator` | Discover research documents |
| `codebase-research-analyzer` | Extract insights from research docs |
| `codebase-online-researcher` | Fetch external documentation |
| `code-simplifier` | Simplify and refine code |

### Available Design Skills

Located in `.agents/skills/`:

| Skill | Relevance to Open Claude Design |
|---|---|
| `impeccable` | **Core** — UI/UX design covering color, contrast, craft, interaction, motion, responsive, spatial, typography, UX writing |
| `critique` | **Core** — Design critique methodology with cognitive load, heuristic scoring, personas |
| `shape` | **Core** — UX/UI planning before code: structured discovery interview → design brief |
| `layout` | **Core** — Layout system, grid, spacing, visual hierarchy |
| `delight` | Enhancement — Micro-interactions, joy, personality |
| `polish` | Enhancement — Final quality pass for alignment, spacing, consistency |
| `animate` | Enhancement — Purposeful animations and motion effects |
| `adapt` | Responsive — Cross-screen/device/platform adaptation |
| `colorize` | Enhancement — Strategic color for visual interest |
| `typeset` | Enhancement — Typography hierarchy, font choices, readability |
| `clarify` | Enhancement — UX copy, error messages, microcopy |
| `harden` | Production — Error handling, empty states, edge cases |
| `audit` | Validation — Accessibility, performance, theming, responsive checks |
| `normalize` | Consistency — Design system alignment, token usage |
| `extract` | System — Extract reusable components and design tokens |
| `playwright-cli` | **Core** — Browser automation, screenshots, visual validation |
| `opentui` | Terminal UI — Components, layout, keyboard, animations |
| `typescript-react-reviewer` | Review — React code quality and anti-patterns |
| `workflow-creator` | Meta — Create workflows using the SDK |

### Browser Automation (Playwright)

The `playwright-cli` skill provides:
- Page navigation, screenshots, and visual snapshots
- Element interaction (click, fill, hover, drag)
- Network request interception and mocking
- Console message capture
- Session and storage state management
- Video recording and tracing
- Test generation from interactions

---

## Part 3: Phase-by-Phase SDK Mapping

### Phase 1: Design System Onboarding → `design-system-builder` stage

**What to build:**

```
Stage: design-system-builder (visible)
Agent: orchestrator or custom "design-system-builder" agent
Skills: impeccable, extract, normalize, colorize, typeset
```

| Claude Design Capability | Atomic SDK Mapping | Status |
|---|---|---|
| Read codebase for design tokens | `codebase-locator` + `codebase-analyzer` (headless stages) | **Exists** |
| Extract colors, fonts, spacing | `extract` skill + custom prompt in `helpers/design-system.ts` | **Partial** — skill exists, prompt needs authoring |
| Read design files (DOCX/PPTX/XLSX) | `liteparse` skill | **Exists** |
| Human-in-the-loop approval | `ctx.stage()` with visible session — user interacts in tmux pane | **Exists** — Ralph's planner stage pattern |
| Persist design system | Write to `.open-claude-design/design-system.json` or similar | **New** — needs file format design |
| Multiple design systems | Config flag or prompt input | **New** |

**Implementation approach:**
1. Headless `codebase-locator` stage finds CSS/Tailwind/design files
2. Headless `codebase-analyzer` stage extracts tokens (colors, fonts, spacing, components)
3. Visible `design-system-builder` stage presents findings, asks user to approve/modify
4. Helper function persists design system to a JSON/YAML file

### Phase 2: Import → `import` stage

**What to build:**

```
Stage: import (headless or visible depending on input type)
Skills: playwright-cli, liteparse
```

| Claude Design Capability | Atomic SDK Mapping | Status |
|---|---|---|
| Text prompt input | `ctx.inputs.prompt` — already the standard pattern | **Exists** |
| Image upload | Pass image path as input; Claude Opus vision processes it | **Exists** — model capability |
| Document upload (DOCX/PPTX/XLSX) | `liteparse` skill parses document → text/structure | **Exists** |
| Codebase reference | `codebase-locator` + `codebase-analyzer` stages | **Exists** |
| Web capture tool | `playwright-cli` skill: navigate to URL, take screenshot, extract DOM/CSS | **Exists** — skill is fully equipped |

**Implementation approach:**
1. Workflow input accepts `prompt` (text), `reference` (file/URL), and `design-system` (path)
2. If URL detected: headless stage with `playwright-cli` captures screenshot + DOM structure
3. If file detected: `liteparse` parses content
4. All inputs aggregated into a structured context for the generation stage

### Phase 3: Generation → `generator` stage

**What to build:**

```
Stage: generator (visible)
Agent: custom "design-generator" agent  
Skills: impeccable, shape, layout, colorize, typeset, delight
```

| Claude Design Capability | Atomic SDK Mapping | Status |
|---|---|---|
| Generate interactive prototype (HTML/CSS/JS) | Visible stage with `impeccable` skill — generates production-grade frontend code | **Exists** |
| Generate wireframes | `shape` skill — structured discovery → design brief → wireframe | **Exists** |
| Apply design system context | Inject design system from Phase 1 into prompt context | **New** — prompt template needed |
| Frontier design (voice/video/3D) | `impeccable` + `overdrive` skills; `animate` for motion | **Partial** — skills exist, 3D/shader would need model capability |

**Implementation approach:**
1. Build `buildGeneratorPrompt()` in `helpers/prompts.ts` that injects:
   - Design system (from Phase 1)
   - Import context (from Phase 2)
   - User's original prompt
   - Output type preference (prototype/wireframe/deck/collateral)
2. Visible stage generates first version — user sees output in real time
3. Output is HTML/CSS/JS written to a scratch directory

### Phase 4: Refinement → `refine-loop` (iterative stages)

**What to build:**

```
Stages: refine-{iteration} (visible, looped)
Agent: custom "design-refiner" agent
Skills: impeccable, critique, layout, polish, adapt, clarify
```

| Claude Design Capability | Atomic SDK Mapping | Status |
|---|---|---|
| Chat conversation refinement | Visible stage — user chats in tmux pane | **Exists** |
| Inline comments | Not directly available in TUI; fallback: reference elements by description/selector | **Adaptation needed** |
| Direct text editing | User can edit generated files directly; re-run validation | **Exists** — file system is accessible |
| Claude-generated adjustment sliders | Not applicable in TUI context; adaptation: Claude proposes variations, user picks | **Adaptation needed** |
| Drawing/annotation | Not applicable in TUI; adaptation: describe changes verbally | **N/A for TUI** |
| Global change propagation | Agent applies changes across all generated files | **Exists** — worker agent can do this |

**Implementation approach — borrowing from Ralph's review-debug loop:**

```typescript
for (let iteration = 1; iteration <= MAX_REFINEMENTS; iteration++) {
  // 1. User provides feedback in visible stage
  const feedback = await ctx.stage(
    { name: `refine-${iteration}` },
    { chatFlags: ["--agent", "design-refiner", ...SKIP_PERMS] },
    {},
    async (s) => {
      await s.session.query(buildRefinePrompt(prompt, { iteration, designDir }));
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    },
  );

  // 2. Parallel validation (critique + screenshot comparison)
  const [critiqueResult, screenshotResult] = await Promise.all([
    ctx.stage(
      { name: `critique-${iteration}`, headless: true },
      {}, {},
      async (s) => {
        const result = await s.session.query(
          buildCritiquePrompt(designDir),
          { agent: "reviewer", ...SUBAGENT_OPTS },
        );
        s.save(s.sessionId);
        return extractAssistantText(result, 0);
      },
    ),
    ctx.stage(
      { name: `screenshot-${iteration}`, headless: true },
      {}, {},
      async (s) => {
        // Use playwright to screenshot the generated HTML
        const result = await s.session.query(
          buildScreenshotValidationPrompt(designDir),
          { agent: "codebase-analyzer", ...SUBAGENT_OPTS },
        );
        s.save(s.sessionId);
        return extractAssistantText(result, 0);
      },
    ),
  ]);

  // 3. If user signals "done" or critique passes → break
  if (isRefinementComplete(feedback.result)) break;
}
```

### Phase 5: Collaboration → Out of scope for CLI workflow

Collaboration (multi-user shared sessions) is a web UI feature, not replicable in a CLI/TUI workflow. The open-source version can support:
- Generating shareable artifacts (HTML files, URLs)
- Committing designs to git for team access
- Exporting to formats others can use

### Phase 6: Export and Handoff → `export` stage

**What to build:**

```
Stage: export (visible or headless)
Agent: custom "design-exporter" agent
Skills: pdf, pptx, docx, handoff
```

| Claude Design Capability | Atomic SDK Mapping | Status |
|---|---|---|
| Export as HTML | Write generated files to output directory | **Trivial** |
| Export as PDF | `pdf` skill | **Exists** |
| Export as PPTX | `pptx` skill | **Exists** |
| Canva export | Would need Canva API integration via MCP | **New** |
| Claude Code handoff bundle | Package design + intent + tokens → handoff spec | **New** — key deliverable |

**Handoff bundle structure** (based on Claude Design's approach):

```
handoff/
├── design/                  ← Generated HTML/CSS/JS
├── design-system.json       ← Design tokens, colors, typography
├── design-intent.md         ← Reasoning behind design decisions
├── component-specs.md       ← Component specifications
├── interaction-specs.md     ← Interaction and state documentation
└── handoff-prompt.md        ← Ready-to-use prompt for Claude Code
```

---

## Part 4: Proposed Workflow Architecture

### Directory Structure

```
src/sdk/workflows/builtin/open-claude-design/
├── claude/index.ts              ← Main workflow definition
├── copilot/index.ts             ← Copilot provider (future)
├── opencode/index.ts            ← OpenCode provider (future)
└── helpers/
    ├── prompts.ts               ← All prompt builders
    ├── design-system.ts         ← Design system persistence/loading
    ├── web-capture.ts           ← URL capture via playwright
    ├── validation.ts            ← Critique/screenshot validation
    ├── export.ts                ← Export format generators
    └── handoff.ts               ← Claude Code handoff bundle
```

### Workflow Topology (Claude provider)

```
                    ┌─→ codebase-locator (headless)
                    │
  design-system ────┤─→ codebase-analyzer (headless)
  (visible, HIL)    │
                    └─→ file-parser (headless, if design files exist)
         │
         ▼
  import (headless) ─── web-capture (headless, if URL input)
         │
         ▼
  generator (visible) ─── applies design system + import context
         │
         ▼
  ┌────────────────────────────────────────────────┐
  │  Refinement Loop (bounded, like Ralph)          │
  │                                                 │
  │  refine-{i} (visible, HIL) ─→ user feedback    │
  │       │                                         │
  │       ├─→ critique-{i} (headless)               │
  │       └─→ screenshot-{i} (headless)             │
  │       │                                         │
  │       ▼                                         │
  │  apply-changes-{i} (visible) ─→ implements      │
  │       │                       feedback           │
  │       ▼                                         │
  │  (loop until user approves or MAX_REFINEMENTS)  │
  └────────────────────────────────────────────────┘
         │
         ▼
  export (visible) ─→ HTML / PDF / PPTX / handoff bundle
```

### Workflow Inputs

```typescript
defineWorkflow({
  name: "open-claude-design",
  description: "AI-powered design workflow: design system → generate → refine → export/handoff",
  inputs: [
    { name: "prompt", type: "text", required: true, description: "Design request" },
    { name: "reference", type: "text", required: false, description: "URL, file path, or codebase path for import" },
    { name: "output-type", type: "enum", required: false, values: ["prototype", "wireframe", "deck", "collateral", "frontier"], default: "prototype", description: "Type of design output" },
    { name: "design-system", type: "text", required: false, description: "Path to existing design system file" },
    { name: "skip-onboarding", type: "enum", required: false, values: ["true", "false"], default: "false", description: "Skip design system onboarding if already exists" },
  ],
})
```

### Key Prompt Builders Needed

| Function | Purpose | Reference Pattern |
|---|---|---|
| `buildDesignSystemPrompt()` | Onboarding: extract + propose design system | Ralph's `buildPlannerPrompt()` |
| `buildImportPrompt()` | Parse inputs: URL capture, file parse, codebase scan | deep-research's `buildLocatorPrompt()` |
| `buildGeneratorPrompt()` | Generate first version with design system context | Custom — combines impeccable + shape skills |
| `buildRefinePrompt()` | Refinement iteration with previous version context | Ralph's `buildOrchestratorPrompt()` |
| `buildCritiquePrompt()` | Design critique with structured output | Ralph's `buildReviewPrompt()` pattern |
| `buildScreenshotValidationPrompt()` | Visual validation via playwright screenshot | Custom — uses playwright-cli skill |
| `buildExportPrompt()` | Generate export in requested format | Custom |
| `buildHandoffPrompt()` | Package handoff bundle with design intent | Custom — based on Claude Design's handoff spec |

---

## Part 5: Existing Capabilities vs. New Work

### Already Exists (can be directly reused)

| Capability | Source |
|---|---|
| Workflow SDK (`defineWorkflow`, `ctx.stage`, `Promise.all`) | `src/sdk/define-workflow.ts`, `src/sdk/runtime/executor.ts` |
| Sub-agent dispatch (headless + visible) | `src/sdk/providers/claude.ts` |
| Iterative loop with exit condition | Ralph workflow pattern (`ralph/claude/index.ts`) |
| Parallel review/validation passes | Ralph's dual-reviewer pattern |
| Codebase analysis (locator + analyzer + pattern-finder) | deep-research-codebase pattern |
| Design skills (impeccable, critique, shape, layout, etc.) | `.agents/skills/` |
| Browser automation (playwright-cli) | `.agents/skills/playwright-cli/` |
| Document parsing (DOCX/PPTX/XLSX) | `liteparse` skill |
| Export formats (PDF, PPTX) | `pdf` and `pptx` skills |
| Git changeset capture | `ralph/helpers/git.ts` |
| Prompt builder pattern | `ralph/helpers/prompts.ts` |
| Structured review output (Zod schemas) | `ralph/helpers/prompts.ts` |
| Workflow registration/discovery | `src/sdk/runtime/discovery.ts` |

### Needs to Be Built

| Capability | Complexity | Notes |
|---|---|---|
| Design system extractor/persister | Medium | Read codebase → extract tokens → persist JSON |
| Web capture helper (URL → screenshot + DOM) | Low | Playwright-cli skill already does this; needs a helper wrapper |
| Generator prompt template | Medium | Combine design system + inputs → generation prompt |
| Refinement loop controller | Low | Follow Ralph's iterative loop pattern |
| Critique/validation structured output | Medium | Adapt Ralph's `ReviewResultSchema` for design critique |
| Screenshot comparison/validation | Medium | Use playwright to capture, model to compare |
| Export helper (HTML/PDF/PPTX) | Low | Thin wrappers around existing skills |
| Handoff bundle packager | Medium | Design intent extraction + token/spec packaging |
| Custom agent definitions | Low | New `.claude/agents/design-*.md` files |

### Not Applicable (CLI/TUI limitations)

| Claude Design Feature | Why N/A | Alternative |
|---|---|---|
| Inline comments on elements | Web UI feature | Describe elements verbally in chat |
| Claude-generated adjustment sliders | Web UI feature | Claude proposes variations, user picks |
| Drawing/annotation on canvas | Web UI feature | Verbal descriptions of desired changes |
| Multi-user collaboration | Web UI feature | Git-based sharing, exported artifacts |
| Real-time slider tweaking | Web UI feature | Iterative prompt refinement |

---

## Part 6: Plugin Commands Mapping

The Claude Design plugin commands map directly to existing Atomic skills:

| Plugin Command | Atomic Skill(s) | Implementation |
|---|---|---|
| `/critique` | `critique` skill | Already exists — structured design feedback |
| `/design-system` | `extract` + `normalize` skills | Already exists — audit/extend component libraries |
| `/handoff` | New `handoff` helper | Needs implementation — measurements, tokens, states |
| `/ux-copy` | `clarify` skill | Already exists — microcopy, error messages, UX writing |
| `/accessibility` | `audit` skill | Already exists — WCAG compliance checks |
| `/research-synthesis` | `research-codebase` skill | Already exists — condense research into insights |

---

## Code References

- `src/sdk/define-workflow.ts:186-195` — `defineWorkflow()` entry point
- `src/sdk/workflows/builtin/ralph/claude/index.ts:54-248` — Ralph workflow (primary implementation reference)
- `src/sdk/workflows/builtin/ralph/helpers/prompts.ts:1-1078` — Ralph prompt builders (pattern reference)
- `src/sdk/workflows/builtin/ralph/helpers/review.ts:1-33` — Review analysis helpers
- `src/sdk/workflows/builtin/ralph/helpers/git.ts:1-201` — Git changeset capture
- `src/sdk/workflows/builtin/deep-research-codebase/claude/index.ts:96-413` — Deep research workflow (parallel sub-agent pattern)
- `src/sdk/workflows/index.ts:1-116` — Workflow SDK public exports
- `src/sdk/runtime/discovery.ts` — Workflow discovery and registration
- `src/sdk/runtime/loader.ts` — Workflow loading pipeline
- `src/sdk/runtime/executor.ts` — Workflow execution runtime
- `src/sdk/providers/claude.ts` — Claude provider (session, query, extract)
- `.agents/skills/impeccable/SKILL.md` — Core design skill
- `.agents/skills/critique/SKILL.md` — Design critique skill
- `.agents/skills/shape/SKILL.md` — UX/UI planning skill
- `.agents/skills/playwright-cli/SKILL.md` — Browser automation skill
- `.impeccable.md` — Project design context

## Architecture Documentation

The Atomic workflow SDK follows these patterns:

1. **Builder pattern**: `defineWorkflow().for<A>().run().compile()` creates a sealed `WorkflowDefinition`
2. **Stage-based orchestration**: `ctx.stage()` manages full sub-agent lifecycle (tmux window, provider init, callback, transcript save)
3. **Dual execution modes**: Visible stages spawn tmux windows with CLI flags; headless stages use Agent SDK's in-process `query()`
4. **Helpers pattern**: Prompt text and domain logic live in `helpers/`, topology in `index.ts`
5. **Parallel execution**: `Promise.all()` + `GraphFrontierTracker` for automatic topology inference
6. **Discovery**: Built-in workflows at `src/sdk/workflows/builtin/<name>/<agent>/index.ts`, reserved names cannot be overridden

## Historical Context (from research/)

- `research/docs/2026-01-31-atomic-current-workflow-architecture.md` — Comprehensive workflow architecture analysis
- `research/docs/2026-01-31-claude-agent-sdk-research.md` — Claude Agent SDK research
- `research/docs/2026-02-02-atomic-builtin-workflows-research.md` — Built-in workflows research
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Pluggable workflows SDK design
- `research/docs/2026-02-25-workflow-sdk-design.md` — Workflow SDK design
- `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md` — Ralph workflow redesign analysis

## Related Research

- `research/docs/2026-04-17-claude-design-product-analysis.md` — Detailed Claude Design product analysis
- `research/web/2026-04-17-claude-design-anthropic-labs.md` — Raw source collection from online research

## Open Questions

1. **Design system persistence format**: JSON vs YAML vs TypeScript? Where should it be stored (`.open-claude-design/` in project root)?
2. **Refinement exit condition**: Should the user explicitly signal "done", or should the workflow detect satisfaction from conversation context?
3. **Screenshot validation approach**: Use playwright to render generated HTML and compare screenshots, or rely purely on model-based visual critique?
4. **Handoff bundle format**: What exact structure for the Claude Code handoff? Should it include a ready-to-use prompt or just specs?
5. **Frontier design scope**: How much of the voice/video/3D/shader capability is achievable in CLI context? Should this be deferred?
6. **Multi-agent scope for Claude-only vs. all providers**: Start with Claude-only (like deep-research), or scaffold all three providers from the start?
7. **Custom agent definitions**: Should we create new agents (`design-generator`, `design-refiner`, `design-exporter`) or reuse existing agents with skill-specific prompts?
