# Copilot Foreground Sub-Agent Premature Completion

**Date**: 2026-03-13
**Status**: Root cause identified, fix proposed
**Severity**: High (affects all Copilot foreground sub-agent UI)

## Problem Statement

Foreground sub-agents launched through the Copilot SDK display a green (completed) status icon instead of a blinking loading indicator. The agent is marked as "completed" almost immediately after appearing, even though the sub-agent is still actively processing work.

## Root Cause

The Copilot SDK fires `tool.execution_complete` for the task tool **before** `subagent.completed`. This ordering is inherent to the SDK's event architecture: the tool execution is considered finished when its result is returned, which happens before the sub-agent lifecycle event fires.

### Event ordering from the Copilot SDK

```
1. tool.execution_start (task tool, no parentToolCallId)
2. subagent.started
3. ... sub-agent work (tool calls, messages, etc.) ...
4. tool.execution_complete (task tool, no parentToolCallId)   <-- FIRES FIRST
5. subagent.completed                                          <-- FIRES SECOND
6. session.idle
```

### How this causes premature completion

When `tool.execution_complete` (step 4) arrives:

1. **Event mapper** (`src/services/agents/clients/copilot/event-mapper.ts:324-361`):
   Maps SDK `tool.execution_complete` to provider event `tool.complete` with the task tool name and toolCallId.

2. **Adapter handler** (`src/services/events/adapters/providers/copilot/message-tool-handlers.ts:296-374`):
   `handleCopilotToolComplete` identifies this as a root task tool (`isRootTaskToolComplete = true`) and publishes `stream.tool.complete` with NO `parentAgentId`.

3. **Stream pipeline consumer** (`src/services/events/consumers/stream-pipeline-consumer.ts:221-238`):
   Maps the bus event to a `tool-complete` StreamPartEvent with `agentId = undefined`.

4. **UI tool handler** (`src/state/chat/stream/use-tool-events.ts:198-314`):
   `handleToolComplete` is called with `agentId = undefined`.
   - `finalizeSyntheticTaskAgentForToolComplete` returns early (Copilot is excluded by provider check at `src/state/chat/shared/helpers/subagents.ts:245`).
   - **`finalizeCorrelatedSubagentDispatchForToolComplete`** (`src/state/chat/shared/helpers/subagents.ts:277-314`) has **no provider check**. It finds the agent where `agent.taskToolCallId === toolCallId` and marks it as `"completed"`.

5. The agent is now shown as green/completed in the UI, even though the sub-agent is still running.

When `subagent.completed` (step 5) later fires, it publishes `stream.agent.complete`, but the agent is already marked completed, so the lifecycle ledger rejects or ignores the duplicate transition.

### Why this only affects Copilot

- **Claude SDK**: Does not emit `tool.execution_complete` for the task tool before `subagent.completed`. Claude fires the native sub-agent start/complete events through a different mechanism. Also, `upsertSyntheticTaskAgentForToolStart` and `finalizeSyntheticTaskAgentForToolComplete` explicitly run for Claude (provider check passes).

- **OpenCode SDK**: Similarly does not have this event ordering issue. Tool execution events for sub-agent tools are handled through correlated session tracking.

- **`finalizeCorrelatedSubagentDispatchForToolComplete`**: This function at `src/state/chat/shared/helpers/subagents.ts:277-314` has NO provider check, unlike its siblings `upsertSyntheticTaskAgentForToolStart` (line 162) and `finalizeSyntheticTaskAgentForToolComplete` (line 245) which both exclude Copilot. This asymmetry means Copilot tool complete events trigger agent finalization through a path that was not designed for Copilot.

## Evidence

1. `isSubagentToolName()` (`src/state/streaming/pipeline-tools/shared.ts:13-19`) matches "task", "agent", "launch_agent" -- the same tool names used by `isCopilotTaskTool()` (`src/services/events/adapters/providers/copilot/message-tool-handlers.ts:376-382`).

2. The `taskToolCallId` on the parallel agent is set to the SDK's `toolCallId` via `resolveSubagentStartCorrelationId` (`src/state/chat/shared/helpers/subagents.ts:56-61`) during `stream.agent.start` handling (`src/state/chat/stream/use-agent-subscriptions.ts:171`).

3. The `tool.execution_complete` event carries this same `toolCallId`, creating the match that `finalizeCorrelatedSubagentDispatchForToolComplete` uses at line 294.

4. DeepWiki documentation for `github/copilot-sdk` confirms `tool.execution_complete` fires before `subagent.completed`.

## Proposed Fix

### Option A: Guard `finalizeCorrelatedSubagentDispatchForToolComplete` for Copilot (Recommended)

Add a provider check to `finalizeCorrelatedSubagentDispatchForToolComplete` that excludes Copilot, matching the behavior of its sibling functions. The Copilot adapter already handles agent completion through its own dedicated path (`handleCopilotSubagentComplete` -> `stream.agent.complete`).

**File**: `src/state/chat/shared/helpers/subagents.ts`
**Location**: Line 277-314

```typescript
export function finalizeCorrelatedSubagentDispatchForToolComplete(args: {
  agents: ParallelAgent[];
  provider: AgentType | undefined; // NEW: add provider parameter
  toolName: string;
  toolId: string;
  success: boolean;
  error?: string;
  completedAtMs: number;
  agentId?: string;
}): ParallelAgent[] {
  if (args.agentId) return args.agents;
  if (args.provider === "copilot") return args.agents; // NEW: skip for Copilot
  if (!isSubagentToolName(args.toolName)) return args.agents;
  // ... rest unchanged
}
```

This also requires updating the call site in `use-tool-events.ts` (line 272) to pass `agentType` as `provider`:

```typescript
return finalizeCorrelatedSubagentDispatchForToolComplete({
  agents: withSyntheticFinalization,
  provider: agentType, // NEW: pass provider
  toolName: completedToolName,
  toolId,
  // ...
});
```

### Option B: Suppress the SDK `tool.execution_complete` for task tools in the adapter

Prevent `handleCopilotToolComplete` from publishing `stream.tool.complete` when the tool is a root task tool. The Copilot adapter already publishes a synthetic `stream.tool.complete` for the task tool in `handleCopilotSubagentComplete` via `publishSyntheticTaskToolComplete`.

**File**: `src/services/events/adapters/providers/copilot/message-tool-handlers.ts`
**Location**: `handleCopilotToolComplete`, after line 348

```typescript
if (isRootTaskToolComplete) {
  // Suppress: handleCopilotSubagentComplete publishes the synthetic
  // task tool complete. Letting the SDK's tool.execution_complete through
  // would prematurely finalize the correlated sub-agent in the UI because
  // the SDK fires this event BEFORE subagent.completed.
  return;
}
```

### Recommendation

**Option A** is the most defensive fix. It ensures Copilot agent completion is exclusively driven by the dedicated `stream.agent.complete` path, regardless of any tool completion events. It matches the existing pattern where the other two functions already exclude Copilot.

**Option B** is a more targeted fix at the adapter level, preventing the problematic event from reaching the UI layer. However, it could suppress legitimate tool complete tracking for the task tool.

Both options should be combined for maximum safety: Option B prevents the root task tool's premature `stream.tool.complete` at the adapter level, and Option A acts as a safety net in the UI layer.

## Testing Approach

1. Unit test: Verify that `finalizeCorrelatedSubagentDispatchForToolComplete` with `provider: "copilot"` returns the agents array unchanged.
2. Integration test: Simulate the full Copilot event sequence (tool.execution_start -> subagent.started -> ... -> tool.execution_complete -> subagent.completed) and verify the agent remains in "running" status until `stream.agent.complete` arrives.
3. Regression test: Ensure Claude and OpenCode sub-agent finalization still works correctly (they should be unaffected since they don't go through this path).

## Files Referenced

| File | Lines | Purpose |
|------|-------|---------|
| `src/state/chat/shared/helpers/subagents.ts` | 277-314 | `finalizeCorrelatedSubagentDispatchForToolComplete` -- missing Copilot guard |
| `src/state/chat/shared/helpers/subagents.ts` | 153-232 | `upsertSyntheticTaskAgentForToolStart` -- has Copilot guard (line 162) |
| `src/state/chat/shared/helpers/subagents.ts` | 234-275 | `finalizeSyntheticTaskAgentForToolComplete` -- has Copilot guard (line 245) |
| `src/state/chat/stream/use-tool-events.ts` | 259-281 | Call site for `finalizeCorrelatedSubagentDispatchForToolComplete` |
| `src/services/events/adapters/providers/copilot/message-tool-handlers.ts` | 296-374 | `handleCopilotToolComplete` -- publishes root task tool complete |
| `src/services/events/adapters/providers/copilot/subagent-handlers.ts` | 152-219 | `handleCopilotSubagentComplete` -- publishes synthetic task tool complete |
| `src/services/events/adapters/providers/copilot/support.ts` | 218-269 | `publishCopilotSyntheticTaskToolComplete` |
| `src/services/events/consumers/stream-pipeline-consumer.ts` | 221-238 | Maps `stream.tool.complete` to `tool-complete` StreamPartEvent |
| `src/services/agents/clients/copilot/event-mapper.ts` | 324-361 | Maps SDK `tool.execution_complete` to provider `tool.complete` |
| `src/state/chat/stream/use-agent-subscriptions.ts` | 69-198 | `stream.agent.start` handler -- sets agent to "running" |
| `src/state/chat/stream/use-agent-subscriptions.ts` | 268-381 | `stream.agent.complete` handler -- sets agent to "completed" |
| `src/components/parallel-agents-tree.tsx` | 123-125 | `shouldAnimateAgentStatus` -- only "running"/"background" animate |
| `src/state/streaming/pipeline-tools/shared.ts` | 13-19 | `isSubagentToolName` -- matches task tool names |
| `src/services/events/adapters/provider-shared.ts` | 46-53 | `isBuiltInTaskTool` -- matches task tool names |
