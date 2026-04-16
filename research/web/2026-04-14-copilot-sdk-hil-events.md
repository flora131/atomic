---
source_url: file:///Users/norinlavaee/atomic/node_modules/@github/copilot-sdk/
fetched_at: 2026-04-14
fetch_method: html-parse
topic: GitHub Copilot SDK (@github/copilot-sdk v0.2.1) — HIL events, session.idle, session.on() API, user_input.requested/completed
---

# GitHub Copilot SDK — HIL Events & session.on() Reference

SDK version: `@github/copilot-sdk@0.2.1`
Sources examined:
- `/node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts` — auto-generated SessionEvent union
- `/node_modules/@github/copilot-sdk/dist/session.d.ts` — CopilotSession class declaration
- `/node_modules/@github/copilot-sdk/dist/session.js` — CopilotSession implementation
- `/node_modules/@github/copilot-sdk/dist/types.d.ts` — all exported types
- `/node_modules/@github/copilot-sdk/dist/client.js` — CopilotClient wiring
- `/docs/copilot-cli/sdk.md` — project local docs

---

## 1. session.on() API

`CopilotSession.on()` has two overloads. Both return an unsubscribe function `() => void`.

### Typed overload — subscribe to a specific event type

```typescript
on<K extends SessionEventType>(
  eventType: K,
  handler: TypedSessionEventHandler<K>
): () => void
```

The handler receives a fully-typed event object. TypeScript narrows the event shape to the exact union member matching `eventType`. Example:

```typescript
session.on("user_input.requested", (event) => {
  // event.data.question — string
  // event.data.requestId — string
  // event.data.choices — string[] | undefined
  // event.data.allowFreeform — boolean | undefined
  // event.data.toolCallId — string | undefined
});
```

### Wildcard overload — subscribe to all events

```typescript
on(handler: SessionEventHandler): () => void
// where SessionEventHandler = (event: SessionEvent) => void
```

Receives every event. Use a `switch (event.type)` to discriminate.

### Internal dispatch — how it works

From `session.js`, the `_dispatchEvent(event)` method:
1. Calls `_handleBroadcastEvent(event)` — handles protocol-level "request" events (`external_tool.requested`, `permission.requested`, `command.execute`, `elicitation.requested`, `capabilities.changed`)
2. Dispatches to all typed handlers registered for `event.type`
3. Dispatches to all wildcard handlers

Both handler sets catch and swallow synchronous exceptions (each handler is wrapped in try/catch).

---

## 2. user_input.requested Event

**Full type declaration** (from `session-events.d.ts` line 2854):

```typescript
{
  id: string;           // UUID v4
  timestamp: string;    // ISO 8601
  parentId: string | null;
  ephemeral: true;      // NOT persisted to disk
  type: "user_input.requested";
  data: {
    requestId: string;        // Unique ID for this request — used to correlate with completion
    question: string;         // The question/prompt the agent wants to ask the user
    choices?: string[];       // Optional predefined choices
    allowFreeform?: boolean;  // Whether free-form text input is allowed (default: true)
    toolCallId?: string;      // LLM tool call ID that triggered this request (for remote UI correlation)
  };
}
```

**Key facts:**
- `ephemeral: true` — this event is **not** persisted to the session event log on disk
- Emitted when the Copilot agent invokes the `ask_user` tool
- The `requestId` links this event to the corresponding `user_input.completed` event
- `toolCallId` is present when the agent used the `ask_user` tool in its LLM completion

**When is it emitted?**
The Copilot CLI server broadcasts this event over the JSON-RPC notification channel (`session.event` notification) to all connected clients. The SDK's `client.js` also registers a separate `userInput.request` RPC request handler (line 1193) that calls `onUserInputRequest` callback registered in session config.

So there are **two parallel mechanisms**:
1. `session.on("user_input.requested", handler)` — fires from the event stream (all listeners see it)
2. `onUserInputRequest` in `createSession` config — fires from a direct RPC call and its return value is sent back to the CLI as the user's answer

---

## 3. user_input.completed Event

**Full type declaration** (from `session-events.d.ts` line 2894):

```typescript
{
  id: string;
  timestamp: string;
  parentId: string | null;
  ephemeral: true;      // NOT persisted to disk
  type: "user_input.completed";
  data: {
    requestId: string;  // Matches the requestId from the corresponding user_input.requested event
  };
}
```

**Key facts:**
- `ephemeral: true` — not persisted
- Signals that the user input request has been resolved; clients should dismiss any UI shown for this request
- The `requestId` field matches the `requestId` from the corresponding `user_input.requested` event
- Does NOT include the actual answer (that is returned to the CLI via the RPC response)

---

## 4. session.idle Event

**Full type declaration** (from `session-events.d.ts` line 265):

```typescript
{
  id: string;
  timestamp: string;
  parentId: string | null;
  ephemeral: true;      // NOT persisted to disk
  type: "session.idle";
  data: {
    backgroundTasks?: {
      agents: {
        agentId: string;
        agentType: string;
        description?: string;
      }[];
      shells: {
        shellId: string;
        description?: string;
      }[];
    };
    aborted?: boolean;  // true when the preceding agentic loop was cancelled via abort signal
  };
}
```

**Key facts:**
- `ephemeral: true` — not persisted
- Emitted when the Copilot agent finishes processing a turn (completes an agentic loop)
- The `backgroundTasks` field lists any agents/shell commands still running in the background when idle fires
- `aborted: true` means the turn was cut short by an abort signal (e.g., `session.abort()`)
- This is the canonical signal to know a `session.send()` has finished processing
- `sendAndWait()` uses this event internally to block until idle

**Usage pattern:**
```typescript
const done = new Promise<void>((resolve) => {
  session.on("session.idle", () => resolve());
});
await session.send({ prompt: "..." });
await done;
```

---

## 5. HIL (Human-in-the-Loop) Functionality

### Method 1: onUserInputRequest (primary HIL mechanism)

Register a handler in `createSession` to enable the `ask_user` tool:

```typescript
const session = await client.createSession({
  model: "gpt-5",
  onPermissionRequest: approveAll,
  onUserInputRequest: async (request, invocation) => {
    // request: UserInputRequest
    // request.question: string
    // request.choices?: string[]
    // request.allowFreeform?: boolean (default true)
    // invocation.sessionId: string

    const answer = await promptUser(request.question, request.choices);
    return {
      answer,         // string
      wasFreeform: true,  // boolean — was it free-form vs chosen from choices
    };
  },
});
```

When `onUserInputRequest` is provided, `requestUserInput: true` is sent in the `session.create` RPC, enabling the `ask_user` tool on the CLI side. The CLI will make a `userInput.request` RPC call (not a notification) to the SDK, which invokes the handler and returns the result. Simultaneously, `user_input.requested` and `user_input.completed` events are broadcast via the event stream.

### Method 2: session.on("user_input.requested") (passive observation)

Use for monitoring/display purposes without providing the answer:

```typescript
session.on("user_input.requested", (event) => {
  console.log(`Agent is asking: ${event.data.question}`);
  // Could show UI — but the actual answer must come from onUserInputRequest
});

session.on("user_input.completed", (event) => {
  console.log(`Input request ${event.data.requestId} completed`);
  // Dismiss any UI shown for this requestId
});
```

### Method 3: Permission Handling (coarse-grained HIL)

`onPermissionRequest` is required for every session. It gates tool execution:

```typescript
onPermissionRequest: async (request, invocation) => {
  // request.kind: "shell" | "write" | "read" | "mcp" | "url" | "memory" | "custom-tool" | "hook"
  const approved = await askUserForApproval(request);
  return approved
    ? { kind: "approved" }
    : { kind: "denied-interactively-by-user" };
},
```

The corresponding events on the stream are `permission.requested` and `permission.completed`. These events are `ephemeral: true`.

### Method 4: Elicitation (structured form HIL)

For structured form-based user input:

```typescript
onElicitationRequest: async (context) => {
  // context.message — description
  // context.requestedSchema — JSON Schema for form fields
  // context.mode — "form" | "url"
  return {
    action: "accept",  // "accept" | "decline" | "cancel"
    content: { field1: "value" },
  };
},
```

Events: `elicitation.requested` (ephemeral) and `elicitation.completed` (ephemeral).

---

## 6. Complete Ephemeral Event List (HIL-relevant)

All these events have `ephemeral: true` and are NOT persisted to disk. They are the key HIL detection signals:

| Event Type | Trigger | Data |
|---|---|---|
| `user_input.requested` | Agent invokes `ask_user` tool | `requestId`, `question`, `choices?`, `allowFreeform?`, `toolCallId?` |
| `user_input.completed` | `ask_user` response received | `requestId` |
| `permission.requested` | Agent needs permission for a tool | `requestId`, `permissionRequest` (kind-discriminated union), `resolvedByHook?` |
| `permission.completed` | Permission resolved | `requestId`, `result.kind` |
| `elicitation.requested` | Agent needs structured form input | `requestId`, `message`, `requestedSchema?`, `mode?`, `elicitationSource?` |
| `elicitation.completed` | Elicitation resolved | `requestId` |
| `session.idle` | Agent loop finished | `backgroundTasks?`, `aborted?` |

---

## 7. Full SessionEvent Type List

All event type strings from the `SessionEvent` discriminated union:

```
session.start, session.resume, session.remote_steerable_changed, session.error,
session.idle, session.title_changed, session.info, session.warning,
session.model_change, session.mode_changed, session.plan_changed,
session.workspace_file_changed, session.handoff, session.truncation,
session.snapshot_rewind, session.shutdown, session.context_changed,
session.usage_info, session.compaction_start, session.compaction_complete,
session.task_complete, session.tools_updated, session.background_tasks_changed,
session.skills_loaded, session.custom_agents_updated, session.mcp_servers_loaded,
session.mcp_server_status_changed, session.extensions_loaded,

user.message, pending_messages.modified,

assistant.turn_start, assistant.intent, assistant.reasoning,
assistant.reasoning_delta, assistant.streaming_delta, assistant.message,
assistant.message_delta, assistant.turn_end, assistant.usage,

abort,

tool.user_requested, tool.execution_start, tool.execution_partial_result,
tool.execution_progress, tool.execution_complete,

skill.invoked,

subagent.started, subagent.completed, subagent.failed, subagent.selected, subagent.deselected,

hook.start, hook.end,

system.message, system.notification,

permission.requested, permission.completed,

user_input.requested, user_input.completed,

elicitation.requested, elicitation.completed,

sampling.requested, sampling.completed,

mcp.oauth_required, mcp.oauth_completed,

external_tool.requested, external_tool.completed,

command.queued, command.execute, command.completed, commands.changed,

capabilities.changed,

exit_plan_mode.requested, exit_plan_mode.completed,
```

---

## 8. TypeScript Types for HIL Detection

```typescript
import type { SessionEvent, SessionEventType, SessionEventPayload } from "@github/copilot-sdk";

// Extract the exact type for user_input.requested
type UserInputRequestedEvent = SessionEventPayload<"user_input.requested">;
// => { id, timestamp, parentId, ephemeral: true, type: "user_input.requested", data: { requestId, question, choices?, allowFreeform?, toolCallId? } }

type UserInputCompletedEvent = SessionEventPayload<"user_input.completed">;
// => { ..., type: "user_input.completed", data: { requestId } }

type SessionIdleEvent = SessionEventPayload<"session.idle">;
// => { ..., type: "session.idle", data: { backgroundTasks?, aborted? } }

// HIL detection pattern
session.on((event) => {
  if (event.type === "user_input.requested") {
    const { requestId, question, choices, allowFreeform, toolCallId } = event.data;
    // Agent is waiting for user input
  }
  if (event.type === "session.idle") {
    const { backgroundTasks, aborted } = event.data;
    // Agent loop complete
  }
});
```

---

## 9. Important Distinction: Events vs RPC Handlers

The `user_input.requested` event is emitted over the notification stream (passive observation), while the **actual HIL mechanism** is the `userInput.request` RPC call wired in `client.js`:

```javascript
// From client.js line 1193
this.connection.onRequest(
  "userInput.request",
  async (params) => await this.handleUserInputRequest(params)
);
```

This means:
- `onUserInputRequest` callback in session config is an **active RPC handler** — it must return the user's answer
- `session.on("user_input.requested")` is **passive observation** — cannot provide the answer

For HIL detection (knowing the agent is waiting for input), subscribing to `user_input.requested` events is sufficient and correct.
