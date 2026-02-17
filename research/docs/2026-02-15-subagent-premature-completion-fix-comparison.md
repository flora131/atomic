---
date: 2026-02-15
researcher: debugger agent
topic: "Sub-agent Premature Completion - Code Fix Comparison"
tags: [debug, fix, code-comparison, sub-agents]
status: complete
---

# Sub-Agent Premature Completion - Code Fix Comparison

## Fix Location 1: Agent Creation (tool.start handler)

### Current Code (Buggy)
**File**: `src/ui/index.ts`  
**Lines**: 517-540

```typescript
// Capture Task tool prompts and toolIds for subagent.start correlation.
if ((data.toolName === "Task" || data.toolName === "task") && data.toolInput && !isUpdate) {
  const input = data.toolInput as Record<string, unknown>;
  const prompt = (input.prompt as string) ?? (input.description as string) ?? "";
  pendingTaskEntries.push({ toolId, prompt: prompt || undefined });

  // Eagerly create a ParallelAgent
  if (state.parallelAgentHandler) {
    const agentType = (input.subagent_type as string) ?? (input.agent_type as string) ?? "agent";
    const taskDesc = (input.description as string) ?? prompt ?? "Sub-agent task";
    const newAgent: ParallelAgent = {
      id: toolId,
      taskToolCallId: toolId,
      name: agentType,
      task: taskDesc,
      status: "running",                    // ❌ ALWAYS "running", ignores mode
      startedAt: new Date().toISOString(),
      currentTool: `Starting ${agentType}…`,
    };
    state.parallelAgents = [...state.parallelAgents, newAgent];
    state.parallelAgentHandler(state.parallelAgents);
    toolCallToAgentMap.set(toolId, toolId);
  }
}
```

### Fixed Code
```typescript
// Capture Task tool prompts and toolIds for subagent.start correlation.
if ((data.toolName === "Task" || data.toolName === "task") && data.toolInput && !isUpdate) {
  const input = data.toolInput as Record<string, unknown>;
  const prompt = (input.prompt as string) ?? (input.description as string) ?? "";
  const mode = (input.mode as string) ?? "sync";                    // ✅ Extract mode
  const isBackground = mode === "background" || mode === "async";   // ✅ Check if background
  
  pendingTaskEntries.push({ toolId, prompt: prompt || undefined });

  // Eagerly create a ParallelAgent
  if (state.parallelAgentHandler) {
    const agentType = (input.subagent_type as string) ?? (input.agent_type as string) ?? "agent";
    const taskDesc = (input.description as string) ?? prompt ?? "Sub-agent task";
    const newAgent: ParallelAgent = {
      id: toolId,
      taskToolCallId: toolId,
      name: agentType,
      task: taskDesc,
      status: isBackground ? "background" : "running",  // ✅ Set correct initial status
      background: isBackground,                         // ✅ Store flag for later checks
      startedAt: new Date().toISOString(),
      currentTool: isBackground 
        ? `Running ${agentType} in background…`
        : `Starting ${agentType}…`,
    };
    state.parallelAgents = [...state.parallelAgents, newAgent];
    state.parallelAgentHandler(state.parallelAgents);
    toolCallToAgentMap.set(toolId, toolId);
  }
}
```

**Key Changes**:
- ✅ Extract `mode` field from `data.toolInput`
- ✅ Detect background/async mode
- ✅ Set initial `status: "background"` for background tasks
- ✅ Store `background: true` flag on agent object
- ✅ Update `currentTool` message for background tasks

---

## Fix Location 2: Tool Completion (tool.complete handler)

### Current Code (Buggy)
**File**: `src/ui/index.ts`  
**Lines**: 648-667

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
            ? "completed" as const          // ❌ UNCONDITIONAL - causes bug
            : a.status,
          currentTool: a.status === "running" || a.status === "pending"
            ? undefined
            : a.currentTool,
          durationMs: a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime()),
        }
      : a
  );
  state.parallelAgentHandler(state.parallelAgents);
  // Clean up consumed mappings
  if (taskSdkCorrelationId) toolCallToAgentMap.delete(taskSdkCorrelationId);
  toolCallToAgentMap.delete(toolId);
}
```

### Fixed Code (Option 1 - Check mode in toolInput)
```typescript
if (agentId) {
  // Extract mode from tool input to determine if this is a background task
  const mode = (data.toolInput?.mode as string) ?? "sync";
  const isBackground = mode === "background" || mode === "async";
  
  // Set result AND finalize status — if subagent.complete never
  // fired (eager agent path), this ensures the agent transitions
  // from "running" → "completed" when the Task tool returns.
  // For background tasks, keep status as "background" until subagent.complete fires.
  state.parallelAgents = state.parallelAgents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          result: resultStr,
          status: isBackground                                      // ✅ Check mode first
            ? (a.status === "running" || a.status === "pending" 
                ? "background" as const 
                : a.status)
            : (a.status === "running" || a.status === "pending"
                ? "completed" as const
                : a.status),
          currentTool: isBackground
            ? (a.status === "running" || a.status === "pending"
                ? "Running in background..."
                : a.currentTool)
            : (a.status === "running" || a.status === "pending"
                ? undefined
                : a.currentTool),
          durationMs: isBackground
            ? a.durationMs  // Don't set duration for background tasks yet
            : (a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime())),
        }
      : a
  );
  state.parallelAgentHandler(state.parallelAgents);
  // Clean up consumed mappings
  if (taskSdkCorrelationId) toolCallToAgentMap.delete(taskSdkCorrelationId);
  toolCallToAgentMap.delete(toolId);
}
```

### Fixed Code (Option 2 - Check background flag on agent)
```typescript
if (agentId) {
  // Set result AND finalize status — if subagent.complete never
  // fired (eager agent path), this ensures the agent transitions
  // from "running" → "completed" when the Task tool returns.
  // For background tasks, keep status as "background" until subagent.complete fires.
  state.parallelAgents = state.parallelAgents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          result: resultStr,
          status: a.background                                      // ✅ Check stored flag
            ? a.status  // Don't change status for background tasks
            : (a.status === "running" || a.status === "pending"
                ? "completed" as const
                : a.status),
          currentTool: a.background
            ? (a.currentTool ?? "Running in background...")
            : (a.status === "running" || a.status === "pending"
                ? undefined
                : a.currentTool),
          durationMs: a.background
            ? a.durationMs  // Don't set duration for background tasks yet
            : (a.durationMs ?? (Date.now() - new Date(a.startedAt).getTime())),
        }
      : a
  );
  state.parallelAgentHandler(state.parallelAgents);
  // Clean up consumed mappings
  if (taskSdkCorrelationId) toolCallToAgentMap.delete(taskSdkCorrelationId);
  toolCallToAgentMap.delete(toolId);
}
```

**Key Changes**:
- ✅ Check if task is background mode (via `toolInput.mode` or `agent.background`)
- ✅ Don't finalize status to "completed" for background tasks
- ✅ Keep status as "background" or preserve current status
- ✅ Update `currentTool` message appropriately
- ✅ Don't set `durationMs` until task actually completes

**Recommendation**: Use **Option 2** (check `agent.background` flag) because:
1. More reliable - flag is stored at creation time
2. Simpler - no need to re-parse `toolInput`
3. Safer - works even if `toolInput` is not available at completion time

---

## Fix Location 3: Stream Deferral Check

### Current Code (Buggy)
**File**: `src/ui/chat.tsx`  
**Lines**: 3324-3332

```typescript
// If sub-agents or tools are still running, defer finalization and queue
// processing until they complete (preserves correct state).
const hasActiveAgents = parallelAgentsRef.current.some(
  (a) => a.status === "running" || a.status === "pending"    // ❌ Missing "background"
);
if (hasActiveAgents || hasRunningToolRef.current) {
  pendingCompleteRef.current = handleComplete;
  return;
}
```

### Fixed Code
```typescript
// If sub-agents or tools are still running, defer finalization and queue
// processing until they complete (preserves correct state).
const hasActiveAgents = parallelAgentsRef.current.some(
  (a) => a.status === "running" 
      || a.status === "pending" 
      || a.status === "background"    // ✅ Include background tasks
);
if (hasActiveAgents || hasRunningToolRef.current) {
  pendingCompleteRef.current = handleComplete;
  return;
}
```

**Key Change**:
- ✅ Include `"background"` status in active agent check
- ✅ Prevents stream finalization while background tasks are running

**Also apply to**:
- `src/ui/chat.tsx:4765-4767` (alternative path)
- `src/ui/chat.tsx:2640-2655` (agent-only stream completion trigger)

---

## Fix Location 4: Agent Finalization on Stream Complete

### Current Code (Buggy)
**File**: `src/ui/chat.tsx`  
**Lines**: 3334-3342

```typescript
// Finalize running parallel agents and bake into message
setParallelAgents((currentAgents) => {
  const finalizedAgents = currentAgents.length > 0
    ? currentAgents.map((a) =>
      a.status === "running" || a.status === "pending"   // ❌ No check for background
        ? { 
            ...a, 
            status: "completed" as const, 
            currentTool: undefined, 
            durationMs: Date.now() - new Date(a.startedAt).getTime() 
          }
        : a
    )
    : undefined;
```

### Fixed Code
```typescript
// Finalize running parallel agents and bake into message
setParallelAgents((currentAgents) => {
  const finalizedAgents = currentAgents.length > 0
    ? currentAgents.map((a) => {
        // Don't finalize background agents - they're still running
        if (a.background && (a.status === "running" || a.status === "pending" || a.status === "background")) {
          return a;  // ✅ Keep background agents unchanged
        }
        // Finalize sync agents that are still running/pending
        return (a.status === "running" || a.status === "pending")
          ? { 
              ...a, 
              status: "completed" as const, 
              currentTool: undefined, 
              durationMs: Date.now() - new Date(a.startedAt).getTime() 
            }
          : a;
      })
    : undefined;
```

**Key Changes**:
- ✅ Check `agent.background` flag
- ✅ Skip finalization for background agents
- ✅ Only finalize sync agents

**Also apply to**:
- `src/ui/chat.tsx:4773-4780` (alternative finalization path)
- `src/ui/chat.tsx:2671-2679` (agent-only stream finalization)

---

## Type Definition Update (Optional)

### Current Code
**File**: `src/ui/components/parallel-agents-tree.tsx`  
**Line**: 31

```typescript
export interface ParallelAgent {
  id: string;
  taskToolCallId?: string;
  name: string;
  task: string;
  status: AgentStatus;
  model?: string;
  startedAt: string;
  durationMs?: number;
  background?: boolean;           // ✅ Already exists but not documented
  error?: string;
  result?: string;
  toolUses?: number;
  tokens?: number;
  currentTool?: string;
  contentOffsetAtStart?: number;
}
```

### Enhanced Documentation
```typescript
export interface ParallelAgent {
  /** Unique identifier for the agent */
  id: string;
  /** Task tool call ID that spawned this agent */
  taskToolCallId?: string;
  /** Display name of the agent (e.g., "Explore", "codebase-analyzer") */
  name: string;
  /** Brief description of what the agent is doing */
  task: string;
  /** Current status */
  status: AgentStatus;
  /** Model being used (optional) */
  model?: string;
  /** Start time in ISO format */
  startedAt: string;
  /** Duration in milliseconds (for completed agents) */
  durationMs?: number;
  /** Whether running in background/async mode (don't finalize until subagent.complete) */
  background?: boolean;           // ✅ Document usage
  /** Error message if status is "error" */
  error?: string;
  /** Agent output/result summary (for completed agents) */
  result?: string;
  /** Number of tool uses (for progress display) */
  toolUses?: number;
  /** Token count (for progress display) */
  tokens?: number;
  /** Current tool operation (e.g., "Bash: Find files...") */
  currentTool?: string;
  /** Content offset where this agent first appeared in the parent response */
  contentOffsetAtStart?: number;
}
```

---

## Summary of Changes

| File | Lines | Change Description |
|------|-------|-------------------|
| `src/ui/index.ts` | 517-540 | Extract mode, set `status: "background"` and `background: true` flag |
| `src/ui/index.ts` | 648-667 | Check `agent.background` flag, don't finalize background tasks |
| `src/ui/chat.tsx` | 3324-3332 | Include `"background"` in active agent check |
| `src/ui/chat.tsx` | 3334-3342 | Skip finalization for `agent.background === true` |
| `src/ui/chat.tsx` | 4765-4767 | Include `"background"` in active agent check |
| `src/ui/chat.tsx` | 4773-4780 | Skip finalization for `agent.background === true` |
| `src/ui/chat.tsx` | 2671-2679 | Skip finalization for `agent.background === true` |
| `src/ui/components/parallel-agents-tree.tsx` | 31 | Document `background` field usage |

---

## Testing Scenarios

### Test 1: Background Task Lifecycle
```typescript
// Spawn background task
const result = await session.stream("task with mode: background");

// After tool.complete fires:
expect(agent.status).toBe("background");  // ✅ Not "completed"
expect(agent.background).toBe(true);

// After subagent.complete fires:
expect(agent.status).toBe("completed");   // ✅ Now completed
```

### Test 2: Sync Task Lifecycle
```typescript
// Spawn sync task
const result = await session.stream("task with mode: sync");

// After tool.complete fires:
expect(agent.status).toBe("completed");   // ✅ Finalized immediately
expect(agent.background).toBe(false);
```

### Test 3: Stream Doesn't Finalize with Background Agents
```typescript
// Spawn background task
const result = await session.stream("task with mode: background");

// After tool.complete:
expect(streamFinalized).toBe(false);      // ✅ Stream still open
expect(agent.status).toBe("background");

// After subagent.complete:
expect(streamFinalized).toBe(true);       // ✅ Stream now finalized
expect(agent.status).toBe("completed");
```
