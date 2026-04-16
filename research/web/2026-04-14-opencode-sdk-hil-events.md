---
source_url: file:///Users/norinlavaee/atomic/node_modules/@opencode-ai/sdk/
fetched_at: 2026-04-14
fetch_method: local node_modules source inspection
topic: OpenCode SDK v2 event subscription API and HIL (human-in-the-loop) question events
---

# OpenCode SDK HIL Events Research

## SDK Package Info

- Package: `@opencode-ai/sdk` version `1.3.17`
- The SDK has two entry points: the root (`@opencode-ai/sdk`) and `@opencode-ai/sdk/v2`
- The v2 client is the current/modern interface; it is accessed via `import { createOpencodeClient } from "@opencode-ai/sdk/v2"`

## 1. Event Subscription API (`event.subscribe()`)

### v2 Client (recommended)

The v2 `OpencodeClient` exposes an `event` namespace with a `subscribe()` method:

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

// Subscribe to all events as a server-sent events (SSE) stream
const result = await client.event.subscribe({
  directory?: string,   // optional
  workspace?: string,   // optional
})

for await (const event of result.stream) {
  // event is typed as `Event` (discriminated union)
  console.log(event.type, event.properties)
}
```

**Type signature:**
```typescript
class Event extends HeyApiClient {
  subscribe<ThrowOnError extends boolean = false>(
    parameters?: {
      directory?: string;
      workspace?: string;
    },
    options?: Options<never, ThrowOnError>
  ): Promise<ServerSentEventsResult<EventSubscribeResponses, unknown>>;
}
```

**Return type:**
```typescript
type ServerSentEventsResult<TData, TReturn = void, TNext = unknown> = {
  stream: AsyncGenerator<TData extends Record<string, unknown> ? TData[keyof TData] : TData, TReturn, TNext>
}
```

The `stream` is an `AsyncGenerator` that yields `Event` objects — each is a member of the `Event` discriminated union.

### v1 Client (legacy / root import)

```typescript
import { createOpencode } from "@opencode-ai/sdk"

const { client } = await createOpencode()

const events = await client.event.subscribe()
for await (const event of events.stream) {
  console.log("Event:", event.type, event.properties)
}
```

Note: The v1 types do NOT include question events (`question.asked`, `question.replied`, `question.rejected`). Those are v2-only.

---

## 2. Question Events (HIL)

These events are **only present in the v2 API** (`@opencode-ai/sdk/v2`).

### EventQuestionAsked

Emitted when the AI agent needs to ask a question to the human.

```typescript
type QuestionOption = {
  label: string;        // Display text (1-5 words, concise)
  description: string;  // Explanation of choice
};

type QuestionInfo = {
  question: string;     // Complete question text
  header: string;       // Very short label (max 30 chars)
  options: Array<QuestionOption>; // Available choices
  multiple?: boolean;   // Allow selecting multiple choices
  custom?: boolean;     // Allow typing a custom answer (default: true)
};

type QuestionRequest = {
  id: string;           // Unique request ID
  sessionID: string;    // Session this question belongs to
  questions: Array<QuestionInfo>; // One or more questions to ask
  tool?: {
    messageID: string;
    callID: string;
  };
};

type EventQuestionAsked = {
  type: "question.asked";
  properties: QuestionRequest;
};
```

### EventQuestionReplied

Emitted after the human has replied to a question.

```typescript
type QuestionAnswer = Array<string>; // Array of selected option labels or custom text

type EventQuestionReplied = {
  type: "question.replied";
  properties: {
    sessionID: string;
    requestID: string;
    answers: Array<QuestionAnswer>; // One answer per question in the request
  };
};
```

### EventQuestionRejected

Emitted when the human rejects/dismisses a question without answering.

```typescript
type EventQuestionRejected = {
  type: "question.rejected";
  properties: {
    sessionID: string;
    requestID: string;
  };
};
```

---

## 3. Session Events and State Transitions

### Session Status

```typescript
type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" };

type EventSessionStatus = {
  type: "session.status";
  properties: {
    sessionID: string;
    status: SessionStatus;
  };
};

type EventSessionIdle = {
  type: "session.idle";
  properties: { sessionID: string };
};

type EventSessionCompacted = {
  type: "session.compacted";
  properties: { sessionID: string };
};
```

### Session Lifecycle Events

```typescript
type EventSessionCreated = {
  type: "session.created";
  properties: { sessionID: string; info: Session };
};

type EventSessionUpdated = {
  type: "session.updated";
  properties: { sessionID: string; info: Session };
};

type EventSessionDeleted = {
  type: "session.deleted";
  properties: { /* varies */ };
};

type EventSessionError = {
  type: "session.error";
  properties: {
    sessionID?: string;
    error?: ProviderAuthError | UnknownError | MessageOutputLengthError 
          | MessageAbortedError | StructuredOutputError | ContextOverflowError | ApiError;
  };
};

type EventSessionDiff = {
  type: "session.diff";
  properties: {
    sessionID: string;
    diff: Array<FileDiff>;
  };
};
```

### Complete `Event` Union Type (v2)

The `Event` type in v2 is the full discriminated union:

```typescript
type Event =
  | EventProjectUpdated
  | EventInstallationUpdated
  | EventInstallationUpdateAvailable
  | EventServerInstanceDisposed
  | EventServerConnected
  | EventGlobalDisposed
  | EventLspClientDiagnostics
  | EventLspUpdated
  | EventMessagePartDelta
  | EventPermissionAsked          // HIL: permission requests
  | EventPermissionReplied
  | EventSessionStatus
  | EventSessionIdle
  | EventQuestionAsked            // HIL: question events
  | EventQuestionReplied
  | EventQuestionRejected
  | EventSessionCompacted
  | EventFileEdited
  | EventFileWatcherUpdated
  | EventTodoUpdated
  | EventTuiPromptAppend
  | EventTuiCommandExecute
  | EventTuiToastShow
  | EventTuiSessionSelect
  | EventMcpToolsChanged
  | EventMcpBrowserOpenFailed
  | EventCommandExecuted
  | EventSessionDiff
  | EventSessionError
  | EventVcsBranchUpdated
  | EventWorkspaceReady
  | EventWorkspaceFailed
  | EventPtyCreated | EventPtyUpdated | EventPtyExited | EventPtyDeleted
  | EventWorktreeReady | EventWorktreeFailed
  | EventMessageUpdated | EventMessageRemoved
  | EventMessagePartUpdated | EventMessagePartRemoved
  | EventSessionCreated | EventSessionUpdated | EventSessionDeleted;
```

---

## 4. HIL (Human-in-the-Loop) Functionality

### Overview

The SDK exposes two HIL mechanisms:

1. **Permission requests** — when the agent wants to perform an action requiring user approval (e.g., file edits, bash commands)
2. **Question requests** — when the agent wants to ask the user a structured question before proceeding

### Question Flow

```
Agent needs input
    → Emits: EventQuestionAsked { type: "question.asked", properties: QuestionRequest }
    → Human sees the question and can:
        (a) Answer → POST /question/{requestID}/reply → Emits: EventQuestionReplied
        (b) Dismiss → POST /question/{requestID}/reject → Emits: EventQuestionRejected
```

### API Endpoints for Question HIL

#### `client.question.list()` — List pending questions

```typescript
const pending = await client.question.list({ directory?, workspace? })
// Returns: Array<QuestionRequest>
```

#### `client.question.reply()` — Reply to a question

```typescript
await client.question.reply({
  requestID: "the-question-request-id",
  answers: [
    ["Option A"],            // Answer for question 0 (array of selected labels)
    ["Option B", "Option C"] // Answer for question 1 (multiple selection if multiple: true)
  ]
})
// Returns: boolean (success)
```

#### `client.question.reject()` — Reject a question

```typescript
await client.question.reject({
  requestID: "the-question-request-id",
})
// Returns: boolean (success)
```

### Permission Flow

```
Agent needs permission
    → Emits: EventPermissionAsked { type: "permission.asked", properties: PermissionRequest }
    → Human responds via:
        (a) client.permission.reply({ requestID, reply: "once" | "always" | "reject" })
        (b) client.permission.respond({ sessionID, permissionID, response: ... }) [deprecated]
```

```typescript
type PermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;    // e.g. "edit", "bash", "webfetch"
  patterns: Array<string>;
  metadata: { [key: string]: unknown };
  always: Array<string>;
  tool?: {
    messageID: string;
    callID: string;
  };
};
```

---

## 5. Session ID Filtering

All question events and permission events include a `sessionID` field on their `properties`. This allows filtering by session when consuming the event stream:

```typescript
const events = await client.event.subscribe()
for await (const event of events.stream) {
  if (event.type === "question.asked") {
    const { sessionID, id: requestID, questions } = event.properties
    // Filter to specific session:
    if (sessionID === mySessionID) {
      // Handle question for this session
    }
  }
}
```

---

## 6. Server-Sent Events Stream Details

The `subscribe()` method returns a `Promise<ServerSentEventsResult>` where:

```typescript
type ServerSentEventsResult<TData> = {
  stream: AsyncGenerator<
    TData extends Record<string, unknown> ? TData[keyof TData] : TData,
    void,    // return type
    unknown  // next type
  >;
}
```

The generator supports:
- `onSseError` callback in options for error handling
- `onSseEvent` callback for per-event side effects
- `sseDefaultRetryDelay` (default: 3000ms)
- `sseMaxRetryAttempts` — stops retrying after N failures
- `sseMaxRetryDelay` (default: 30000ms)

The first event on connection is `server.connected`.

---

## 7. Import Paths Summary

```typescript
// v2 client (full features incl. question events)
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { 
  Event, 
  EventQuestionAsked, 
  EventQuestionReplied,
  EventQuestionRejected,
  QuestionRequest,
  QuestionInfo,
  QuestionOption,
  QuestionAnswer,
  EventPermissionAsked,
  EventPermissionReplied,
  EventSessionStatus,
  SessionStatus
} from "@opencode-ai/sdk/v2"

// v1 legacy client (no question events)
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
```

---

## Key Findings

1. **`question.asked`, `question.replied`, `question.rejected` events exist** — but only in the v2 SDK (`@opencode-ai/sdk/v2`). The v1/root import does NOT have these types.

2. **`event.subscribe()` API** is available on both v1 and v2 clients. In v2 it's `client.event.subscribe({ directory?, workspace? })` returning an async generator.

3. **Question event data shape**: The `EventQuestionAsked` carries a `QuestionRequest` with `id` (requestID), `sessionID`, and an array of `QuestionInfo` objects (each with `question`, `header`, `options[]`, `multiple?`, `custom?`).

4. **Replying to questions**: Use `client.question.reply({ requestID, answers })` where `answers` is `Array<QuestionAnswer>` (= `Array<Array<string>>`). One `QuestionAnswer` per question in the request.

5. **Filtering by session**: Both `EventQuestionAsked` and `EventQuestionReplied`/`EventQuestionRejected` include `sessionID` in their `properties`, enabling per-session filtering.

6. **HIL mechanics**: The agent emits `question.asked`, your code filters it from the event stream, calls `client.question.reply()` or `client.question.reject()`, and the agent continues.
