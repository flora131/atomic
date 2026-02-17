---
date: 2026-02-15 23:28:58 UTC
researcher: GitHub Copilot CLI
git_commit: be285d51c5a6dd1030d424df39320ac9e22ea080
branch: lavaman131/hotfix/sub-agents-ui
repository: atomic
topic: "UI elements pinned vs inline streaming in chat (sub-agent tree, task list, offsets, background lifecycle)"
tags: [research, codebase, ui, streaming, sub-agents, task-list, offsets, opentui]
status: complete
last_updated: 2026-02-15
last_updated_by: GitHub Copilot CLI
last_updated_note: "Added follow-up research for ● bullet rendering behavior across streamed blocks"
---

# Research

## Research Question
Research the codebase in depth to understand why some UI elements (for example sub-agent tree view and task list) appear pinned instead of streaming inline with chat, including edge cases with background sub-agents and possible offset/index placement effects, and compare current implementation patterns with OpenTUI best practices.

## Summary
The current UI has two different rendering paths: (1) inline chronological message segments inside chat bubbles, and (2) manually placed persistent/pinned panels outside the message segment flow. The sub-agent tree is currently inserted as an inline segment (`type: "agents"`), while the Ralph task list is intentionally rendered as a separate bottom panel (`TaskListPanel`) outside the scrollbox message stream. Task segments are still constructed (`type: "tasks"`) but are explicitly suppressed in message rendering (`return null`), which preserves pinned task placement rather than inline placement.

Across lifecycle handling, stream completion is deferred while running sub-agents/tools exist (`pendingCompleteRef`), and multiple finalization paths convert running/pending agents to terminal statuses; meanwhile `background` exists in type/render logic but there is no runtime assignment path observed in current UI event handling. Offset/index capture for tools/agents/tasks is present and used in segment insertion (`contentOffsetAtStart`, `agentsContentOffset`, `tasksContentOffset`), with ordering primarily controlled by insertion offsets. Follow-up analysis also shows `●` rendering is segment-boundary-driven: when new stream blocks create new text segments after non-text insertions, a new bullet-prefixed block is rendered.

## Detailed Findings

### 1) Inline segment architecture vs pinned panel architecture
- `buildContentSegments()` constructs a unified insertion list for `"text" | "tool" | "hitl" | "agents" | "tasks"` and places insertions by offset into message content (`src/ui/chat.tsx:1268-1466`).
- In `MessageBubble`, agent segments render inline with `<ParallelAgentsTree />` (`src/ui/chat.tsx:1676-1691`).
- In the same renderer, task segments are suppressed: `segment.type === "tasks" => return null` (`src/ui/chat.tsx:1693-1696`).
- Separately, a persistent Ralph task panel is rendered after the chat scrollbox in the root layout (`src/ui/chat.tsx:5446-5453`) via `TaskListPanel`, which is documented as pinned (`src/ui/components/task-list-panel.tsx:4-6`).
- `TaskListPanel` itself uses a dedicated container with `flexShrink={0}` and its own inner `scrollbox`, preserving panel behavior independent from message stream layout (`src/ui/components/task-list-panel.tsx:78-90`).

### 2) Stream anchoring for sub-agent tree (inline path)
- Parallel-agent updates are registered from parent UI state into chat local state (`src/ui/chat.tsx:2608-2617`).
- Live parallel-agent snapshots are written into the active streaming message so they render in message order (`src/ui/chat.tsx:2619-2632`).
- During message rendering, those agent snapshots become inline `"agents"` segments at recorded offsets (`src/ui/chat.tsx:1333-1365`, `src/ui/chat.tsx:1676-1691`).

### 3) Task list path currently split between offsets and manual placement
- Offset capture exists for tasks at first `TodoWrite` call: `tasksContentOffset = msg.content.length` (`src/ui/chat.tsx:2177-2183`).
- `buildContentSegments()` inserts `"tasks"` segments when task data and offset are present (`src/ui/chat.tsx:1367-1374`).
- Rendering explicitly bypasses those inline task segments (`src/ui/chat.tsx:1693-1696`), while persistent task UI is rendered outside the message stream (`src/ui/chat.tsx:5446-5453`).
- Net effect in current implementation: task UI appears pinned by structure, even though offset scaffolding for inline insertion still exists.

### 4) Offset/index logic used for chronological placement
- Tool offsets are captured at tool start from current message content length (`src/ui/chat.tsx:2133-2141`).
- First sub-agent spawn captures `agentsContentOffset` (`src/ui/chat.tsx:2154-2157`).
- First `TodoWrite` captures `tasksContentOffset` (`src/ui/chat.tsx:2177-2183`).
- Segment builder maps Task tool call IDs to offsets, groups agents by offset, and inserts grouped trees accordingly (`src/ui/chat.tsx:1337-1365`).
- Insertions are sorted by offset (`src/ui/chat.tsx:1376-1377`) and text is split around insertion points while advancing `lastOffset` to avoid duplication (`src/ui/chat.tsx:1394-1424`).

### 5) Sub-agent/tool completion and deferred finalization behavior
- Chat completion defers if active running/pending agents or running tools remain (`src/ui/chat.tsx:3318-3325`).
- Deferred completion is resumed by an effect once no active agents/tools remain (`src/ui/chat.tsx:2637-2648`) and by tool completion signaling (`src/ui/chat.tsx:2265-2268`).
- Finalization paths map running/pending agents to completed snapshots when baking final message state (`src/ui/chat.tsx:3330-3335`, `src/ui/chat.tsx:4795-4800`).
- Interrupt path marks running/pending agents as interrupted and bakes interrupted snapshots into message history (`src/ui/chat.tsx:4171-4201`, `src/ui/chat.tsx:4246-4265`).

### 6) Background-mode and SDK event lifecycle observations
- Central event correlation and agent state transitions are in `src/ui/index.ts` (`pendingTaskEntries`, `toolCallToAgentMap`, eager Task agent creation): `src/ui/index.ts:436-453`, `src/ui/index.ts:507-530`.
- `subagent.start` merges eager entries to SDK IDs or adds new running entries (`src/ui/index.ts:793-849`, `src/ui/index.ts:825-837`).
- `subagent.complete` sets completed/error status (`src/ui/index.ts:853-879`).
- Task `tool.complete` also finalizes running/pending agents to completed while attaching result (`src/ui/index.ts:647-669`, `src/ui/index.ts:701-717`).
- UI type/render layer includes a `background` status (`src/ui/components/parallel-agents-tree.tsx:26`, `src/ui/components/parallel-agents-tree.tsx:600-607`, `src/ui/components/parallel-agents-tree.tsx:616`), and Task renderer displays input mode (`src/ui/tools/registry.ts:693-699`), but no runtime status-assignment path to `"background"` was found in `src/ui` event handlers during this pass.

### 7) Manual placement surfaces currently in chat layout
- Above scrollbox: compaction summary and todo summary panel (`src/ui/chat.tsx:5272-5291`).
- Inside scrollbox: message stream and input flow (`src/ui/chat.tsx:5295-5445`).
- Below scrollbox: persistent Ralph task panel (`src/ui/chat.tsx:5446-5453`).
- This split confirms current behavior is not exclusively flow-based for all UI artifacts; some elements are intentionally pinned by container placement.

## OpenTUI Documentation Context (DeepWiki)
- DeepWiki summary for OpenTUI `ScrollBoxRenderable` sticky behavior and recommended chat usage (`stickyScroll: true`, `stickyStart: "bottom"`):  
  https://deepwiki.com/search/what-are-opentui-best-practice_7d455a7b-5377-43a5-a7d2-7e98560e7280
- DeepWiki summary of sticky state machine details (`_hasManualScroll`, `applyStickyStart`, `updateStickyState`, normal-flow child rendering via content container):  
  https://deepwiki.com/search/how-does-scrollbox-sticky-beha_ed172456-c241-416a-aeaa-acc63ca0685e
- DeepWiki source-location summary naming concrete implementation file and methods (`packages/core/src/renderables/ScrollBox.ts`, related tests):  
  https://deepwiki.com/search/list-the-concrete-source-files_4ace1393-ba16-4003-988f-7869b92c6f59
- DeepWiki wiki section links surfaced by those queries:
  - ScrollBox: https://deepwiki.com/wiki/anomalyco/opentui#4.1.2
  - Event System: https://deepwiki.com/wiki/anomalyco/opentui#3.4

## Code References
- `src/ui/chat.tsx:1268-1466` - Segment model and offset-based insertion.
- `src/ui/chat.tsx:1676-1691` - Inline sub-agent tree rendering in message segments.
- `src/ui/chat.tsx:1693-1696` - Task segment suppression (`return null`).
- `src/ui/chat.tsx:2133-2141` - Tool offset capture (`contentOffsetAtStart`).
- `src/ui/chat.tsx:2154-2157` - `agentsContentOffset` capture.
- `src/ui/chat.tsx:2177-2183` - `tasksContentOffset` capture.
- `src/ui/chat.tsx:2265-2268` - Deferred completion trigger when tools finish.
- `src/ui/chat.tsx:2619-2632` - Anchoring live agent updates into active streaming message.
- `src/ui/chat.tsx:2637-2648` - Deferred completion release effect.
- `src/ui/chat.tsx:3318-3335` - Stream completion deferral and completion-status baking.
- `src/ui/chat.tsx:4171-4201` - Interrupt-state conversion for active agents/tools.
- `src/ui/chat.tsx:5272-5291` - Pinned panels above scrollbox.
- `src/ui/chat.tsx:5295-5445` - Scrollbox chat flow area.
- `src/ui/chat.tsx:5446-5453` - Persistent Ralph task panel below scrollbox.
- `src/ui/components/task-list-panel.tsx:4-6` - Component docstring describing pinned behavior.
- `src/ui/components/task-list-panel.tsx:78-90` - Panel layout and independent scroll area.
- `src/ui/components/parallel-agents-tree.tsx:26` - `AgentStatus` includes background.
- `src/ui/components/parallel-agents-tree.tsx:600-607` - Status sort order.
- `src/ui/components/parallel-agents-tree.tsx:616-660` - Running/background counts and header text.
- `src/ui/index.ts:436-453` - Task/sub-agent correlation maps.
- `src/ui/index.ts:507-530` - Eager Task-agent creation path.
- `src/ui/index.ts:793-849` - `subagent.start` correlation/merge behavior.
- `src/ui/index.ts:853-879` - `subagent.complete` terminal status behavior.
- `src/ui/index.ts:647-669` - Task `tool.complete` result attribution and status finalization.
- `src/ui/tools/registry.ts:693-699` - Task mode display in tool renderer.

## Historical Context (from research/)
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` documents prior findings on segment ordering and fixed-position/pinned surfaces.
- `research/docs/2026-02-13-ralph-task-list-ui.md` documents introduction of persistent Ralph task panel behavior and file-watcher-driven task updates.
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md` documents unified sub-agent lifecycle handling across SDKs and status transition behavior.

## Related Research
- `specs/tui-layout-streaming-content-ordering.md`
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md`
- `research/docs/2026-02-13-ralph-task-list-ui.md`
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md`

## Follow-up Research 2026-02-15 23:40:41 UTC
### ● rendering per streamed block
- Bullet rendering in assistant messages is determined per text segment during `segments.map(...)` in `MessageBubble` (`src/ui/chat.tsx:1622-1698`).
- A bullet is shown when a segment starts a new block (`isNewBlock = !prevSegment || prevSegment.type !== "text"`), not once per message (`src/ui/chat.tsx:1626-1635`).
- The currently streaming block is identified as the last segment (`index === segments.length - 1`), which receives animated bullet rendering while active (`src/ui/chat.tsx:1629-1635`, `src/ui/chat.tsx:1701-1706`).
- Segment boundaries are recalculated on each streamed chunk because chunks append to `msg.content` (`src/ui/chat.tsx:3472-3477`), and `buildContentSegments()` reruns with tool/agent/task insertion offsets (`src/ui/chat.tsx:1283-1412`).
- When non-text insertions exist (tool/hitl/agent/task insertion points), text can be split around insertion offsets and then rendered as separate blocks (`src/ui/chat.tsx:1394-1424`), so subsequent streamed text may appear under a new bullet-prefixed block rather than extending a prior one.
- Interleaved text splitting logic (when text sits between non-text segments) further reinforces block-level rendering behavior (`src/ui/chat.tsx:1431-1462`).

## Open Questions
- The UI type system and tree renderer support `"background"` status, but current `src/ui` runtime handlers in this pass did not show assignment to that status.
- Task segments are still created with offset metadata while rendering is intentionally bypassed; current code contains both inline segment plumbing and persistent-panel rendering simultaneously.
