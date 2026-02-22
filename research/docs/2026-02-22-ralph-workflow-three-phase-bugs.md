---
date: 2026-02-22 07:51:13 UTC
researcher: Claude Opus 4.6
git_commit: 86d16e28fad10b8dff352de6627d711f8308268e
branch: lavaman131/hotfix/ralph-workflow
repository: ralph-workflow
topic: "Ralph workflow three-phase cycle bugs across OpenCode, Copilot, and Claude Agent SDKs"
tags: [research, codebase, ralph, workflow, opencode, copilot, claude, task-list, sub-agent, todowrite, deterministic-execution]
status: complete
last_updated: 2026-02-22
last_updated_by: Claude Opus 4.6
---

# Research: Ralph Workflow Three-Phase Cycle Bugs

## Research Question

Investigate the `/ralph` workflow's three-phase cycle (implement with workers → review with reviewer → implement with workers → exit) across all three SDK backends (OpenCode, Copilot, Claude Agent SDK) to document the root causes of these bugs:

1. **OpenCode SDK**: (a) Task list items #2-#11 condensed into a single display entry, (b) workflow chat history not propagating to main chat view, (c) reviewer sub-agent phase skipped.

2. **Copilot SDK**: (a) Reviewer sub-agent phase not invoked or not rendering, (b) second implementation-with-workers phase never executes.

3. **Claude Agent SDK**: (a) Three-phase cycle enters infinite loop because task list items never marked as complete.

## Summary

The `/ralph` workflow is orchestrated by `createRalphCommand()` in `workflow-commands.ts:580-883`. It runs three phases sequentially using `streamAndWait` and `spawnSubagent` from the `CommandContext` interface. A central shared mechanism—the sub-agent tool event filtering in `index.ts:729-756`—causes TodoWrite calls from worker sub-agents to be classified as sub-agent tools and silently dropped from the main UI's tool event handlers. This prevents `tasks.json` from being updated with completion statuses, which blocks the review phase gate (`allTasksCompleted` check at `workflow-commands.ts:708-711`) and causes infinite looping when the workflow re-prompts the agent to continue incomplete tasks.

The task list condensation ("#2-#11") originates from model behavior rather than UI code—no condensation logic exists in the rendering pipeline. The chat history gap in OpenCode results from the `hideContent` mechanism used in Step 1 combined with how `sendSilentMessage` creates placeholder messages. For both Copilot and Claude, `spawnSubagent` delegates to a prompt-injection approach that instructs the main session to invoke the named sub-agent via its Task tool, which is model-dependent and may not reliably execute.

## Detailed Findings

### Architecture Overview: The Ralph Three-Phase Workflow

The workflow is defined as a `CommandDefinition` (not a graph node execution) in `workflow-commands.ts:580-883`:

```
Phase 1: Task Decomposition (workflow-commands.ts:630-663)
  └── streamAndWait(buildSpecToTasksPrompt(prompt), { hideContent: true })
  └── Parse JSON tasks from output
  └── Save to tasks.json, register task IDs

Phase 2: Implementation Loop (workflow-commands.ts:687-718)
  └── while (iteration < MAX_RALPH_ITERATIONS)  // MAX = 100
        └── streamAndWait(buildBootstrappedTaskContext | buildContinuePrompt)
        └── readTasksFromDisk(sessionDir)
        └── Break if: allCompleted | wasCancelled | !hasActionable

Phase 3: Review & Fix (workflow-commands.ts:720-848)
  └── GATE: Only entered if allTasksCompleted === true (line 727)
  └── for (reviewIteration < MAX_REVIEW_ITERATIONS)  // MAX = 1
        └── spawnSubagent({ name: "reviewer", message: reviewPrompt })
        └── parseReviewResult(output)
        └── buildFixSpecFromReview(review, tasks, prompt)
        └── If fixes needed:
              └── streamAndWait(buildSpecToTasksPrompt(fixSpec), { hideContent: true })
              └── Implementation loop (same structure as Phase 2)
```

### Finding 1: Sub-Agent TodoWrite Events Are Silently Dropped

**Location:** `src/ui/index.ts:729-756`

When worker sub-agents (spawned via the Task tool) call TodoWrite, the tool events flow through `index.ts`'s event handlers. At `index.ts:730-736`, tools invoked while parallel agents are running are classified as `isSubagentTool`:

```typescript
// index.ts:730-736
if (!isTaskTool && state.parallelAgentHandler && state.parallelAgents.length > 0) {
    const runningAgent = [...state.parallelAgents]
        .reverse()
        .find((a) => a.status === "running");
    if (runningAgent) {
        isSubagentTool = true;
        subagentToolIds.add(toolId);
```

When `isSubagentTool` is `true`:
- `state.toolStartHandler` is NOT called at `index.ts:750`
- `state.toolCompleteHandler` is NOT called at `index.ts:817-818`

These are the handlers where TodoWrite persistence to `tasks.json` occurs (`chat.tsx:2321-2355` for tool.start, `chat.tsx:2486-2505` for tool.complete). Since they're never invoked for sub-agent tools, **worker sub-agents' TodoWrite calls never reach `saveTasksToActiveSession`**.

**Impact across all SDKs:**

- **Claude SDK**: Tasks remain "pending" in `tasks.json` indefinitely. The loop condition `diskTasks.every(t => t.status === "completed")` at `workflow-commands.ts:708-711` never becomes true. The `hasActionableTasks` check at line 714 returns `true` (pending tasks with met dependencies exist). The loop continues indefinitely, sending `buildContinuePrompt` which says "Some tasks are still incomplete" — causing the agent to keep trying.

- **OpenCode SDK**: Same behavior. Tasks never complete on disk, the review phase gate (`allTasksCompleted`) at `workflow-commands.ts:727` is never reached.

- **Copilot SDK**: Same behavior. Review phase is skipped, second implementation cycle never triggered.

### Finding 2: Task List Condensation ("#2-#11") Is Model-Generated

**Location:** `src/ui/components/task-list-indicator.tsx`, `task-list-panel.tsx`, `task-order.ts`

An exhaustive search of all task list rendering code confirms **no condensation, grouping, or range-collapsing logic exists anywhere in the codebase**:

- `TaskListIndicator` (`task-list-indicator.tsx:113-162`): Each item is rendered individually in a `.map()` loop.
- `TaskListBox` (`task-list-panel.tsx:71-150`): Passes items through to `TaskListIndicator` with `maxVisible={Infinity}`.
- `sortTasksTopologically` (`task-order.ts:186-289`): Reorders tasks but never merges them.
- The overflow mechanism shows `... +N more` (`task-list-indicator.tsx:168`), not range notation.

The "#2-#11" condensation originates from the **model itself** calling TodoWrite with a consolidated task item. When the main agent in Phase 2 receives `buildBootstrappedTaskContext` (which includes the full task list JSON and instructs "Dispatch workers with explicit task assignments and update TodoWrite as progress changes"), the model may decide to consolidate related tasks into a single entry.

**Ralph task ID guard behavior:** The guard at `chat.tsx:2326` via `hasRalphTaskIdOverlap` (`ralph-task-state.ts:47-105`) normalizes IDs by stripping the leading `#`. An item with `id: "#2-#11"` normalizes to `"2-#11"` which does NOT match any known ID like `"2"`, `"3"`, etc. The guard returns `false`, blocking the condensed update from being written to `tasks.json`. However, the in-memory `todoItems` state may be updated through the `handleToolStart` path if the guard logic has edge cases, or the condensation may appear in the inline message rendering (which shows the TodoWrite tool output directly, independent of `tasks.json`).

### Finding 3: Chat History Not Showing (OpenCode)

**Location:** `src/ui/chat.tsx:3543-3696`

The `hideContent` mechanism works as follows:

1. **Phase 1** uses `streamAndWait(prompt, { hideContent: true })` at `workflow-commands.ts:630-633`.
2. `hideStreamContentRef.current` is set to `true` at `chat.tsx:3767`.
3. In `handleChunk` (`chat.tsx:3543`): content IS accumulated in `lastStreamingContentRef.current` (line 3548), but rendering is skipped (line 3550 returns early).
4. On completion (`chat.tsx:3690-3691`): the empty placeholder message is removed from `messagesWindowed`.

**Phase 2** calls `streamWithInterruptRecovery(context, prompt)` WITHOUT `{ hideContent: true }` at `workflow-commands.ts:697-700`. The `hideStreamContentRef` should be `false` at this point (reset at `chat.tsx:3693` after Phase 1 completion). Content should render normally.

The chat history gap visible in the screenshot (`workflow-chat-history-bug.png`) occurs because:

1. Phase 1's hidden stream produces no visible message (placeholder removed).
2. Phase 2's `sendSilentMessage` creates a new assistant placeholder but does NOT create a visible user message (unlike `sendMessage`). The user sees only their original `/ralph` command input.
3. If the OpenCode agent dispatches work primarily through its native sub-agent mechanism (`AgentPartInput` dispatch at `opencode.ts:138-153`), the main session's text output may be minimal — the agent might emit mostly tool calls and sub-agent dispatches, with little visible text content being streamed back through `handleChunk`.

### Finding 4: `spawnSubagent` Uses Prompt-Injection for Non-OpenCode SDKs

**Location:** `src/ui/chat.tsx:3711-3758`

For Copilot and Claude SDKs, `spawnSubagent` constructs a text instruction at `chat.tsx:3730-3738`:

```typescript
instruction = `Invoke the "${agentName}" sub-agent with the following task. Return ONLY the sub-agent's complete output with no additional commentary or explanation.\n\nTask for ${agentName}:\n${task}\n\nImportant: Do not add any text before or after the sub-agent's output. Pass through the complete response exactly as produced.`;
```

This is sent through `context.sendSilentMessage(instruction)` to the main session. The model must interpret this instruction and invoke the named sub-agent via its built-in Task tool. This approach is inherently non-deterministic because:

- The model may not invoke the Task tool as instructed.
- The model may add commentary around the sub-agent output.
- The `hideStreamContentRef.current = true` at `chat.tsx:3748` suppresses rendering, so failures are invisible.

For OpenCode, sub-agents are dispatched structurally via `AgentPartInput` (`opencode.ts:138-153`), which triggers the SDK's native sub-agent mechanism. This is deterministic.

### Finding 5: Review Phase Gate Requires All Tasks Completed on Disk

**Location:** `src/ui/commands/workflow-commands.ts:720-727`

```typescript
const finalTasks = await readTasksFromDisk(sessionDir);
const allTasksCompleted =
    finalTasks.length > 0 &&
    finalTasks.every((t) => t.status === "completed");

if (allTasksCompleted) {
    // ... review phase
}
```

This gate condition depends entirely on `tasks.json` reflecting all tasks as "completed". Given Finding 1 (sub-agent TodoWrite events are dropped), this condition is never met when workers are spawned as sub-agents. The review phase is unconditionally skipped.

### Finding 6: The `streamAndWait` + `spawnSubagent` Shared Resolver

**Location:** `src/ui/chat.tsx:1945, 3760-3771, 3711-3758`

Both `streamAndWait` and `spawnSubagent` share a single-slot `streamCompletionResolverRef`. Only one can be active at a time. A new call resolves any pending one with `wasInterrupted: true`. This is safe for sequential usage (as in the ralph workflow) but means:

- Only one streaming operation can be in-flight at any time.
- If a Phase 2 `streamAndWait` is active and something else calls `streamAndWait` or `spawnSubagent`, the Phase 2 operation is force-resolved as interrupted.

### Finding 7: Task Persistence Guard Logic

**Location:** `src/ui/utils/ralph-task-state.ts:47-105`, `src/ui/chat.tsx:2326-2341`

The `hasRalphTaskIdOverlap` function acts as a guard:
- Normalizes known task IDs (strips `#`, lowercases) at line 54.
- For each incoming todo with an ID, checks if it's in the known set (lines 68-76). If ANY todo has an ID NOT in the known set, returns `false` immediately (line 73).
- Falls back to content-based matching for items without IDs (lines 79-101).

This guard correctly prevents unrelated sub-agent TodoWrite calls from overwriting ralph state, but it also blocks legitimate task updates if the model modifies task IDs (e.g., condensation like "#2-#11").

### Finding 8: TodoWrite Registration Differs by SDK

**Location:** `src/commands/chat.ts:241-244`, `src/sdk/clients/claude.ts:258`

- **Claude**: TodoWrite is a built-in Claude Code tool (listed in `BUILTIN_ALLOWED_TOOLS` at `claude.ts:258`). The custom `createTodoWriteTool()` from `todo-write.ts:67` is NOT registered for Claude.
- **Copilot**: The custom `createTodoWriteTool()` IS registered (at `chat.ts:242-243`).
- **OpenCode**: TodoWrite is available through OpenCode's native tool system.

Tool events arrive via different mechanisms:
- **Claude**: Hook-based (`toolEventsViaHooks = true` at `index.ts:468`). Events arrive through `PostToolUse` hooks at `claude.ts:1404-1428`.
- **OpenCode**: SSE-based. Events arrive through `message.part.updated` SSE events at `opencode.ts:654-708`.
- **Copilot**: Event callback-based. Events arrive through `tool.execution_start` and `tool.execution_complete` SDK events at `copilot.ts:526-659`.

### Finding 9: Copilot `session.idle` Completion Signal

**Location:** `src/sdk/clients/copilot.ts:431-433`

The Copilot SDK uses `session.idle` as the definitive stream completion signal. The `assistant.message` event does NOT set `done = true` (line 429: "Don't set done = true here - wait for session.idle / Tool execution may cause multiple assistant.message events"). This is correct for multi-turn agentic flows where the model issues tool calls followed by additional messages.

### Finding 10: Deterministic Execution and the Workflow SDK

The current `/ralph` implementation does NOT use the graph SDK (`src/graph/`) for execution. It's implemented as a direct imperative workflow within a `CommandDefinition.execute` function using `streamAndWait` and `spawnSubagent`. The graph SDK provides constructs like `agentNode`, `decisionNode`, `parallelNode`, and `subagentNode` that could enforce deterministic sequencing, but they are not used by the ralph workflow.

The workflow's three phases are sequenced via standard `async/await` control flow:
1. Phase 1 `await streamAndWait(...)` → Phase 2 `while` loop with `await streamAndWait(...)` → Phase 3 `await spawnSubagent(...)`.
2. The control flow itself IS deterministic. The non-determinism arises from:
   - Task completion signals not propagating (Finding 1)
   - Model behavior in TodoWrite calls (Finding 2)
   - Prompt-injection-based sub-agent dispatch for non-OpenCode SDKs (Finding 4)

## Code References

- `src/ui/commands/workflow-commands.ts:580-883` — `createRalphCommand()` orchestrating the three-phase workflow
- `src/ui/commands/workflow-commands.ts:687-718` — Phase 2 implementation loop
- `src/ui/commands/workflow-commands.ts:720-848` — Phase 3 review & fix phase
- `src/ui/commands/workflow-commands.ts:165-200` — `saveTasksToActiveSession()` writes tasks.json
- `src/ui/commands/workflow-commands.ts:203-213` — `readTasksFromDisk()` reads tasks.json
- `src/ui/index.ts:729-756` — Sub-agent tool event filtering (drops TodoWrite from sub-agents)
- `src/ui/index.ts:817-818` — Sub-agent tool.complete filtering
- `src/ui/chat.tsx:3760-3771` — `streamAndWait` implementation
- `src/ui/chat.tsx:3711-3758` — `spawnSubagent` implementation
- `src/ui/chat.tsx:3543-3550` — `handleChunk` with `hideContent` suppression
- `src/ui/chat.tsx:3684-3696` — `handleComplete` with resolver and placeholder cleanup
- `src/ui/chat.tsx:2321-2355` — `handleToolStart` TodoWrite interception + ralph guard
- `src/ui/chat.tsx:2486-2505` — `handleToolComplete` TodoWrite interception + ralph guard
- `src/ui/chat.tsx:1945` — `streamCompletionResolverRef` single-slot resolver
- `src/ui/utils/ralph-task-state.ts:47-105` — `hasRalphTaskIdOverlap` task ID guard
- `src/ui/utils/task-status.ts:97-104` — `normalizeTaskStatus` alias mapping
- `src/ui/components/task-list-indicator.tsx:113-162` — Individual task rendering (no condensation)
- `src/ui/components/task-list-panel.tsx:156-178` — `TaskListPanel` file-watcher-driven
- `src/ui/components/task-order.ts:186-289` — Topological sort (no grouping)
- `src/graph/nodes/ralph.ts:32-72` — `buildSpecToTasksPrompt` task decomposition prompt
- `src/graph/nodes/ralph.ts:143-161` — `buildBootstrappedTaskContext` Phase 2 prompt
- `src/graph/nodes/ralph.ts:164-180` — `buildContinuePrompt` loop continuation prompt
- `src/graph/nodes/ralph.ts:207-289` — `buildReviewPrompt` reviewer prompt
- `src/graph/nodes/ralph.ts:292-349` — `parseReviewResult` JSON parsing
- `src/graph/nodes/ralph.ts:352-416` — `buildFixSpecFromReview` fix specification builder
- `src/sdk/clients/opencode.ts:138-153` — `buildOpenCodePromptParts` AgentPartInput dispatch
- `src/sdk/clients/copilot.ts:431-433` — `session.idle` completion signal
- `src/sdk/clients/claude.ts:258` — `BUILTIN_ALLOWED_TOOLS` includes TodoWrite
- `src/commands/chat.ts:241-244` — TodoWrite custom tool registration (Copilot only)

## Architecture Documentation

### Current Workflow Execution Pattern

The ralph workflow uses an imperative `async/await` pattern within a `CommandDefinition.execute` function rather than the graph SDK. This means:

1. **No graph nodes** — The `agentNode`, `decisionNode`, `subagentNode` etc. from `src/graph/nodes.ts` are not used.
2. **No compiled graph** — The `CompiledGraph` from `src/graph/compiled.ts` is not involved.
3. **Direct SDK session interaction** — The workflow communicates with the SDK through `CommandContext.streamAndWait` and `CommandContext.spawnSubagent`, which use `sendSilentMessage` under the hood.
4. **Single session** — All phases share the same SDK session (no session recreation between phases).
5. **Disk-based state** — Task state is persisted to `tasks.json` and read back after each streaming iteration to determine loop exit conditions.
6. **File watcher for UI** — The `TaskListPanel` reads task state independently from disk via `watchTasksJson`, decoupled from the workflow control flow.

### SDK-Specific Dispatch Differences

| Mechanism | OpenCode | Copilot | Claude |
|---|---|---|---|
| `streamAndWait` | `session.prompt()` via SSE | `session.send()` via event callback | `query()` with `resume` option |
| `spawnSubagent` | `AgentPartInput` (native) | Prompt-injection (Task tool) | Prompt-injection (Task tool) |
| TodoWrite delivery | SSE `message.part.updated` | `tool.execution_*` events | `PostToolUse` hooks |
| Stream completion | `message.complete` event | `session.idle` event | Async generator exhaustion |
| Sub-agent dispatch | `{ type: "agent", name }` prompt part | Text instruction to invoke Task tool | Text instruction to invoke Task tool |

### Task Persistence Data Flow

```
Model calls TodoWrite
  │
  ├── Is the calling agent a sub-agent? (index.ts:730-736)
  │     ├── YES → isSubagentTool=true → tool event DROPPED (not dispatched)
  │     └── NO  → tool event dispatched to handleToolStart/handleToolComplete
  │
  └── handleToolStart/handleToolComplete (chat.tsx:2321-2355 / 2486-2505)
        │
        ├── Is this a TodoWrite call? (isTodoWriteToolName)
        │     ├── NO → skip
        │     └── YES → normalize items
        │
        ├── Is a ralph session active? (ralphSessionIdRef.current)
        │     ├── NO → update in-memory state unconditionally
        │     └── YES → check hasRalphTaskIdOverlap guard
        │           ├── PASS → update in-memory state + saveTasksToActiveSession()
        │           └── FAIL → skip (no update, no persistence)
        │
        └── saveTasksToActiveSession() (workflow-commands.ts:165-200)
              └── atomicWrite(tasks.json)
                    └── readTasksFromDisk() in workflow loop reads this file
```

## Historical Context (from research/)

- `research/docs/2026-02-09-163-ralph-loop-enhancements.md` — Prior research on ralph loop behavior
- `research/docs/2026-02-13-ralph-task-list-ui.md` — Task list UI rendering research
- `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` — DAG orchestration exploration
- `research/docs/2026-02-15-subagent-premature-completion-SUMMARY.md` — Sub-agent premature completion investigation (related to tool event lifecycle)
- `research/docs/2026-02-15-subagent-event-flow-diagram.md` — Event flow documentation for sub-agents
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Sub-agent SDK integration patterns
- `research/docs/2026-02-21-workflow-sdk-inline-mode-research.md` — Workflow SDK inline mode (recent)
- `research/docs/2026-01-31-graph-execution-pattern-design.md` — Original graph execution pattern design

## Related Research

- `research/docs/2026-02-11-workflow-sdk-implementation.md` — Workflow SDK implementation design
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Pluggable workflows SDK design
- `research/docs/2026-01-31-opencode-sdk-research.md` — OpenCode SDK capabilities
- `research/docs/2026-01-31-github-copilot-sdk-research.md` — Copilot SDK capabilities
- `research/docs/2026-01-31-claude-agent-sdk-research.md` — Claude Agent SDK capabilities

## Open Questions

1. **Main agent vs. sub-agent TodoWrite**: The workflow prompts (`buildBootstrappedTaskContext`, `buildContinuePrompt`) instruct the main agent to "update TodoWrite as progress changes". When the main agent dispatches workers via the Task tool, do the workers call TodoWrite (as sub-agents, which would be dropped), or does the main agent call TodoWrite directly after workers complete? The answer determines whether the filtering in `index.ts:729-756` is the sole blocker.

2. **OpenCode AgentPartInput completion**: When OpenCode dispatches a sub-agent via `AgentPartInput`, how does the main session report back? Does it emit text content (visible in chat), or does it only emit tool/agent events? This affects the chat history visibility.

3. **Prompt-injection reliability**: For Copilot and Claude, the `spawnSubagent` prompt-injection approach asks the model to "invoke the reviewer sub-agent". What is the observed success rate of this approach? Does the model reliably invoke the Task tool as instructed?

4. **Graph SDK migration**: Would migrating the ralph workflow from imperative `CommandDefinition.execute` to the graph SDK (`agentNode` → `subagentNode` → `decisionNode` chain) provide deterministic phase transitions? The graph SDK has built-in node execution, retry, and state management that could enforce the implement→review→implement→exit cycle.

5. **Task state reconciliation**: Even if sub-agent TodoWrite events were propagated, would the ralph task ID guard (`hasRalphTaskIdOverlap`) correctly handle partial updates where individual task statuses change (e.g., task #3 moves from "pending" to "completed") without sending the full task list?
