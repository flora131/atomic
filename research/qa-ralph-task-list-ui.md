# QA Analysis: Ralph Persistent Task List UI

**Date**: 2026-02-13
**Spec**: `specs/ralph-task-list-ui.md`
**Method**: Static code analysis (bun unavailable in QA environment for live TUI testing)
**Files Analyzed**: `task-list-panel.tsx`, `task-list-indicator.tsx`, `workflow-commands.ts`, `chat.tsx`, `registry.ts`, `ralph-nodes.ts`

---

## Critical Bugs

### BUG-1: `TaskListIndicator` truncates at 10 items instead of allowing scroll (Spec §10, G1)

**Severity**: High
**Spec says**: "The panel uses a scrollable container with a maximum height (e.g., 15 lines) instead of TaskListIndicator's maxVisible truncation. All tasks remain accessible via scrolling rather than being hidden behind a +N more overflow indicator."
**Actual behavior**: `TaskListPanel` wraps `TaskListIndicator` in a `<scrollbox maxHeight={15}>` but does NOT override the default `maxVisible=10` prop. `TaskListIndicator` (line 76) defaults `maxVisible` to 10 and renders a "+N more tasks" overflow message for items beyond 10.

**Impact**: If a workflow has 15 tasks, only 10 are rendered with a "+5 more tasks" label. The scrollbox scrolls the 10 visible items — the remaining 5 are inaccessible. This directly contradicts the spec's intent.

**Fix**: Pass `maxVisible={Infinity}` (or omit the truncation logic) from `TaskListPanel`:
```tsx
<TaskListIndicator items={tasks} expanded={expanded} maxVisible={Infinity} />
```

---

### BUG-2: Resume path has no worker loop — only completes one task (Spec §5.5.5)

**Severity**: High
**Spec says** (Section 5.5.5, step 5): "Enter worker loop — file watcher picks up changes automatically"
**Actual behavior** (workflow-commands.ts lines 725-730): The resume handler sends a single `context.sendSilentMessage(implementPrompt)` and returns. There is no iteration. Compare with the new workflow path (lines 782-793) which has an explicit `for` loop reading tasks from disk and calling `streamAndWait` until all tasks are completed.

**Impact**: On `/ralph --resume <id>`, the agent processes ONE task and then stops. Remaining pending tasks are never picked up. The user would need to manually run `/ralph --resume` again for each remaining task. The new workflow path correctly loops.

**Fix**: The resume handler should mirror the new workflow path's worker loop:
```typescript
// Load tasks from disk, reset in_progress → pending
const currentTasks = await readTasksFromDisk(sessionDir);
for (const t of currentTasks) {
  if (t.status === "in_progress") t.status = "pending";
}
await saveTasksToActiveSession(currentTasks, parsed.sessionId);

// Worker loop (same as new workflow path)
const maxIterations = currentTasks.length * 2;
for (let i = 0; i < maxIterations; i++) {
  const tasks = await readTasksFromDisk(sessionDir);
  const pending = tasks.filter(t => t.status !== "completed");
  if (pending.length === 0) break;
  const prompt = buildTaskListPreamble(tasks) + buildImplementFeaturePrompt() + additionalPrompt;
  const result = await context.streamAndWait(prompt);
  if (result.wasInterrupted) break;
}
```

---

### BUG-3: Resume path doesn't reset `in_progress` tasks to `pending` (Spec §5.5.5)

**Severity**: High
**Spec says** (Section 5.5.5, step 2): "Reset in_progress → pending (line 796-800)"
**Actual behavior**: The resume handler (lines 696-748) never loads tasks from disk and never resets `in_progress` tasks. Tasks that were `in_progress` when the previous session was interrupted remain stuck in that state.

**Impact**: The agent may try to work on an already-in-progress task that was interrupted, or worse, the blinking indicator persists indefinitely for a task that will never complete.

---

### BUG-4: Resume path missing task list preamble in prompt (Spec §5.5.5)

**Severity**: Medium
**Spec says** (Section 5.5.5, step 5): Worker loop should include task context.
**Actual behavior** (line 726-730):
```typescript
const implementPrompt = buildImplementFeaturePrompt();
context.sendSilentMessage(implementPrompt + additionalPrompt);
```
The prompt sent to the agent does NOT include `buildTaskListPreamble(tasks)`. Compare with the new workflow path (line 790): `buildTaskListPreamble(currentTasks) + buildImplementFeaturePrompt()`.

**Impact**: On resume, the agent receives the implementation instructions but has no knowledge of the current task list. It can't determine which tasks are pending/completed without the preamble. The agent has to re-discover the task state from scratch.

---

## Medium Bugs

### BUG-5: Ctrl+T toggles BOTH visibility AND expansion simultaneously (Spec §5.2.4)

**Severity**: Medium
**Spec says** (Section 5.2.4): "Ctrl+T toggles both panels simultaneously via the shared showTodoPanel state" (referring to visibility only). The spec describes `expanded` as controlled by the `tasksExpanded` state passed as a prop, but doesn't say Ctrl+T should toggle expansion.
**Actual behavior** (chat.tsx line 3690-3694):
```typescript
if (event.ctrl && !event.shift && event.name === "t") {
  setShowTodoPanel(prev => !prev);
  setTasksExpanded(prev => !prev);  // ← toggles expansion too!
  return;
}
```

**Impact**: Creates a confusing toggle cycle:
1. Press 1: panel hides + expanded becomes true (invisible change)
2. Press 2: panel shows (expanded view) + expanded becomes false
3. Press 3: panel hides + expanded becomes true again

The user can never consistently see the expanded view since it flips on every toggle. The expansion state is always the opposite of what you'd expect when the panel becomes visible.

**Fix**: Remove the `setTasksExpanded` toggle from the Ctrl+T handler, or use a separate keybinding for expansion.

---

### BUG-6: Resume doesn't load tasks into `todoItems` for `TodoPanel` summary (Spec §5.5.5)

**Severity**: Medium
**Spec says** (Section 5.5.5, step 4): "Update todoItems from loaded tasks so TodoPanel summary reflects current state"
**Actual behavior**: The resume handler at lines 722-730 sets `ralphSessionDir` and `ralphSessionId` (activating the TaskListPanel) but never calls `context.setTodoItems(tasks)` with the loaded tasks. The TodoPanel summary ("☑ N tasks (X done, Y open)") will show nothing until the agent's first TodoWrite call.

**Impact**: Brief gap where the TodoPanel is empty on resume. The TaskListPanel (bottom) will show tasks (loaded from file), but the TodoPanel summary (top) will be blank until the agent calls TodoWrite.

---

### BUG-7: `watchTasksJson` returns no-op when file doesn't exist at mount time (Spec §5.1)

**Severity**: Medium
**Location**: `workflow-commands.ts` line 809
```typescript
if (!existsSync(tasksPath)) return () => {};
```

**Scenario**: If `TaskListPanel` mounts before `tasks.json` is written to disk (possible race), or if tasks.json is temporarily deleted, the watcher is never created and the cleanup function is a no-op. The component will never receive live updates even after the file appears.

**Impact**: In the normal workflow path, this is mitigated because `saveTasksToActiveSession` is awaited before `setRalphSessionDir`. However, in edge cases (filesystem delays, resume with missing file), the panel becomes permanently stale. The initial synchronous read at mount still works, but live updates won't.

**Fix**: Either retry the watcher creation, or watch the directory instead of the file.

---

## Low / Visual Bugs

### BUG-8: Tree connector `╰` only on first task item — looks odd in standalone panel

**Severity**: Low (Visual)
**Location**: `task-list-indicator.tsx` line 96
```tsx
<span>{i === 0 ? `${CONNECTOR.subStatus}  ` : "   "}</span>
```

**Context**: The `TaskListIndicator` was originally designed for inline rendering under a loading spinner during streaming, where the `╰` connector makes visual sense as a tree branch from the spinner. When reused inside the `TaskListPanel` (which has its own border box), the single connector on the first item looks orphaned — it connects to nothing above it.

**Impact**: The first task shows `╰  ● Task name` while subsequent tasks show `   ● Task name`. Inside a bordered panel with a header, the connector has no parent element to connect to, creating a visual inconsistency.

**Suggestion**: Either remove the connector when rendering inside TaskListPanel (add a prop like `showConnector={false}`), or apply connectors consistently to all items.

---

### BUG-9: React key uses array index instead of task ID

**Severity**: Low
**Location**: `task-list-indicator.tsx` line 95: `<text key={i}>`

**Impact**: Using array indices as React keys can cause incorrect re-renders when tasks are reordered, inserted, or removed. Tasks have an `id` field (e.g., "#1", "#2") that should be used. This could cause visual glitches where a completed task briefly shows as in-progress if tasks are reordered.

**Fix**: `<text key={item.id ?? i}>`

---

### BUG-10: Panel dismissal doesn't trigger for slash commands (Spec §5.3.4 — ambiguous)

**Severity**: Low (Possible Design Deviation)
**Location**: `chat.tsx` lines 4541-4558

**Spec says** (Section 5.3.4): The dismissal code checks `!inputText.trim().startsWith("/ralph")`. In the spec's pseudocode, this check would fire for ALL non-ralph input including slash commands like `/help`.
**Actual behavior**: The slash command handler (line 4543-4548) returns early before the ralph dismissal check at line 4552. So typing `/help` during an idle ralph workflow does NOT dismiss the panel.

**Assessment**: This may actually be correct behavior — the spec explicitly says the panel should persist across `/clear` and `/compact`, which are also slash commands. But the spec's pseudocode placement ("before sending the message") implies it should run for all input. Clarify whether non-ralph slash commands should dismiss the panel.

---

## Spec Compliance Summary

| Spec Goal | Status | Notes |
|-----------|--------|-------|
| G1: TaskListPanel with full task list below scrollbox | ⚠️ Partial | Panel renders but maxVisible=10 truncates (BUG-1) |
| G2: Activate watchTasksJson for file-driven updates | ✅ Done | Watcher connected, drives state correctly |
| G3: Panel persists across /clear and /compact | ✅ Done | Refs preserved and restored in clearContext |
| G4: TodoPanel summary coexists above scrollbox | ✅ Done | Both panels render, Ctrl+T toggles both |
| G5: Remove manual context.clearContext() | ✅ Done | No clearContext in worker loop |
| G6: Remove context.setTodoItems() from worker loop | ✅ Done | TodoWrite handler drives both panels |
| G7: Panel lifecycle (active/idle/dismissed) | ⚠️ Partial | Active & dismissed work; idle works for new workflows but resume is broken (BUG-2/3/4) |

---

## Recommendations

1. **P0**: Fix BUG-1 (maxVisible truncation) — simple one-line fix with high visual impact
2. **P0**: Fix BUG-2/3/4 together — the resume path needs a complete rewrite to mirror the new workflow path's worker loop with task loading and iteration
3. **P1**: Fix BUG-5 (Ctrl+T double toggle) — confusing UX
4. **P1**: Fix BUG-6 (resume TodoPanel) — add `context.setTodoItems()` call on resume
5. **P2**: Fix BUG-7 (watcher race) — add fallback or directory-level watching
6. **P2**: Fix BUG-8/9 (visual polish) — low effort, improved rendering quality
