---
date: 2026-03-01 19:33:01 UTC
researcher: Copilot (Claude Opus 4.6)
git_commit: 7debf4841f53cc01dbe3faa8bc4b00a9367bb7a6
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "OpenCode SDK Auto-Compaction: Current State and Reference Implementations"
tags: [research, codebase, compaction, context-overflow, opencode, claude, copilot, auto-compaction, tui, spinner]
status: complete
last_updated: 2026-03-01
last_updated_by: Copilot (Claude Opus 4.6)
---

# Research: OpenCode SDK Auto-Compaction

## Research Question

The other SDKs (Claude Agent SDK, Copilot SDK) have auto-compact behavior, but the OpenCode SDK implementation seems to be missing it. For example, a `ContextOverflowError` is thrown without recovery:

```
✗ {"name":"ContextOverflowError","data":{"message":"Input exceeds context window of this model","responseBody":"..."}}
```

Document how auto-compaction works in the Claude and Copilot integrations (including compaction spinner and TUI clearing), how the upstream OpenCode codebase handles compaction natively, and what the OpenCode SDK integration in workflow-sdk currently does (and doesn't do).

## Summary

The workflow-sdk has a well-developed compaction system for the Copilot SDK (native `infiniteSessions` auto-compaction with event-based lifecycle) and Claude SDK (tool-name detection + `session.compaction` bus events + `/compact` prompt forwarding). The OpenCode SDK integration has partial compaction support — it implements `summarize()` and maps the upstream `session.compacted` SSE event — but **lacks automatic context overflow detection and recovery**. The upstream OpenCode codebase has a full auto-compaction system (`SessionCompaction.isOverflow()` → `SessionCompaction.create()` → `SessionCompaction.process()`) that detects overflow proactively and triggers LLM-driven summarization, but this workflow-sdk integration does not wire into that flow. Critically, when a `ContextOverflowError` occurs during streaming, the OpenCode client treats it as a generic fatal error with no compaction recovery path.

### Key Gaps in OpenCode SDK Integration

1. **No `phase: "start"` emission** — Only `phase: "complete"` is emitted via `session.compacted` SSE event; the TUI never shows "Compacting…" spinner during auto-compaction
2. **No automatic overflow detection** — No proactive token-based threshold check before or during streaming
3. **No `ContextOverflowError` recovery** — Context overflow errors are treated as generic fatal stream errors
4. **No `session.truncation` emission** — The event type exists in the type system and adapter, but the OpenCode client never emits it
5. **No `infiniteSessions`-style config** — No compaction thresholds passed at session creation (unlike Copilot)
6. **Workflow graph partially compensates** — The `contextMonitorNode` calls `summarize()` for OpenCode at 45% threshold, but this only works in workflow mode, not in direct chat

---

## Detailed Findings

### 1. Copilot SDK Integration — Auto-Compaction (Reference Implementation)

The Copilot SDK has the most complete auto-compaction implementation, with native SDK support via `infiniteSessions`.

#### Session Creation with Compaction Thresholds

**`src/sdk/clients/copilot.ts:1116-1120`**

```typescript
infiniteSessions: {
  enabled: true,
  backgroundCompactionThreshold: BACKGROUND_COMPACTION_THRESHOLD, // 0.45
  bufferExhaustionThreshold: BUFFER_EXHAUSTION_THRESHOLD,         // 0.6
},
```

The Copilot SDK is configured at session creation to automatically trigger compaction when context reaches 45% and buffer exhaustion at 60%.

#### SDK Event Mapping

**`src/sdk/clients/copilot.ts:155-166`** — Two SDK events map to one unified event:
- `"session.compaction_start"` → `"session.compaction"` with `{ phase: "start" }`
- `"session.compaction_complete"` → `"session.compaction"` with `{ phase: "complete", success, error }`

**`src/sdk/clients/copilot.ts:889-900`** — Event data construction in `handleSdkEvent()`:
```typescript
case "session.compaction_start":
  eventData = { phase: "start" };
  break;
case "session.compaction_complete":
  eventData = {
    phase: "complete",
    success: typeof data.success === "boolean" ? data.success : true,
    error: asNonEmptyString(data.error),
  };
  break;
```

#### Manual `/compact` Command

**`src/sdk/clients/copilot.ts:604-611`** — `session.summarize()` sends `/compact` as a prompt:
```typescript
summarize: async (): Promise<void> => {
  if (state.isClosed) throw new Error("Session is closed");
  await state.sdkSession.sendAndWait({ prompt: "/compact" });
},
```

#### Three-Layer Event Translation

1. Copilot SDK events (`session.compaction_start`) 
2. → Unified `AgentEvent` (`session.compaction`) via `copilot.ts:889-900`
3. → Bus events (`stream.session.compaction`) via `copilot-adapter.ts:1115-1130`

#### Data Flow

1. Session created with `infiniteSessions` config (thresholds 0.45/0.6)
2. SDK detects threshold breach internally
3. SDK emits `session.compaction_start` → mapped to `{ phase: "start" }`
4. Adapter publishes `stream.session.compaction` on event bus
5. TUI handler calls `applyAutoCompactionIndicator({ status: "running" })`
6. Spinner verb overridden to `"Compacting"` on streaming message
7. SDK completes → emits `session.compaction_complete` → `{ phase: "complete", success: true }`
8. TUI handler calls `applyAutoCompactionIndicator({ status: "completed" })`
9. All messages cleared, new empty streaming message created, history buffer reset

---

### 2. Claude Agent SDK Integration — Auto-Compaction

The Claude integration uses a dual-detection approach: tool-name pattern matching and `session.compaction` bus events.

#### `summarize()` Implementation

**`src/sdk/clients/claude.ts:1027-1053`**

1. Guards for closed session
2. Builds SDK options with `resume` support
3. Sends `query({ prompt: "/compact", options })` to Claude SDK
4. Iterates all response messages via `processMessage()`
5. Re-throws any errors

The Claude client does **not** emit `session.compaction` events during `summarize()`. Compaction events come from either the SDK's internal hooks or tool-name detection.

#### `PreCompact` Hook

**`src/sdk/clients/claude.ts:78`** — `ClaudeHookConfig` includes `PreCompact?: HookCallback[]`, but `mapEventTypeToHookEvent()` (lines 127-138) does not map any unified event type to `PreCompact`. Hooks are only registered via `registerHooks()`.

#### Tool-Name Auto-Compaction Detection

The TUI layer detects compaction via tool names in `handleToolStart` and `handleToolComplete` (see §5 TUI section).

#### Workflow Graph Strategy

**`src/workflows/graph/nodes.ts:1263-1274`** — For Claude, `getDefaultCompactionAction()` returns `"recreate"` (not `"summarize"`). The `contextMonitorNode` emits a `context_window_warning` signal with `shouldRecreateSession: true` rather than calling `summarize()`.

---

### 3. OpenCode SDK Integration — Current State

#### What Exists

##### `summarize()` Method

**`src/sdk/clients/opencode.ts:2107-2145`**

1. Calls `client.sdkClient.session.summarize()` with `sessionID` and `directory`
2. Post-compaction: queries `session.messages()` to refresh token counts
3. Silently catches token refresh errors
4. Emits `session.idle` with `reason: "context_compacted"` — **not** `session.compaction`

##### SSE Event Mapping for `session.compacted`

**`src/sdk/clients/opencode.ts:987-996`**

```typescript
case "session.compacted":
  this.emitEvent("session.compaction", sessionID, {
    phase: "complete",
    success: true,
  });
  break;
```

Only emits `phase: "complete"` — there is no `phase: "start"` emitted anywhere in the OpenCode client.

##### Context Usage Tracking

**`src/sdk/clients/opencode.ts:1732-1738, 2147-2160`**

Session state tracks `inputTokens`, `outputTokens`, `contextWindow`, and `systemToolsBaseline`. The `getContextUsage()` method computes usage percentage.

##### Event Adapter Wiring

**`src/events/adapters/opencode-adapter.ts:280-291`** — The adapter subscribes to both `session.compaction` and `session.truncation` from the client. However, the client only ever emits `session.compaction` (with `phase: "complete"`), and **never** emits `session.truncation`.

##### Workflow-Level Compaction

**`src/workflows/graph/nodes.ts:1263-1266`** — `getDefaultCompactionAction("opencode")` returns `"summarize"`, meaning the `contextMonitorNode` will call `session.summarize()` at 45% threshold. This only works in workflow mode.

#### What's Absent

| Feature | Copilot | Claude | OpenCode |
|---------|---------|--------|----------|
| `phase: "start"` emission | ✅ `session.compaction_start` | ✅ Via SDK hooks | ❌ Never emitted |
| `phase: "complete"` emission | ✅ `session.compaction_complete` | ✅ Via SDK hooks | ✅ `session.compacted` SSE |
| Auto-compaction thresholds at session creation | ✅ `infiniteSessions` config | ❌ | ❌ |
| Tool-name-based detection | ✅ (secondary path) | ✅ (primary path) | ❌ (no compaction tools emitted) |
| `session.truncation` emission | ✅ With token details | ❌ | ❌ (adapter subscribed but never fires) |
| `ContextOverflowError` handling | ❌ (generic error) | ❌ (generic error) | ❌ (generic error) |
| Automatic overflow detection during streaming | ✅ (SDK-native) | ❌ (workflow-level) | ❌ (workflow-level only) |
| Post-compaction token refresh | Via SDK events | Via message processing | ✅ Via `session.messages()` query |

##### Error Handling Gap

**`src/sdk/clients/opencode.ts:1995-2001, 2089-2091`** — During streaming, `session.error` SSE events are caught and converted to generic `Error` objects. There is no differentiation of `ContextOverflowError` — all errors are treated uniformly as fatal stream errors.

The string `"ContextOverflowError"` does not appear anywhere in the workflow-sdk codebase.

---

### 4. Upstream OpenCode — Native Auto-Compaction System

The upstream OpenCode project at `~/Documents/projects/opencode` has a comprehensive auto-compaction system.

#### Overflow Detection

**`packages/opencode/src/session/compaction.ts:32-48`** — `SessionCompaction.isOverflow()`

1. Checks `config.compaction.auto` — returns `false` if disabled
2. If model `limit.context === 0`, returns `false` (unlimited)
3. Computes token count: `total` or `input + output + cache.read + cache.write`
4. Computes reserved buffer: `config.compaction.reserved` or `min(COMPACTION_BUFFER=20000, maxOutputTokens)`
5. Computes usable context: `limit.input - reserved` or `limit.context - maxOutputTokens`
6. Returns `count >= usable`

#### Detection Trigger Points

**Path A — Mid-stream (`packages/opencode/src/session/processor.ts:282-284`):**
On `"finish-step"` event during LLM streaming, checks `isOverflow()`. If true, sets `needsCompaction = true` and breaks the stream loop. Returns `"compact"` from `process()`.

**Path B — Pre-loop (`packages/opencode/src/session/prompt.ts:541-554`):**
At the start of each `SessionPrompt.loop()` iteration, checks `isOverflow()` on the last finished assistant message. If overflow and not already summarized (`summary !== true`), calls `SessionCompaction.create()` and continues.

#### Compaction Execution

**`packages/opencode/src/session/compaction.ts:101-229`** — `SessionCompaction.process()`

1. Resolves compaction model (dedicated `"compaction"` agent's model or fallback)
2. Creates assistant message with `mode: "compaction"`, `summary: true`
3. Triggers `experimental.session.compacting` plugin hook
4. Builds compaction prompt (default template or plugin-provided)
5. Sends conversation + compaction prompt to LLM (no tools available)
6. On auto-compaction, creates synthetic "Continue" user message
7. Publishes `Bus.publish(Event.Compacted, { sessionID })`

#### Default Compaction Prompt Template

```
Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation...

When constructing the summary, try to stick to this template:
---
## Goal
[What goal(s) is the user trying to accomplish?]

## Instructions
[What important instructions did the user give you that are relevant]

## Discoveries
[What notable things were learned during this conversation...]

## Accomplished
[What work has been completed, what work is still in progress...]

## Relevant files / directories
[Structured list of relevant files that have been read, edited, or created...]
---
```

#### Message History Filtering Post-Compaction

**`packages/opencode/src/session/message-v2.ts:794-809`** — `filterCompacted()` truncates message history to only messages from the latest compaction point forward. The summary replaces all prior history for subsequent LLM calls.

#### Tool Output Pruning

**`packages/opencode/src/session/compaction.ts:50-99`** — `SessionCompaction.prune()`

- Iterates messages backwards, skipping the most recent 2 user turns
- Protects `PRUNE_PROTECT=40000` tokens of recent tool outputs
- If prunable tokens exceed `PRUNE_MINIMUM=20000`, marks them with `time.compacted = Date.now()`
- Pruned tool outputs replaced with `"[Old tool result content cleared]"` in model messages

#### Context Overflow Error Detection (14+ Providers)

**`packages/opencode/src/provider/error.ts:8-41`** — `ProviderError.isOverflow()` matches error messages against regex patterns for Anthropic, OpenAI, Google, Amazon Bedrock, xAI, Groq, OpenRouter, DeepSeek, GitHub Copilot, llama.cpp, LM Studio, MiniMax, Kimi, Cerebras, Mistral, and a generic fallback.

**`packages/opencode/src/session/retry.ts`** — `ContextOverflowError` is explicitly non-retryable.

**`packages/opencode/src/session/processor.ts:356-358`** — Currently has a `TODO` for handling `ContextOverflowError` specifically:
```typescript
if (MessageV2.ContextOverflowError.isInstance(error)) {
  // TODO: Handle context overflow error
}
```

#### Configuration

| Setting | Default | Effect |
|---------|---------|--------|
| `compaction.auto` | `true` | Enable/disable auto-compaction |
| `compaction.prune` | `true` | Enable/disable tool output pruning |
| `compaction.reserved` | `min(20000, maxOutputTokens)` | Token buffer before overflow triggers |
| `OPENCODE_DISABLE_AUTOCOMPACT` | `false` | Env var to disable auto-compaction |
| `OPENCODE_DISABLE_PRUNE` | `false` | Env var to disable pruning |

#### TUI Representation

**`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:441-467`** — Manual `/compact` command with alias `/summarize` and keybind `<leader>c`.

**`index.tsx:1295-1302`** — Compaction part renders a horizontal divider with centered " Compaction " title.

**`packages/opencode/src/cli/cmd/tui/context/sync.tsx:450-458`** — Session status returns `"compacting"` when `session.time.compacting` is set.

#### Event System

```typescript
export const Event = {
  Compacted: BusEvent.define("session.compacted", z.object({ sessionID: z.string() })),
}
```

Published after successful LLM summarization. Subscribers can react to compaction completion.

---

### 5. TUI Compaction UI Patterns (Shared Across SDKs)

#### LoadingIndicator Component

**`src/ui/chat.tsx:1083-1121`**

Renders animated braille-character spinner (8 frames: `⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷`) at 100ms intervals.

Verb resolution priority:
1. `verbOverride` (e.g., `"Compacting"`) — highest priority
2. `"Reasoning"` if `thinkingMs > 0`
3. `"Composing"` — default

Output format: `⣾ Compacting… (6m 22s · ↓ 16.7k tokens · thought for 54s)`

#### Spinner Verb Override for `/compact`

**`src/ui/chat.tsx:1003-1005`**
```typescript
export function getSpinnerVerbForCommand(commandName: string): string | undefined {
  return commandName === "compact" ? "Compacting" : undefined;
}
```

#### Auto-Compaction Indicator State Machine

**`src/ui/utils/auto-compaction-lifecycle.ts`**

Four states: `idle` → `running` → `completed`/`error` → `idle`

Tool name detection (`isAutoCompactionToolName`, lines 18-29):
- Exact: `"compact"`
- Suffix: `"/compact"`, `"__compact"`
- Contains: `"precompact"`, `"context_compact"`, `"context-compact"`, `"auto_compact"`, `"auto-compact"`

#### `applyAutoCompactionIndicator()` — Visual Transitions

**`src/ui/chat.tsx:2314-2361`**

| Status | Effect |
|--------|--------|
| `"running"` | `isAutoCompacting = true`, spinner verb → `"Compacting"` on streaming message |
| `"completed"` | `isAutoCompacting = false`, clear all messages, create fresh streaming message, write compaction summary to history buffer |
| `"error"` | `isAutoCompacting = false`, clear `"Compacting"` verb override, revert spinner to default |
| `"idle"` | `isAutoCompacting = false` |

#### Message Clearing After Compaction

On `"completed"`:
1. Creates new empty assistant message via `createMessage("assistant", "", true)`
2. Updates `streamingMessageIdRef` to new message
3. Calls `clearHistoryBuffer()` then `appendCompactionSummary(summaryText)`
4. Replaces all visible messages: `return [newMsg]`

#### Compaction History (Ctrl+O)

**`src/ui/chat.tsx:5629-5632`** — `Ctrl+O` toggles `transcriptMode`

**`src/ui/chat.tsx:6658-6666`** — Transcript view renders: `[...readHistoryBuffer(), ...messages]`

After compaction, the history buffer contains the compaction summary marker, and current messages show post-compaction content.

#### CompactionPart Display

**`src/ui/components/parts/compaction-part-display.tsx:18-33`**
```tsx
<text style={{ fg: colors.muted }}>
  {`${MISC.separator} Conversation compacted ${MISC.separator}`}
</text>
```

Renders muted-colored banner with separator icons and summary text.

#### Conversation History Buffer

**`src/ui/utils/conversation-history-buffer.ts`**

Persists as NDJSON to `{tmpdir}/atomic-cli/history-{pid}.json`:
- `appendCompactionSummary(summary)`: Clears buffer, writes single message with `id: compact_{timestamp}_{random}`
- `clearHistoryBuffer()`: Truncates file, resets dedup Set
- `readHistoryBuffer()`: Reads NDJSON, populates dedup Set

#### Bus Event Subscriptions

**`src/ui/chat.tsx:3181-3196`** — Subscribes to `stream.session.compaction`:
```typescript
useBusSubscription("stream.session.compaction", (event) => {
  if (phase === "start") applyAutoCompactionIndicator({ status: "running" });
  else if (phase === "complete") applyAutoCompactionIndicator(success === false ? { status: "error", ... } : { status: "completed" });
});
```

This provides a detection path independent of tool-name matching.

---

## Code References

### Workflow-SDK (this codebase)

- `src/sdk/clients/opencode.ts:987-996` — SSE `session.compacted` → unified `session.compaction` mapping (phase: "complete" only)
- `src/sdk/clients/opencode.ts:2107-2145` — `summarize()` method calling `sdkClient.session.summarize()`
- `src/sdk/clients/opencode.ts:1995-2001` — Stream error handling (generic, no ContextOverflowError differentiation)
- `src/sdk/clients/copilot.ts:889-900` — Copilot compaction start/complete event mapping
- `src/sdk/clients/copilot.ts:1116-1120` — `infiniteSessions` configuration
- `src/sdk/clients/copilot.ts:604-611` — `summarize()` via `sendAndWait({ prompt: "/compact" })`
- `src/sdk/clients/claude.ts:1027-1053` — `summarize()` via `query({ prompt: "/compact" })`
- `src/sdk/types.ts:548-555` — `SessionCompactionEventData` interface
- `src/events/bus-events.ts:281-290` — `stream.session.compaction` bus event schema
- `src/events/adapters/opencode-adapter.ts:280-291` — OpenCode adapter compaction/truncation subscriptions
- `src/events/adapters/copilot-adapter.ts:1115-1130` — Copilot adapter compaction handler
- `src/events/adapters/claude-adapter.ts:282-286, 953-971` — Claude adapter compaction handler
- `src/ui/chat.tsx:1003-1005` — `getSpinnerVerbForCommand()` returning `"Compacting"`
- `src/ui/chat.tsx:1083-1121` — `LoadingIndicator` component
- `src/ui/chat.tsx:1821-1827` — Compaction React state variables
- `src/ui/chat.tsx:2314-2361` — `applyAutoCompactionIndicator()` callback
- `src/ui/chat.tsx:2485-2487` — Tool-name-based auto-compaction detection in `handleToolStart`
- `src/ui/chat.tsx:2597-2604` — Tool-name-based auto-compaction detection in `handleToolComplete`
- `src/ui/chat.tsx:3181-3196` — `stream.session.compaction` bus subscription in TUI
- `src/ui/utils/auto-compaction-lifecycle.ts:1-89` — State machine types, transitions, and helpers
- `src/ui/utils/conversation-history-buffer.ts:100-113` — `appendCompactionSummary()`
- `src/ui/components/parts/compaction-part-display.tsx:18-33` — CompactionPart rendering
- `src/workflows/graph/types.ts:776-779` — `BACKGROUND_COMPACTION_THRESHOLD` and `BUFFER_EXHAUSTION_THRESHOLD`
- `src/workflows/graph/nodes.ts:1263-1274` — `getDefaultCompactionAction()` per agent type

### Upstream OpenCode (`~/Documents/projects/opencode`)

- `packages/opencode/src/session/compaction.ts:32-48` — `SessionCompaction.isOverflow()` detection logic
- `packages/opencode/src/session/compaction.ts:50-99` — `SessionCompaction.prune()` tool output stripping
- `packages/opencode/src/session/compaction.ts:101-229` — `SessionCompaction.process()` LLM summarization
- `packages/opencode/src/session/compaction.ts:231-260` — `SessionCompaction.create()` enqueuing
- `packages/opencode/src/session/compaction.ts:22-27` — `Event.Compacted` bus event definition
- `packages/opencode/src/session/prompt.ts:274` — `SessionPrompt.loop()` main processing loop
- `packages/opencode/src/session/prompt.ts:528-539` — Compaction task detection in loop
- `packages/opencode/src/session/prompt.ts:541-554` — Pre-loop overflow detection
- `packages/opencode/src/session/processor.ts:282-284` — Mid-stream overflow detection on `finish-step`
- `packages/opencode/src/session/processor.ts:356-358` — `ContextOverflowError` detection (TODO)
- `packages/opencode/src/session/message-v2.ts:794-809` — `filterCompacted()` message truncation
- `packages/opencode/src/session/message-v2.ts:619-621` — Pruned tool output replacement text
- `packages/opencode/src/provider/error.ts:8-41` — `ProviderError.isOverflow()` regex patterns (14+ providers)
- `packages/opencode/src/provider/error.ts:112-148` — `ProviderError.parseStreamError()` structured error parsing
- `packages/opencode/src/session/retry.ts` — `ContextOverflowError` classified as non-retryable
- `packages/opencode/src/config/config.ts:1139-1146` — `compaction` config schema
- `packages/opencode/src/flag/flag.ts:14,20` — Feature flags for disabling compaction/pruning
- `packages/opencode/src/agent/agent.ts:157-171` — Hidden `"compaction"` agent definition
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:441-467` — TUI `/compact` command
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1295-1302` — Compaction divider UI
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:450-458` — Session `"compacting"` status
- `packages/sdk/js/src/v2/gen/types.gen.ts` — SDK types: `ContextOverflowError`, `CompactionPart`, `EventSessionCompacted`
- `packages/plugin/src/index.ts` — `experimental.session.compacting` plugin hook

## Architecture Documentation

### Event Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SDK Layer                                 │
│                                                                  │
│  Copilot SDK                Claude SDK              OpenCode SDK │
│  ├─ session.compaction_start  ├─ tool.start (compact)  ├─ SSE   │
│  └─ session.compaction_complete └─ tool.complete        │  events│
│       │                           │                     │        │
│       ▼                           ▼                     ▼        │
│  ┌─────────┐               ┌─────────┐           ┌─────────┐   │
│  │copilot.ts│               │claude.ts │           │opencode.ts│  │
│  │ maps both│               │ no event │           │ maps only │  │
│  │ start +  │               │ emission │           │ "complete"│  │
│  │ complete │               │ for      │           │ from SSE  │  │
│  │ to unified│              │ compaction│           │ session.  │  │
│  │ session. │               │          │           │ compacted │  │
│  │ compaction│              │          │           │           │  │
│  └────┬─────┘               └──────────┘           └─────┬────┘  │
│       │                                                   │      │
└───────┼───────────────────────────────────────────────────┼──────┘
        │                                                   │
        ▼                                                   ▼
┌───────────────────────────────────────────────────────────────┐
│                     Unified Event Layer                        │
│                                                               │
│  EventType: "session.compaction"                              │
│  Data: { phase: "start" | "complete", success?, error? }      │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │copilot-adapter.ts│  │claude-adapter.ts  │  │opencode-   │ │
│  │ subscribes to    │  │ subscribes to     │  │adapter.ts  │ │
│  │ session.compaction│  │ session.compaction│  │ subscribes │ │
│  │ → publishes      │  │ → publishes       │  │ to session.│ │
│  │ stream.session.  │  │ stream.session.   │  │ compaction │ │
│  │ compaction       │  │ compaction        │  │ → publishes│ │
│  └────────┬─────────┘  └────────┬──────────┘  └─────┬──────┘ │
│           │                      │                    │       │
└───────────┼──────────────────────┼────────────────────┼───────┘
            │                      │                    │
            ▼                      ▼                    ▼
┌───────────────────────────────────────────────────────────────┐
│                     Event Bus Layer                            │
│                                                               │
│  BusEventType: "stream.session.compaction"                    │
│  Data: { phase, success?, error? }                            │
│                                                               │
└──────────────────────────┬────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────┐
│                        TUI Layer                              │
│                                                               │
│  ┌─ useBusSubscription("stream.session.compaction") ──────┐  │
│  │  phase: "start"  → applyAutoCompactionIndicator(running) │  │
│  │  phase: "complete" → applyAutoCompactionIndicator(done)  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ handleToolStart (tool name detection) ─────────────────┐  │
│  │  isAutoCompactionToolName() → applyAutoCompactionIndicator │ │
│  └──────────────────────────────────────────────────────────┘  │
│                                                               │
│  applyAutoCompactionIndicator()                               │
│  ├─ running:   spinner verb → "Compacting"                   │
│  ├─ completed: clear messages, create fresh msg, save summary │
│  └─ error:     revert spinner verb to default                 │
│                                                               │
│  LoadingIndicator: ⣾ Compacting… (duration · tokens · thinking)│
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Upstream OpenCode Auto-Compaction Flow

```
SessionPrompt.loop()
    │
    ├─ [Check for pending compaction task in message queue]
    │       │
    │       └─► SessionCompaction.process()
    │               ├─ Trigger hook: experimental.session.compacting
    │               ├─ Build prompt (default template or plugin-provided)
    │               ├─ Send conversation + prompt to LLM (no tools)
    │               ├─ Create assistant message (mode: "compaction", summary: true)
    │               ├─ If auto: create synthetic "Continue" user message
    │               └─ Bus.publish(Event.Compacted, { sessionID })
    │
    ├─ [Normal LLM Processing via SessionProcessor]
    │       │
    │       ├─ On finish-step event:
    │       │     └─ SessionCompaction.isOverflow(tokens, model)
    │       │           └─ true → needsCompaction = true → break stream
    │       │                  → process() returns "compact"
    │       │
    │       ├─ On APICallError:
    │       │     └─ ProviderError.parseAPICallError()
    │       │           └─ isOverflow() → ContextOverflowError (non-retryable)
    │       │
    │       └─ On StreamError:
    │             └─ ProviderError.parseStreamError()
    │                   └─ code === "context_length_exceeded" → ContextOverflowError
    │
    ├─ [Post-processing overflow check]
    │       └─ SessionCompaction.isOverflow()
    │               └─ true → SessionCompaction.create() → queue compaction
    │
    └─ [Pruning — after loop exits]
            └─ SessionCompaction.prune()
                    └─ Backward scan → protect recent 40k tokens
                    └─ Prune if >20k tokens pruneable
                    └─ Set part.state.time.compacted = Date.now()
                    └─ In model messages: "[Old tool result content cleared]"
```

## Historical Context (from research/)

No existing research documents were found specifically covering compaction or context overflow handling.

## Related Research

- `research/workflow-gaps.md` — May contain related gap analysis

## Open Questions

1. **ContextOverflowError recovery in OpenCode client**: When a `ContextOverflowError` occurs during streaming in the OpenCode SDK integration, should the client automatically trigger `summarize()` and retry, or should it emit a `session.compaction` event with `phase: "start"` and let the existing TUI infrastructure handle the visual feedback?

2. **`phase: "start"` emission timing**: The OpenCode SDK's SSE protocol only has `session.compacted` (post-fact). To emit `phase: "start"`, the workflow-sdk OpenCode client would need to synthetically emit it before calling `summarize()`. Is this the right approach?

3. **Non-workflow mode coverage**: The `contextMonitorNode` in the workflow graph layer already calls `summarize()` for OpenCode at 45% threshold, but this only works when using workflow graphs. Should the OpenCode client itself have built-in threshold monitoring for direct chat mode?

4. **Tool output pruning**: The upstream OpenCode has a `prune()` mechanism that strips old tool outputs. Should the workflow-sdk OpenCode integration implement similar pruning, or does the upstream server already handle this?

5. **`session.truncation` dead subscription**: The OpenCode adapter subscribes to `session.truncation` but the client never emits it. Should this be wired up to an upstream SSE event, or is it intentionally unused?
