---
date: 2026-02-15 19:51:31 UTC
researcher: GitHub Copilot CLI
git_commit: dbda8029862ba9e7bda5acce3a867a67d56cb048
branch: lavaman131/hotfix/sub-agents-ui
repository: atomic
topic: "Sub-agent tree status lifecycle while background agents run during streaming (SDK parity)"
tags: [research, codebase, ui, sub-agents, streaming, sdk-parity]
status: complete
last_updated: 2026-02-15
last_updated_by: GitHub Copilot CLI
---

# Research

## Research Question
Research the codebase to understand why the sub-agent tree can show fully completed (green) while sub-agents are still running in the background during streaming, document expected status signaling (grey pending/running, yellow interrupted, red spawn failure/error, green completed), and verify behavior across OpenCode SDK, Claude Agent SDK, and Copilot SDK integrations.

## Summary
The tree status lifecycle is centralized in `src/ui/index.ts` and rendered by `src/ui/components/parallel-agents-tree.tsx`, with live updates bridged into the streaming message in `src/ui/chat.tsx`. Current behavior marks Task-backed agents as completed on `tool.complete` (`src/ui/index.ts:648-663`) if they are still `running/pending`, and `background` exists in type definitions but is not assigned anywhere in runtime logic (`src/ui/components/parallel-agents-tree.tsx:25`, search results show no status assignment sites). All three SDKs normalize into the same `subagent.start`/`subagent.complete` event model (`src/sdk/types.ts:274-287`), so the same UI lifecycle logic is shared across Claude, OpenCode, and Copilot.

## Detailed Findings

### 1) Sub-agent tree status model and color semantics
- `AgentStatus` is defined as `"pending" | "running" | "completed" | "error" | "background" | "interrupted"` in `src/ui/components/parallel-agents-tree.tsx:25`.
- Status-to-color mapping for the dot is implemented in `getStatusIndicatorColor`:
  - green for completed (`:158-160`)
  - yellow for interrupted (`:160-162`)
  - red for error (`:162-164`)
  - muted grey for running/pending/background (`:164-169`)
- Header state is derived from counts (`:594-639`), where non-running with completed agents produces `"{N} ... finished"` and success color in header (`:620-626`, `:636-638`).

### 2) Live event pipeline that drives tree state
- Tool/sub-agent tracking structures are initialized in `src/ui/index.ts:433-453` (`pendingTaskEntries`, `toolCallToAgentMap`, `subagentToolIds`, `sdkToolIdMap`).
- On `tool.start` for `Task/task`, an eager `ParallelAgent` is created with status `"running"` and pushed to UI (`src/ui/index.ts:507-530`).
- On `subagent.start`, eager entries are merged to SDK IDs or a new running entry is added (`src/ui/index.ts:780-851`).
- On `subagent.complete`, status is set to `"completed"` or `"error"` (`src/ui/index.ts:865-879`).
- On `tool.complete` for `Task/task`, parsed result text is attributed and status is forced to completed when currently running/pending (`src/ui/index.ts:648-663`).

### 3) Streaming-time UI update mechanics (tree should keep updating while text streams)
- Parent-to-chat bridge registers `parallelAgentHandler` and updates both ref/state (`src/ui/chat.tsx:2607-2616`).
- A `useEffect` anchors live `parallelAgents` into the active streaming message (`src/ui/chat.tsx:2618-2631`).
- `buildContentSegments` inserts agent-tree segments at captured offsets (`src/ui/chat.tsx:1283-1365`), and `MessageBubble` renders those segments with `<ParallelAgentsTree .../>` (`src/ui/chat.tsx:1676-1691`).
- Stream finalization is deferred while active agents/tools exist (`src/ui/chat.tsx:3317-3325`), but completion code also maps running/pending to completed in finalize paths (`src/ui/chat.tsx:3331-3334`, `src/ui/chat.tsx:4791-4794`).

### 4) Background/async task state in current implementation
- Task renderer reads and displays `input.mode` (`src/ui/tools/registry.ts:693-699`) but status lifecycle logic does not branch on mode in UI event handlers.
- `background` is treated as active in tree sorting/counts (`src/ui/components/parallel-agents-tree.tsx:581`, `:594`) but no runtime assignment sites were found in source search.
- No `read_agent`/background-agent polling integration is present in UI runtime state handlers (search across `src/ui` returned only static `background` status/type references).

### 5) SDK parity: all SDKs feed one shared sub-agent lifecycle UI
- Unified event types include `subagent.start` and `subagent.complete` (`src/sdk/types.ts:274-287`).
- Claude mapping: `SubagentStart`/`SubagentStop` via hook map (`src/sdk/claude-client.ts:112-123`) with event data population for `agent_id`/`agent_type` (`src/sdk/claude-client.ts:963-974`).
- OpenCode mapping: `part.type === "agent"` -> `subagent.start`, `part.type === "step-finish"` -> `subagent.complete` (`src/sdk/opencode-client.ts:654-670`).
- Copilot mapping: `subagent.started`/`subagent.completed` and `subagent.failed` mapped into unified events (`src/sdk/copilot-client.ts:132-148`, `:570-593`).
- Because all map into the same `src/ui/index.ts` handlers, status-transition behavior is SDK-agnostic at the UI layer.

### 6) Screenshot alignment with code paths
- The screenshot shows an agent tree header in finished/green state while streaming narration below continues.
- This aligns with tree header derivation from `completedCount` (`parallel-agents-tree.tsx:636-638`) and Task `tool.complete` status-finalization path (`ui/index.ts:648-663`) during ongoing stream updates.

## Code References
- `src/ui/components/parallel-agents-tree.tsx:25` - `AgentStatus` union includes `background`.
- `src/ui/components/parallel-agents-tree.tsx:153-170` - status color mapping (grey/yellow/red/green behavior).
- `src/ui/components/parallel-agents-tree.tsx:594-639` - header count and finished/running/pending label logic.
- `src/ui/index.ts:507-530` - eager Task agent creation (running).
- `src/ui/index.ts:780-851` - `subagent.start` merge/create path.
- `src/ui/index.ts:854-879` - `subagent.complete` terminal status mapping.
- `src/ui/index.ts:648-663` - Task `tool.complete` completion assignment for running/pending agents.
- `src/ui/chat.tsx:2607-2631` - bridge and live agent anchoring to streaming message.
- `src/ui/chat.tsx:1283-1365` - content segment insertion for agent trees.
- `src/ui/chat.tsx:1676-1691` - tree render path in segment stream.
- `src/ui/chat.tsx:3317-3325` - defer completion while active.
- `src/ui/chat.tsx:3331-3334` - finalize running/pending as completed in completion path.
- `src/ui/chat.tsx:4791-4794` - additional finalize path setting running/pending to completed.
- `src/ui/tools/registry.ts:693-699` - Task renderer includes `mode` field display.
- `src/sdk/types.ts:274-287` - unified lifecycle event contract.
- `src/sdk/claude-client.ts:112-123` - Claude hook-event mapping.
- `src/sdk/claude-client.ts:963-974` - Claude sub-agent event data mapping.
- `src/sdk/opencode-client.ts:654-670` - OpenCode sub-agent lifecycle mapping.
- `src/sdk/copilot-client.ts:132-148` - Copilot event normalization map.
- `src/sdk/copilot-client.ts:570-593` - Copilot sub-agent started/completed/failed data mapping.

## Architecture Documentation
Current runtime status flow for sub-agent tree:

1. `tool.start(Task)` creates eager running tree node (`ui/index.ts:507-530`).
2. `subagent.start` merges temporary ID to SDK sub-agent ID (`ui/index.ts:810-824`).
3. Agent/internal tool updates mutate `currentTool` and `toolUses` (`ui/index.ts:544-557`).
4. `subagent.complete` sets completed/error (`ui/index.ts:865-879`).
5. `tool.complete(Task)` parses result and can also finalize status to completed (`ui/index.ts:648-663`).
6. Chat stream keeps rendering updated tree through anchored message segments (`chat.tsx:2618-2631`, `:1676-1691`).

## Historical Context (from research/)
- `research/docs/2026-02-15-ralph-orchestrator-ui-cleanup.md` documents the same event pipeline (`tool.start` -> `subagent.start` -> `subagent.complete` -> Task `tool.complete`) and chat anchoring behavior.
- `research/docs/2026-02-14-subagent-output-propagation-issue.md` documents compact tree rendering behavior and result propagation timing through Task `tool.complete`.
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` documents content-offset segment ordering and live streaming placement around tree updates.
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` documents normalized event architecture across Claude/OpenCode/Copilot clients.

## External SDK References
- Anthropic TypeScript SDK streaming/tool helpers: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md
- OpenCode SDK JS API/events: https://github.com/anomalyco/opencode-sdk-js/blob/main/api.md
- Copilot SDK repository docs: https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md
- Copilot Go SDK lifecycle/session events: https://pkg.go.dev/github.com/github/copilot-sdk/go

## Related Research
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md`
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md`
- `research/docs/2026-02-11-workflow-sdk-implementation.md`

## Open Questions
- How background `Task` tool executions are intended to report in-progress vs terminal state when completion is deferred to `read_agent` workflows is not represented in current UI status transitions.
- The `background` status is available in UI types and rendering logic but has no observed runtime assignment path in current code.
