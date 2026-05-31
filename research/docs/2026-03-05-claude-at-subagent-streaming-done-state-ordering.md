---
date: 2026-03-05 02:18:15 UTC
researcher: OpenCode (gpt-5.3-codex)
git_commit: 63098f1c198f995e14e08cbc413b8d4c817a6e23
branch: lavaman131/hotfix/opencode-sub-agents
repository: atomic
topic: "Research the codebase to identify why streaming of sub-agents invoked with @ in Claude Agent SDK starts before sub-agent tree UI is updated in a done state"
tags: [research, codebase, claude-sdk, sub-agents, streaming, event-bus, tui]
status: complete
last_updated: 2026-03-05
last_updated_by: OpenCode (gpt-5.3-codex)
---

# Research

## Research Question

Research the codebase to identify why streaming of sub-agents invoked with `@` in Claude Agent SDK starts before the sub-agent tree UI is updated in a done state. Determine whether this is a race condition or another ordering behavior.

## Summary

The current implementation uses two different update lanes for related UI changes, which creates observable ordering differences:

- Sub-agent lifecycle (`stream.agent.start/update/complete`) is handled by direct typed bus subscriptions and updates `parallelAgents` immediately in `ChatApp`.
- Streamed text/tool parts are handled through wildcard bus subscription -> `BatchDispatcher` (16ms frame batching) -> `StreamPipelineConsumer` -> `onStreamParts` callback.
- Sub-agent tree "done" visibility is not rendered directly from the bus event; it becomes visible after a second hop: `setParallelAgents(...)` then a `useEffect` that bakes `parallelAgents` into `message.parallelAgents`/parts via `applyStreamPartEvent({ type: "parallel-agents" })`.

Because done-state rendering requires this extra React effect pass, while streaming content can continue through the stream-part lane, users can observe new streamed output before the tree row visually flips to done. In this codebase, that behavior is primarily status propagation ordering (intentional async architecture with batching/effect boundaries), not a single isolated bug.

There are still documented race windows at micro-order level (for example direct vs batched tool events), and the code includes explicit mitigations (dispatcher flush on `stream.session.idle`, buffering/replay for agent-scoped events).

## Detailed Findings

### 1) `@` mention invocation is fire-and-forget fan-out

- `@` detection and parsing happens in submit flow (`src/ui/chat.tsx:7835`, `src/ui/utils/mention-parsing.ts:58`).
- For each mention, the code executes `void executeCommand(...)` without awaiting (`src/ui/chat.tsx:7866`).
- The same non-awaited fan-out exists in queued-dispatch path (`src/ui/chat.tsx:5499`, `src/ui/chat.tsx:5502`).
- Claude agent command calls `sendSilentMessage(instruction, { agent })` (`src/ui/commands/agent-commands.ts:753`, `src/ui/commands/agent-commands.ts:757`).

This means stream startup is not serialized by mention completion.

### 2) Stream starts quickly and emits lifecycle events before/while chunk streaming

- `sendSilentMessage` calls `startAssistantStream(...)` after optional placeholder reconciliation (`src/ui/chat.tsx:5863`, `src/ui/chat.tsx:5871`, `src/ui/chat.tsx:5873`).
- `startAssistantStream` immediately sets streaming flags, creates assistant streaming message, then calls `onStreamMessage` asynchronously (`src/ui/chat.tsx:4697`, `src/ui/chat.tsx:4727`, `src/ui/chat.tsx:4733`).
- Claude adapter emits `stream.session.start` and synthetic foreground `stream.agent.start` before `session.stream(...)` iteration (`src/events/adapters/claude-adapter.ts:231`, `src/events/adapters/claude-adapter.ts:232`, `src/events/adapters/claude-adapter.ts:369`, `src/events/adapters/claude-adapter.ts:1817`).
- Adapter publishes sub-agent lifecycle from SDK hooks (`src/events/adapters/claude-adapter.ts:1497`, `src/events/adapters/claude-adapter.ts:1527`).

### 3) Event bus and batching create two timing lanes

- `EventBus.publish` dispatches typed handlers before wildcard handlers (`src/events/event-bus.ts:245`, `src/events/event-bus.ts:262`).
- Wildcard subscription feeds the batch dispatcher (`src/events/consumers/wire-consumers.ts:71`).
- Dispatcher uses frame-aligned flush (16ms default) (`src/events/batch-dispatcher.ts:21`, `src/events/batch-dispatcher.ts:259`, `src/events/batch-dispatcher.ts:265`).
- Stream pipeline maps `stream.text.delta` and `stream.tool.complete`, but does not map `stream.agent.complete` (`src/events/consumers/stream-pipeline-consumer.ts:181`, `src/events/consumers/stream-pipeline-consumer.ts:220`, `src/events/consumers/stream-pipeline-consumer.ts:311`).

Result: lifecycle completion and stream-part updates do not flow through a single synchronized reducer path.

### 4) Tree done-state visibility is a second-stage sync

- `stream.agent.complete` directly updates `parallelAgents` status (`src/ui/chat.tsx:4607`, `src/ui/chat.tsx:4627`, `src/ui/chat.tsx:4636`).
- The visible tree data on the message is synchronized later in a `useEffect` using `applyStreamPartEvent` with `type: "parallel-agents"` (`src/ui/chat.tsx:5063`, `src/ui/chat.tsx:5090`, `src/ui/parts/stream-pipeline.ts:1278`).
- Agent rows render `Done` only when status becomes `completed` in tree data (`src/ui/components/parallel-agents-tree.tsx:665`, `src/ui/components/parallel-agents-tree.tsx:666`).

This effect-based bake is the key reason done-state can appear after additional streamed updates.

### 5) Streaming text is independently delivered and can continue

- Text deltas are emitted from Claude chunk processing (`src/events/adapters/claude-adapter.ts:469`, `src/events/adapters/claude-adapter.ts:519`).
- Sub-agent-scoped deltas are routed to agent inline parts when `agentId` is available (`src/ui/parts/stream-pipeline.ts:1121`).
- If inline agent part is not present yet, events are buffered and replayed when `parallel-agents` merge occurs (`src/ui/parts/stream-pipeline.ts:1145`, `src/ui/parts/stream-pipeline.ts:1288`).

### 6) Explicit race handling exists in current code

- Chat includes a documented fallback for a direct-vs-batched timing window where `text.complete` can arrive before batched tool-start events (`src/ui/chat.tsx:3421`).
- On `stream.session.idle`, chat flushes dispatcher before continuation/finalization checks to avoid stale tool state (`src/ui/chat.tsx:4145`, `src/ui/chat.tsx:4155`).
- Tests document this ordering and the fixed-vs-broken behavior (`src/ui/chat.session-idle-flush.test.ts:112`, `src/ui/chat.session-idle-flush.test.ts:122`).

## Timeline (Observed in Code)

1. User submits `@agent ...`; mention parsed and command dispatched non-awaited (`src/ui/chat.tsx:7835`, `src/ui/chat.tsx:7866`).
2. `sendSilentMessage` starts assistant stream immediately (`src/ui/chat.tsx:5873`, `src/ui/chat.tsx:4692`).
3. Claude adapter publishes session start and synthetic agent start (`src/events/adapters/claude-adapter.ts:231`, `src/events/adapters/claude-adapter.ts:232`).
4. Stream chunks publish text deltas through batch pipeline (`src/events/adapters/claude-adapter.ts:519`, `src/events/consumers/wire-consumers.ts:71`).
5. Sub-agent complete event sets `parallelAgents` terminal status (`src/events/adapters/claude-adapter.ts:1527`, `src/ui/chat.tsx:4607`).
6. Separate effect later bakes updated `parallelAgents` into message parts/tree (`src/ui/chat.tsx:5063`, `src/ui/chat.tsx:5090`).
7. Tree row renders `Done` when baked status is `completed` (`src/ui/components/parallel-agents-tree.tsx:665`).

## Classification: Race Condition or Something Else?

Based on current implementation, this is primarily **asynchronous propagation ordering across separate state/update channels**, not a single root race condition.

- Deterministic design factors:
  - typed vs wildcard dispatch split,
  - 16ms frame batching,
  - done-state visual update requiring a follow-up `useEffect` bake.
- Race windows do exist at finer granularity (documented in comments/tests), but the specific observed symptom (streaming visible before tree done-state paint) follows directly from this architecture.

## Code References

- `src/ui/chat.tsx:7835` - `@` submit branch.
- `src/ui/chat.tsx:7866` - mention command fan-out via `void executeCommand(...)`.
- `src/ui/commands/agent-commands.ts:757` - Claude `sendSilentMessage(..., { agent })`.
- `src/ui/chat.tsx:5873` - `sendSilentMessage` starts assistant stream.
- `src/ui/chat.tsx:4692` - `startAssistantStream` bootstrap.
- `src/events/adapters/claude-adapter.ts:231` - publishes `stream.session.start`.
- `src/events/adapters/claude-adapter.ts:232` - publishes synthetic `stream.agent.start`.
- `src/events/adapters/claude-adapter.ts:369` - begins `session.stream(...)` iteration.
- `src/events/adapters/claude-adapter.ts:1527` - publishes `stream.agent.complete`.
- `src/events/adapters/claude-adapter.ts:519` - publishes `stream.text.delta`.
- `src/events/event-bus.ts:245` - typed handlers dispatch.
- `src/events/event-bus.ts:262` - wildcard handlers dispatch.
- `src/events/consumers/wire-consumers.ts:71` - wildcard -> batch enqueue.
- `src/events/batch-dispatcher.ts:21` - 16ms flush interval.
- `src/events/consumers/stream-pipeline-consumer.ts:220` - maps `stream.tool.complete`.
- `src/events/consumers/stream-pipeline-consumer.ts:311` - unmapped events path (includes `stream.agent.complete`).
- `src/ui/chat.tsx:4607` - direct `stream.agent.complete` subscription.
- `src/ui/chat.tsx:5063` - effect syncing `parallelAgents` into message.
- `src/ui/parts/stream-pipeline.ts:1278` - `parallel-agents` reducer merge.
- `src/ui/components/parallel-agents-tree.tsx:665` - completed substatus rendering.
- `src/ui/chat.tsx:3421` - documented direct-vs-batched race fallback comment.
- `src/ui/chat.tsx:4145` - `session.idle` pre-check dispatcher flush.
- `src/ui/chat.session-idle-flush.test.ts:112` - fixed ordering test.

## Architecture Documentation

Current architecture for this symptom path:

- Command layer: mention parsing + command dispatch (`@` -> `executeCommand`).
- Stream adapter layer: provider-specific translation (Claude SDK hooks/chunks -> canonical `stream.*` bus events).
- Event layer: typed handlers and wildcard handlers with batch dispatcher.
- UI layer:
  - direct bus subscriptions mutate live lifecycle state (`parallelAgents`),
  - stream-part consumer mutates content/tool/thinking parts,
  - effect synchronizes live agent state into message-level tree parts for rendering.

The tree done-state is therefore derived state that follows lifecycle event handling and subsequent effect synchronization.

## Historical Context (from research/)

- `research/docs/2026-02-15-subagent-event-flow-diagram.md` - earlier timing diagrams for sub-agent lifecycle ordering.
- `research/docs/2026-02-15-subagent-premature-completion-investigation.md` - prior lifecycle timing bug and guard context.
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md` - normalized lifecycle expectations across providers.
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md` - SDK event pipeline to tree render path.
- `research/docs/2026-02-23-gh-issue-258-background-agents-ui.md` - historical background-agent UI behavior tied to lifecycle updates.

These prior docs describe similar event-order sensitivities; current code reflects the same broad pipeline shape with bus-driven handling.

## External Library Context

- Claude Agent SDK hooks docs: <https://platform.claude.com/docs/en/agent-sdk/hooks>
- Claude Agent SDK streaming docs: <https://platform.claude.com/docs/en/agent-sdk/streaming-output>
- Claude Code hooks docs: <https://code.claude.com/docs/en/hooks>
- Claude Code changelog (interleaving/async hook notes): <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

External docs do not define a single strict global order between streaming chunks and lifecycle hooks across all async paths; this aligns with the repository's reconciliation/buffering design.

## Related Research

- `research/docs/2026-03-04-claude-sdk-discovery-and-atomic-config-sync.md`
- `research/docs/2026-03-02-copilot-sdk-ui-alignment.md`
- `research/docs/2026-03-01-opencode-delegation-streaming-parity.md`
- `research/docs/2026-03-01-opencode-tui-concurrency-bottlenecks.md`

## Open Questions

- In real user traces, is the reported ordering observed for single-mention submits, multi-mention submits, or both? The code supports both paths and multi-mention dispatch is explicitly non-awaited (`src/ui/chat.tsx:7866`).
- Which concrete event timestamps are present in runtime logs for the observed sessions (`stream.agent.complete`, `stream.text.delta`, `parallel-agents` effect bake), relative to user-perceived UI updates?
