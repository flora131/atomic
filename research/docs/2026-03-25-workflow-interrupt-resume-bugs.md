---
date: 2026-03-25 02:59:09 UTC
researcher: Copilot (Claude Opus 4.6)
git_commit: 710aea8e407f2f97af5f2ef82e14a697b1993a0a
branch: lavaman131/hotfix/interrupt-workflows
repository: atomic
topic: "Workflow Interrupt/Resume Bugs: Session Preservation, Spinner, and Queued Message Handling"
tags: [research, codebase, workflow, conductor, interrupt, session, queue, spinner]
status: complete
last_updated: 2026-03-25
last_updated_by: Copilot
---

# Research: Workflow Interrupt/Resume Bugs

## Research Question

Investigate three bugs in the Ralph workflow interrupt/resume system:
1. **New session bug**: Interrupting a workflow stage and sending a follow-up message creates a NEW session instead of resuming/connecting to the existing session — losing conversation context
2. **Queued message bug**: A queued message sent during a workflow stage, when combined with Ctrl+C interruption, re-shows the stage banner and incorrectly advances to the next stage with an empty task list
3. **Spinner bug**: The spinner (composing indicator) may not reload after interrupt+resume
4. **Queued message without interruption**: A queued message during a stage (no interruption) should be sent to the current stage's session upon completion — verify this works correctly

## Summary

All three bugs stem from the same root cause in `WorkflowSessionConductor.runStageSession()`: **the session is always destroyed in the `finally` block, even when the stage is interrupted and will be resumed**. The `preserveSessionForResume` flag at `conductor.ts:221` is set too late (after the session is already destroyed) and only controls which prompt text is used — it does not actually preserve the session object.

### Root Causes

| Bug | Root Cause | Location |
|-----|-----------|----------|
| New session | `finally` block destroys session before `preserveSessionForResume` is set | `conductor.ts:551-558` |
| Stage banner re-show | `executeAgentStage()` always calls `onStageTransition()` on re-entry | `conductor.ts:294` |
| Next stage advancement | New session has no context → planner responds generically → empty task list → orchestrator sees `[]` | `conductor.ts:381` |
| Spinner missing | `onStageTransition` re-shows spinner, but the new session has no context so the issue is cosmetic | `conductor-executor.ts:157-158` |
| Queued message (no interrupt) | Already works via drain loop at `conductor.ts:478-512` | N/A |

## Detailed Findings

### 1. Session Lifecycle During Interrupt+Resume

#### The `runStageSession` Flow (`conductor.ts:355-560`)

The critical code path:

```
runStageSession()
├── while (true) {                          // continuation loop
│   ├── try {
│   │   ├── Check preserveSessionForResume  // line 375-379: uses resume msg as prompt
│   │   ├── session = createSession()       // line 381: ALWAYS creates new session
│   │   ├── streamSession()                 // line 387-400: streams through SDK adapter
│   │   ├── if (this.interrupted)           // line 403: returns "interrupted"
│   │   ├── Drain queued messages           // line 478-512: sends to active session
│   │   └── return { status: "completed" }  // line 524
│   └── finally {
│       ├── this.currentSession = null      // line 552: always clears
│       └── destroySession(session)         // line 554: always destroys
│   }
}
```

**The bug**: When a stage is interrupted at line 403-412, the function returns `{ status: "interrupted" }`. The `finally` block then executes, destroying the session (line 554). Control returns to `execute()` at line 213, which calls `waitForResumeInput()` and if a message is provided, sets `preserveSessionForResume = true` at line 221. But by this point, the session is already gone.

On re-execution, `runStageSession()` at line 375-379 detects `preserveSessionForResume` and uses the resume message as the prompt, but then at line 381, **creates a brand-new session** via `config.createSession()`. This new session has zero conversation history.

#### Evidence from Log 1 (`events/2026-03-25T025220`)

```
[seq 2]  workflow.step.start: planner (⌕ PLANNER)
[seq 4]  stream.turn.start: turnId "0" (first turn)
[seq 5-40] Streaming: planner thinking about Rust TUI snake game
[seq 41] cancellation: "Operation cancelled by user" (Ctrl+C)
[seq 44] workflow.step.complete: planner status="interrupted" durationMs=6428
[seq 45] stream.session.start: {} (NEW session — no stage banner!)
[seq 46] stream.turn.start: turnId "0" (turn 0 = fresh session)
[seq 47-66] Agent responds: "The user said 'Continue' but there's no prior context..."
```

Key observations:
- `turnId: "0"` at seq 46 confirms a brand-new session (no history)
- No stage banner event between seq 44 and 45 — BUT `onStageTransition` should have fired
- The agent has no context about the task, confirming session isolation

#### The `preserveSessionForResume` Flag (`conductor.ts:78,221,375-379`)

Current implementation:
```typescript
// conductor.ts:78 — instance field
private preserveSessionForResume = false;

// conductor.ts:221 — set in execute() AFTER stage returns
this.preserveSessionForResume = true;

// conductor.ts:375-379 — consumed in runStageSession()
if (this.preserveSessionForResume && this.pendingResumeMessage !== null) {
  currentPrompt = this.pendingResumeMessage;  // Only changes the prompt
  this.pendingResumeMessage = null;
  this.preserveSessionForResume = false;
}
// line 381: session = await this.config.createSession(stage.sessionConfig);
// ^^^ Still creates a new session!
```

**Fix needed**: The conductor must preserve the actual `Session` object when a stage is interrupted and will be resumed. On resume, it should reuse the preserved session instead of creating a new one.

### 2. Stage Banner Re-Show on Resume

#### The `onStageTransition` Callback (`conductor-executor.ts:135-166`)

When the conductor re-executes a stage after interrupt+resume, `executeAgentStage()` at line 294 calls:
```typescript
this.config.onStageTransition(previousStageId, nodeId);
```

This fires for EVERY stage entry, including resume re-entries. The callback at `conductor-executor.ts:135-166` does:
1. `context.updateWorkflowState({ currentStage, stageIndicator })` — re-shows "Stage 1/4: ⌕ PLANNER"
2. `context.setStreaming(true)` — re-enables streaming
3. `context.addMessage("assistant", "")` — creates a new empty assistant message

#### Evidence from Log 2 (`events/2026-03-25T025508`)

```
[seq 2]  workflow.step.start: planner (⌕ PLANNER)  ← initial start
[seq 62] cancellation: user cancels
[seq 65] workflow.step.complete: planner status="interrupted"
[seq 66] workflow.step.start: planner (⌕ PLANNER)  ← RE-SHOWN on resume!
[seq 68] stream.turn.start: turnId "0" (new session)
[seq 113] workflow.step.complete: planner status="completed" (generic response)
[seq 114] workflow.step.start: orchestrator (⚡ ORCHESTRATOR)  ← advances with empty tasks
```

**Fix needed**: Differentiate between initial stage entry and resume re-entry. On resume, skip the stage banner and workflow state update, but still re-enable streaming and create a new assistant message.

### 3. Queued Message Interaction with Interrupt

#### Queue Consumption During Interrupt (`conductor.ts:122-131`)

When a stage is interrupted, the conductor calls `waitForResumeInput()`:
```typescript
private async waitForResumeInput(): Promise<string | null> {
  const queuedMessage = this.config.checkQueuedMessage?.();
  if (queuedMessage) return queuedMessage;  // ← dequeues from UI queue
  // ...otherwise waits for user input
}
```

If a message was queued (user typed while streaming), `checkQueuedMessage` dequeues it. This message becomes the `resumeInput`, triggering stage re-execution. But because the session is destroyed (Bug 1), the queued message goes to a new empty session.

#### The Race Between Conductor and TUI Queue Dispatch

The TUI's `continueQueuedConversation()` (`use-app-orchestration.ts:51-84`) is called from `setStreamingWithFinalize(false)` at `use-dispatch-controller.ts:315`. It schedules dispatch with a 50ms delay (`stream-continuation.ts:242`).

The conductor's drain loop runs synchronously after `streamSession()` returns. So for the non-interrupt case:
1. Stream completes → TUI calls `setStreamingWithFinalize(false)` → schedules 50ms dispatch
2. Conductor's `streamSession()` returns → drain loop runs immediately → dequeues message
3. 50ms later: TUI dispatch fires → queue is empty → no-op

**This means the non-interrupt drain loop works correctly** — the conductor wins the race because it dequeues synchronously while the TUI dispatch is delayed by 50ms.

For the interrupt case:
1. Ctrl+C → `interruptStreaming()` → sets `isStreaming=false`
2. `interruptStreaming()` does NOT call `continueQueuedConversation()` (because `shouldContinueAfterInterrupt=false` for workflows)
3. Conductor's `waitForResumeInput()` → `checkQueuedMessage()` → dequeues the message
4. Message goes to a new empty session (Bug 1)

**Fix needed**: Preserve the session so queued messages go to the same session with full context.

### 4. Spinner State During Workflow Transitions

#### Spinner Visibility Control

The spinner is driven by `message.streaming` on `ChatMessage` objects. The decision function `shouldShowMessageLoadingIndicator()` at `loading-state.ts:36-62` returns:
```
Boolean(message.streaming) || hasActiveBackground || hasActiveForeground
```

#### Spinner During Stage Transitions

Between stages:
1. Previous stage stream completes → `handleStreamComplete()` → `setStreaming(false)` → spinner hides
2. Conductor's `onStageTransition` fires → `setStreaming(true)` → `addMessage("assistant", "")` → spinner shows

For resume after interrupt:
1. Interrupt → `interruptStreaming()` → `stopSharedStreamState()` → `setStreaming(false)` → spinner hides
2. Conductor's `waitForResumeInput()` blocks...
3. User submits → conductor re-queues node → `executeAgentStage()` → `onStageTransition()` → `setStreaming(true)` → spinner shows

**The spinner DOES show on resume** (confirmed by raw-stream.log: "⣯ Composing…" appears after "❯ Continue"). The user's report of "spinner is missing" may refer to a subtle timing issue or a different scenario. However, ensuring the banner is NOT re-shown while the spinner IS shown is part of the fix.

### 5. Queued Message Drain Without Interruption (`conductor.ts:478-512`)

This path works correctly:

```typescript
// After main stream completes, before returning StageOutput:
while (session) {
  const queuedMessage = this.config.checkQueuedMessage?.();
  if (!queuedMessage) break;
  
  // Send to the SAME active session (preserves context)
  queuedResponse = await this.config.streamSession(session, queuedMessage, {
    abortSignal: context.abortSignal,
  });
  accumulatedResponse += queuedResponse;
}
```

The queued message is streamed through the **same session** that handled the stage's main prompt, preserving full conversation history. The response is accumulated so the stage's parser can process the complete output.

**Conclusion**: No fix needed for the non-interrupt drain path.

## Code References

### Critical Files

- `src/services/workflows/conductor/conductor.ts:67-560` — WorkflowSessionConductor (session lifecycle, interrupt/resume)
- `src/services/workflows/conductor/conductor.ts:101-116` — `interrupt()` and `resume()` methods
- `src/services/workflows/conductor/conductor.ts:122-131` — `waitForResumeInput()` (queue check + user input)
- `src/services/workflows/conductor/conductor.ts:213-225` — Interrupt handling in `execute()` (sets `preserveSessionForResume`)
- `src/services/workflows/conductor/conductor.ts:355-560` — `runStageSession()` (session creation, streaming, cleanup)
- `src/services/workflows/conductor/conductor.ts:375-379` — Resume message handling (prompt swap only)
- `src/services/workflows/conductor/conductor.ts:381` — `createSession()` call (always creates new)
- `src/services/workflows/conductor/conductor.ts:403-412` — Interrupt detection (returns early)
- `src/services/workflows/conductor/conductor.ts:478-512` — Queued message drain loop
- `src/services/workflows/conductor/conductor.ts:551-558` — `finally` block (always destroys session)
- `src/services/workflows/runtime/executor/conductor-executor.ts:48-350` — Conductor executor (wires config)
- `src/services/workflows/runtime/executor/conductor-executor.ts:135-166` — `onStageTransition` callback
- `src/services/workflows/runtime/executor/conductor-executor.ts:213` — `checkQueuedMessage` wiring
- `src/services/workflows/runtime/executor/conductor-executor.ts:214-221` — `waitForResumeInput` wiring
- `src/state/chat/keyboard/use-interrupt-controls.ts:126-290` — Ctrl+C handler (stage-aware interrupt)
- `src/state/chat/keyboard/interrupt-execution.ts:95-174` — `interruptStreaming()` (state cleanup)
- `src/state/chat/composer/submit.ts:119-130` — Workflow input resolver consumption
- `src/state/chat/controller/use-app-orchestration.ts:51-84` — `continueQueuedConversation()`
- `src/services/workflows/helpers/workflow-input-resolver.ts:1-34` — Promise-based resolver
- `src/state/chat/command/context-factory.ts:371-382` — `waitForUserInput()` + conductor registration
- `src/state/chat/shared/helpers/loading-state.ts:36-62` — Spinner visibility decision
- `src/services/workflows/conductor/types.ts` — `ConductorConfig` interface

### Conductor Type Definitions

- `src/services/workflows/conductor/types.ts` — `ConductorConfig.checkQueuedMessage`, `waitForResumeInput`, `onStageTransition`
- `src/services/workflows/conductor/types.ts` — `StageDefinition.indicator`

## Architecture Documentation

### Conductor Pattern

The `WorkflowSessionConductor` is a lightweight state machine that:
1. Walks a compiled graph BFS-style (`execute()`)
2. Creates isolated agent sessions per "agent" node (`runStageSession()`)
3. Executes deterministic nodes (tool, decision) via `node.execute()` (`executeDeterministicNode()`)
4. Threads context forward via `StageOutput` records in `stageOutputs` map
5. Handles interrupt/resume via `waitForResumeInput()` + `preserveSessionForResume`

### Two-Tier Interrupt Architecture

1. **UI Layer** (`use-interrupt-controls.ts`): Handles visual state — stops spinner, finalizes message, shows "Operation cancelled"
2. **Conductor Layer** (`conductor.ts`): Handles execution flow — aborts session, waits for resume input, re-queues nodes

### Session-Per-Stage Isolation

Each stage creates a fresh session with no conversation history from prior stages. Context is threaded via `StageOutput.rawResponse` and `StageContext.stageOutputs`, not via session continuity. This is by design for inter-stage isolation, but breaks down for intra-stage resume where the user expects conversation continuity.

## Proposed Fix Approach

### Fix 1: Preserve Session on Interrupt for Resume

In `conductor.ts`:
1. Add `private preservedSession: Session | null = null` field
2. In the interrupt return path (line 403-412), set `this.preservedSession = session` and `session = undefined` to prevent `finally` from destroying it
3. At the start of `runStageSession()`, if `preserveSessionForResume` is true and `preservedSession` exists, use it instead of calling `createSession()`
4. Destroy the preserved session in the `finally` block only when it's not being preserved

### Fix 2: Skip Stage Banner on Resume

In `conductor.ts`:
1. Add `private isResuming = false` field
2. Set `this.isResuming = true` in `execute()` before `continue` (line 222)
3. In `executeAgentStage()`, pass `isResuming` to `onStageTransition` or skip it
4. Clear `this.isResuming = false` at the start of `executeAgentStage()`

In `conductor-executor.ts`:
1. Modify `onStageTransition` signature to accept `options?: { isResume?: boolean }`
2. Skip `updateWorkflowState({ stageIndicator })` when `isResume` is true
3. Still call `setStreaming(true)` and `addMessage("assistant", "")` for spinner

### Fix 3: Update ConductorConfig Types

In `conductor/types.ts`:
1. Update `onStageTransition` signature to include resume flag

## Open Questions

1. Should the preserved session have a TTL/timeout to prevent leaked sessions if the user never resumes?
2. Should the stage banner part (`WorkflowStepPart`) be updated to show "resumed" status on re-entry?
3. Should context pressure monitoring be re-evaluated after resume (the preserved session may be close to context limits)?
4. Is there a scenario where the spinner doesn't show that isn't captured by these logs?
