---
date: 2026-02-09 06:00:00 UTC
researcher: Claude Opus 4.6
git_commit: 92c1f87
branch: lavaman131/feature/tui
repository: atomic
topic: "Token count and thinking timer bugs - audit of streaming metadata pipeline"
tags: [research, codebase, streaming, tokens, thinking, ui, sdk, bug]
status: complete
last_updated: 2026-02-09
last_updated_by: Claude Opus 4.6
---

# Research: Token Count & Thinking Timer Display Bugs

## Research Question

Two bugs exist in the Atomic CLI TUI:
1. **Token count** is only displayed for tasks lasting longer than one minute
2. **Thinking timer** does not show during streaming

Target UI format: `✶ Fermenting… (6m 22s · ↓ 16.7k tokens · thought for 54s)`

Audit the full pipeline from SDK clients through the streaming orchestration layer to the UI components, and research each SDK for explicit support of real-time token counting and thinking/reasoning timing.

## Summary

The **token count bug** is a display-layer issue: the `CompletionSummary` component gates its entire render behind a `>= 60000` ms (1 minute) threshold (`chat.tsx:1309`). During streaming, the `LoadingIndicator` component correctly receives and displays token counts in real-time via `streamingMeta`. However, once streaming completes, the token/thinking data is baked into the message object and only shown if the response took >= 1 minute. Short responses lose their token/thinking stats entirely.

The **thinking timer bug** has two root causes:
1. **OpenCode SDK**: Yields `type: "thinking"` messages but without `metadata.streamingStats`, so the `ui/index.ts` handler at line 674-681 silently skips the update.
2. **Copilot SDK**: Yields `type: "thinking"` messages (from `assistant.reasoning_delta` events) but also without `metadata.streamingStats`, same skip behavior.
3. **Claude SDK**: Correctly yields thinking metadata with `streamingStats.thinkingMs`, BUT only at `content_block_stop` (end of each thinking block). No intermediate updates during thinking.

Additionally, neither OpenCode nor Copilot clients track `assistant.usage` events for real-time output token counts — the character-based estimation (`charCount / 4`) in `ui/index.ts:671` is the only real-time source for all three SDKs.

## Detailed Findings

### 1. Data Flow Architecture

The streaming metadata pipeline has three layers:

```
SDK Client (claude/opencode/copilot)
  → yields AgentMessage { type, content, role, metadata? }
    → ui/index.ts handleStreamMessage() processes stream
      → calls onMeta({ outputTokens, thinkingMs }) on each chunk
        → chat.tsx handleMeta() updates streamingMeta state
          → LoadingIndicator renders during streaming
          → CompletionSummary renders after completion (if >= 60s)
```

### 2. Token Count Bug Analysis

#### During Streaming (WORKS)

`ui/index.ts:662-671` — On every text chunk, token count is estimated and propagated:
```typescript
let charCount = 0;
// ...
if (message.type === "text" && typeof message.content === "string") {
  onChunk(message.content);
  charCount += message.content.length;
  onMeta?.({ outputTokens: Math.round(charCount / 4), thinkingMs });
}
```

This calls `handleMeta` in `chat.tsx:3727-3730`:
```typescript
const handleMeta = (meta: StreamingMeta) => {
  streamingMetaRef.current = meta;
  setStreamingMeta(meta);
};
```

The `LoadingIndicator` at `chat.tsx:1295` receives `streamingMeta?.outputTokens` and displays it correctly.

#### After Completion (BUG)

`chat.tsx:1309` — The `CompletionSummary` is gated:
```typescript
{!message.streaming && message.durationMs != null && message.durationMs >= 60000 && (
  <CompletionSummary durationMs={message.durationMs} outputTokens={message.outputTokens} thinkingMs={message.thinkingMs} />
)}
```

The `>= 60000` threshold means **all responses under 1 minute lose their post-completion token/thinking display**. The `LoadingIndicator` unmounts when `message.streaming` becomes false, and the `CompletionSummary` only renders for long tasks.

**Fix**: Remove or lower the `>= 60000` threshold. Consider always showing `CompletionSummary` when `durationMs > 0`, or use a much lower threshold (e.g., 5 seconds).

### 3. Thinking Timer Bug Analysis

#### ui/index.ts Gating Logic (Lines 674-681)

```typescript
else if (message.type === "thinking" && message.metadata) {
  const stats = message.metadata.streamingStats as
    | { thinkingMs: number; outputTokens: number }
    | undefined;
  if (stats) {
    thinkingMs = stats.thinkingMs;
    onMeta?.({ outputTokens: Math.round(charCount / 4), thinkingMs });
  }
}
```

This requires `message.metadata.streamingStats` to be present. Only the Claude SDK provides this.

#### Claude SDK (WORKS — but only at block end)

`claude-client.ts:437-471`:
- Tracks thinking block boundaries via `content_block_start` (type `"thinking"`) and `content_block_stop`
- Uses wall-clock timing: `thinkingStartMs = Date.now()` at start, `thinkingDurationMs += Date.now() - thinkingStartMs` at stop
- Yields thinking metadata ONLY at `content_block_stop`:
  ```typescript
  yield {
    type: "thinking",
    content: "",
    role: "assistant",
    metadata: { streamingStats: { thinkingMs: thinkingDurationMs, outputTokens } },
  };
  ```
- **Gap**: No intermediate thinkingMs updates during an active thinking block. The UI won't show "thought for Xs" until the thinking block finishes.

#### OpenCode SDK (BROKEN — no streamingStats metadata)

`opencode-client.ts:949-954`:
```typescript
} else if (part.type === "reasoning" && part.text) {
  yield {
    type: "thinking" as const,
    content: part.text,
    role: "assistant" as const,
  };
}
```

**Missing**: No `metadata` field at all. The `ui/index.ts` check `message.metadata` passes as `undefined`, so the thinking time is never updated.

**SDK Support**: OpenCode's `ReasoningPart` type has `time: { start: number, end?: number }` fields that could provide reasoning timing, but these are not currently used.

Token data: Only available post-completion via `result.data.info?.tokens` (`opencode-client.ts:1002-1014`). No real-time streaming token events.

#### Copilot SDK (BROKEN — no streamingStats metadata)

`copilot-client.ts:311-318`:
```typescript
} else if (event.type === "assistant.reasoning_delta") {
  hasYieldedDeltas = true;
  chunks.push({
    type: "thinking",
    content: event.data.deltaContent,
    role: "assistant",
  });
  notifyConsumer();
}
```

**Missing**: No `metadata` field at all. Same issue as OpenCode.

**SDK Support**: Copilot SDK provides:
- `assistant.usage` event with `inputTokens`, `outputTokens`, `duration` fields
- `assistant.reasoning_delta` event with `reasoningId`, `deltaContent` — no timing data in individual deltas
- `session.usage_info` event with `tokenLimit`, `currentTokens`

The `assistant.usage` event fires per-turn and includes `duration` which could be used. No explicit reasoning duration is provided by the SDK.

### 4. SDK Capability Matrix

| Feature | Claude SDK | OpenCode SDK | Copilot SDK |
|---------|-----------|-------------|-------------|
| Real-time output tokens | No (only `message_delta` at end) | No (only in final response) | Yes (`assistant.usage` event) |
| Token estimation fallback | char/4 in ui/index.ts | char/4 in ui/index.ts | char/4 in ui/index.ts |
| Thinking/reasoning events | Yes (`content_block_start/stop`) | Yes (`ReasoningPart`) | Yes (`assistant.reasoning_delta`) |
| Thinking duration | Wall-clock (our tracking) | Available via `time.start/end` | Not provided by SDK |
| streamingStats metadata | Yes (at block end) | No (needs addition) | No (needs addition) |

### 5. Proposed Fixes

#### Fix 1: CompletionSummary Threshold (Token Count Bug)

**File**: `src/ui/chat.tsx:1309`

Change the threshold from `>= 60000` to always show when data is available:
```typescript
// Before:
{!message.streaming && message.durationMs != null && message.durationMs >= 60000 && (

// After:
{!message.streaming && message.durationMs != null && message.durationMs > 0 && (
```

Or use a lower threshold like 5 seconds (`>= 5000`) if showing for very fast responses is undesirable.

#### Fix 2: OpenCode Thinking Metadata

**File**: `src/sdk/opencode-client.ts:949-954`

Track reasoning timing using `Date.now()` wall-clock (same approach as Claude client):
```typescript
// Add tracking variables before the stream loop:
let reasoningStartMs: number | null = null;
let reasoningDurationMs = 0;

// In the reasoning handler:
} else if (part.type === "reasoning" && part.text) {
  if (reasoningStartMs === null) {
    reasoningStartMs = Date.now();
  }
  yield {
    type: "thinking" as const,
    content: part.text,
    role: "assistant" as const,
    metadata: {
      streamingStats: {
        thinkingMs: Date.now() - reasoningStartMs + reasoningDurationMs,
        outputTokens: 0,
      },
    },
  };
}
// When a non-reasoning part arrives after reasoning, finalize:
if (part.type !== "reasoning" && reasoningStartMs !== null) {
  reasoningDurationMs += Date.now() - reasoningStartMs;
  reasoningStartMs = null;
}
```

Alternatively, if OpenCode's `ReasoningPart.time` fields are populated, use those directly for more accuracy.

#### Fix 3: Copilot Thinking Metadata

**File**: `src/sdk/copilot-client.ts:311-318`

Same wall-clock approach:
```typescript
// Add tracking variables:
let reasoningStartMs: number | null = null;
let reasoningDurationMs = 0;

// In reasoning_delta handler:
} else if (event.type === "assistant.reasoning_delta") {
  if (reasoningStartMs === null) {
    reasoningStartMs = Date.now();
  }
  hasYieldedDeltas = true;
  chunks.push({
    type: "thinking",
    content: event.data.deltaContent,
    role: "assistant",
    metadata: {
      streamingStats: {
        thinkingMs: Date.now() - reasoningStartMs + reasoningDurationMs,
        outputTokens: 0,
      },
    },
  });
  notifyConsumer();
}
// When non-reasoning events arrive after reasoning, finalize timing
```

#### Fix 4: Real-Time Thinking Updates During Active Thinking (Enhancement)

Currently, the `ui/index.ts` handler only updates `thinkingMs` when it sees `streamingStats`. For Claude, this means thinkingMs only updates at `content_block_stop`. For a live "thought for Xs" counter during thinking, the `ui/index.ts` layer could track wall-clock time when it sees `type: "thinking"` messages without stats:

```typescript
// In ui/index.ts handleStreamMessage:
let thinkingStartLocal: number | null = null;

// For thinking messages without stats (real-time updates):
if (message.type === "thinking") {
  if (thinkingStartLocal === null) {
    thinkingStartLocal = Date.now();
  }
  const stats = message.metadata?.streamingStats as { thinkingMs: number } | undefined;
  if (stats) {
    thinkingMs = stats.thinkingMs;
    thinkingStartLocal = null; // block ended
  } else {
    // Live estimation: accumulated + current block duration
    const currentThinking = thinkingMs + (Date.now() - thinkingStartLocal);
    onMeta?.({ outputTokens: Math.round(charCount / 4), thinkingMs: currentThinking });
  }
}
```

This would show live "thought for Xs" for all SDKs during active reasoning.

### 6. Key File References

| File | Line(s) | Description |
|------|---------|-------------|
| `src/ui/chat.tsx` | 731-738 | `formatTokenCount()` helper |
| `src/ui/chat.tsx` | 751-789 | `LoadingIndicator` component (streaming display) |
| `src/ui/chat.tsx` | 854-870 | `CompletionSummary` component (post-completion display) |
| `src/ui/chat.tsx` | 1295 | LoadingIndicator usage with streamingMeta props |
| `src/ui/chat.tsx` | 1309 | **BUG**: CompletionSummary `>= 60000` threshold |
| `src/ui/chat.tsx` | 1400 | `streamingMeta` useState declaration |
| `src/ui/chat.tsx` | 3727-3730 | `handleMeta` callback |
| `src/ui/chat.tsx` | 3645-3654 | `handleComplete` captures finalMeta |
| `src/ui/chat.tsx` | 3898 | streamingMeta passed only when `msg.streaming` |
| `src/ui/index.ts` | 662-682 | `handleStreamMessage` token/thinking tracking loop |
| `src/sdk/claude-client.ts` | 437-482 | Claude thinking block tracking and token tracking |
| `src/sdk/opencode-client.ts` | 949-954 | **BUG**: OpenCode thinking yield without metadata |
| `src/sdk/opencode-client.ts` | 1002-1014 | OpenCode post-completion token extraction |
| `src/sdk/copilot-client.ts` | 311-318 | **BUG**: Copilot thinking yield without metadata |

### 7. Testing Notes

- Temporarily remove the `>= 60000` threshold at `chat.tsx:1309` to verify both token count and thinking timer display for short responses
- Test with all three agents: `bun run ~/Documents/projects/atomic/src/cli.ts chat -a <claude|opencode|copilot>`
- For thinking tests, use models that support extended thinking/reasoning (e.g., Claude with thinking enabled, or models with reasoning effort)
- After verification, decide on the final threshold value (0, 5000, or 60000)
- Character-based token estimation (`charCount / 4`) is approximate; verify it produces reasonable values compared to actual SDK token counts
