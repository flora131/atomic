---
date: 2026-02-15
researcher: debugger agent
topic: "Sub-agent Premature Completion Bug - Investigation Summary"
tags: [debug, summary, executive-summary]
status: complete
---

# Sub-Agent Premature Completion Bug - Executive Summary

## Investigation Complete ✅

This investigation traced the root cause of sub-agent nodes being marked "completed" (green status) before background tasks actually finish execution.

## Documents Created

1. **Full Investigation Report** (17 KB)
   - `research/docs/2026-02-15-subagent-premature-completion-investigation.md`
   - Comprehensive root cause analysis with evidence and call sites
   - Impact assessment and testing recommendations
   - 4 proposed fix strategies with trade-offs

2. **Event Flow Diagram** (28 KB)
   - `research/docs/2026-02-15-subagent-event-flow-diagram.md`
   - Visual timeline diagrams showing normal vs buggy behavior
   - Status indicator color mapping
   - Code path summary with ASCII diagrams

3. **Quick Reference** (5 KB)
   - `research/docs/2026-02-15-subagent-premature-completion-quick-ref.md`
   - TL;DR summary with the bug in 3 lines
   - Primary and secondary issue sites
   - Quick lookup table of affected files

4. **Code Fix Comparison** (15 KB)
   - `research/docs/2026-02-15-subagent-premature-completion-fix-comparison.md`
   - Side-by-side current vs fixed code
   - 4 fix locations with detailed before/after
   - Test scenarios for validation

## The Bug (One Sentence)

**The `tool.complete` event handler unconditionally finalizes agent status to "completed" without checking if the task was launched in background/async mode, causing the UI to show green "finished" status when background tasks are merely spawned, not completed.**

## Root Cause Location

**Primary Issue**: `src/ui/index.ts:658`

```typescript
status: a.status === "running" || a.status === "pending"
  ? "completed" as const   // ❌ No check for background mode
  : a.status,
```

## Key Findings

### 1. Race Condition Timing
- For **background tasks**: `tool.complete` fires when task **spawns** (not finishes)
- For **sync tasks**: `tool.complete` fires when task **completes**
- UI code treats both the same → premature completion for background tasks

### 2. Unused Status Type
- `"background"` status exists in type definition (`parallel-agents-tree.tsx:26`)
- Color mapping supports it (grey, like "running")
- Tree sorting includes it
- **But no runtime code ever assigns this status**

### 3. Multiple Finalization Sites
- 4 call sites unconditionally finalize `"running"` → `"completed"`
- All need fixes to check for background mode

### 4. SDK-Agnostic Bug
- Affects Claude, OpenCode, and Copilot SDK backends equally
- All normalize to same event model, share same buggy UI handlers

## Evidence Trail

| Location | Line | Issue |
|----------|------|-------|
| `src/ui/index.ts` | 658 | **Primary**: Unconditional finalization in tool.complete |
| `src/ui/index.ts` | 530 | Initial status always "running", ignores mode |
| `src/ui/chat.tsx` | 3338 | Stream finalization doesn't skip background |
| `src/ui/chat.tsx` | 4778 | Alternative finalization path, same issue |
| `src/ui/chat.tsx` | 2675 | Agent-only stream finalization |
| `src/ui/chat.tsx` | 3327 | Deferral check missing "background" status |

## Recommended Fix (2-Part)

### Part 1: Agent Creation
Extract `mode` field from `toolInput` and set:
- `status: "background"` for background/async tasks
- `background: true` flag for later checks

### Part 2: Tool Completion
Check `agent.background` flag before finalizing:
- If `background === true`: Keep status, don't finalize
- If `background === false`: Finalize to "completed" (current behavior)

**Impact**: ~20 lines changed across 2 files, fixes all 4 finalization sites

## Timeline

```
┌─────────────────────────────────────────────────────────────┐
│ Background Task (Current Buggy Behavior)                    │
├─────────────────────────────────────────────────────────────┤
│ 0ms:    tool.start      → grey "running" ⚪               │
│ 5ms:    subagent.start  → grey "running" ⚪               │
│ 10ms:   tool.complete   → green "completed" 🟢 ❌ BUG     │
│                           (task just spawned, not done)     │
│ ...                                                          │
│ 30s:    subagent.complete → green "completed" 🟢           │
│                            (task actually finished)         │
│                                                              │
│ User Experience: Shows finished at 10ms, really done at 30s │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Background Task (With Fix)                                  │
├─────────────────────────────────────────────────────────────┤
│ 0ms:    tool.start      → grey "background" ⚪ ✅         │
│ 5ms:    subagent.start  → grey "background" ⚪ ✅         │
│ 10ms:   tool.complete   → grey "background" ⚪ ✅         │
│                           (preserves status, sets result)   │
│ ...                                                          │
│ 30s:    subagent.complete → green "completed" 🟢 ✅       │
│                            (task actually finished)         │
│                                                              │
│ User Experience: Shows running until 30s, then finished ✅  │
└─────────────────────────────────────────────────────────────┘
```

## Testing Requirements

Three test scenarios identified:

1. **Background task lifecycle** - Verify grey until completion
2. **Sync task lifecycle** - Verify immediate green on completion
3. **Stream deferral** - Verify stream waits for background agents

## Impact Assessment

- **Severity**: HIGH
- **User-Facing**: Yes - incorrect visual indicators mislead users
- **Data Integrity**: Medium - metrics (duration) are incorrect for background tasks
- **Scope**: All Task tools with `mode: "background"` or `mode: "async"`

## Next Steps

1. ✅ Investigation complete
2. ⏭️ Implement fix in `src/ui/index.ts` (lines 520, 658)
3. ⏭️ Update finalization logic in `src/ui/chat.tsx` (4 sites)
4. ⏭️ Add test coverage for background task lifecycle
5. ⏭️ Update documentation for status semantics

## Reference

All investigation documents are in `research/docs/`:
- `2026-02-15-subagent-premature-completion-investigation.md` - Full report
- `2026-02-15-subagent-event-flow-diagram.md` - Visual diagrams
- `2026-02-15-subagent-premature-completion-quick-ref.md` - Quick lookup
- `2026-02-15-subagent-premature-completion-fix-comparison.md` - Code fixes

---

**Investigation completed by**: debugger agent  
**Date**: 2026-02-15  
**Total time**: ~30 minutes  
**Lines of code analyzed**: ~1500 lines across 5 files  
**Evidence collected**: 10 specific call sites with line numbers  
**Proposed fixes**: 4 options (1 recommended)
