---
date: 2026-03-06 00:00:00 UTC
researcher: Codex (GPT-5)
git_commit: 3f83c9233aa68faa2c594620a848842634acc8db
branch: lavaman131/hotfix/streaming-reliability
repository: streaming-reliability
topic: "OpenCode SDK Event Schema and TypeScript Type Reference"
tags: [research, opencode, sdk, events, typescript, sse]
status: complete
last_updated: 2026-03-06
last_updated_by: Codex (GPT-5)
---

# Research: OpenCode SDK Event Schema Reference

## Short Answer

Yes. The OpenCode SDK exposes structured TypeScript types for streamed events.

The event stream is a discriminated union shaped like:

```ts
type Event = {
  type: string;
  properties: Record<string, unknown>;
};
```

In practice, the SDK exports a concrete `Event` union where each variant has a literal `type` and a typed `properties` payload.

## Where The Types Live

### Installed SDK package (`@opencode-ai/sdk@1.2.18`)

- Root surface:
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`
  - `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts`
- V2 surface:
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
  - `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`

### Upstream repo notes from DeepWiki (`anomalyco/opencode`)

DeepWiki points to these upstream sources:

- Event definitions in the core app are created with `BusEvent.define(...)` and Zod schemas.
- Message-related events are defined in `packages/opencode/src/session/message-v2.ts`.
- Session/global event streaming is handled by the server routes that publish SSE events.
- Generated SDK types are emitted from the SDK package's generated `types.gen.ts` files from the OpenAPI spec.

DeepWiki searches used:

- https://deepwiki.com/search/does-the-opencode-sdk-define-a_7edbe200-b1a9-46be-bc0f-74d56daeb47e
- https://deepwiki.com/search/in-the-opencode-sdk-what-is-th_c33bd5b2-996f-4451-ae8b-f5712d38f805

## How You Consume Events

### Scoped event stream

The SDK exposes an event client with:

```ts
const client = createOpencodeClient(...);
const { stream } = await client.event.subscribe({
  directory: "/path/to/project",
  workspace: "optional-workspace", // v2 only
});

for await (const event of stream) {
  // event is typed as Event
}
```

The subscribe endpoint is `/event`, and the generated response type is `200: Event`.

### Global event stream

The SDK also exposes a global stream:

```ts
const { stream } = await client.global.event();

for await (const event of stream) {
  // event is typed as GlobalEvent
  // { directory: string; payload: Event }
}
```

## Event Envelope

Both SDK surfaces model streamed events as discriminated unions:

```ts
type EventVariant = {
  type: "literal.event.name";
  properties: { ...typed payload... };
};
```

The important pattern is:

- `type` is the discriminator
- `properties` is the typed payload
- `GlobalEvent` wraps an `Event` with `directory`

## Current Richest Surface: `@opencode-ai/sdk/v2`

The `v2` surface is the most complete event schema in the installed package and the one DeepWiki describes as the current generated API.

### Top-level v2 event families

| Family | Event types |
| --- | --- |
| Installation / server / project | `installation.updated`, `installation.update-available`, `project.updated`, `server.instance.disposed`, `server.connected`, `global.disposed` |
| LSP / files / VCS | `lsp.client.diagnostics`, `lsp.updated`, `file.edited`, `file.watcher.updated`, `vcs.branch.updated` |
| Messages | `message.updated`, `message.removed`, `message.part.updated`, `message.part.delta`, `message.part.removed` |
| Permissions / questions | `permission.asked`, `permission.replied`, `question.asked`, `question.replied`, `question.rejected` |
| Sessions | `session.created`, `session.updated`, `session.deleted`, `session.diff`, `session.error`, `session.status`, `session.idle`, `session.compacted` |
| Tasking / commands / TUI | `todo.updated`, `command.executed`, `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `tui.session.select` |
| MCP / workspace / terminal | `mcp.tools.changed`, `mcp.browser.open.failed`, `workspace.ready`, `workspace.failed`, `pty.created`, `pty.updated`, `pty.exited`, `pty.deleted`, `worktree.ready`, `worktree.failed` |

### Important v2 payload types

- `EventMessageUpdated.properties.info: Message`
- `EventMessagePartUpdated.properties.part: Part`
- `EventMessagePartDelta.properties: { sessionID; messageID; partID; field; delta }`
- `EventSessionCreated.properties.info: Session`
- `EventSessionDiff.properties: { sessionID; diff: FileDiff[] }`
- `EventSessionStatus.properties: { sessionID; status: SessionStatus }`
- `EventPermissionAsked.properties: PermissionRequest`
- `EventQuestionAsked.properties: QuestionRequest`
- `EventTodoUpdated.properties: { sessionID; todos: Todo[] }`
- `EventPtyCreated.properties.info: Pty`

### Important nested unions in v2

The event schema is useful because the payloads are typed too:

- `Message = UserMessage | AssistantMessage`
- `Part = TextPart | SubtaskPart | ReasoningPart | FilePart | ToolPart | StepStartPart | StepFinishPart | SnapshotPart | PatchPart | AgentPart | RetryPart | CompactionPart`
- `SessionStatus = { type: "idle" } | { type: "busy" } | { type: "retry"; ... }`

That means the stream is not just "some event name plus loose JSON"; it is typed all the way down into message, part, session, todo, question, and PTY payloads.

## Root SDK Surface vs `v2`

The installed package currently exposes typed event unions in both places:

- `@opencode-ai/sdk`
- `@opencode-ai/sdk/v2`

However, they are not identical.

### What differs

The root surface is narrower and older. The main differences I verified locally are:

| Area | Root `@opencode-ai/sdk` | `@opencode-ai/sdk/v2` |
| --- | --- | --- |
| Message deltas | `message.part.updated` can include optional `delta?: string` | Separate `message.part.delta` event with `{ sessionID, messageID, partID, field, delta }` |
| Permissions | `permission.updated` | `permission.asked` |
| Questions | Not present in the root union | `question.asked`, `question.replied`, `question.rejected` |
| Project / global events | Not present in the root union | `project.updated`, `global.disposed` |
| MCP / workspace / worktree | Not present in the root union | Present |
| TUI session select | Not present in the root union | `tui.session.select` |

### Practical recommendation

If you are building new event-handling code and can choose the SDK surface, prefer `@opencode-ai/sdk/v2`. It has:

- a richer event union
- cleaner separation of delta events
- more runtime/system event coverage
- better alignment with the upstream event model described by DeepWiki

## Concrete TypeScript Example

```ts
import {
  createOpencodeClient,
  type Event,
  type EventMessagePartDelta,
  type EventSessionCreated,
} from "@opencode-ai/sdk/v2";

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
});

const { stream } = await client.event.subscribe({
  directory: process.cwd(),
});

for await (const event of stream) {
  switch (event.type) {
    case "session.created": {
      const created: EventSessionCreated = event;
      console.log(created.properties.info.id);
      break;
    }
    case "message.part.delta": {
      const delta: EventMessagePartDelta = event;
      console.log(delta.properties.partID, delta.properties.delta);
      break;
    }
    default: {
      const _exhaustive: Event = event;
      void _exhaustive;
    }
  }
}
```

## Bottom Line

There is a real structured event schema in the OpenCode SDK, not just ad hoc JSON.

For future reference:

- Use the `Event` union as the authoritative stream type.
- Match on `event.type`.
- Read typed payloads from `event.properties`.
- Prefer `@opencode-ai/sdk/v2` when you want the most complete and current event model.
