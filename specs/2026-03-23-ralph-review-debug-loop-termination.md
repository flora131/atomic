# Ralph Review/Debug Loop Termination — Back-to-Back Clean Reviews & Configurable Max Stages

| Document Metadata      | Details     |
| ---------------------- | ----------- |
| Author(s)              | lavaman131  |
| Status                 | Draft (WIP) |
| Team / Owner           | Atomic CLI  |
| Created / Last Updated | 2026-03-22  |

## 1. Executive Summary

The Ralph workflow currently executes its review/debug stages as a **single-pass linear pipeline**: the reviewer runs once, the debugger optionally runs once to fix issues, and the workflow terminates — regardless of whether the fixes were correct. This spec proposes introducing an **iterative review/debug loop** that requires **two consecutive clean reviewer passes** (zero P1/P2 findings) before exiting, bounded by a **configurable `maxCycles` cap** (default 100 cycles) on `LoopConfig`. The implementation requires four changes: (1) fixing the DSL compiler's broken loop termination by wiring the `until` predicate (now accepting `BaseState` directly) and a per-loop `maxCycles` counter into back-edges, (2) adding a `.break()` DSL instruction for early loop exit, (3) wrapping the reviewer and debugger stages in a `.loop()` / `.endLoop()` block with `.break()` on clean reviews, and (4) enhancing the reviewer prompt to include the prior-iteration debugger output.

> **Research basis**: [research/docs/2026-03-22-ralph-review-debug-loop-termination.md](../research/docs/2026-03-22-ralph-review-debug-loop-termination.md)

## 2. Context and Motivation

### 2.1 Current State

The Ralph workflow is defined via the chainable DSL in `src/services/workflows/ralph/definition.ts` as four sequential stages:

```
PLANNER ──→ ORCHESTRATOR ──→ REVIEWER ──→ DEBUGGER(conditional) ──→ END
```

- **Planner**: Decomposes the user prompt into a structured task list.
- **Orchestrator**: Dispatches tasks in parallel via sub-agent tools.
- **Reviewer**: Reviews the completed implementation for correctness issues. Outputs a structured `ReviewResult` with findings and an overall verdict.
- **Debugger**: Conditionally runs when `hasActionableFindings()` returns `true` (P1/P2 findings detected). Applies fixes based on the review findings.

The `.if()` / `.endIf()` block around the debugger is purely conditional — the DSL compiler does not generate decision/branching nodes. Instead, it sets a `shouldRun` predicate on the debugger `StageDefinition`, and the conductor skips the stage if `shouldRun` returns `false` (ref: `compiler.ts:165-192`, `conductor.ts:237-246`).

**Architecture**: The DSL compiler (`dsl/compiler.ts`) transforms the builder's instruction tape into a `CompiledGraph` with nodes and edges. The `WorkflowSessionConductor` (`conductor/conductor.ts`) walks the graph node-by-node, executing agent stages and evaluating edge conditions to determine the next node.

### 2.2 The Problem

1. **No re-review after fixes**: The debugger applies fixes and the workflow terminates. There is no mechanism to verify that the fixes are correct or complete. A single reviewer pass may miss issues that only become apparent after initial fixes are applied.

2. **No confidence in fix quality**: Without iterative review, the workflow cannot guarantee that the final state of the codebase is clean. Users must manually re-run the entire workflow to validate debugger fixes.

3. **DSL `until` predicate is dead code**: The DSL compiler's `endLoop` handler hardcodes the loop back-edge condition as `() => true` (`compiler.ts:391-394`). The `LoopConfig.until` predicate is stored in the instruction but **never referenced** during graph generation. This means any DSL-based loop today loops unconditionally until `MAX_STEPS` (100 raw graph steps) is hit — a critical gap compared to the low-level `GraphBuilder` which correctly embeds `until` + iteration counter (ref: `iteration-dsl.ts:112-122`).

4. **Step count ≠ loop iterations**: `ConductorConfig.maxIterations` counts raw graph node visits (including `__loop_start`, `__loop_check`, decision nodes), not logical loop iterations. Each review/debug cycle consumes ~4-5 graph steps, so `maxIterations: 100` yields only ~20-25 actual review/debug cycles.

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] **G1**: Wrap the reviewer → debugger stages in a `.loop()` / `.endLoop()` block so the workflow iterates the review/debug cycle.
- [ ] **G2**: The loop terminates when the reviewer produces ≥2 consecutive clean passes (zero P1/P2 findings).
- [ ] **G3**: The loop is bounded by a configurable `maxReviewCycles` parameter (default 100 review/debug cycles), preventing runaway loops.
- [ ] **G4**: Fix the DSL compiler to wire the `LoopConfig.until` predicate into the loop-check back-edge condition, matching the low-level `GraphBuilder` behavior.
- [ ] **G5**: The reviewer receives context about what the debugger fixed in the previous iteration so it can perform an informed re-review.
- [ ] **G6**: The `maxReviewCycles` parameter counts logical loop iterations (reviewer→debugger cycles), not raw graph steps.

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT change the worker/task loop (planner → orchestrator cycle). That is a separate loop (ref: `specs/2026-02-09-ralph-loop-enhancements.md`).
- [ ] We will NOT add checkpointing/serialization for loop state in this version.
- [ ] We will NOT change the review priority filtering logic (P3 findings remain filtered out).
- [ ] We will NOT migrate the Ralph definition from the DSL to the low-level `GraphBuilder` — we fix the DSL instead.
- [ ] We will NOT add a UI for configuring `maxReviewCycles` at runtime — configuration is via the workflow definition.

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture Diagram

#### Current Flow (Single-Pass)
```
PLANNER ──→ ORCHESTRATOR ──→ REVIEWER ──→ DEBUGGER(conditional) ──→ END
```

#### Proposed Flow (Iterative Review/Debug Loop)
```
PLANNER ──→ ORCHESTRATOR ──→ ┌──────────── LOOP ──────────────────┐
                             │  REVIEWER                          │
                             │    │                               │
                             │    ├─ findings? → DEBUGGER         │
                             │    │              (reset counter,   │
                             │    │               continue loop)   │
                             │    └─ clean? → increment counter   │
                             │         ├─ < 2 consecutive clean   │
                             │         │   → continue loop         │
                             │         └─ ≥ 2 consecutive clean   │
                             │             → exit loop             │
                             └────────────────────────────────────┘
                                              │
                                             END
```

### 4.2 Architectural Pattern

We adopt an **iterative convergence loop** pattern: the review/debug cycle repeats until the output stabilizes (two consecutive clean reviews = convergence signal), bounded by a hard iteration cap for safety. This is a well-established pattern already present in the codebase via the low-level `GraphBuilder.loop()` and `reviewCycle()` template (`graph/templates.ts:180-191`).

### 4.3 Key Components

| Component                | Responsibility                                           | File                  | Change Type   |
| ------------------------ | -------------------------------------------------------- | --------------------- | ------------- |
| DSL Compiler (`endLoop`) | Wire `LoopConfig.until` into loop-check back-edge        | `dsl/compiler.ts`     | **Fix (bug)** |
| DSL Compiler (`endLoop`) | Embed iteration counter in loop-check node               | `dsl/compiler.ts`     | **Enhance**   |
| Ralph Definition         | Add `.loop()` / `.endLoop()` around reviewer+debugger    | `ralph/definition.ts` | **Modify**    |
| Ralph Definition         | Define `until` predicate with consecutive-clean tracking | `ralph/definition.ts` | **New**       |
| Reviewer Prompt Builder  | Accept and render prior-iteration fix context            | `ralph/prompts.ts`    | **Enhance**   |
| Conductor Config         | Document `maxReviewCycles` semantics                     | `conductor/types.ts`  | **Document**  |

## 5. Detailed Design

### 5.1 Phase 1: Fix DSL Compiler Loop Termination (Prerequisite)

**Problem**: The DSL compiler's `endLoop` handler (`compiler.ts:385-398`) creates a loop back-edge with `condition: () => true`, ignoring the `LoopConfig.until` predicate entirely. The low-level `GraphBuilder` (`iteration-dsl.ts:112-122`) correctly embeds both the `until` predicate and an iteration counter.

**Solution**: Align the DSL compiler's loop compilation with the `GraphBuilder` pattern.

#### 5.1.1 Loop Node Enhancement

The `__loop_start_N` decision node must initialize an iteration counter in `state.outputs`, and the `__loop_check_N` node must increment it — mirroring `iteration-dsl.ts:62-88`.

**Modify `compiler.ts` — `loop` case** (lines 370-383):

```typescript
case "loop": {
  const loopStartId = `__loop_start_${nodeCounter++}`;
  const loopCheckId = `__loop_check_${nodeCounter++}`;
  const loopConfig = instruction.config;
  const maxIter = loopConfig.maxIterations;

  // Loop start: initialize iteration counter in state.outputs
  const loopStartNode: NodeDefinition<BaseState> = {
    id: loopStartId,
    type: "decision",
    execute: async (ctx: ExecutionContext<BaseState>) => {
      const iterationKey = `${loopStartId}_iteration`;
      const current = (ctx.state.outputs[iterationKey] as number) ?? 0;
      return {
        stateUpdate: {
          outputs: { ...ctx.state.outputs, [iterationKey]: current },
        } as Partial<BaseState>,
      };
    },
  };

  // Loop check: increment iteration counter
  const loopCheckNode: NodeDefinition<BaseState> = {
    id: loopCheckId,
    type: "decision",
    execute: async (ctx: ExecutionContext<BaseState>) => {
      const iterationKey = `${loopStartId}_iteration`;
      const current = (ctx.state.outputs[iterationKey] as number) ?? 0;
      return {
        stateUpdate: {
          outputs: { ...ctx.state.outputs, [iterationKey]: current + 1 },
        } as Partial<BaseState>,
      };
    },
  };

  nodes.set(loopStartId, loopStartNode);
  nodes.set(loopCheckId, loopCheckNode);
  connectPrevious(loopStartId);
  loopStack.push({
    loopStartNodeId: loopStartId,
    loopCheckNodeId: loopCheckId,
    config: loopConfig,
  });
  previousNodeId = loopStartId;
  break;
}
```

#### 5.1.2 `LoopConfig` Interface Change

**File**: `src/services/workflows/dsl/types.ts` (lines 138-150)

Change the `until` predicate to accept `BaseState` directly instead of `StageContext`. This gives maximum flexibility — users can define custom state shapes for loops and access the full graph state in loop predicates.

```typescript
export interface LoopConfig<TState extends BaseState = BaseState> {
  /** Predicate evaluated before each iteration. Loop terminates when true. */
  readonly until: (state: TState) => boolean;

  /**
   * Hard upper bound on the number of loop cycles (not raw graph steps).
   * Prevents runaway loops even when `until` never returns true.
   * @default 100
   */
  readonly maxCycles?: number;
}
```

**Breaking change**: Existing `.loop()` calls that use `StageContext` in their `until` predicates must be updated to use `BaseState`. Since no DSL workflows currently use `.loop()` in production (the Ralph definition is the first), this is safe.

> **Note**: The low-level `GraphBuilder` (`iteration-dsl.ts`) already uses `EdgeCondition<TState>` (which accepts `TState extends BaseState`) for its loop conditions. This change aligns the DSL with the low-level API.

#### 5.1.3 Back-Edge Condition Fix

**Modify `compiler.ts` — `endLoop` case** (lines 385-398):

The back-edge must embed the `until` predicate + iteration counter. Since `until` now accepts `BaseState` directly, no adapter is needed.

```typescript
case "endLoop": {
  const ctx = loopStack.pop()!;
  const loopConfig = ctx.config;
  const maxCycles = loopConfig.maxCycles ?? 100;
  const iterationKey = `${ctx.loopStartNodeId}_iteration`;

  if (previousNodeId !== null) {
    edges.push({ from: previousNodeId, to: ctx.loopCheckNodeId });
  }

  // Continue edge: loop back when until() is false AND under max cycles
  edges.push({
    from: ctx.loopCheckNodeId,
    to: ctx.loopStartNodeId,
    condition: (state: BaseState) => {
      const currentIteration = (state.outputs[iterationKey] as number) ?? 0;
      return !loopConfig.until(state) && currentIteration < maxCycles;
    },
    label: "loop_continue",
  });

  previousNodeId = ctx.loopCheckNodeId;
  break;
}
```

#### 5.1.4 Loop Early Exit (`break`) Support

To support early-exit from loops (e.g., consecutive clean reviews triggering a break), add a `.break()` DSL instruction that, when compiled, produces an edge from the current node directly to the loop's exit node (the node after `__loop_check`).

**DSL API**:
```typescript
.loop({ until: ..., maxCycles: 100 })
  .stage("reviewer", { ... })
  .if((ctx) => !hasActionableFindings(ctx.stageOutputs))
    .break()  // exit loop immediately — skip debugger, continue to next stage
  .endIf()
  .stage("debugger", { ... })
.endLoop()
```

**Compiler**: The `break` instruction creates an edge from the current node to the enclosing loop's `__loop_check` node with `condition: () => true`, and the `__loop_check` node's exit edge (to the node after the loop) is taken when the `until` predicate is true or when reached via break. Alternatively, `.break()` can set a flag in `state.outputs` (e.g., `__loop_break_N: true`) that the loop-check exit edge evaluates.

> **Note**: The low-level `GraphBuilder` does not have explicit `break` support. This is a DSL-only convenience that compiles down to conditional edges.

### 5.2 Phase 2: Ralph Review/Debug Loop Definition

**File**: `src/services/workflows/ralph/definition.ts`

#### 5.2.1 Consecutive Clean Review Counter

Add a closure-scoped counter that tracks consecutive clean reviewer passes. This counter resets to 0 whenever actionable findings are detected, and increments by 1 on each clean pass. The loop uses `.break()` to exit early when the counter reaches the threshold.

```typescript
function createReviewLoopTerminator(
  stageOutputs: ReadonlyMap<string, StageOutput>,
  requiredConsecutiveClean = 2,
) {
  let consecutiveCleanReviews = 0;

  return {
    update: (): void => {
      if (!hasActionableFindings(stageOutputs)) {
        consecutiveCleanReviews++;
      } else {
        consecutiveCleanReviews = 0;
      }
    },
    shouldTerminate: (): boolean =>
      consecutiveCleanReviews >= requiredConsecutiveClean,
    reset: () => { consecutiveCleanReviews = 0; },
    getCount: () => consecutiveCleanReviews,
  };
}
```

> **Design note**: The factory function returns a fresh counter per workflow execution. The closure is simple and appropriate for the current non-checkpointed execution model. If checkpointing is added later, the counter can be migrated to `state.outputs` (ref: research §Option C — [research doc, "Modification Strategy"](../research/docs/2026-03-22-ralph-review-debug-loop-termination.md)).

#### 5.2.2 Modified Workflow Definition

The loop uses `maxCycles: 100` (configurable), an `until` predicate that checks the consecutive-clean counter, and `.break()` for early exit when the reviewer finds no actionable issues and the threshold is met:

```typescript
const reviewTerminator = createReviewLoopTerminator(/* stageOutputs ref */);

export const ralphWorkflowDefinition = defineWorkflow("ralph", "...")
  .version("1.0.0")
  .argumentHint('"<prompt-or-spec-path>"')
  .stage("planner", { /* unchanged */ })
  .stage("orchestrator", { /* unchanged */ })
  .loop({
    until: (_state) => reviewTerminator.shouldTerminate(),
    maxCycles: 100,
  })
  .stage("reviewer", {
    /* ... existing config with enhanced prompt (see §5.3) ... */
  })
  .if((ctx) => !hasActionableFindings(ctx.stageOutputs))
    .break()  // No findings — check if we've reached 2 consecutive clean reviews
  .endIf()
  .stage("debugger", {
    /* ... existing config ... */
  })
  .endLoop()
  .compile();
```

**Flow per iteration**:
1. Reviewer runs and produces findings.
2. `if(!hasActionableFindings)` evaluates:
   - **Clean**: `.break()` exits the loop → proceeds to END. The `until` predicate (`shouldTerminate()`) checks the consecutive-clean counter. If ≥2, the loop exits. If <2, the loop continues (reviewer runs again without the debugger).
   - **Actionable findings**: Debugger runs, counter resets, loop continues.

> **Note on `.break()` semantics**: `.break()` exits to the `__loop_check` node, which evaluates the `until` predicate. If `until` returns `false`, the loop continues (back to `__loop_start`). If `until` returns `true`, the loop exits. This means `.break()` + `until` together implement the "2 consecutive clean reviews" logic: `.break()` skips the debugger on clean reviews, and `until` exits the loop when the counter reaches the threshold.

#### 5.2.3 Iteration Counting Semantics

The `maxCycles` parameter in `LoopConfig` counts **logical loop iterations** (one full pass through all body nodes), not raw graph steps. After the Phase 1 compiler fix, the `__loop_check` node increments a per-loop iteration counter in `state.outputs`, and the back-edge condition checks `currentIteration < maxCycles`. This means `maxCycles: 100` = 100 actual review/debug cycles.

The conductor's `MAX_STEPS` (100 raw graph steps) is no longer needed as a global limit. Loop termination is fully handled by the per-loop `maxCycles` counter, and non-looped graph segments are finite by construction. The `MAX_STEPS` constant and `stepCount < maxSteps` guard in the conductor should be **removed**.

### 5.3 Phase 3: Reviewer Prompt Enhancement

**File**: `src/services/workflows/ralph/prompts.ts`

#### 5.3.1 Problem

In a multi-iteration loop, the reviewer needs to know what the debugger changed in the previous iteration. Currently:
- The debugger's `outputMapper: () => ({})` produces no structured output.
- `stageOutputs.get("debugger")` contains `rawResponse` (the debugger's full agent response), but the reviewer prompt builder doesn't reference it.

#### 5.3.2 Solution

Enhance `buildReviewPrompt()` to accept an optional `priorDebuggerOutput` parameter. When present, include a "Previous Fix Context" section in the prompt so the reviewer can focus on verifying the fixes.

```typescript
export function buildReviewPrompt(
  tasks: TaskItem[],
  userPrompt: string,
  progressSummary: string,
  priorDebuggerOutput?: string,  // NEW parameter
): string {
  // ... existing prompt construction ...

  let prompt = `# Code Review Request\n\n...`;

  if (priorDebuggerOutput && priorDebuggerOutput.trim().length > 0) {
    prompt += `\n## Previous Iteration Fix Context

The debugger applied the following fixes in the previous review/debug iteration.
Focus your review on verifying these fixes are correct and complete, in addition
to checking for any new issues.

<previous_fixes>
${priorDebuggerOutput.trim()}
</previous_fixes>\n\n`;
  }

  // ... rest of prompt ...
  return prompt;
}
```

#### 5.3.3 Wiring in the Definition

Update the reviewer stage's `prompt` function to read the debugger's prior output from `stageOutputs`:

```typescript
.stage("reviewer", {
  name: "Reviewer",
  description: "\uD83D\uDD0D REVIEWER",
  reads: ["tasks"],
  outputs: ["reviewResult"],
  prompt: (ctx) => {
    const orchestratorOutput = ctx.stageOutputs.get("orchestrator");
    const progressSummary = orchestratorOutput?.rawResponse ?? "";
    const debuggerOutput = ctx.stageOutputs.get("debugger");
    const priorFixContext = debuggerOutput?.rawResponse;
    return buildReviewPrompt(
      [...ctx.tasks],
      ctx.userPrompt,
      progressSummary,
      priorFixContext,
    );
  },
  outputMapper: (response) => ({
    reviewResult: parseReviewResult(response),
  }),
})
```

> **Note**: On the first iteration, `stageOutputs.get("debugger")` returns `undefined` (the debugger hasn't run yet), so `priorFixContext` is `undefined` and the prompt omits the previous fix section. On subsequent iterations, the debugger's `rawResponse` from the previous cycle is available because `stageOutputs` overwrites per stage ID — the most recent debugger output is always the one from the previous iteration.

### 5.4 Phase 4: Remove Conductor Global Step Limit

**File**: `src/services/workflows/conductor/conductor.ts`

The conductor's `MAX_STEPS = 100` constant and the `stepCount < maxSteps` guard in the execution loop should be **removed entirely**. Loop termination is now fully handled by the per-loop `maxCycles` counter in `__loop_check` nodes — a global step limit is redundant and would interfere with legitimate long-running loops.

#### 5.4.1 Changes

1. **Delete** the `MAX_STEPS = 100` constant (line 58).
2. **Remove** `stepCount`, `maxSteps`, and the `stepCount < maxSteps` condition from the `while` loop (lines 133-137). The loop condition becomes simply `nodeQueue.length > 0`.
3. **Remove** `ConductorConfig.maxIterations` (conductor/types.ts:405-410) — it is no longer needed.
4. The existing per-node cycle detection (`visited` set, line 150-153) and abort signal check remain as guards against non-loop infinite traversal.

```typescript
// Before:
const maxSteps = this.config.maxIterations ?? MAX_STEPS;
while (nodeQueue.length > 0 && stepCount < maxSteps) {

// After:
while (nodeQueue.length > 0) {
```

Non-looped portions of the graph are acyclic by construction (the compiler validates this). Loop nodes bypass cycle detection via the `nodeId.includes("loop_")` check, and their termination is governed exclusively by `maxCycles`.

## 6. Alternatives Considered

| Option                                                        | Pros                                                                                        | Cons                                                                                                                                              | Reason for Rejection                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A: Low-level `GraphBuilder` with `reviewCycle()` template** | Working loop semantics out of the box; `reviewCycle()` template already exists              | Abandons the DSL; loses declarative definition readability; inconsistent with how Ralph is defined today                                          | Rejecting in favor of fixing the DSL, which is the intended authoring surface |
| **B: Custom control node inside loop**                        | No compiler changes needed; custom node manages counter and signals exit via state mutation | Adds a non-standard node to the workflow; harder to understand; counter management split across multiple places                                   | Over-engineering for a problem solvable by fixing the compiler                |
| **C: Single clean review (not consecutive)**                  | Simpler termination logic                                                                   | Insufficient confidence — a single clean pass could be a false negative (reviewer missed issues that would surface on re-review with fix context) | Two consecutive clean reviews provide higher confidence in convergence        |
| **D: Fixed iteration count (e.g., always 3 cycles)**          | Predictable runtime; no counter logic needed                                                | Wasteful when code is clean; insufficient when code has deep issues                                                                               | Adaptive termination (exit when clean) is better UX                           |

## 7. Cross-Cutting Concerns

### 7.1 Observability

- **Iteration count logging**: Each loop iteration should be logged with the current iteration number and whether the reviewer found actionable findings, enabling operators to understand convergence behavior.
- **Existing telemetry**: The conductor already emits `workflow.step.start` and `workflow.step.complete` events per stage. These will naturally fire for each loop iteration, providing per-iteration timing data.

### 7.2 Safety and Termination Guarantees

Three layers of termination protection:

| Layer        | Mechanism                                                    | Default        | Scope    |
| ------------ | ------------------------------------------------------------ | -------------- | -------- |
| 1. Semantic  | `until` predicate + `.break()` (2 consecutive clean reviews) | 2 clean passes | Per-loop |
| 2. Cycle cap | `maxCycles` counter in `__loop_check` node                   | 100 cycles     | Per-loop |

> **Formal verification**: The Z3-verified loop termination model in [research/docs/2026-03-21-workflow-sdk-simplification-z3-verification.md](../research/docs/2026-03-21-workflow-sdk-simplification-z3-verification.md) proves that bounded loops with monotonically increasing counters and `maxCycles` always terminate.

### 7.3 Performance Implications

- **Worst case**: 100 review/debug cycles × (1 reviewer + 1 debugger agent session) = 200 agent sessions. Each session involves an LLM API call. This is bounded and configurable.
- **Expected case**: Most implementations converge in 1-3 cycles. The 2-consecutive-clean-review requirement adds at most 1 extra reviewer pass beyond the point of convergence.
- **Context growth**: Each iteration's reviewer receives the debugger's prior `rawResponse`. To prevent context explosion, the `maxStageOutputBytes` config (`conductor/types.ts:420`) can truncate the debugger output forwarded to subsequent iterations.

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

- [ ] **Phase 1**: Fix DSL compiler loop termination — wire `until` predicate + iteration counter into back-edge. Change `LoopConfig.until` to accept `BaseState`. Rename `maxIterations` to `maxCycles` with default 100. Add `.break()` DSL instruction with compiler support.
- [ ] **Phase 2**: Add review/debug loop to Ralph definition with `.loop({ maxCycles: 100 })`, consecutive clean review counter, `.break()` for early exit on clean reviews, and `until` predicate for termination.
- [ ] **Phase 3**: Enhance reviewer prompt with prior-iteration fix context (read `rawResponse` from debugger's `stageOutputs` entry).
- [ ] **Phase 4**: Remove conductor `MAX_STEPS` constant and `ConductorConfig.maxIterations` — loop termination is handled per-loop via `maxCycles`.

### 8.2 Test Plan

#### Unit Tests

- [ ] **DSL Compiler — Loop `until` wiring**: Compile a workflow with `.loop({ until: ..., maxCycles: N })` and verify the generated back-edge condition embeds the `until` predicate (accepting `BaseState`) and iteration counter.
- [ ] **DSL Compiler — Loop iteration counting**: Execute a compiled loop graph and verify that `state.outputs[iterationKey]` increments correctly per cycle, and the loop exits when `maxCycles` is reached.
- [ ] **DSL Compiler — Loop exit on `until`**: Execute a compiled loop graph where the `until` predicate returns `true` after K iterations, and verify the loop exits at iteration K.
- [ ] **DSL Compiler — `.break()` instruction**: Compile a workflow with `.break()` inside a loop conditional. Verify the break edge routes to `__loop_check` and the exit edge is taken.
- [ ] **DSL Compiler — `.break()` outside loop**: Verify the compiler rejects `.break()` outside a `.loop()` / `.endLoop()` block with a clear error.
- [ ] **Consecutive clean review counter**: Unit test `createReviewLoopTerminator()` — verify counter increments on clean reviews, resets on actionable findings, and signals termination at the threshold.
- [ ] **`hasActionableFindings` unchanged**: Verify the existing function continues to work correctly (regression test).
- [ ] **`LoopConfig` type**: Verify `until` accepts `BaseState` (not `StageContext`) and `maxCycles` defaults to 100.

#### Integration Tests

- [ ] **Ralph workflow — clean code path**: Run Ralph with an implementation that produces zero findings. Verify the loop runs exactly 2 reviewer passes (both clean) and exits.
- [ ] **Ralph workflow — fix-then-clean path**: Run Ralph with an implementation that has issues on the first review. Verify the debugger runs, then the reviewer re-reviews, and the loop converges.
- [ ] **Ralph workflow — max cycles cap**: Run Ralph with a reviewer that always finds issues. Verify the loop exits at `maxCycles` (100).

#### Edge Case Tests

- [ ] **Reviewer parse failure**: When `parseReviewResult()` returns `null` but `rawResponse` is non-empty, the conservative fallback treats it as actionable. Verify the loop continues (counter resets).
- [ ] **Debugger skipped (clean review)**: When `hasActionableFindings` is false, the debugger is skipped. Verify the loop correctly re-enters the reviewer without the debugger executing.
- [ ] **Abort signal**: Verify the loop respects `abortSignal.aborted` mid-iteration.

## 9. Resolved Questions

- [x] **Q1: DSL `until` to graph edge adapter** — **Decision: Change `LoopConfig.until` to accept `BaseState` directly (breaking change to DSL API).** Rationale: This gives maximum flexibility, allowing users to define custom states for loops and access the full graph state in loop predicates, rather than being constrained to `StageContext`.

- [x] **Q2: Debugger output forwarding** — **Decision: Read `rawResponse` directly from `stageOutputs.get("debugger")`.** This is the simplest approach — the raw response already contains the full agent output with all fix details. No changes to the debugger's `outputMapper` are needed.

- [x] **Q3: `maxReviewCycles` configurability** — **Decision: Add a `maxCycles` parameter to the `.loop()` config (`LoopConfig`).** This replaces the previous `maxIterations` semantics. `maxCycles` defaults to 100 and counts logical loop iterations (not raw graph steps). Non-looped portions of the workflow have no iteration limit. The conductor's global `MAX_STEPS` limit is removed entirely — loop termination is handled per-loop via `maxCycles`.

- [x] **Q4: Consecutive clean threshold** — **Decision: Not a parameter — implemented via `if()`/`else()` control flow within the loop body.** The DSL loop must support **early exit** (breaking out of the loop and continuing to the next stage or ending the workflow). The consecutive-clean-review logic is expressed as control flow inside the loop body using the existing `.if()` / `.endIf()` conditional blocks plus a new early-exit mechanism (e.g., `.break()` or a predicate on `.endLoop()` that evaluates per-iteration). This keeps the loop primitive generic and the termination logic domain-specific.

- [x] **Q5: Context window pressure** — **Decision: Only include the most recent debugger output.** Since `stageOutputs` overwrites per stage ID, `stageOutputs.get("debugger")?.rawResponse` always returns the latest debugger output from the previous cycle. This naturally limits context growth to one iteration's worth of debugger output per reviewer prompt.

## Appendix: Code References

### Files to Modify

| File                                            | Lines           | What                                                                                                               |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/services/workflows/dsl/types.ts`           | 138-150         | Change `LoopConfig.until` to accept `BaseState`; rename `maxIterations` → `maxCycles`; add `BreakInstruction` type |
| `src/services/workflows/dsl/define-workflow.ts` | builder methods | Add `.break()` method; validate it's inside a loop block                                                           |
| `src/services/workflows/dsl/compiler.ts`        | 370-398         | Fix `loop`/`endLoop` to wire `until` predicate + iteration counter; add `break` compilation                        |
| `src/services/workflows/ralph/definition.ts`    | 71-151          | Add `.loop()`/`.endLoop()` around reviewer+debugger; add `.break()` + terminator                                   |
| `src/services/workflows/ralph/prompts.ts`       | 334-420         | Enhance `buildReviewPrompt()` with `priorDebuggerOutput` param                                                     |
| `src/services/workflows/conductor/conductor.ts` | 58, 133-137     | Remove `MAX_STEPS` constant, `stepCount`, and `maxSteps` guard                                                     |
| `src/services/workflows/conductor/types.ts`     | 405-410         | Remove `maxIterations` field from `ConductorConfig`                                                                |

### Files for Reference (Do Not Modify)

| File                                                      | Lines   | What                                                            |
| --------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| `src/services/workflows/graph/authoring/iteration-dsl.ts` | 46-132  | Reference implementation of correct loop with `until` + counter |
| `src/services/workflows/graph/templates.ts`               | 180-191 | `reviewCycle()` template — working loop pattern                 |
| `src/services/workflows/dsl/types.ts`                     | 138-150 | `LoopConfig` interface definition                               |
| `src/services/workflows/conductor/types.ts`               | 183-204 | `StageOutput` type                                              |
| `src/services/workflows/ralph/prompts.ts`                 | 529-588 | `parseReviewResult()` — unchanged                               |

### Related Research

| Document                                                                                                                                              | Relationship                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [research/docs/2026-03-22-ralph-review-debug-loop-termination.md](../research/docs/2026-03-22-ralph-review-debug-loop-termination.md)                 | **Primary research** — complete analysis of current state and implementation options |
| [research/docs/2026-03-21-workflow-sdk-simplification-z3-verification.md](../research/docs/2026-03-21-workflow-sdk-simplification-z3-verification.md) | Z3 formal verification proving bounded loops always terminate                        |
| [research/docs/2026-03-20-ralph-workflow-redesign-analysis.md](../research/docs/2026-03-20-ralph-workflow-redesign-analysis.md)                       | Architecture inventory confirming single-pass review                                 |
| [specs/2026-03-23-ralph-workflow-redesign.md](2026-03-23-ralph-workflow-redesign.md)                                                                                        | Broader redesign proposal (compatible — same stage structure)                        |
| [specs/2026-02-09-ralph-loop-enhancements.md](2026-02-09-ralph-loop-enhancements.md)                                                                                        | Worker/task loop enhancements (separate concern)                                     |
