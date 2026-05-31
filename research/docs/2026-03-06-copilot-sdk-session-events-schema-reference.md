---
date: 2026-03-06 00:00:00 UTC
researcher: Codex
git_commit: 3f83c9233aa68faa2c594620a848842634acc8db
branch: lavaman131/hotfix/streaming-reliability
repository: streaming-reliability
topic: "Copilot SDK session event schema and TypeScript type reference"
tags: [research, copilot-sdk, typescript, events, schema]
status: complete
last_updated: 2026-03-06
last_updated_by: Codex
last_updated_note: "Initial DeepWiki-backed reference for Copilot SDK event typing"
---

# Research

## Research Question
Is there a structured schema and TypeScript type surface for events emitted by the Copilot SDK? If so, what are the relevant Node.js exports and how should consumers use them?

## Short Answer
Yes. DeepWiki reports that the Copilot SDK has a structured event schema with generated TypeScript types for session events.

The Node.js SDK event surface is centered on a generated discriminated union named `SessionEvent`, produced from `session-events.schema.json` and exposed through:

- `nodejs/src/generated/session-events.ts`
- `nodejs/src/types.ts`

This means consumers should treat Copilot SDK events as typed, schema-backed objects rather than unstructured JSON blobs.

## Key TypeScript Exports

DeepWiki identifies the following Node.js exports as the main session-event typing surface:

- `SessionEvent`
  The primary discriminated union for all session events. Each member has a string literal `type` and a typed `data` payload.
- `SessionEventType`
  A union of all allowed `SessionEvent["type"]` string values.
- `SessionEventPayload<T extends SessionEventType>`
  A utility type that narrows the event shape for a specific event type.
- `SessionEventHandler`
  Handler signature for an unfiltered `SessionEvent`.
- `TypedSessionEventHandler<T extends SessionEventType>`
  Handler signature for a specific event type.
- `SessionLifecycleEvent`
  Separate client/session-lifecycle event type, distinct from per-turn conversation events.
- `SessionLifecycleEventType`
  Union of lifecycle event names.
- `SessionLifecycleHandler`
  Handler for `SessionLifecycleEvent`.
- `TypedSessionLifecycleHandler<K extends SessionLifecycleEventType>`
  Typed lifecycle handler for a specific lifecycle event.

## Source of Truth

DeepWiki states that:

- `session-events.schema.json` is the canonical schema.
- `nodejs/src/generated/session-events.ts` is generated from that schema.
- `nodejs/src/types.ts` re-exports the generated type and adds convenience utility types.

This is the important architectural point: the SDK type surface is schema-derived, so the correct place to look for event evolution is the schema and generated outputs, not ad hoc parser code.

## Event Shape Pattern

The event surface is reported as a discriminated union like:

```ts
type SessionEvent =
  | { type: "assistant.message"; data: { ... } }
  | { type: "assistant.message_delta"; data: { ... } }
  | { type: "tool.execution_start"; data: { ... } }
  | { type: "tool.execution_complete"; data: { ... } }
  | { type: "session.start"; data: { ... } }
  | ...
```

The stable narrowing mechanism is `event.type`.

## Documented Event Categories

DeepWiki grouped the generated `SessionEvent` union into these practical categories.

### Session lifecycle

Examples reported by DeepWiki:

- `session.start`
- `session.resume`
- `session.error`
- `session.idle`
- `session.shutdown`
- `session.context_changed`
- `session.usage_info`
- `session.compaction_start`
- `session.compaction_complete`

Representative payload fields include session identifiers, model/context metadata, repository context, token usage, and compaction statistics.

### User input

Examples reported by DeepWiki:

- `user.message`

Representative payload fields include:

- `content`
- `transformedContent`
- `attachments`
- `source`

### Assistant output

Examples reported by DeepWiki:

- `assistant.message`
- `assistant.message_delta`
- `assistant.reasoning`
- `assistant.reasoning_delta`
- `assistant.turn_start`
- `assistant.turn_end`
- `assistant.usage`

Representative payload fields include message IDs, streamed deltas, reasoning payloads, usage/token accounting, and tool request metadata.

### Tool execution

Examples reported by DeepWiki:

- `tool.user_requested`
- `tool.execution_start`
- `tool.execution_partial_result`
- `tool.execution_progress`
- `tool.execution_complete`

Representative payload fields include tool call IDs, tool names, arguments, progress text, partial output, completion result, error data, MCP metadata, and telemetry.

## TypeScript Consumption Pattern

The recommended consumer model is to narrow by `event.type`.

```ts
session.on((event) => {
  switch (event.type) {
    case "assistant.message":
      console.log(event.data.content);
      break;
    case "tool.execution_start":
      console.log(event.data.toolName);
      break;
    case "tool.execution_complete":
      console.log(event.data.success, event.data.result);
      break;
  }
});
```

DeepWiki also reports that the SDK supports typed subscription by event name, which should give a narrowed callback parameter:

```ts
session.on("assistant.message", (event) => {
  console.log(event.data.content);
});
```

And for explicit type extraction:

```ts
type AssistantMessageEvent = SessionEventPayload<"assistant.message">;
```

## Practical Implications For This Repository

- Copilot SDK events should be modeled as schema-backed discriminated unions.
- `event.type` should be the only event discriminator used in adapters.
- Local normalization code should prefer typed narrowing over stringly typed `data` access.
- If this repository needs exhaustive mapping, the best upstream anchor is the Copilot SDK `session-events.schema.json` plus generated Node.js types.

## Recommendation

If we need a stable local abstraction, mirror the upstream structure with:

1. An internal adapter entrypoint that accepts `SessionEvent`.
2. A `switch (event.type)` exhaustive mapper.
3. Optional helper aliases based on `SessionEventPayload<T>` for high-volume event families like assistant messages and tool execution.

## Sources

DeepWiki repo: `github/copilot-sdk`

DeepWiki searches used for this note:

- https://deepwiki.com/search/does-the-copilot-sdk-define-a_c99a23bc-2330-42ee-a106-2b31794b0ae4
- https://deepwiki.com/search/in-the-nodejs-copilot-sdk-spec_bdd6ac53-56cd-443d-abc4-ac9ae36a0f3e

## Confidence and Caveat

High confidence that the SDK exposes structured session-event types and that `SessionEvent` is the central Node.js union.

Caveat: this note is based on DeepWiki's repo-grounded summary rather than directly vendoring the upstream source files into this repository. Before implementing exhaustive field-level handling for every single event variant, re-check the current upstream `session-events.schema.json` and generated `nodejs/src/generated/session-events.ts`.
