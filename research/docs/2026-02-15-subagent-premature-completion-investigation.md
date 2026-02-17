---
date: 2026-02-15
researcher: debugger agent
topic: "Sub-agent nodes marked completed before background tasks finish - Root Cause Analysis"
tags: [debug, investigation, sub-agents, status-lifecycle, race-condition]
status: complete
---

# Investigation: Sub-Agent Nodes Marked Completed Before Background Tasks Finish

## Executive Summary

Sub-agent nodes in the parallel agents tree can be marked as "completed" (green status) before the background tasks they represent actually finish execution. This occurs due to a **race condition between event timing and status finalization logic** where `tool.complete` events for Task tools can finalize agent status to "completed" even when the underlying task is still running in the background.

### Root Cause
The primary issue is in **`src/ui/index.ts:648-663`** where the `tool.complete` event handler for Task tools unconditionally finalizes agent status from `"running"` or `"pending"` to `"completed"` without checking if the task was launched in background/async mode.

## Detailed Event Flow Analysis

### Normal Sub-Agent Lifecycle (Sync Mode)

1. **`tool.start` (Task)** - `src/ui/index.ts:507-530`
   - Creates eager `ParallelAgent` with status `"running"`
   - Adds to `state.parallelAgents` array
   - Maps `toolId` to temporary agent ID in `toolCallToAgentMap`
   - Triggers UI update via `state.parallelAgentHandler()`

2. **`subagent.start`** - `src/ui/index.ts:780-851`
   - Merges eager agent entry with SDK-provided `subagentId`
   - Updates correlation mapping: SDK correlation ID → `agentId`
   - Agent remains in `"running"` status
   - Updates current tool display

3. **`subagent.complete`** - `src/ui/index.ts:871-905`
   - Sets status to `"completed"` or `"error"` based on `success` field
   - Clears `currentTool` field
   - Calculates and sets `durationMs`
   - **Does NOT include result text** (per comment at line 627-629)

4. **`tool.complete` (Task)** - `src/ui/index.ts:578-720`
   - **CRITICAL PATH**: Lines 648-663
   - Parses result text from `toolResult`
   - Looks up agent via correlation map
   - **Unconditionally finalizes status**:
   ```typescript
   status: a.status === "running" || a.status === "pending"
     ? "completed" as const
     : a.status,
   ```
   - Sets `result` field with parsed text
   - Calculates duration if not already set

### Where the Race Condition Occurs

**File: `src/ui/index.ts`**
**Lines: 648-663**

```typescript
if (agentId) {
  // Set result AND finalize status — if subagent.complete never
  // fired (eager agent path), this ensures the agent transitions
  // from "running" → "completed" when the Task tool returns.
  state.parallelAgents = state.parallelAgents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          result: resultStr,
          status: a.status === "running" || a.status === "pending"
            ? "completed" as const      // ⚠️ PREMATURE COMPLETION HERE
            : a.status,
          currentTool: a.status === "running" || a.status === "pending"
            ? undefined
            : a.currentTool,
          durationMs: a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime()),
        }
      : a
  );
```

**Problem**: This code assumes that when `tool.complete` fires for a Task tool, the sub-agent has finished. However:
- For **background/async tasks**, `tool.complete` fires immediately after the task is spawned
- The background agent continues running independently
- The UI shows the agent as "completed" (green) while it's still working

## Evidence and Call Sites

### 1. Status Finalization Sites

#### Primary Issue: `src/ui/index.ts:648-663`
**Context**: Task tool.complete handler
**Condition**: Agent in "running" or "pending" status
**Action**: Unconditionally sets status to "completed"
**Missing Check**: Does not inspect `input.mode` field to determine if task is background/async

#### Secondary Issues:

**`src/ui/chat.tsx:3334-3340`**
```typescript
// Finalize running parallel agents and bake into message
const finalizedAgents = currentAgents.length > 0
  ? currentAgents.map((a) =>
    a.status === "running" || a.status === "pending"
      ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: ... }
      : a
  )
```
**Context**: Stream completion handler when no active agents detected
**Issue**: Finalizes all running/pending agents during message completion

**`src/ui/chat.tsx:4776-4779`**
```typescript
const finalizedAgents = currentAgents.length > 0
  ? currentAgents.map((a) =>
    a.status === "running" || a.status === "pending"
      ? { ...a, status: "completed" as const, currentTool: undefined, durationMs: ... }
      : a
  )
```
**Context**: Alternative completion path
**Issue**: Same unconditional finalization

**`src/ui/chat.tsx:2671-2679`**
```typescript
const finalizedAgents = parallelAgents.map((a) =>
  a.status === "running" || a.status === "pending"
    ? {
      ...a,
      status: "completed" as const,
      currentTool: undefined,
      durationMs: Date.now() - new Date(a.startedAt).getTime(),
    }
    : a
);
```
**Context**: Agent-only stream finalization
**Issue**: Finalizes agents in "@mention-only" flows

### 2. Deferral Logic

**`src/ui/chat.tsx:3324-3332`**
```typescript
// If sub-agents or tools are still running, defer finalization and queue
// processing until they complete (preserves correct state).
const hasActiveAgents = parallelAgentsRef.current.some(
  (a) => a.status === "running" || a.status === "pending"
);
if (hasActiveAgents || hasRunningToolRef.current) {
  pendingCompleteRef.current = handleComplete;
  return;
}
```
**Context**: Checks before stream finalization
**Issue**: Once an agent is marked "completed" by tool.complete, this check no longer defers finalization

### 3. Background Status Definition

**File: `src/ui/components/parallel-agents-tree.tsx:26`**
```typescript
export type AgentStatus = "pending" | "running" | "completed" | "error" | "background" | "interrupted";
```
**Status**: Type is defined but **never assigned in runtime**

**File: `src/ui/components/parallel-agents-tree.tsx:591-598`**
```typescript
const order: Record<AgentStatus, number> = {
  running: 0,
  pending: 1,
  background: 2,  // Defined in sort order
  completed: 3,
  interrupted: 4,
  error: 5,
};
```
**Status**: Sort order includes "background" but no code path sets this status

**File: `src/ui/components/parallel-agents-tree.tsx:607`**
```typescript
const runningCount = agents.filter(a => a.status === "running" || a.status === "background").length;
```
**Status**: Counted as "running" for header display, but never assigned

## Task Tool Mode Field

**File: `src/ui/tools/registry.ts:693-697`**
```typescript
const mode = (props.input.mode as string) || "";

if (agentType) content.push(`Agent: ${agentType}`);
if (model) content.push(`Model: ${model}`);
if (mode) content.push(`Mode: ${mode}`);  // ✅ Displayed but not checked for logic
```
**Status**: Mode field is extracted and displayed in tool output, but **not used in status lifecycle decisions**

## SDK Event Ordering

From existing research (`research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md`):

> Current runtime status flow for sub-agent tree:
> 1. `tool.start(Task)` creates eager running tree node
> 2. `subagent.start` merges temporary ID to SDK sub-agent ID
> 3. Agent/internal tool updates mutate `currentTool` and `toolUses`
> 4. **`subagent.complete` sets completed/error**
> 5. **`tool.complete(Task)` parses result and can also finalize status to completed**

**Key Insight**: Both `subagent.complete` AND `tool.complete` can set status to "completed". This creates a race condition where whichever fires first (or if only one fires) determines when the UI shows completion.

### SDK Parity
All three SDKs (Claude, OpenCode, Copilot) normalize to the same event model:
- **Claude**: `SubagentStart`/`SubagentStop` → `subagent.start`/`subagent.complete` (`src/sdk/claude-client.ts:112-123`)
- **OpenCode**: `part.type === "agent"` → `subagent.start`, `part.type === "step-finish"` → `subagent.complete` (`src/sdk/opencode-client.ts:654-670`)
- **Copilot**: `subagent.started`/`subagent.completed` → unified events (`src/sdk/copilot-client.ts:132-148`)

Because all map to the same handlers, the bug affects all SDK backends equally.

## Specific Conditions for Premature Completion

### Condition 1: Background Task Spawned
1. User invokes Task tool with `mode: "background"`
2. `tool.start` creates agent with status `"running"`
3. SDK spawns background process
4. `tool.complete` fires **immediately** (background task started, not completed)
5. Line 658 sets status to `"completed"` (❌ WRONG)
6. Background task continues running
7. Agent tree shows green/completed while actual work is in progress

### Condition 2: Fast Sync Task Completion
1. Task tool starts and completes very quickly
2. `subagent.complete` may not fire before `tool.complete`
3. `tool.complete` handler assumes agent is done and sets "completed"
4. If `subagent.complete` fires later, status is already "completed" (no-op)

### Condition 3: SDK Event Ordering Variance
1. Different SDKs may emit events in different orders
2. OpenCode emits `step-finish` (→ `subagent.complete`) but timing varies
3. If `tool.complete` arrives first, premature completion occurs

## Color/Visual Indicators

**File: `src/ui/components/parallel-agents-tree.tsx:153-166`**
```typescript
export function getStatusIndicatorColor(
  status: AgentStatus,
  colors: Pick<ThemeColors, "muted" | "success" | "warning" | "error">,
): string {
  if (status === "completed") return colors.success;  // ✅ GREEN
  if (status === "interrupted") return colors.warning; // ⚠️ YELLOW
  if (status === "error") return colors.error;        // ❌ RED
  return colors.muted;                                 // ⚪ GREY (running/pending/background)
}
```

**Impact**: Once status is set to "completed", the tree header and individual agent rows show **green indicators**, falsely signaling completion.

**File: `src/ui/components/parallel-agents-tree.tsx:636-638`**
```typescript
const headerColor = runningCount > 0
  ? themeColors.accent
  : interruptedCount > 0
    ? themeColors.warning
    : completedCount > 0
      ? themeColors.success  // ✅ GREEN HEADER
      : themeColors.muted;
```

## Proposed Fix Strategy

### Option 1: Check `mode` Field in tool.complete Handler (Recommended)

**File: `src/ui/index.ts:648-663`**

```typescript
if (agentId) {
  const isBackgroundMode = (data.toolInput?.mode as string) === "background" 
    || (data.toolInput?.mode as string) === "async";
  
  state.parallelAgents = state.parallelAgents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          result: resultStr,
          // Only finalize status if NOT background mode
          status: isBackgroundMode 
            ? "background" as const  // ✅ Use background status
            : (a.status === "running" || a.status === "pending"
                ? "completed" as const
                : a.status),
          currentTool: isBackgroundMode 
            ? "Running in background..."
            : (a.status === "running" || a.status === "pending" ? undefined : a.currentTool),
          durationMs: isBackgroundMode 
            ? undefined  // Don't set duration for background tasks
            : (a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime())),
        }
      : a
  );
```

### Option 2: Store `background` Flag on Agent Creation

**File: `src/ui/index.ts:517-540`**

```typescript
if ((data.toolName === "Task" || data.toolName === "task") && data.toolInput && !isUpdate) {
  const input = data.toolInput as Record<string, unknown>;
  const prompt = (input.prompt as string) ?? (input.description as string) ?? "";
  const mode = input.mode as string | undefined;
  const isBackground = mode === "background" || mode === "async";
  
  pendingTaskEntries.push({ toolId, prompt: prompt || undefined });

  if (state.parallelAgentHandler) {
    const agentType = (input.subagent_type as string) ?? (input.agent_type as string) ?? "agent";
    const taskDesc = (input.description as string) ?? prompt ?? "Sub-agent task";
    const newAgent: ParallelAgent = {
      id: toolId,
      taskToolCallId: toolId,
      name: agentType,
      task: taskDesc,
      status: isBackground ? "background" : "running",  // ✅ Set correct initial status
      background: isBackground,  // ✅ Store flag
      startedAt: new Date().toISOString(),
      currentTool: `Starting ${agentType}…`,
    };
```

Then check `agent.background` field in `tool.complete` handler.

### Option 3: Never Finalize Status in tool.complete for Task Tools

**Rationale**: Only `subagent.complete` should set terminal status. The `tool.complete` handler should only set the `result` field.

**File: `src/ui/index.ts:648-663`**

```typescript
if (agentId) {
  state.parallelAgents = state.parallelAgents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          result: resultStr,
          // ✅ Don't touch status - let subagent.complete handle it
          // status: unchanged
          // ✅ Only clear currentTool if already completed
          currentTool: a.status === "completed" ? undefined : a.currentTool,
          durationMs: a.status === "completed" 
            ? (a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime()))
            : a.durationMs,
        }
      : a
  );
```

**Trade-off**: Requires that `subagent.complete` **always** fires. If SDKs have inconsistent behavior, some agents may stay in "running" state indefinitely.

### Option 4: Implement read_agent Polling for Background Tasks

**Concept**: For background tasks, don't mark completed until `read_agent` tool is called and confirms completion.

**Requires**:
1. Tracking background agent IDs
2. UI integration for `read_agent` tool
3. Status updates based on agent completion polling

**Complexity**: High - requires new tool integration and polling infrastructure

## Testing Recommendations

### Test Case 1: Background Task Lifecycle
```typescript
test("background task remains in background status until read_agent confirms completion", async () => {
  // 1. Spawn task with mode: "background"
  // 2. Verify agent status is "background" (not "completed")
  // 3. Verify tree header shows "Running" not "finished"
  // 4. Call read_agent with wait: true
  // 5. Verify status transitions to "completed" only after agent actually completes
});
```

### Test Case 2: Sync Task with Fast Completion
```typescript
test("sync task transitions to completed after both subagent.complete and tool.complete", async () => {
  // 1. Spawn task with mode: "sync" (default)
  // 2. Wait for tool.complete
  // 3. Verify status is "running" if subagent.complete hasn't fired
  // 4. Wait for subagent.complete
  // 5. Verify status transitions to "completed"
});
```

### Test Case 3: Visual Indicator Consistency
```typescript
test("tree header color matches agent status", async () => {
  // 1. Create agents in various states
  // 2. Verify header color is grey while any agent is running/background
  // 3. Verify header color is green only when all agents are completed
});
```

## Related Research Documents

- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md` - Original discovery
- `research/docs/2026-02-14-subagent-output-propagation-issue.md` - Result propagation timing
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` - SDK event normalization

## Impact Assessment

### Severity: **HIGH**
- **User Confusion**: Users see agents marked "finished" while work is still in progress
- **Incorrect Timing**: Duration metrics are wrong for background tasks
- **Status Inconsistency**: "background" status type exists but is never used
- **SDK-Agnostic**: Affects all three SDK backends equally

### Affected Scenarios:
1. ✅ **Background/async Task tools** - Definitely affected
2. ⚠️ **Fast sync tasks** - Potentially affected depending on event timing
3. ⚠️ **Multiple parallel agents** - Compounded confusion when some finish early
4. ✅ **Stream finalization** - Premature completion allows stream to finalize early

## Conclusion

The root cause of premature sub-agent completion is the **unconditional status finalization in the `tool.complete` handler for Task tools** at `src/ui/index.ts:648-663`. This code path was designed to handle cases where `subagent.complete` never fires (eager agent path), but it doesn't account for background/async execution modes where `tool.complete` fires immediately upon task spawn rather than task completion.

**Recommended Fix**: Implement **Option 1** (check `mode` field) or **Option 2** (store background flag on agent) to properly distinguish between sync and background tasks and use the `"background"` status that already exists in the type system but is never assigned.

**Next Steps**:
1. Implement fix in `src/ui/index.ts`
2. Update agent creation logic to set initial status based on mode
3. Add test coverage for background task lifecycle
4. Update documentation for status lifecycle semantics
