---
date: 2026-03-22 18:05:41 UTC
researcher: Copilot (Claude Opus 4.6 1M)
git_commit: 27da30b864329c64c6cf513dfc00976991aa4f70
branch: lavaman131/feature/workflow-refactor
repository: atomic
topic: "Ralph Workflow Review/Debug Loop Termination — Back-to-Back Clean Reviews & Configurable Max Stages"
tags: [research, codebase, ralph, workflow, reviewer, debugger, termination, loop, graph-builder, conductor]
status: complete
last_updated: 2026-03-22
last_updated_by: Copilot
---

# Research: Ralph Workflow Review/Debug Loop & Termination Conditions

## Research Question

> How does the Ralph workflow's review/debug cycle currently work, and what
> needs to change to require **back-to-back clean reviewer passes** before
> termination, with a **configurable max-stages cap** (default 100)?

## Summary

The Ralph workflow today is a **strictly linear, single-pass pipeline**:
`Planner → Orchestrator → Reviewer → Debugger(conditional)`. There is **no
loop** around the review/debug cycle. The reviewer runs once; if it finds
actionable issues, the debugger runs once to fix them — and the workflow ends.
There is no mechanism to re-review after fixes.

To implement the desired behavior, three changes are needed:

1. **Wrap the Reviewer → Debugger stages in a `.loop()` / `.endLoop()` block**
   within the DSL definition, so the workflow can iterate the review/debug
   cycle multiple times.
2. **Track consecutive clean review count** in the loop's `until` predicate,
   requiring ≥2 back-to-back reviewer passes with zero actionable findings
   before exiting.
3. **Add a configurable `maxStages` parameter** to the workflow definition
   construction. The DSL's `LoopConfig` already supports `maxIterations`
   (defaults to 100 in the lower-level `GraphBuilder` but is **required** in
   the DSL's `LoopConfig`), so this is plumbed directly.

## Detailed Findings

### 1. Current Ralph Workflow Definition

**File**: `src/services/workflows/ralph/definition.ts:71-151`

The workflow is defined using the chainable DSL:

```typescript
export const ralphWorkflowDefinition = defineWorkflow("ralph", "...")
  .version("1.0.0")
  .stage("planner",    { ... })   // Line 77
  .stage("orchestrator", { ... }) // Line 84
  .stage("reviewer",   { ... })   // Line 112
  .if((ctx) => hasActionableFindings(ctx.stageOutputs))  // Line 126
  .stage("debugger",   { ... })   // Line 127
  .endIf()                         // Line 150
  .compile();
```

**Key observation**: The `.if()` / `.endIf()` block is a **conditional**, not a
loop. The debugger either runs or is skipped — the pipeline does not circle
back to the reviewer after the debugger finishes.

### 2. The `hasActionableFindings` Predicate

**File**: `src/services/workflows/ralph/definition.ts:50-65`

```typescript
function hasActionableFindings(
  stageOutputs: ReadonlyMap<string, StageOutput>,
): boolean {
  const reviewerOutput = stageOutputs.get("reviewer");
  if (!reviewerOutput || reviewerOutput.status !== "completed") return false;
  const review = getReviewResult(stageOutputs);
  if (review !== null && review.findings.length > 0) return true;
  if (review === null && reviewerOutput.rawResponse.trim().length > 0)
    return true;
  return false;
}
```

This function:
1. Returns `false` if the reviewer hasn't completed
2. Returns `true` if the parsed `ReviewResult` has `findings.length > 0`
3. Returns `true` if parsing failed but the raw response is non-empty
   (conservative fallback — treats unstructured output as actionable)
4. Returns `false` otherwise (clean review)

### 3. Review Result Parsing

**File**: `src/services/workflows/ralph/prompts.ts:529-588`

`parseReviewResult()` attempts three JSON extraction strategies:
1. Direct `JSON.parse(content)` — looks for `{findings, overall_correctness}`
2. Markdown code fence extraction (`\`\`\`json ... \`\`\``)
3. Regex match for a JSON object containing `"findings"`

In all cases, findings with `priority > 2` (P3, low-priority) are **filtered
out** before returning. Only P1/P2 findings are considered actionable.

The `ReviewResult` type (`prompts.ts:326-331`) includes:
- `findings: ReviewFinding[]`
- `overall_correctness: string`
- `overall_explanation: string`
- `overall_confidence_score: number`

### 4. How Conditional Execution Works (The `shouldRun` Mechanism)

**Files**: `src/services/workflows/dsl/compiler.ts:165-192, 362-368`

The DSL compiler does **not** produce decision nodes for `if`/`else`/`endIf`
blocks. Instead:

1. `computeShouldRunMap()` walks the instruction list, maintaining a condition
   stack. For each `"stage"` instruction inside a conditional block, it
   associates the stage ID with the enclosing condition function.
2. The compiled graph is **purely linear**: `planner → orchestrator → reviewer
   → debugger`. No branching in the graph structure.
3. At runtime, the conductor evaluates `stage.shouldRun(context)` before each
   agent stage (`conductor.ts:237-246`). If it returns `false`, the stage is
   skipped with an empty response.

This means the current `if()` block sets `shouldRun` on the debugger stage =
`(ctx) => hasActionableFindings(ctx.stageOutputs)`.

### 5. DSL Loop Support

**File**: `src/services/workflows/dsl/types.ts:138-150`

```typescript
export interface LoopConfig {
  readonly until: (context: StageContext) => boolean;
  readonly maxIterations: number;
}
```

**File**: `src/services/workflows/dsl/types.ts:281-361` (WorkflowBuilderInterface)

The DSL already supports `.loop(config)` and `.endLoop()` methods. The
builder records `{ type: "loop", config }` and `{ type: "endLoop" }`
instructions.

### 6. How DSL Loops Compile to Graphs

**File**: `src/services/workflows/dsl/compiler.ts:370-398`

When the compiler encounters a `loop` instruction:
1. Creates `__loop_start_N` and `__loop_check_N` decision nodes
2. Wires `previousNode → loop_start`
3. On `endLoop`, wires `lastBodyNode → loop_check` and adds a **back-edge**
   `loop_check → loop_start` with `condition: () => true`
4. Sets `previousNodeId = loopCheckNodeId` so subsequent stages chain after it

**Important**: The DSL compiler's loop back-edge currently uses `condition:
() => true` (always loop). The actual loop termination is **not enforced by
the graph** in DSL-compiled workflows. This differs from the low-level
`GraphBuilder`, which embeds the `until` predicate + `maxIterations` counter
directly into the loop edges.

The conductor's `stepCount < maxSteps` check (`conductor.ts:137`) acts as the
safety limit: `maxSteps = config.maxIterations ?? 100`.

### 7. Conductor Execution Loop

**File**: `src/services/workflows/conductor/conductor.ts:125-202`

```
while (nodeQueue.length > 0 && stepCount < maxSteps)
```

Key mechanics:
- `MAX_STEPS = 100` (conductor.ts:58) — hard-coded constant
- `maxSteps = config.maxIterations ?? MAX_STEPS` — configurable via
  `ConductorConfig.maxIterations` (`types.ts:410`)
- `stepCount` increments for every node processed (including decision nodes)
- Nodes with `"loop_"` in their ID are exempt from cycle-detection duplicate
  checks (`conductor.ts:150-153`)

### 8. How `stageOutputs` Accumulate

**File**: `src/services/workflows/conductor/conductor.ts:280, 491-508`

Each completed stage's output is stored in `this.stageOutputs.set(nodeId,
output)`. When a stage runs multiple times in a loop, its output is
**overwritten** — the map uses the stage ID as the key. This means:

- In the proposed loop, each reviewer iteration would **overwrite** the
  previous reviewer's `StageOutput`
- The `hasActionableFindings()` function reads from `stageOutputs.get
  ("reviewer")`, so it always sees the **latest** review
- No built-in history of past reviews exists — consecutive-clean-review
  tracking must be added as external state

### 9. GraphBuilder's Lower-Level Loop (For Reference)

**File**: `src/services/workflows/graph/authoring/iteration-dsl.ts:46-132`

The `GraphBuilder.loop()` method (used by `templates.ts:reviewCycle`,
`taskLoop`) provides a more sophisticated loop with:
- Iteration counter stored in `state.outputs["{loopStartId}_iteration"]`
- Continue-edge condition: `!config.until(state) && iteration < maxIterations`
- Exit-edge condition: `config.until(state) || iteration >= maxIterations`
- Default `maxIterations: 100` (`iteration-dsl.ts:60`)

The `LoopConfig` for the low-level builder (`authoring/types.ts:10-13`):
```typescript
interface LoopConfig<TState> {
  until: EdgeCondition<TState>;
  maxIterations?: number; // defaults to 100
}
```

### 10. Graph Templates Using Loops

**File**: `src/services/workflows/graph/templates.ts`

Two templates use `.loop()`:

| Template | Body Nodes | `maxIterations` |
|----------|-----------|-----------------|
| `reviewCycle()` (line 180-191) | `[executor, reviewer, fixer]` | passthrough from options |
| `taskLoop()` (line 196-211) | `[worker, optional reviewer]` | passthrough from options |

These are not used by the current Ralph definition (which uses the DSL), but
demonstrate the pattern for a review cycle loop.

## Architecture Documentation

### Current Flow (Single-Pass)

```
PLANNER ──→ ORCHESTRATOR ──→ REVIEWER ──→ DEBUGGER(conditional) ──→ END
                                                │
                                       hasActionableFindings?
                                       ├─ true  → runs debugger
                                       └─ false → skips debugger
```

### Proposed Flow (Looped Review/Debug)

```
PLANNER ──→ ORCHESTRATOR ──→ ┌─────────── LOOP ──────────────┐
                             │  REVIEWER                      │
                             │    │                           │
                             │    ├─ findings? → DEBUGGER     │
                             │    │              (continue)    │
                             │    └─ clean? → check counter   │
                             │         ├─ < 2 consecutive     │
                             │         │   clean → continue    │
                             │         └─ ≥ 2 consecutive     │
                             │             clean → exit loop   │
                             └────────────────────────────────┘
                                              │
                                             END
```

### Key Interfaces for the Modification

| Interface | File | Relevance |
|-----------|------|-----------|
| `LoopConfig` | `dsl/types.ts:138-150` | Loop termination config — `until` + `maxIterations` |
| `StageContext` | `conductor/types.ts:237-262` | Context passed to `until` predicate and `shouldRun` |
| `StageOutput` | `conductor/types.ts:183-204` | Stage output stored in `stageOutputs` map |
| `ConductorConfig.maxIterations` | `conductor/types.ts:410` | Conductor-level step limit (default 100) |
| `hasActionableFindings` | `ralph/definition.ts:50-65` | Current review-pass decision function |
| `WorkflowBuilderInterface` | `dsl/types.ts:281-361` | DSL API with `.loop()` / `.endLoop()` |

### Modification Strategy

**Option A — Track in the `until` predicate via closure state**:
Use a closure variable outside the DSL chain to track consecutive clean
reviews. The `until` predicate increments/resets the counter based on the
latest reviewer output.

```typescript
let consecutiveCleanReviews = 0;

defineWorkflow("ralph", "...")
  .stage("planner", { ... })
  .stage("orchestrator", { ... })
  .loop({
    until: (ctx) => {
      if (!hasActionableFindings(ctx.stageOutputs)) {
        consecutiveCleanReviews++;
      } else {
        consecutiveCleanReviews = 0;
      }
      return consecutiveCleanReviews >= 2;
    },
    maxIterations: 100, // configurable
  })
  .stage("reviewer", { ... })
  .if((ctx) => hasActionableFindings(ctx.stageOutputs))
  .stage("debugger", { ... })
  .endIf()
  .endLoop()
  .compile();
```

**Concern**: The `until` predicate in the DSL's `LoopConfig` is evaluated by
the graph loop-check mechanism. However, in DSL-compiled graphs, the
loop back-edge has `condition: () => true` (always loop), and the actual
loop termination relies on the conductor's `stepCount < maxSteps` check.
The `until` predicate from `LoopConfig` is **currently unused** by the DSL
compiler's `generateGraph()` function — it's stored in the instruction but
only the low-level `GraphBuilder` uses it.

**This means** the DSL loop today has no `until` enforcement — it relies
entirely on `MAX_STEPS`. To make `until` work in the DSL loop, either:

1. The conductor must be enhanced to evaluate the `until` predicate at each
   `__loop_check_N` node, or
2. The DSL compiler must embed the `until` predicate into the loop-check
   edges (like the low-level `GraphBuilder` does), or
3. The implementation uses a different mechanism entirely (e.g., a custom
   control node that checks the consecutive count).

**Option B — Use `shouldRun` on a gate stage**:
Instead of a DSL loop, add a custom tool node that acts as a "gate" or use
the low-level `GraphBuilder` directly with `reviewCycle()` template.

**Option C — Hybrid approach**:
Keep the DSL definition but add a custom tool node inside the loop that
tracks review history and signals loop exit via state mutation.

### Important Caveats

1. **`stageOutputs` overwrites**: In a loop, each reviewer run overwrites the
   previous output at key `"reviewer"`. The `until` predicate (or custom node)
   must inspect the latest output before it's overwritten by the next
   iteration.

2. **`stepCount` vs loop iterations**: The conductor counts all node visits
   (including `__loop_start`, `__loop_check`, and decision nodes). A single
   review/debug iteration consumes multiple steps. `maxIterations: 100` means
   100 *graph steps*, not 100 review cycles. For 100 actual review/debug
   cycles, the `maxIterations` may need to be higher (roughly
   `100 * nodesPerIteration`).

3. **DSL `until` predicate is not wired**: As documented above, the DSL
   compiler stores the `LoopConfig.until` in the instruction tape but does
   not use it in `generateGraph()`. The loop back-edge is unconditional.
   This must be addressed for the feature to work correctly.

4. **Prompt context**: In a multi-iteration review/debug loop, the reviewer
   needs context about what was fixed since its last review. The debugger's
   output (side-effectual — `outputMapper: () => ({})`) does not produce
   structured output. The reviewer's prompt builder may need enhancement to
   reference prior review/fix iterations.

## Code References

- `src/services/workflows/ralph/definition.ts:50-65` — `hasActionableFindings()` predicate
- `src/services/workflows/ralph/definition.ts:71-151` — Full workflow definition
- `src/services/workflows/ralph/prompts.ts:529-588` — `parseReviewResult()` parser
- `src/services/workflows/ralph/prompts.ts:334-420` — `buildReviewPrompt()` builder
- `src/services/workflows/ralph/prompts.ts:424-522` — `buildFixSpecFromReview()` / `buildFixSpecFromRawReview()`
- `src/services/workflows/dsl/types.ts:138-150` — DSL `LoopConfig` interface
- `src/services/workflows/dsl/types.ts:281-361` — `WorkflowBuilderInterface` (loop/endLoop)
- `src/services/workflows/dsl/compiler.ts:370-398` — DSL loop compilation to graph nodes
- `src/services/workflows/dsl/compiler.ts:165-192` — `computeShouldRunMap()` for `shouldRun`
- `src/services/workflows/dsl/compiler.ts:362-368` — Conditional blocks ignored in graph generation
- `src/services/workflows/conductor/conductor.ts:58` — `MAX_STEPS = 100`
- `src/services/workflows/conductor/conductor.ts:125-202` — Main graph-walk loop
- `src/services/workflows/conductor/conductor.ts:135-137` — `maxSteps` enforcement
- `src/services/workflows/conductor/conductor.ts:237-246` — `shouldRun` evaluation
- `src/services/workflows/conductor/types.ts:410` — `ConductorConfig.maxIterations`
- `src/services/workflows/graph/authoring/iteration-dsl.ts:46-132` — Low-level loop with `until` + counter
- `src/services/workflows/graph/templates.ts:180-191` — `reviewCycle()` template

## Historical Context (from research/)

- `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md` — Most recent architecture inventory; confirms single-pass review, no loop around review/debug
- `research/docs/2026-03-18-ralph-eager-dispatch-research.md` — Eager dispatch research; documents worker loop (not review loop)
- `research/docs/2026-02-25-ralph-workflow-implementation.md` — Earlier implementation details
- `research/docs/2026-02-09-163-ralph-loop-enhancements.md` — Ralph loop enhancements (worker loop only)
- `specs/ralph-workflow-redesign.md` — Session-based prompt-chained architecture proposal
- `specs/ralph-loop-enhancements.md` — Worker loop iteration improvements

## Related Research

- `research/docs/2026-03-21-workflow-sdk-simplification-z3-verification.md` — Z3 formal verification for loop bounds
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Graph engine internals
- `research/docs/2026-01-31-workflow-config-semantics.md` — Workflow configuration semantics

## Open Questions

1. **DSL `until` wiring gap**: The DSL compiler does not embed the `until`
   predicate into loop edges. Should this be fixed in the compiler (to match
   the low-level `GraphBuilder` behavior), or should an alternative mechanism
   be used for termination control?

2. **Step count semantics**: `ConductorConfig.maxIterations` counts raw graph
   steps, not loop iterations. Should a new `maxReviewCycles` config be added
   for domain-level counting, or should `maxIterations` be reinterpreted?

3. **Consecutive clean review state**: Where should the counter live?
   - Closure variable (simple but not serializable/checkpointable)
   - Custom state field via `.state()` schema (persistent, but adds complexity)
   - Custom tool node that manages the counter in `state.outputs`

4. **Reviewer prompt evolution**: After the debugger applies fixes, the next
   reviewer iteration needs to know what changed. Should the reviewer prompt
   builder be enhanced to include the debugger's fix summary, or does the
   shared `stageOutputs` map provide enough context?
