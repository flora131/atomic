---
date: 2026-03-08 21:07:13 UTC
researcher: OpenCode (gpt-5.4)
git_commit: e981f3c71643619a7dbbd9fd3e8fd6d7c21e7b54
branch: lavaman131/hotfix/streaming-reliability
repository: atomic
topic: "Claude sub-agent tree tool call streaming"
tags: [research, codebase, claude, sub-agents, streaming, tool-calls, ui]
status: complete
last_updated: 2026-03-08
last_updated_by: OpenCode (gpt-5.4)
---

# Research

## Research Question

How does the current codebase implement Claude sub-agent execution, tool-call correlation, and streaming into the sub-agent tree UI?

## Summary

Claude `@agent` commands are routed as natural-language delegation prompts, not direct imperative API calls, in `src/commands/tui/agent-commands.ts:744`. The Claude client then relies on Claude SDK hooks plus `task_started` / `task_progress` / `task_notification` system messages to recover the real sub-agent lifecycle and correlate it to `tool_use_id`, `parent_tool_use_id`, and child SDK session IDs in `src/services/agents/clients/claude.ts:1626` and `src/services/agents/clients/claude.ts:2440`.

The Claude event adapter converts those normalized agent events into bus-level `stream.agent.start`, `stream.agent.update`, `stream.agent.complete`, `stream.tool.start`, `stream.tool.complete`, and `stream.tool.partial_result` events in `src/services/events/adapters/claude-adapter.ts:743`, `src/services/events/adapters/claude-adapter.ts:806`, `src/services/events/adapters/claude-adapter.ts:1198`, and `src/services/events/adapters/claude-adapter.ts:1366`. Task/Agent dispatch tools are intentionally suppressed from standalone tool rows and shown through the sub-agent tree instead.

The chat runtime keeps live sub-agent state in `parallelAgents`, binds each agent to the appropriate message, projects that state back into message parts, and routes agent-scoped text, reasoning, tool rows, and partial tool output into each agent's inline subtree through `src/state/chat/stream/use-agent-subscriptions.ts:64`, `src/state/chat/agent/use-message-projection.ts:155`, and `src/state/parts/stream-pipeline.ts:767`.

## Detailed Findings

### Claude sub-agent entry path

- Claude agent commands are registered from discovered `.claude`, `.opencode`, and `.github` agent definitions, but the Claude execution path specifically sends a natural-language instruction: `Use the {agent} sub-agent... After the sub-agent completes, provide the output to the user.` in `src/commands/tui/agent-commands.ts:760-763`.
- The Claude client forwards configured tool restrictions and sub-agent definitions into the SDK query options so those agents are actually discoverable to Claude at runtime in `src/services/agents/clients/claude.ts:688-699`.
- The shared enhanced system prompt also nudges all providers toward sub-agent usage patterns and research/debug delegation in `src/services/agents/enhanced-system-prompt.ts:17-25`.

### Claude client event normalization

- Claude's normalized event contract includes `subagent.start`, `subagent.update`, and `subagent.complete` in `src/services/agents/types.ts:634-673`.
- The Claude client records several correlation maps: `toolUseIdToAgentId`, `toolUseIdToSessionId`, `taskDescriptionByToolUseId`, `subagentSdkSessionIdToAgentId`, and `unmappedSubagentIds` in `src/services/agents/clients/claude.ts:435-457`.
- `task_started` stores the human task description by `tool_use_id`, `task_progress` emits `subagent.update` with `last_tool_name` and `usage.tool_uses`, and `task_notification` emits `subagent.complete` with success/result in `src/services/agents/clients/claude.ts:1626-1684`.
- Hook processing maps Claude hook payloads into unified tool/sub-agent events, resolves both `toolUseID` and `parent_tool_use_id`, prefers recorded task descriptions when hook labels are generic, and backfills missing `agent_id` on stop events in `src/services/agents/clients/claude.ts:2446-2545`.
- The same hook path registers `tool_use_id -> agent_id` mappings and later uses differing child SDK `session_id` values to infer when a hook belongs to a sub-agent instead of the parent session in `src/services/agents/clients/claude.ts:2547-2692`.

### Main-stream vs sub-agent-stream separation

- In both query consumption paths, Claude assistant messages with `parent_tool_use_id` are skipped so child-agent text/tool-use payloads do not leak into the main assistant transcript in `src/services/agents/clients/claude.ts:880-889` and `src/services/agents/clients/claude.ts:1284-1307`.
- This means sub-agent UI rendering depends on the normalized hook/system-message event path rather than rendering nested assistant messages directly.

### Claude adapter bus translation

- The Claude adapter captures task-tool metadata (`description`, background mode) on task-tool start and keeps pending correlation IDs ready for later `subagent.start` reconciliation in `src/services/events/adapters/claude-adapter.ts:743-747`.
- When a child tool starts, the adapter resolves parent attribution from direct parent IDs, `parent_tool_use_id`, child-session ownership, active-tool context, and background fallbacks, then updates `SubagentToolTracker` before publishing `stream.tool.start` in `src/services/events/adapters/claude-adapter.ts:752-802`.
- The same attribution logic runs for tool completion in `src/services/events/adapters/claude-adapter.ts:806-913`.
- Task dispatch tools (`task`, `launch_agent`, `agent`) are intentionally not emitted as standalone tool parts because the tree itself is the visual representation of that work in `src/services/events/adapters/claude-adapter.ts:783-786` and `src/services/events/adapters/claude-adapter.ts:891-894`.
- Partial tool output from sub-agent-owned sessions is translated into `stream.tool.partial_result` with parent-agent attribution in `src/services/events/adapters/claude-adapter.ts:1198-1231`.
- `subagent.start` publishes `stream.agent.start` only after resolving task label, background flag, tool correlation, and child-session ownership in `src/services/events/adapters/claude-adapter.ts:1366-1532`.
- `subagent.complete` and `subagent.update` become `stream.agent.complete` and `stream.agent.update` in `src/services/events/adapters/claude-adapter.ts:1540-1611`.

### Agent-state store and message binding

- `useStreamAgentSubscriptions` is the main stateful consumer for `stream.agent.*` events in `src/state/chat/stream/use-agent-subscriptions.ts:24-355`.
- On `stream.agent.start`, it validates lifecycle order, resolves the target message binding from correlation IDs, creates or upgrades an existing placeholder agent, and marks background agents with status `background` instead of `running` in `src/state/chat/stream/use-agent-subscriptions.ts:64-187`.
- On `stream.agent.update`, it updates `currentTool` and `toolUses`, and emits textual progress messages for background agents in `src/state/chat/stream/use-agent-subscriptions.ts:190-255`.
- On `stream.agent.complete`, it records completion ordering metadata, marks the agent completed/error, computes duration, and emits a background completion/failure message when needed in `src/state/chat/stream/use-agent-subscriptions.ts:258-355`.

### Projection into message parts and tree rendering

- The message projection hook re-applies current `parallelAgents` into the currently streaming message, the last streamed message, or the dedicated background message in `src/state/chat/agent/use-message-projection.ts:155-216`.
- The reducer recognizes `task`, `agent`, and `launch_agent` as sub-agent dispatch tools in `src/state/parts/stream-pipeline.ts:687-701`.
- Agent-scoped tool/text/reasoning events that arrive before the tree exists are buffered in `agentEventBuffer` and replayed after the next `parallel-agents` projection in `src/state/parts/stream-pipeline.ts:766-869`.
- `mergeParallelAgentsIntoParts` groups projected agents by `taskToolCallId`, inserts an `AgentPart` after the corresponding dispatch tool group, and falls back to a standalone agent block when no parent tool part can be matched in `src/state/parts/stream-pipeline.ts:912-1045`.
- Agent-scoped `tool-start`, `tool-complete`, and `tool-partial-result` events are routed into `inlineParts` instead of top-level tool rows in `src/state/parts/stream-pipeline.ts:1248-1333`.
- The `parallel-agents` event updates both `message.parallelAgents` and structured `parts`, then drains any buffered child events for the newly visible agents in `src/state/parts/stream-pipeline.ts:1352-1367`.
- `AgentPartDisplay` renders those projected agent parts with `ParallelAgentsTree` in `src/components/message-parts/agent-part-display.tsx:17-33`.
- `ParallelAgentsTree` defines the render model (`ParallelAgent`, statuses, task-label fallback, hidden-count handling, inline child tool/text/reasoning rows) in `src/components/parallel-agents-tree.tsx:15-34`, `src/components/parallel-agents-tree.tsx:132-139`, and `src/components/parallel-agents-tree.tsx:245-344`.

### Tool-count and current-tool updates inside the tree

- `SubagentToolTracker` is the shared runtime used by adapters to convert nested tool activity into `stream.agent.update` events with `toolUses` and `currentTool` in `src/services/events/adapters/subagent-tool-tracker.ts:28-149`.
- For Claude, the adapter uses this tracker on tool start, tool complete, and partial result progress so the tree can show active tool usage even when only hook traffic is available in `src/services/events/adapters/claude-adapter.ts:752-780`, `src/services/events/adapters/claude-adapter.ts:886-889`, and `src/services/events/adapters/claude-adapter.ts:1228-1229`.

## Code References

- `src/commands/tui/agent-commands.ts:744-773` - Claude `@agent` commands are translated into natural-language delegation prompts.
- `src/services/agents/clients/claude.ts:688-699` - Claude SDK options receive tool restrictions and configured sub-agent definitions.
- `src/services/agents/clients/claude.ts:880-889` - Sub-agent assistant messages are excluded from the returned parent assistant result.
- `src/services/agents/clients/claude.ts:1284-1307` - Streaming path also suppresses child assistant messages from the main transcript.
- `src/services/agents/clients/claude.ts:1626-1684` - `task_progress`, `task_started`, and `task_notification` are mapped into sub-agent lifecycle state.
- `src/services/agents/clients/claude.ts:2446-2692` - Hook payload normalization and Claude-specific tool/sub-agent correlation logic.
- `src/services/events/adapters/claude-adapter.ts:743-802` - Tool-start attribution and task-tool suppression.
- `src/services/events/adapters/claude-adapter.ts:806-913` - Tool-complete attribution and task-tool suppression.
- `src/services/events/adapters/claude-adapter.ts:1198-1231` - Partial tool output routing for child-agent tools.
- `src/services/events/adapters/claude-adapter.ts:1366-1532` - Bus publication for `stream.agent.start`.
- `src/services/events/adapters/claude-adapter.ts:1540-1611` - Bus publication for `stream.agent.complete` and `stream.agent.update`.
- `src/services/events/adapters/subagent-tool-tracker.ts:28-149` - Shared tracker for current tool and tool-use counts.
- `src/state/chat/stream/use-agent-subscriptions.ts:64-355` - Runtime parallel-agent store, lifecycle validation, and message binding.
- `src/state/chat/agent/use-message-projection.ts:155-216` - Projection of `parallelAgents` into chat messages.
- `src/state/parts/stream-pipeline.ts:687-701` - Canonical sub-agent dispatch-tool detection.
- `src/state/parts/stream-pipeline.ts:766-869` - Buffer/replay of agent-scoped events before the tree exists.
- `src/state/parts/stream-pipeline.ts:912-1045` - `AgentPart` insertion and grouping by parent tool call.
- `src/state/parts/stream-pipeline.ts:1248-1367` - Routing of agent-scoped tool events and `parallel-agents` projection.
- `src/components/message-parts/agent-part-display.tsx:17-33` - Agent part render entry point.
- `src/components/parallel-agents-tree.tsx:15-34` - `ParallelAgent` UI model.
- `src/components/parallel-agents-tree.tsx:245-344` - Tree rendering for agent summaries and inline child parts.

## Architecture Documentation

1. A Claude `@agent` command injects a natural-language delegation request into the main stream.
2. Claude SDK emits hook events and system task events; the Claude client normalizes them into unified agent/tool events while maintaining `tool_use_id`, `parent_tool_use_id`, task-description, and child-session mappings.
3. The Claude adapter translates those normalized events into typed bus events, suppressing top-level task-tool rows and attributing nested tools to their owning sub-agent.
4. `useStreamAgentSubscriptions` maintains the live `parallelAgents` array and binds each sub-agent to a specific chat message.
5. `use-message-projection` reprojects the current `parallelAgents` state into message parts.
6. The stream pipeline inserts `AgentPart` blocks after dispatch tools, replays buffered child events, and routes agent-scoped text/reasoning/tool output into each agent's `inlineParts`.
7. `ParallelAgentsTree` renders the visible tree rows and nested inline parts while completion ordering is tracked separately by the runtime ledger.

## Historical Context (from research/)

- `research/docs/2026-03-06-claude-agent-sdk-event-schema.md` documents the Claude SDK message union and confirms that `task_started`, `task_progress`, and `task_notification` are first-class streamed system-message subtypes.
- `research/docs/2026-02-23-sdk-subagent-api-research.md` compares OpenCode, Copilot, and Claude sub-agent APIs and notes Claude's reliance on `parent_tool_use_id` plus hooks for nested execution correlation.
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md` records the earlier shared tree lifecycle model; the current codebase still uses the same start/update/complete shape, but the implementation now lives in the event-bus and parts pipeline files above.

## Related Research

- `research/docs/2026-03-06-claude-agent-sdk-event-schema.md`
- `research/docs/2026-02-23-sdk-subagent-api-research.md`
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md`
- `research/docs/2026-03-01-opencode-delegation-streaming-parity.md`

## Open Questions

- The repo currently has substantial uncommitted work in Claude, Copilot, and config/discovery files, so this document reflects the working tree state on `lavaman131/hotfix/streaming-reliability`, not just the last committed revision.
- This research documents how Claude correlation currently works, but it does not include a runtime trace from a live Claude session to verify each fallback branch in `resolveToolCorrelationId`, `resolveSubagentSessionParentAgentId`, and pending task-correlation recovery.
