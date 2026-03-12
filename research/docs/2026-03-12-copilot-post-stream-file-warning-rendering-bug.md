---
date: 2026-03-12 03:20:57 UTC
researcher: Copilot
git_commit: null
branch: null
repository: streaming-reliability
topic: "Copilot SDK post-stream file name and warning rendering bug"
tags: [research, bug, copilot-sdk, streaming, rendering, session-info, session-warning, tui]
status: complete
last_updated: 2026-03-12
last_updated_by: Copilot
last_updated_note: "Initial investigation of post-stream ● file path and ⚠ warning rendering artifacts"
---

# Research

## Research Question

After the Copilot SDK conversation streamer finishes (the "Reasoned for Xs" completion summary renders), file-write file paths appear as `● C:\path\to\file` lines and warning messages appear as `⚠ message` lines below the completion summary. These should not render at all. Where are they generated and how should they be suppressed?

## Symptom

```
●
Created a minimal Verus devcontainer with two files:
- .devcontainer/devcontainer.json — ...
- .devcontainer/setup.sh — ...
⣿ Reasoned for 56s · ↓ 1.3k tokens · thought for 5s
● C:\dev\pdd-kit\.devcontainer\setup.sh          <-- BUG: should not render
● C:\dev\pdd-kit\.devcontainer\devcontainer.json  <-- BUG: should not render
```

The `● filepath` lines appear **after** the `⣿ Reasoned for ...` completion summary, creating visual artifacts. Similarly, `⚠` warning lines may appear in the same position.

## Root Cause

### 1. `session.info` events with file paths → rendered as system messages

The Copilot SDK emits `session.info` provider events whose `message` field contains bare file paths (the files the agent wrote). These flow through the pipeline:

```
Copilot SDK → session.info event
  → event-mapper.ts:413-418 (maps to internal session.info)
  → provider-router.ts:234-241 (routes to handleCopilotSessionInfo)
  → session-handlers.ts:315-330 (publishes stream.session.info BusEvent)
  → use-session-subscriptions.ts:259-269 (renders as system message)
```

**The rendering handler** (`use-session-subscriptions.ts:259-269`):

```ts
useBusSubscription("stream.session.info", (event) => {
  const { message, infoType } = event.data;
  if (infoType === "cancellation") return;
  if (infoType === "snapshot") return;
  if (!message) return;
  if (message.startsWith("/") && !message.includes(" ")) return;
  setMessagesWindowed((prev) => [
    ...prev,
    createMessage("system", `${STATUS.active} ${message}`),
  ]);
});
```

This handler filters out `cancellation`, `snapshot`, and bare slash-command info types — but it does **not** filter file-path messages. The file paths pass through all guards and are rendered as `● <filepath>` system messages.

### 2. `session.warning` events → rendered as system messages

Similarly, the Copilot SDK emits `session.warning` provider events that flow through:

```
Copilot SDK → session.warning event
  → event-mapper.ts:419-424
  → provider-router.ts:242-249
  → session-handlers.ts:332-347 (publishes stream.session.warning BusEvent)
  → use-session-subscriptions.ts:271-279 (renders as system message)
```

**The rendering handler** (`use-session-subscriptions.ts:271-279`):

```ts
useBusSubscription("stream.session.warning", (event) => {
  const { message } = event.data;
  if (message) {
    setMessagesWindowed((prev) => [
      ...prev,
      createMessage("system", `${MISC.warning} ${message}`),
    ]);
  }
});
```

This handler has **no filtering at all** — any warning with a non-empty message is rendered as `⚠ <message>`.

### 3. Timing: these events bypass stream-completion lifecycle guards

Unlike `StreamPartEvent`-based events (text deltas, tool start/complete, etc.) which go through the `StreamPipelineConsumer` and respect staleness/runId guards, session info and warning events are handled via **direct `useBusSubscription` hooks** in `useStreamSessionSubscriptions()`. They bypass:

- The `StreamPipelineConsumer` mapping pipeline
- The staleness filter in `use-consumer.ts:150-156`
- The `BatchDispatcher` coalescing

This means even after `stream.session.idle` has been processed and `finalizeCompletedStream()` has run (setting `streaming: false` on all messages), late-arriving `session.info`/`session.warning` events still create new system messages that appear below the completion summary.

## Fix Options

### Option A: Suppress at the rendering layer (Recommended — surgical, low risk)

In `use-session-subscriptions.ts`, add guards to the `stream.session.info` and `stream.session.warning` handlers to prevent rendering:

**For `session.info` (lines 259-269)** — completely suppress file-path info messages and optionally all info messages:

```ts
// Option A1: Filter out file-path messages specifically
useBusSubscription("stream.session.info", (event) => {
  const { message, infoType } = event.data;
  if (infoType === "cancellation") return;
  if (infoType === "snapshot") return;
  if (!message) return;
  if (message.startsWith("/") && !message.includes(" ")) return;
  // NEW: Suppress file path info messages
  if (looksLikeFilePath(message)) return;
  setMessagesWindowed((prev) => [
    ...prev,
    createMessage("system", `${STATUS.active} ${message}`),
  ]);
});

// Helper: detect if message is a bare file path
function looksLikeFilePath(msg: string): boolean {
  const trimmed = msg.trim();
  // Windows absolute path
  if (/^[A-Za-z]:\\/.test(trimmed)) return true;
  // Unix absolute path
  if (trimmed.startsWith("/") && trimmed.includes("/")) return true;
  // Relative path with extension
  if (/^\.{0,2}\//.test(trimmed) || /\.[a-zA-Z]{1,10}$/.test(trimmed)) return true;
  return false;
}
```

```ts
// Option A2: Suppress ALL session.info rendering (simpler)
// Simply remove or no-op the entire handler body
useBusSubscription("stream.session.info", (_event) => {
  // Intentionally suppressed — info messages are not user-facing
});
```

**For `session.warning` (lines 271-279)** — suppress all warning messages:

```ts
useBusSubscription("stream.session.warning", (_event) => {
  // Intentionally suppressed — warnings not user-facing
});
```

### Option B: Suppress at the adapter layer (prevents events from entering the bus)

In `session-handlers.ts`, prevent file-path info and warning events from being published:

**`handleCopilotSessionInfo` (lines 315-330):**

```ts
export function handleCopilotSessionInfo(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.info">,
): void {
  // Suppress — file path info events should not reach the bus
}
```

**`handleCopilotSessionWarning` (lines 332-347):**

```ts
export function handleCopilotSessionWarning(
  context: CopilotSessionHandlerContext,
  event: AgentEvent<"session.warning">,
): void {
  // Suppress — warning events should not reach the bus
}
```

**Trade-off:** This is Copilot-specific and prevents any bus consumer from seeing these events (including the debug subscriber or future analytics). Option A is more targeted.

### Option C: Add lifecycle guards to the subscription handlers

Add `isStreamingRef` or `runId` guards to the `session.info`/`session.warning` handlers so they only render while the stream is active:

```ts
useBusSubscription("stream.session.info", (event) => {
  if (!isStreamingRef.current) return; // Only render during active stream
  if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) return;
  // ... existing logic
});
```

**Trade-off:** This only fixes the *timing* issue (post-stream rendering) but still renders file paths during streaming. The user wants them completely removed.

## Recommended Fix

**Option A2 + suppress warnings**: No-op both handlers entirely. The `session.info` and `session.warning` events from the Copilot SDK carry operational metadata (file paths, internal warnings) that are not meaningful to the end user in the TUI. The tool-result rendering system already displays file operations with proper status indicators and formatting. These system messages are redundant and visually disruptive.

### Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `src/state/chat/stream/use-session-subscriptions.ts` | 259-269 | No-op or remove the `stream.session.info` handler body |
| `src/state/chat/stream/use-session-subscriptions.ts` | 271-279 | No-op or remove the `stream.session.warning` handler body |

### Impact Assessment

- **Copilot SDK**: File path info and warning system messages will no longer render. File operations are still visible via tool-result parts (● ► Write filename.ts).
- **Claude/OpenCode SDKs**: Also use the same shared `stream.session.info` and `stream.session.warning` bus subscriptions. If these providers send meaningful user-facing info/warnings, suppressing universally could hide them. In that case, prefer provider-scoped suppression (Option B for Copilot only, leave the shared handler intact for other providers).
- **Debug subscriber**: Unaffected — the debug subscriber listens to raw bus events independently.

### Cross-Provider Consideration

The `stream.session.info` and `stream.session.warning` handlers in `use-session-subscriptions.ts` are **shared across all providers** (Copilot, Claude, OpenCode). Before fully no-op'ing these handlers, verify whether Claude or OpenCode rely on them for user-visible notifications:

- Claude adapter: `src/services/events/adapters/providers/claude/aux-event-handlers.ts:329-361` — publishes `stream.session.info` and `stream.session.warning` with the same schema.
- OpenCode adapter: `src/services/events/adapters/providers/opencode/aux-event-handlers.ts:291,308` — same pattern.

If only Copilot sends unwanted file-path info events, the safest fix is **Option B** (suppress at the Copilot adapter) or add a Copilot-specific `infoType` filter in Option A.

## Data Flow Diagram

```
Copilot SDK
    │
    ├── session.info { message: "C:\\dev\\file.ts", infoType: "general" }
    │       │
    │       ▼
    │   event-mapper.ts → session.info internal event
    │       │
    │       ▼
    │   provider-router.ts → handleCopilotSessionInfo()
    │       │
    │       ▼
    │   session-handlers.ts → publishEvent({ type: "stream.session.info" })
    │       │
    │       ▼
    │   EventBus.publish()
    │       │
    │       ├── Direct subscription in use-session-subscriptions.ts
    │       │       │
    │       │       ▼
    │       │   Guards: skip cancellation, snapshot, bare commands
    │       │   ❌ No guard for file paths
    │       │       │
    │       │       ▼
    │       │   createMessage("system", "● C:\\dev\\file.ts")  ← BUG
    │       │       │
    │       │       ▼
    │       │   Renders after "⣿ Reasoned for..." completion summary
    │       │
    │       └── BatchDispatcher (wildcard) — irrelevant, consumed by StreamPipelineConsumer
    │           which does NOT map session.info to StreamPartEvent
    │
    └── session.warning { message: "...", warningType: "general" }
            │
            ▼
        Same flow → createMessage("system", "⚠ ...")  ← BUG
```

## Key Files Reference

| File | Role |
|------|------|
| `src/services/agents/clients/copilot/event-mapper.ts:413-424` | Maps raw SDK session.info/warning to internal events |
| `src/services/events/adapters/providers/copilot/provider-router.ts:234-249` | Routes to session handlers |
| `src/services/events/adapters/providers/copilot/session-handlers.ts:315-347` | Publishes stream.session.info/warning BusEvents |
| `src/state/chat/stream/use-session-subscriptions.ts:259-279` | **Renders the buggy system messages** |
| `src/services/events/bus-events/schemas.ts:99-105` | Schema for info/warning events |
| `src/services/events/bus-events/types.ts:110-116` | Type definitions for info/warning events |
| `src/theme/icons.ts:14,104` | STATUS.active (●) and MISC.warning (⚠) symbols |
