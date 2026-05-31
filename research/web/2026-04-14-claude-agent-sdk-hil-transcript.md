---
source_url: local://node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts + local://docs/claude-code/agent-sdk/
fetched_at: 2026-04-14
fetch_method: html-parse (local node_modules + docs directory)
topic: Claude Agent SDK — getSessionMessages, SessionMessage type, tool_use/tool_result blocks, AskUserQuestion, listSessions, detecting unresolved tool calls
---

# Claude Agent SDK — HIL Transcript Research

## Sources Consulted

- `/Users/norinlavaee/atomic/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (TypeScript type declarations)
- `/Users/norinlavaee/atomic/docs/claude-code/agent-sdk/sdk-references/typescript.md` (SDK reference docs)
- `/Users/norinlavaee/atomic/docs/claude-code/agent-sdk/core-concepts/sessions.md` (sessions guide)
- `/Users/norinlavaee/atomic/docs/claude-code/agent-sdk/guides/user-input.md` (user input guide)
- `/Users/norinlavaee/.claude/projects/-Users-norinlavaee-atomic/*.jsonl` (real session transcripts)
- `/Users/norinlavaee/atomic/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` (Anthropic core types)
- `/Users/norinlavaee/atomic/node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` (Beta types)

---

## 1. `getSessionMessages()` — Function Signature and Behavior

### Declaration

```typescript
function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions
): Promise<SessionMessage[]>;
```

### `GetSessionMessagesOptions`

```typescript
type GetSessionMessagesOptions = {
  /** Project directory to find the session in. If omitted, searches all projects. */
  dir?: string;
  /** Maximum number of messages to return. */
  limit?: number;
  /** Number of messages to skip from the start. */
  offset?: number;
  /**
   * When true, include system messages (e.g., compact boundaries, informational
   * notices) in the returned list alongside user/assistant messages.
   * Defaults to false for backwards compatibility.
   */
  includeSystemMessages?: boolean;
};
```

### Behavior (from SDK JSDoc)

> Reads a session's conversation messages from its JSONL transcript file.
> Parses the transcript, builds the conversation chain via parentUuid links,
> and returns user/assistant messages in chronological order.

- Returns messages in **chronological order** via `parentUuid` chain traversal
- Skips system messages by default (`includeSystemMessages: false`)
- Returns empty array if session not found
- Session files are stored at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`

### Usage Example

```typescript
import { listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const [latest] = await listSessions({ dir: "/path/to/project", limit: 1 });

if (latest) {
  const messages = await getSessionMessages(latest.sessionId, {
    dir: "/path/to/project",
    limit: 20
  });

  for (const msg of messages) {
    console.log(`[${msg.type}] ${msg.uuid}`);
  }
}
```

---

## 2. `SessionMessage` Type

### Declaration

```typescript
/**
 * A message from a session transcript.
 * Returned by `getSessionMessages` for reading historical session data.
 */
type SessionMessage = {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: null;
};
```

**Key observation**: The `message` field is typed as `unknown`. The actual runtime shape depends on the message type:

- For `assistant` messages: `message` is a `BetaMessage` (from `@anthropic-ai/sdk/resources/beta/messages/messages.mjs`), which has `content: Array<BetaContentBlock>`
- For `user` messages: `message` is a `MessageParam` (from `@anthropic-ai/sdk/resources`), which has `content: string | Array<ContentBlockParam>`

The `SDKAssistantMessage` type (used in the live query stream) shows:
```typescript
type SDKAssistantMessage = {
  type: 'assistant';
  message: BetaMessage;  // <-- the typed version
  parent_tool_use_id: string | null;
  error?: SDKAssistantMessageError;
  uuid: UUID;
  session_id: string;
};
```

The `SDKUserMessage` type:
```typescript
type SDKUserMessage = {
  type: 'user';
  message: MessageParam;  // <-- role: 'user' | 'assistant', content: string | ContentBlockParam[]
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
  priority?: 'now' | 'next' | 'later';
  timestamp?: string;
  uuid?: UUID;
  session_id?: string;
};
```

**Practical approach for `getSessionMessages` results**: cast `message` appropriately:
- If `msg.type === 'assistant'`: `const m = msg.message as { role: string; content: Array<{ type: string; id?: string; name?: string; input?: unknown; tool_use_id?: string }> }`
- If `msg.type === 'user'`: same cast pattern

---

## 3. `tool_use` Block Structure

### From `@anthropic-ai/sdk` types

```typescript
interface ToolUseBlock {
  id: string;
  input: unknown;
  name: string;
  type: 'tool_use';
  caller?: DirectCaller | ServerToolCaller;  // (non-beta variant)
}

interface BetaToolUseBlock {
  id: string;
  input: unknown;
  name: string;
  type: 'tool_use';
  caller?: BetaDirectCaller | BetaServerToolCaller;
}
```

### Observed from real session JSONL

An assistant message with a `tool_use` block looks like this in the raw JSONL:

```json
{
  "parentUuid": "...",
  "isSidechain": false,
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_01AK7JiyaCnAM24FHqifka48",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01YQWmmDfZAuviphW1XKaiXG",
        "name": "Bash",
        "input": {
          "command": "ls /Users/norinlavaee/atomic/src/",
          "description": "List top-level src directory"
        },
        "caller": { "type": "direct" }
      }
    ],
    "stop_reason": null,
    "usage": { ... }
  },
  "type": "assistant",
  "uuid": "16c0c6e0-7027-4e72-b33a-a311ceed481b",
  "timestamp": "2026-04-15T01:24:17.783Z",
  "sessionId": "68c62201-3fd4-497f-b8d9-fb87473ed485"
}
```

**Key fields for tool_use detection**:
- `block.type === 'tool_use'`
- `block.id` — the unique tool use ID (e.g., `"toolu_01YQWmmDfZAuviphW1XKaiXG"`)
- `block.name` — the tool name (e.g., `"Bash"`, `"AskUserQuestion"`)
- `block.input` — tool-specific input object

---

## 4. `tool_result` Block Structure

### From `@anthropic-ai/sdk` types

```typescript
interface ToolResultBlockParam {
  tool_use_id: string;
  type: 'tool_result';
  cache_control?: CacheControlEphemeral | null;
  content?: string | Array<TextBlockParam | ImageBlockParam | ...>;
  is_error?: boolean;
}
```

### Observed from real session JSONL

A user message containing a `tool_result` block looks like:

```json
{
  "parentUuid": "16c0c6e0-7027-4e72-b33a-a311ceed481b",
  "isSidechain": false,
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_01YQWmmDfZAuviphW1XKaiXG",
        "type": "tool_result",
        "content": "cli.ts\ncommands\n...",
        "is_error": false
      }
    ]
  },
  "uuid": "40ec4182-8c1b-47ea-9c39-bb289d2811b0",
  "timestamp": "2026-04-15T01:24:18.872Z",
  "sourceToolAssistantUUID": "16c0c6e0-7027-4e72-b33a-a311ceed481b",
  "toolUseResult": {
    "stdout": "cli.ts\ncommands\n...",
    "stderr": "",
    "interrupted": false,
    "isImage": false
  },
  "sessionId": "68c62201-3fd4-497f-b8d9-fb87473ed485"
}
```

**Key fields for tool_result detection**:
- `block.type === 'tool_result'`
- `block.tool_use_id` — matches the `id` field from the corresponding `tool_use` block
- `block.content` — the tool's output (string or array)
- `block.is_error` — whether the tool errored

**Note**: The user message's `message.content` may also be a plain `string` (for human messages that aren't tool results). Always check `Array.isArray(content)` first.

---

## 5. `AskUserQuestion` Tool — How It Appears in the Transcript

### Input format

When Claude calls `AskUserQuestion`, it appears as a `tool_use` block in an assistant message with:

```json
{
  "type": "tool_use",
  "id": "toolu_017scoyk7tgd627Q7Fmwtfnr",
  "name": "AskUserQuestion",
  "input": {
    "questions": [
      {
        "question": "What area of health do you focus on the most?",
        "header": "Focus Area",
        "options": [
          { "label": "Nutrition & Diet", "description": "Eating habits, meal planning, supplements, etc." },
          { "label": "Exercise & Movement", "description": "Workouts, daily activity, stretching, sports" },
          { "label": "Sleep & Recovery", "description": "Sleep quality, rest days, stress management" },
          { "label": "Mental Wellness", "description": "Mindfulness, meditation, therapy, journaling" }
        ],
        "multiSelect": false
      }
    ]
  },
  "caller": { "type": "direct" }
}
```

### Response format (returned via `canUseTool` callback → `PermissionResultAllow`)

After the user answers, the response is a `tool_result` user message with `tool_use_id` matching the original `AskUserQuestion` call:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_017scoyk7tgd627Q7Fmwtfnr",
        "content": "...",
        "is_error": false
      }
    ]
  }
}
```

The `updatedInput` returned by the callback becomes the tool result content:
```json
{
  "questions": [ /* original questions array */ ],
  "answers": {
    "What area of health do you focus on the most?": "Nutrition & Diet"
  }
}
```

### Detection in `canUseTool` callback

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === "AskUserQuestion") {
    // HIL state — Claude is asking the user a question
    // input.questions is the array of questions
    return handleClarifyingQuestions(input);
  }
  return { behavior: "allow", updatedInput: input };
}
```

**Key**: `AskUserQuestion` must be explicitly included in the `tools` array if a restricted tool list is used:
```typescript
tools: ["Read", "Glob", "Grep", "AskUserQuestion"]
```

---

## 6. Detecting Unresolved Tool Calls in the Transcript

### Algorithm

After calling `getSessionMessages()`, iterate the returned messages and build a set of pending tool_use IDs:

```typescript
import { getSessionMessages, SessionMessage } from "@anthropic-ai/claude-agent-sdk";

type ContentBlock = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

type MessageLike = {
  role: string;
  content: string | ContentBlock[];
};

async function getUnresolvedToolUses(sessionId: string, dir?: string) {
  const messages = await getSessionMessages(sessionId, { dir });

  // Collect all tool_use IDs from assistant messages
  const toolUseIds = new Set<string>();
  // Collect all resolved tool_use IDs from user messages
  const resolvedIds = new Set<string>();
  // Track name for each tool_use ID
  const toolUseNames = new Map<string, string>();

  for (const msg of messages) {
    const message = msg.message as MessageLike;
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    if (msg.type === 'assistant') {
      for (const block of content) {
        if (block.type === 'tool_use' && block.id) {
          toolUseIds.add(block.id);
          toolUseNames.set(block.id, block.name ?? '');
        }
      }
    } else if (msg.type === 'user') {
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          resolvedIds.add(block.tool_use_id);
        }
      }
    }
  }

  // Unresolved = tool_use IDs without a corresponding tool_result
  const unresolved = [...toolUseIds].filter(id => !resolvedIds.has(id));
  return unresolved.map(id => ({ id, name: toolUseNames.get(id) ?? '' }));
}
```

### HIL State Detection Pattern

To detect whether a session is waiting for human input (specifically an `AskUserQuestion` call):

```typescript
const unresolved = await getUnresolvedToolUses(sessionId, dir);
const isAwaitingHIL = unresolved.some(t => t.name === 'AskUserQuestion');
```

### Important Caveats

1. **`getSessionMessages` returns historical data**: It reads from the on-disk JSONL transcript. For a currently running session, this reflects the state at the time of reading but may lag slightly.

2. **The transcript is a chain**: Messages are linked via `parentUuid`. The SDK builds the chain and returns them in order. The last few messages will show the current state.

3. **Unresolved at end-of-session vs. mid-session**: An unresolved `AskUserQuestion` at the end of the message list indicates the session is currently waiting. If the session has ended (result message exists), then an unresolved tool_use indicates an interrupted/errored session.

4. **`deferred_tool_use` on `SDKResultSuccess`**: The result message has an optional `deferred_tool_use?: SDKDeferredToolUse` field:
   ```typescript
   type SDKDeferredToolUse = {
     id: string;
     name: string;
     input: Record<string, unknown>;
   };
   ```
   This is set when the session ended with a pending tool use (e.g., when `canUseTool` is not provided). This is the **most direct** signal from the live stream (not transcript) that a HIL state ended the session.

---

## 7. `listSessions()` and Session Identification

### Declaration

```typescript
function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
```

### `ListSessionsOptions`

```typescript
type ListSessionsOptions = {
  /**
   * Directory to list sessions for. When provided, returns sessions for
   * this project directory (and optionally its git worktrees). When omitted,
   * returns sessions across all projects.
   */
  dir?: string;
  /** Maximum number of sessions to return. */
  limit?: number;
  /**
   * Number of sessions to skip from the start of the sorted result set.
   */
  offset?: number;
  /**
   * When dir is inside a git repo, include sessions from all worktrees.
   * Defaults to true.
   */
  includeWorktrees?: boolean;
};
```

### `SDKSessionInfo` Return Type

```typescript
type SDKSessionInfo = {
  sessionId: string;        // UUID — use this with getSessionMessages()
  summary: string;          // Display title (custom, auto-generated, or first prompt)
  lastModified: number;     // Unix ms timestamp
  fileSize?: number;        // JSONL file size in bytes
  customTitle?: string;     // User-set via /rename
  firstPrompt?: string;     // First meaningful user prompt
  gitBranch?: string;       // Git branch at end of session
  cwd?: string;             // Working directory
  tag?: string;             // User-set tag via tagSession()
  createdAt?: number;       // Unix ms timestamp of creation
};
```

### Session Storage Location

Sessions are stored at:
```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

Where `<encoded-cwd>` is the absolute CWD with every non-alphanumeric character replaced by `-`. For example, `/Users/me/atomic` becomes `-Users-me-atomic`.

**Important for `resume`**: The session file must exist on the current machine at the exact same encoded-cwd path. Cross-host resume requires moving the JSONL file.

### Usage Example

```typescript
import { listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

// List 10 most recent sessions for a specific project
const sessions = await listSessions({ dir: "/Users/me/atomic", limit: 10 });

// Results are sorted by lastModified descending (newest first)
for (const session of sessions) {
  console.log(`${session.sessionId} | ${session.summary} | ${new Date(session.lastModified).toISOString()}`);
}

// Get messages for the first session
const messages = await getSessionMessages(sessions[0].sessionId, {
  dir: "/Users/me/atomic"
});
```

### Session ID from Live Stream

During an active `query()` call, the session ID is available:
1. **Early**: From the `system` init message (`message.subtype === 'init'` → `message.session_id`)
2. **On completion**: From the result message (`message.type === 'result'` → `message.session_id`)

```typescript
for await (const message of query({ prompt: "...", options: {} })) {
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id;
  }
  if (message.type === "result") {
    sessionId = message.session_id;  // also available here
  }
}
```

---

## 8. Complete Message Type Hierarchy

The live query stream emits `SDKMessage` which is a union:

```typescript
type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | SDKAPIRetryMessage
  | SDKLocalCommandOutputMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKSessionStateChangedMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
  | SDKRateLimitEvent
  | SDKElicitationCompleteMessage
  | SDKPromptSuggestionMessage;
```

For transcript reading, `SessionMessage.type` is only `'user' | 'assistant' | 'system'`.

### `BetaMessage` (assistant message payload)

```typescript
interface BetaMessage {
  id: string;
  content: Array<BetaContentBlock>;  // Array of blocks
  role: 'assistant';
  // ... stop_reason, usage, etc.
}
```

### `BetaContentBlock` union

```typescript
type BetaContentBlock =
  | BetaTextBlock          // { type: 'text', text: string }
  | BetaThinkingBlock      // { type: 'thinking', thinking: string }
  | BetaRedactedThinkingBlock
  | BetaToolUseBlock       // { type: 'tool_use', id: string, name: string, input: unknown }
  | BetaServerToolUseBlock
  | BetaWebSearchToolResultBlock
  | BetaWebFetchToolResultBlock
  | BetaCodeExecutionToolResultBlock
  | BetaMCPToolUseBlock    // { type: 'mcp_tool_use', ... }
  | BetaMCPToolResultBlock
  | BetaCompactionBlock
  // ... more
```

### `MessageParam` (user message payload)

```typescript
interface MessageParam {
  content: string | Array<ContentBlockParam>;
  role: 'user' | 'assistant';
}
```

Where `ContentBlockParam` includes `ToolResultBlockParam`:
```typescript
interface ToolResultBlockParam {
  tool_use_id: string;
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam | ...>;
  is_error?: boolean;
}
```

---

## 9. Summary: How to Detect AskUserQuestion HIL State from Transcript

The most reliable approach for detecting a session blocked on `AskUserQuestion`:

```typescript
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

async function isSessionAwaitingHIL(
  sessionId: string,
  dir?: string
): Promise<boolean> {
  const messages = await getSessionMessages(sessionId, { dir });

  const resolvedToolUseIds = new Set<string>();
  
  // First pass: collect all resolved tool_use IDs from user messages
  for (const msg of messages) {
    if (msg.type !== 'user') continue;
    const m = msg.message as { content: unknown };
    const content = m?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<{ type: string; tool_use_id?: string }>) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        resolvedToolUseIds.add(block.tool_use_id);
      }
    }
  }

  // Check the last few assistant messages for unresolved AskUserQuestion
  for (const msg of [...messages].reverse()) {
    if (msg.type !== 'assistant') continue;
    const m = msg.message as { content: unknown };
    const content = m?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<{ type: string; id?: string; name?: string }>) {
      if (
        block.type === 'tool_use' &&
        block.name === 'AskUserQuestion' &&
        block.id &&
        !resolvedToolUseIds.has(block.id)
      ) {
        return true;
      }
    }
    break; // Only check the most recent assistant message
  }

  return false;
}
```

**Alternative**: Use the `canUseTool` callback during a live query to detect HIL state in real-time without polling the transcript:

```typescript
canUseTool: async (toolName, input) => {
  if (toolName === 'AskUserQuestion') {
    onHILDetected?.();  // emit event or set state
    return handleClarifyingQuestions(input);
  }
  return { behavior: 'allow', updatedInput: input };
}
```

---

## 10. Additional Notes

### `getSubagentMessages()`

For subagent transcripts:
```typescript
function getSubagentMessages(
  sessionId: string,
  agentId: string,
  options?: GetSubagentMessagesOptions
): Promise<SessionMessage[]>;
```

Subagents are stored at: `~/.claude/projects/<dir>/<sessionId>/subagents/agent-<agentId>.jsonl`

### `SDKDeferredToolUse` on result messages

When a query ends with a pending permission request (because `canUseTool` is not set), the `SDKResultSuccess` message contains:
```typescript
deferred_tool_use?: {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
```
This is the SDK's own built-in signal that the session stopped because of a pending tool use.

### `AskUserQuestion` limitations

- Not available in subagents spawned via the Agent tool
- Each call supports 1-4 questions with 2-4 options each
- Must be in the `tools` array if a restricted tool list is passed

### Session file encoding

`<encoded-cwd>` = absolute path with every non-alphanumeric character replaced by `-`
- `/Users/norinlavaee/atomic` → `-Users-norinlavaee-atomic`
