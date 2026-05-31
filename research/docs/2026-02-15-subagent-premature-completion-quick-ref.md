---
date: 2026-02-15
researcher: debugger agent
topic: "Sub-agent Premature Completion - Quick Reference"
tags: [debug, quick-ref, sub-agents, bug]
status: complete
---

# Sub-Agent Premature Completion Bug - Quick Reference

## TL;DR

Sub-agent nodes show green "completed" status before background tasks actually finish due to unconditional status finalization in the `tool.complete` event handler.

## The Bug in 3 Lines

**File**: `src/ui/index.ts`  
**Line**: 658  
**Problem**: `status: a.status === "running" ? "completed" : a.status` runs when `tool.complete` fires, which happens **immediately** for background tasks, not when they finish.

## Evidence

### Primary Issue Call Site
```typescript
// src/ui/index.ts:648-663
if (agentId) {
  state.parallelAgents = state.parallelAgents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          result: resultStr,
          status: a.status === "running" || a.status === "pending"
            ? "completed" as const   // ❌ BUG: No check for background mode
            : a.status,
          // ...
        }
      : a
  );
```

### Secondary Issue Sites
1. `src/ui/chat.tsx:3338` - Stream finalization
2. `src/ui/chat.tsx:4778` - Alternative finalization path  
3. `src/ui/chat.tsx:2675` - Agent-only stream finalization

All unconditionally finalize `"running"` → `"completed"`.

## Event Flow

### Background Task (Buggy)
```
tool.start → status:"running" (grey ⚪)
  ↓
subagent.start → status:"running" (grey ⚪)
  ↓
tool.complete → status:"completed" (green 🟢) ❌ TOO EARLY
  ↓
[...30 seconds of actual work...]
  ↓
subagent.complete → status:"completed" (no change)
```

**User sees**: Green "finished" at 10ms, actual completion at 30000ms

## Root Cause

The `tool.complete` handler was designed for **sync tasks** where completion means "task finished". For **background tasks**, `tool.complete` fires when the task is **spawned**, not when it completes.

## The Fix (Option 1 - Recommended)

```typescript
// src/ui/index.ts:648-663 (modified)
if (agentId) {
  const isBackgroundMode = 
    (data.toolInput?.mode as string) === "background" ||
    (data.toolInput?.mode as string) === "async";
  
  state.parallelAgents = state.parallelAgents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          result: resultStr,
          status: isBackgroundMode 
            ? "background" as const  // ✅ Use background status
            : (a.status === "running" || a.status === "pending"
                ? "completed" as const
                : a.status),
          currentTool: isBackgroundMode 
            ? "Running in background..."
            : (a.status === "running" || a.status === "pending" 
                ? undefined 
                : a.currentTool),
          durationMs: isBackgroundMode 
            ? undefined
            : (a.durationMs ?? Date.now() - new Date(a.startedAt).getTime()),
        }
      : a
  );
```

**Also update**:
- `src/ui/index.ts:530` - Set initial status to `"background"` on agent creation
- `src/ui/chat.tsx:3327` - Include `"background"` in active agent check
- `src/ui/chat.tsx:3338,4778,2675` - Don't finalize agents with `background: true`

## Unused Type

```typescript
// src/ui/components/parallel-agents-tree.tsx:26
export type AgentStatus = 
  | "pending" 
  | "running" 
  | "completed" 
  | "error" 
  | "background"   // ⚠️ Defined but NEVER assigned in runtime
  | "interrupted";
```

The `"background"` status exists and is handled in UI (grey color, counts as "running"), but no code path assigns it.

## Impact

- **Severity**: HIGH
- **User-facing**: Yes - incorrect status indicators
- **Scope**: All Task tools with `mode: "background"` or `mode: "async"`
- **SDK Coverage**: Affects Claude, OpenCode, and Copilot equally

## Test Case

```typescript
test("background task shows grey until completion", async () => {
  // 1. Spawn Task with mode: "background"
  // 2. Wait for tool.complete event
  // 3. Assert status is "background" not "completed"
  // 4. Wait for subagent.complete event
  // 5. Assert status transitions to "completed"
});
```

## Related Files

| File | Lines | Description |
|------|-------|-------------|
| `src/ui/index.ts` | 648-663 | **Primary bug site** - tool.complete handler |
| `src/ui/index.ts` | 507-530 | Agent creation - should set background status |
| `src/ui/chat.tsx` | 3324-3340 | Stream deferral - should check background |
| `src/ui/chat.tsx` | 4765-4779 | Alt finalization - should skip background |
| `src/ui/chat.tsx` | 2665-2679 | Agent-only finalization |
| `src/ui/components/parallel-agents-tree.tsx` | 26 | AgentStatus type definition |
| `src/ui/tools/registry.ts` | 693 | Task tool renders mode field |

## Reference Documents

- **Full Investigation**: `research/docs/2026-02-15-subagent-premature-completion-investigation.md`
- **Event Flow Diagram**: `research/docs/2026-02-15-subagent-event-flow-diagram.md`
- **SDK Parity Research**: `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md`
