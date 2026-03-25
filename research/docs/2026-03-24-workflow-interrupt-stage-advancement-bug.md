---
date: 2026-03-24 03:42:01 UTC
researcher: Claude Opus 4.6
git_commit: 017ba430cfe2a0801dc478d6895a505bf2850159
branch: lavaman131/hotfix/interrupt-workflows
repository: atomic
topic: "Workflow interrupt advances to next stage instead of staying on current stage; queued messages not delivered to current stage"
tags: [research, codebase, workflow, interrupt, conductor, queued-messages, ralph, stream-cancellation]
status: complete
last_updated: 2026-03-24
last_updated_by: Claude Opus 4.6
---

# Research: Workflow Interrupt Stage Advancement Bug

## Research Question

When interrupting (Escape/Ctrl+C) a workflow during a stage, the current stage is cancelled and the workflow advances to the next stage instead of stopping the current stage and allowing the user to send a follow-up message. Additionally:
- Queued messages sent during a workflow stage should be propagated to the current stage if cancellation is applied.
- If a message is queued during a stage and there is no intermediate interruption, the queued message should be sent upon completion of the current stage to that same stage.

## Summary

The bug has a clear root cause in the `WorkflowSessionConductor` class. When a user interrupts a workflow stage, `conductor.interrupt()` only calls `this.currentSession?.abort?.()` — it does **not** signal the conductor's workflow-level `abortSignal`. Consequently, `runStageSession()` checks `context.abortSignal.aborted` (which is `false`), falls through to the normal completion path, and returns `status: "completed"`. The main execution loop only breaks on `status === "error"`, so it advances to the next node. There is no mechanism to pause the conductor on interruption and wait for user input before continuing.

For queued messages, the system intentionally suppresses queue draining during workflow stages (via `suppressQueueContinuation`), but there is no mechanism to drain the queue into the **current** stage — either after interruption or after normal stage completion.

## Detailed Findings

### 1. The Conductor Execution Loop

The `WorkflowSessionConductor` at `src/services/workflows/conductor/conductor.ts` drives the entire workflow. Its `execute()` method (line 118) implements a simple BFS queue over graph nodes:

```
while (nodeQueue.length > 0) {
  if (abortSignal.aborted) break;           // line 129 — only workflow-level abort
  const nodeId = nodeQueue.shift()!;
  // ... execute node ...
  if (output.status === "error") break;      // line 171 — only breaks on error
  const nextNodes = getNextExecutableNodes(); // line 189 — advances to next
  nodeQueue.push(...nextNodes);              // line 190
}
```

**Critical gap**: There is no check for `status === "interrupted"` in the loop. An interrupted stage is treated identically to a completed one.

### 2. The `interrupt()` Method Gap

At `conductor.ts:97-99`:

```typescript
interrupt(): void {
  this.currentSession?.abort?.();
}
```

This aborts the **per-stage session** but does NOT:
- Set any flag on the conductor itself (e.g., `this.interrupted = true`)
- Signal `this.config.abortSignal` (the workflow-level abort)
- Communicate back to the execution loop that the stage was interrupted

### 3. The `runStageSession()` Abort Check Mismatch

At `conductor.ts:344`:

```typescript
if (context.abortSignal.aborted) {
  return { stageId: stage.id, status: "interrupted", ... };
}
```

`context.abortSignal` is the **workflow-level** abort signal (from `conductor-executor.ts:112`). A single Escape/Ctrl+C calls `conductor.interrupt()` which only aborts the session, NOT this signal. So the check at line 344 is `false`, and execution falls through to line 420 returning `status: "completed"`.

The `"interrupted"` status path is only reachable on a **full workflow cancellation** (second Ctrl+C), which triggers `cancelWorkflow()` and rejects the `waitForUserInput` promise — but that's a different, more destructive path.

### 4. The Bus Event Status Mapping

At `conductor.ts:267-272`:

```typescript
this.emitStepComplete(
  stage, durationMs,
  output.status === "completed" ? "completed" : "error",
  output.error,
);
```

This is a binary mapping — any non-`"completed"` status becomes `"error"` in the bus event. Even if `runStageSession` did return `"interrupted"`, the bus event schema at `schemas.ts:175` only allows `["completed", "error", "skipped"]`. The `StageOutputStatus` type does define `"interrupted"` (at `conductor/types.ts:29`), but this value never makes it to the event bus.

### 5. Queued Message Suppression During Workflows

The queued message system at `hooks/use-message-queue.ts` stores messages when `isStreamingRef.current` is true. Dequeuing is controlled by `continueQueuedConversation()` at `state/chat/controller/use-app-orchestration.ts:51`.

**During workflow interruption** (Escape or first Ctrl+C):
- `handleEscapeKey` at `use-interrupt-controls.ts:319` passes `shouldContinueAfterInterrupt: !workflowState.workflowActive` → `false` when workflow is active
- `handleCtrlCKey` workflow branch (lines 181-190) does NOT call `continueQueuedConversation()`
- Result: **queued messages are never dispatched to the interrupted stage**

**During normal workflow stage completion**:
- `suppressQueueContinuation` is computed from `awaitedStreamRunIdsRef` at multiple sites
- Workflow runs tracked via `trackAwaitedRun()` have their run IDs in the awaited set
- When such runs complete, `suppressQueueContinuation` is `true`, so `continueQueuedConversation()` is not called
- The conductor's main loop immediately advances to the next node
- Result: **queued messages are never delivered to the completed stage**

### 6. The Interrupt Signal Chain (Complete Flow)

```
User presses Escape/Ctrl+C
  │
  ├─► onInterrupt() → chat-ui-controller.ts:384 handleInterrupt()
  │     ├─► state.streamAbortController.abort()  ← aborts SDK adapter
  │     └─► session.abort()                      ← SDK-level abort
  │
  ├─► interruptStreaming() → interrupt-execution.ts:95
  │     ├─► separateAndInterruptAgents()
  │     ├─► Update message: wasInterrupted=true, streaming=false
  │     ├─► stopSharedStreamState() → isStreaming=false
  │     ├─► resolveTrackedRun("interrupt", ...)
  │     └─► continueQueuedConversation() ← SUPPRESSED during workflow
  │
  └─► conductorInterruptRef.current?.()
        └─► conductor.interrupt() → this.currentSession?.abort?.()
              └─► Aborts per-stage session
                    └─► Stream adapter resolves normally
                          └─► runStageSession returns status: "completed" ← BUG
                                └─► Main loop advances to next node    ← BUG
```

### 7. Stage Transition Mechanism

Between stages, the conductor calls `onStageTransition(from, to)` configured at `conductor-executor.ts:135-165`:

```typescript
onStageTransition: (from, to) => {
  context.updateWorkflowState({ currentStage: to, stageIndicator, ... });
  context.setStreaming(true);    // Re-enable streaming for next stage
  context.addMessage("assistant", ""); // New message for next stage's output
},
```

This happens synchronously between `emitStepComplete` for the previous stage and `emitStepStart` for the next stage. There is no checkpoint or pause where the system could check for queued messages or wait for user input.

### 8. Graph Traversal After Stage Completion

`getNextExecutableNodes()` at `graph-traversal.ts:23-46` evaluates outgoing edges from the completed node. It supports:
- `result.goto` for direct jumps (not used by conductor agent stages)
- Conditional edges evaluated against graph state
- Unconditional edges (always taken)

The function does not consider the stage's completion status — it only looks at graph structure and state.

### 9. Run Tracking and Workflow Awaited Runs

The `StreamRunRuntime` at `state/runtime/stream-run-runtime.ts` manages run lifecycle. When a run is interrupted:
- `interruptRun()` at line 141 → `finalizeRun(runId, "interrupted", { wasInterrupted: true })`
- This resolves the `StreamRunHandle.result` promise immediately

The conductor executor uses `streamAndWait` (via `context-factory.ts:356-369`) which calls `trackAwaitedRun()`. The awaited run's promise resolution is how `runStageSession` knows the stream finished. But the resolution carries `wasInterrupted: true` which is currently not checked by the conductor.

### 10. Existing Test Coverage

A test file exists at `tests/services/workflows/conductor/conductor-stage-interrupt.test.ts` that validates:
- `registerConductorInterrupt` is called with `conductor.interrupt()` before execution
- The registered function calls `session.abort()`
- Registration is cleared after execution

However, the tests do **not** validate that an interrupted stage prevents advancement to the next node or that the conductor pauses for user input.

## Code References

### Primary Files (Root Cause)
- `src/services/workflows/conductor/conductor.ts:97-99` — `interrupt()` method: only aborts session, missing state flag
- `src/services/workflows/conductor/conductor.ts:118-196` — `execute()` main loop: no `"interrupted"` status handling
- `src/services/workflows/conductor/conductor.ts:267-272` — `emitStepComplete()` call: binary status mapping
- `src/services/workflows/conductor/conductor.ts:304-451` — `runStageSession()`: abort check uses workflow-level signal only
- `src/services/workflows/conductor/conductor.ts:344` — The abort check that never fires on single interrupt

### Interrupt Signal Chain
- `src/state/chat/keyboard/use-interrupt-controls.ts:126-197` — Ctrl+C handler with workflow branch
- `src/state/chat/keyboard/use-interrupt-controls.ts:302-349` — Escape handler
- `src/state/chat/keyboard/interrupt-execution.ts:95-174` — `interruptStreaming()` core function
- `src/state/runtime/chat-ui-controller.ts:384-427` — `handleInterrupt()` AbortController path

### Queued Message System
- `src/hooks/use-message-queue.ts:129-220` — Queue state: enqueue/dequeue/clear
- `src/state/chat/composer/submit.ts:45-165` — `handleComposerSubmit()` enqueue-vs-send decision
- `src/state/chat/controller/use-app-orchestration.ts:51-84` — `continueQueuedConversation()` dequeue consumer
- `src/state/chat/shared/helpers/stream-continuation.ts:233-311` — Guard functions and dispatch helper

### Conductor Executor (Integration Layer)
- `src/services/workflows/runtime/executor/conductor-executor.ts:48-230` — `executeConductorWorkflow()` wiring
- `src/services/workflows/runtime/executor/conductor-executor.ts:112` — Workflow abort signal creation
- `src/services/workflows/runtime/executor/conductor-executor.ts:135-165` — `onStageTransition` callback
- `src/services/workflows/runtime/executor/conductor-executor.ts:220` — `registerConductorInterrupt` call

### Conductor Types
- `src/services/workflows/conductor/types.ts:29` — `StageOutputStatus = "completed" | "interrupted" | "error"`
- `src/services/workflows/conductor/types.ts:237-262` — `StageContext` with `abortSignal`
- `src/services/workflows/conductor/graph-traversal.ts:23-46` — `getNextExecutableNodes()`

### Event Bus
- `src/services/events/bus-events/schemas.ts:167-194` — Workflow event schemas (status enum lacks `"interrupted"`)
- `src/services/events/registry/handlers/stream-workflow-step.ts:1-49` — Workflow step event → StreamPartEvent mappers
- `src/state/chat/stream/use-session-subscriptions.ts:169-300` — `stream.session.idle` subscription handler

### SDK Adapter (Stream Abort)
- `src/services/events/adapters/providers/claude/streaming-runtime.ts:198-201` — Abort detection in stream loop
- `src/services/events/adapters/providers/claude/streaming-runtime.ts:288-314` — Finally block: publishes idle/partial-idle
- `src/state/runtime/chat-ui-controller.ts:581-615` — `streamWithSession()` bridge to conductor

### Tests
- `tests/services/workflows/conductor/conductor-stage-interrupt.test.ts` — Existing interrupt registration tests

## Architecture Documentation

### Current Interrupt Architecture (Workflows)

The system has a **tiered interrupt model**:
- **Tier 1** (single Escape or first Ctrl+C): Aborts current stage session only
- **Tier 2** (second Ctrl+C within 1 second): Full workflow cancellation

The conductor uses a **graph-walking BFS loop** that processes nodes sequentially. Each agent node creates an isolated session, streams a prompt, captures the response, and emits step events. The loop only stops on explicit error or workflow-level abort.

The queued message system uses a **guard-then-dispatch** pattern with a 50ms delay, controlled by `shouldDispatchQueuedMessage()` which requires `!isStreaming && runningAskQuestionToolCount === 0`. Workflow stages suppress queue draining via `suppressQueueContinuation` tied to `awaitedStreamRunIdsRef`.

### Key Type Relationships

```
StageOutputStatus = "completed" | "interrupted" | "error"  (internal, conductor/types.ts:29)
Bus event status  = "completed" | "error" | "skipped"       (external, schemas.ts:175)
                                  ↑ "interrupted" collapses to "error"
```

### Dual-Track Interruption

```
State Layer (React hooks)          Runtime Layer (AbortController)
─────────────────────────          ─────────────────────────────
interruptStreaming()                handleInterrupt()
  ├─ finalizes message               ├─ streamAbortController.abort()
  ├─ stops shared stream state        └─ session.abort()
  ├─ resolves tracked run                   │
  └─ (suppressed) queue drain               └─ SDK adapter stops
                                                  │
          Conductor Layer                         │
          ────────────────                        │
          conductor.interrupt()  ←────────────────┘
            └─ currentSession?.abort?.()
                 └─ (missing) no state flag set
                 └─ (missing) no abort signal propagation
```

## Historical Context (from research/)

- `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md` — Ralph workflow redesign: session-based prompt-chained architecture analysis
- `research/docs/2026-03-23-ask-user-question-dsl-node-type.md` — askUserQuestion() DSL node type with workflow HITL UI (related: user input during workflows)
- `research/docs/2026-02-03-model-params-workflow-nodes-message-queuing.md` — Message queuing architecture research
- `research/docs/2026-02-25-graph-execution-engine.md` — Graph execution engine technical documentation
- `research/docs/2026-02-28-workflow-issues-research.md` — Prior workflow issues research
- `research/docs/v1/2026-03-15-spec-04-workflow-engine.md` — V2 workflow engine specification
- `specs/ralph-workflow-redesign.md` — Ralph workflow redesign spec
- `specs/workflow-issues-fixes.md` — Prior workflow issues and fixes

## Related Research

- `research/docs/2026-03-22-ralph-review-debug-loop-termination.md` — Related: loop control and termination logic in Ralph
- `research/docs/2026-02-28-workflow-gaps-architecture.md` — Prior gap analysis of workflow architecture
- `research/docs/2026-03-18-ralph-eager-dispatch-research.md` — Related: sub-agent dispatch and task management

## Open Questions

1. **Pause semantics**: When the conductor pauses on interruption, should it create a HITL-style input prompt (like `askUserQuestion` node), or should it simply stop the loop and let the normal chat input flow deliver the next message?

2. **Queue drain target**: When a queued message is delivered to the "current stage," does that mean:
   - Continuing the same SDK session with `session.stream(queuedMessage)` (session continuation)?
   - Creating a new isolated session for the same stage node with the queued message as the prompt?

3. **Normal completion + queue**: If a stage completes normally and there's a queued message, should the stage's output still be stored (so downstream stages can reference it), and then the queued message starts a new session for the same node?

4. **Loop stages**: For stages inside a `loop()` (reviewer, debugger), if interrupted with a queued message, should the loop iteration counter be affected?

5. **Multiple queued messages**: If multiple messages are queued, should they all be delivered to the current stage sequentially, or only the first one (with the rest remaining queued for subsequent stages)?
