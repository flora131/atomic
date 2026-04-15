---
date: 2026-04-14 18:24:09 PDT
researcher: Claude Opus 4.6
git_commit: 969525a232edeb3b9db48f1bebd065faad6c60a4
branch: flora131/feature/HIL-final
repository: atomic
topic: "Human-in-the-Loop (HIL) Detection & UI Surfacing Across Three SDK Providers"
tags: [research, codebase, hil, awaiting-input, claude-agent-sdk, copilot-sdk, opencode-sdk, session-graph, opentui, workflow]
status: complete
last_updated: 2026-04-14
last_updated_by: Claude Opus 4.6
---

# Research: HIL Detection & UI Surfacing

## Research Question

How should Atomic detect when an SDK is waiting for human input (HIL state) and surface it in the UI — without polling pane content and without breaking existing SDK idle/completion logic? Document all relevant code paths, types, SDK capabilities, and UI components needed to implement `awaiting_input` as a new session status.

## Summary

The codebase currently supports four session statuses: `pending`, `running`, `complete`, `error`. There is no `awaiting_input` status. When an agent is waiting for user input, the UI shows it as `running` (yellow pulsing border) with no distinction — making multi-stage workflows appear frozen.

All three SDK providers have native capabilities for detecting HIL state:
- **Claude Agent SDK**: Transcript-based detection via `getSessionMessages()` — scan for unresolved `AskUserQuestion` tool_use blocks
- **Copilot SDK**: Native `user_input.requested` and `user_input.completed` events via `session.on()`
- **OpenCode SDK**: Server event stream with `question.asked`, `question.replied`, `question.rejected` events via `client.event.subscribe()`

The implementation requires changes across 5 layers: (1) types, (2) store, (3) panel API, (4) executor/providers, and (5) UI components.

---

## Detailed Findings

### 1. Current Session Status System

#### Type Definition

**File**: `src/sdk/components/orchestrator-panel-types.ts:3`
```typescript
export type SessionStatus = "pending" | "running" | "complete" | "error";
```

There is no `awaiting_input` status. The union must be extended.

#### SessionData

**File**: `src/sdk/components/orchestrator-panel-types.ts:16-23`
```typescript
export interface SessionData {
  name: string;
  status: SessionStatus;
  parents: string[];
  error?: string;
  startedAt: number | null;
  endedAt: number | null;
}
```

No field for HIL metadata (e.g., question text).

#### Status Helpers

**File**: `src/sdk/components/status-helpers.ts:5-25`

Three functions map status to visual properties:

```typescript
function statusColor(status, theme) → { running: theme.warning, complete: theme.success, pending: theme.textDim, error: theme.error }
function statusLabel(status) → { running: "running", complete: "done", pending: "waiting", error: "failed" }
function statusIcon(status)  → { running: "●", complete: "✓", pending: "○", error: "✗" }
```

All three need an `awaiting_input` entry. Per the design spec:
- Color: `theme.info` (blue, `#89b4fa` in Mocha / `#1e66f5` in Latte)
- Label: `"input needed"`
- Icon: `"?"`

#### Theme Colors

**File**: `src/sdk/runtime/theme.ts:34-46` (Catppuccin Mocha)

The `info` color is `theme.accent` which is `#89b4fa` (Catppuccin Blue) — already in `GraphTheme.info`. This matches the design spec exactly. No new colors needed.

---

### 2. PanelStore — State Management

**File**: `src/sdk/components/orchestrator-panel-store.ts`

The store has methods for transitioning sessions: `startSession()`, `completeSession()`, `failSession()`. There is no method for setting a session to `awaiting_input` or back to `running`.

#### Current Transition Methods

| Method | Status Change | Side Effects |
|--------|--------------|-------------|
| `startSession(name)` | → `running` | Sets `startedAt` |
| `completeSession(name)` | → `complete` | Sets `endedAt` |
| `failSession(name, error)` | → `error` | Sets `endedAt`, `error` |

Missing: A method to transition `running` → `awaiting_input` and `awaiting_input` → `running`.

---

### 3. OrchestratorPanel — Public API

**File**: `src/sdk/components/orchestrator-panel.tsx`

The imperative API class bridges the executor with the React UI. Current methods:

```typescript
sessionStart(name)     // Mark running
sessionSuccess(name)   // Mark complete
sessionError(name, msg) // Mark error
addSession(name, parents) // Dynamically add node
```

Missing: `sessionAwaitingInput(name)` and `sessionResumed(name)` methods. These would be called by the provider-specific HIL detection code in the executor.

---

### 4. Executor — Session Runner & Provider Integration

**File**: `src/sdk/runtime/executor.ts`

#### SharedRunnerState (line 533)

```typescript
interface SharedRunnerState {
  tmuxSessionName: string;
  sessionsBaseDir: string;
  agent: AgentType;
  inputs: Record<string, string>;
  panel: OrchestratorPanel;
  activeRegistry: Map<string, ActiveSession>;
  completedRegistry: Map<string, SessionResult>;
  failedRegistry: Set<string>;
}
```

The `panel` reference is available to session runners. HIL callbacks can call `shared.panel.sessionAwaitingInput(name)` / `shared.panel.sessionResumed(name)`.

#### createSessionRunner (line 700)

This function manages the full session lifecycle. The key integration points for HIL:

1. **After client/session init** (line 892-941): Provider-specific HIL setup goes here
2. **Copilot send() wrapper** (line 915-941): Already wraps `send()` to await `session.idle`. HIL detection for Copilot needs to be wired alongside this
3. **Run user callback** (line 982): The `await run(ctx)` call is where the stage callback runs. HIL events fire during this period

#### Copilot send() Wrapper (line 915-941)

The existing wrapper intercepts `copilotSession.send()` and blocks until `session.idle` fires. HIL detection must prevent `session.idle` from resolving the `send()` wrapper while a `user_input.requested` is pending. Otherwise the stage completes prematurely when the user answers the question (because `session.idle` fires between the agent asking and then continuing after the answer).

---

### 5. Claude Agent SDK — Transcript-Based HIL Detection

#### SDK Capabilities (confirmed from `@anthropic-ai/claude-agent-sdk`)

**`getSessionMessages(sessionId, options)`** returns `Promise<SessionMessage[]>`:
```typescript
type SessionMessage = {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  session_id: string;
  message: unknown;  // BetaMessage for assistant, MessageParam for user
  parent_tool_use_id: null;
};
```

**tool_use blocks** (in assistant messages):
```typescript
// message.content array contains:
{ type: "tool_use", id: "toolu_xxx", name: "AskUserQuestion", input: { questions: [...] } }
```

**tool_result blocks** (in user messages):
```typescript
// message.content array contains:
{ type: "tool_result", tool_use_id: "toolu_xxx", content: "..." }
```

#### Detection Algorithm: `hasUnresolvedHILTool()`

A pure function that scans the transcript:

1. Walk assistant messages for `tool_use` blocks where `name === "AskUserQuestion"`
2. Collect their `id` values into an unresolved set
3. Walk user messages for `tool_result` blocks
4. Remove matching `tool_use_id` values from the unresolved set
5. If any IDs remain → HIL is active

This is deterministic, testable, and uses the transcript as source of truth.

#### Integration Point: `waitForIdle()` in claude.ts

**File**: `src/sdk/providers/claude.ts:265-302`

The current `waitForIdle()` function polls the tmux pane for the idle prompt indicator. This is where HIL detection would be integrated:

- Before each poll iteration, call `getSessionMessages()` and run `hasUnresolvedHILTool()`
- If HIL detected: fire `onHIL(true)`, skip idle detection, sleep briefly
- When HIL clears: fire `onHIL(false)`, add post-HIL cooldown (3s), resume idle detection

The `claudeQuery()` function (line 381) calls `waitForIdle()` — the callback chain is:
```
executor.createSessionRunner → initProviderClientAndSession → ClaudeSessionWrapper.query()
  → claudeQuery() → waitForIdle() ← integrate HIL here
```

#### Claude Session ID Resolution

**File**: `src/sdk/providers/claude.ts:155-165`

`findNewSessionId()` resolves the Claude session ID by diffing against `knownSessionIds`. The executor stores this in `paneState.claudeSessionId` (line 471-480). For `waitForIdle()`, the session ID is passed as a parameter — it can be used to call `getSessionMessages()`.

---

### 6. Copilot SDK — Native Event-Based HIL Detection

#### SDK Capabilities (confirmed from `@github/copilot-sdk@0.2.1`)

**`user_input.requested`** event:
```typescript
{
  type: "user_input.requested";
  ephemeral: true;
  data: {
    requestId: string;       // correlates with completed event
    question: string;        // what the agent is asking
    choices?: string[];      // predefined options
    allowFreeform?: boolean; // free-text allowed
    toolCallId?: string;     // originating tool call
  }
}
```

**`user_input.completed`** event:
```typescript
{
  type: "user_input.completed";
  ephemeral: true;
  data: {
    requestId: string;  // matches the requested event
  }
}
```

**Subscription API**: `session.on("user_input.requested", (event) => { ... })` returns `() => void` unsubscribe function.

#### Integration Point: Copilot send() Wrapper

**File**: `src/sdk/runtime/executor.ts:915-941`

The existing wrapper creates a promise that resolves on `session.idle`. HIL detection adds:

1. **Event listeners**: Before `nativeSend()`, register listeners for `user_input.requested` and `user_input.completed`
2. **HIL pending flag**: Set a `hilPending` boolean when `user_input.requested` fires. This prevents the `session.idle` promise from resolving prematurely
3. **Panel updates**: Call `shared.panel.sessionAwaitingInput(name)` on `requested` and `shared.panel.sessionResumed(name)` on `completed`
4. **Flag clear**: On `user_input.completed`, clear `hilPending` so the next `session.idle` can resolve normally

#### Critical Architecture Note

There are TWO mechanisms for `user_input` in Copilot SDK:
- **`onUserInputRequest`** (in `createSession` config): Active RPC handler that sends the answer back. This is what the tmux pane handles natively
- **`session.on("user_input.requested")`**: Passive event observation. Use this for HIL detection UI — it doesn't interfere with the RPC answer flow

---

### 7. OpenCode SDK — Server Event Stream HIL Detection

#### SDK Capabilities (confirmed from `@opencode-ai/sdk@1.3.17`, v2 surface)

**Event subscription**:
```typescript
const result = await client.event.subscribe({ directory?, workspace? });
for await (const event of result.stream) {
  switch (event.type) {
    case "question.asked": ...
    case "question.replied": ...
    case "question.rejected": ...
  }
}
```

**`question.asked`** event:
```typescript
{
  type: "question.asked";
  properties: {
    id: string;          // requestID
    sessionID: string;   // filter by session
    questions: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description: string }>;
      multiple?: boolean;
      custom?: boolean;
    }>;
    tool?: { messageID: string; callID: string };
  }
}
```

**`question.replied`** event:
```typescript
{
  type: "question.replied";
  properties: {
    sessionID: string;
    requestID: string;
    answers: Array<Array<string>>;
  }
}
```

**`question.rejected`** event:
```typescript
{
  type: "question.rejected";
  properties: { sessionID: string; requestID: string }
}
```

#### Integration Point

In the executor's `createSessionRunner()`, after `initProviderClientAndSession()` for OpenCode, start a background async IIFE:

```typescript
if (shared.agent === "opencode") {
  const ocClient = providerClient as ProviderClient<"opencode">;
  (async () => {
    const { stream } = await ocClient.event.subscribe();
    for await (const event of stream) {
      if (event.type === "question.asked" && event.properties.sessionID === sessionId) {
        shared.panel.sessionAwaitingInput(name);
        onHIL?.(true);
      }
      if ((event.type === "question.replied" || event.type === "question.rejected")
          && event.properties.sessionID === sessionId) {
        shared.panel.sessionResumed(name);
        onHIL?.(false);
      }
    }
  })().catch(() => {});
}
```

The `sessionID` filter ensures only events for THIS session trigger UI updates.

---

### 8. UI Components — Changes Required

#### 8a. Node Card (`src/sdk/components/node-card.tsx`)

Currently 4 rows tall for all statuses. The design spec calls for 6 rows when `awaiting_input`:

- Row 1: top border with name
- Row 2: blank
- Row 3: duration
- Row 4: "waiting for response" (blue)
- Row 5: "↵ enter to respond" (dim gray)
- Row 6: bottom border

The `NodeCard` component (line 9-69) currently renders:
```tsx
<box ... height={displayH} border borderColor={borderCol} ...>
  <box alignItems="center">
    <text fg={durCol}>{duration}</text>
  </box>
</box>
```

For `awaiting_input`, the border color should pulse between `theme.border` (`#585b70`) and `theme.info` (`#89b4fa`). The existing pulse logic (line 27-29) uses `theme.warning` (yellow) — this needs to branch on status.

Additional content for `awaiting_input` nodes:
```tsx
{isAwaitingInput && (
  <>
    <box alignItems="center">
      <text fg={theme.info}>waiting for response</text>
    </box>
    <box alignItems="center">
      <text fg={theme.textDim}>↵ enter to respond</text>
    </box>
  </>
)}
```

#### 8b. Layout (`src/sdk/components/layout.ts`)

The layout uses constants:
```typescript
export const NODE_H = 4;  // default height
```

The `rowH` map (line 153-156) stores the max height per depth level:
```typescript
for (const n of Object.values(map)) {
  rowH[n.depth] = Math.max(rowH[n.depth] ?? 0, NODE_H);
}
```

For `awaiting_input` nodes at 6 rows, the `NODE_H` used should be 6 instead of 4. The `rowH` computation already uses `Math.max`, so if an `awaiting_input` node contributes 6 to its depth's row height, all nodes at that depth level expand to 6 — which is correct.

The `LayoutNode` type includes `status` so the layout function can check `status === "awaiting_input"` when computing row heights.

#### 8c. Statusline (`src/sdk/components/statusline.tsx`)

The statusline (line 28-38) shows the focused node's icon and name:
```tsx
<span fg={statusColor(focusedNode.status, theme)}>{statusIcon(focusedNode.status)} </span>
<span fg={theme.text}>{focusedNode.name}</span>
```

With `awaiting_input`, `statusIcon()` returns `"?"` and `statusColor()` returns `theme.info` (blue). This works automatically once the helpers are updated.

The design spec says no extra "attach to provide input" text — just the `?` icon in blue next to the name.

#### 8d. Compact Switcher (`src/sdk/components/compact-switcher.tsx`)

Uses `statusIcon()` and `statusColor()` — will pick up `awaiting_input` automatically.

#### 8e. Pulse Animation (`src/sdk/components/session-graph-panel.tsx:102-117`)

Currently only pulses when `hasRunning`:
```typescript
const hasRunning = useMemo(
  () => store.sessions.some((s) => s.status === "running"),
  [storeVersion],
);
```

Must also pulse for `awaiting_input`:
```typescript
const hasAnimating = useMemo(
  () => store.sessions.some((s) => s.status === "running" || s.status === "awaiting_input"),
  [storeVersion],
);
```

---

### 9. Unified Callback Interface

All three providers feed into a single callback signature:

```typescript
onHIL?: (waiting: boolean) => void
```

At the executor level, this is wired to `shared.panel`:
```typescript
const onHIL = (waiting: boolean) => {
  if (waiting) shared.panel.sessionAwaitingInput(name);
  else shared.panel.sessionResumed(name);
};
```

This decouples provider-specific detection from the UI layer. Each provider calls `onHIL(true)` when HIL starts and `onHIL(false)` when it ends — the UI doesn't know or care which SDK is underneath.

---

### 10. Existing askUserQuestion DSL Research

**File**: `research/docs/2026-03-23-ask-user-question-dsl-node-type.md`

A prior research document explored adding `askUserQuestion()` as a DSL node type in the workflow graph. That research is about the *graph-level* ask-user node factory and a `UserQuestionDialog` / `HitlResponseWidget` UI system that are part of an older workflow architecture.

The current research is different — it's about detecting when *any* of the three SDK agents encounters HIL (via their native mechanisms) and surfacing it in the *session graph panel*. The DSL research is complementary but addresses a different layer.

---

## Code References

### Core Types & Store
- `src/sdk/components/orchestrator-panel-types.ts:3` — `SessionStatus` union (needs `awaiting_input`)
- `src/sdk/components/orchestrator-panel-types.ts:16-23` — `SessionData` interface
- `src/sdk/components/orchestrator-panel-store.ts:68-91` — Session transition methods (needs `awaitingInput` + `resumeSession`)
- `src/sdk/components/orchestrator-panel.tsx:99-113` — Panel API (needs `sessionAwaitingInput` + `sessionResumed`)

### Status Helpers & Theme
- `src/sdk/components/status-helpers.ts:5-25` — `statusColor`, `statusLabel`, `statusIcon` (all need `awaiting_input` entry)
- `src/sdk/runtime/theme.ts:34-46` — Catppuccin Mocha palette (`accent: "#89b4fa"` = blue, already mapped to `GraphTheme.info`)
- `src/sdk/components/graph-theme.ts:18` — `info: string` field in `GraphTheme` (already exists)

### Executor & Providers
- `src/sdk/runtime/executor.ts:700-1045` — `createSessionRunner()` — main integration site
- `src/sdk/runtime/executor.ts:915-941` — Copilot `send()` wrapper (needs HIL guard)
- `src/sdk/providers/claude.ts:265-302` — `waitForIdle()` (needs HIL detection integration)
- `src/sdk/providers/claude.ts:381-495` — `claudeQuery()` (calls `waitForIdle`)

### UI Components
- `src/sdk/components/node-card.tsx:9-69` — `NodeCard` (needs awaiting_input rendering + blue pulse)
- `src/sdk/components/layout.ts:8-9` — `NODE_W = 36, NODE_H = 4` (awaiting_input nodes need height 6)
- `src/sdk/components/layout.ts:101-222` — `computeLayout()` (row height computed from `NODE_H` per node)
- `src/sdk/components/session-graph-panel.tsx:102-117` — Pulse animation (needs to fire for `awaiting_input` too)
- `src/sdk/components/statusline.tsx:28-38` — Focused node info (auto-works with updated helpers)
- `src/sdk/components/compact-switcher.tsx:43-70` — Agent list (auto-works with updated helpers)

### SDK Dependencies (node_modules)
- `@anthropic-ai/claude-agent-sdk` — `getSessionMessages()`, `SessionMessage`, `listSessions()`
- `@github/copilot-sdk@0.2.1` — `session.on("user_input.requested")`, `session.on("user_input.completed")`
- `@opencode-ai/sdk@1.3.17` (v2) — `client.event.subscribe()`, `question.asked/replied/rejected` events

---

## Architecture Documentation

### Current State Machine

```
pending ──→ running ──→ complete
                   └──→ error
```

### Proposed State Machine

```
pending ──→ running ──→ complete
               ↕            
         awaiting_input     
               │            
               └──→ error   
```

Transitions:
- `running → awaiting_input`: SDK detects HIL (tool_use without tool_result, event fires)
- `awaiting_input → running`: User responds (tool_result appears, event fires)
- `running → complete`: SDK idle detection confirms agent finished
- `running → error` / `awaiting_input → error`: Agent errors during or after HIL

Key invariant: `awaiting_input → running` on user response, NOT `awaiting_input → complete`. The agent continues working after receiving the answer — completion only fires when the agent is truly done.

### Provider Detection Matrix

| Provider | Detection Mechanism | Signal Type | Latency |
|----------|-------------------|-------------|---------|
| Claude | `getSessionMessages()` transcript scan | Poll (2s interval) | ~2s |
| Copilot | `session.on("user_input.requested/completed")` | Push (native events) | Instant |
| OpenCode | `client.event.subscribe()` SSE stream | Push (server events) | Instant |

### UI Visual Signals

| Signal | Location | Behavior |
|--------|----------|----------|
| Blue pulsing border | Node card | Sine wave between `#585b70` ↔ `#89b4fa` |
| 6-row expanded card | Node card | "waiting for response" + "↵ enter to respond" |
| Blue `?` icon | Statusline | Next to focused node name |
| Blue `?` icon | Compact switcher | In agent list |

---

## Historical Context (from research/)

- `research/docs/2026-03-23-ask-user-question-dsl-node-type.md` — Prior research on `askUserQuestion()` as a DSL node type. Documents the graph-level `askUserNode()` factory and HITL UI components (`UserQuestionDialog`, `HitlResponseWidget`). Different layer from this work but shares the concept.
- `research/docs/2026-03-06-copilot-sdk-session-events-schema-reference.md` — Schema reference for Copilot SDK session events. Confirms `user_input.requested/completed` events exist in the discriminated union.
- `research/docs/2026-03-06-opencode-sdk-event-schema-reference.md` — OpenCode SDK event schema. Confirms `question.asked/replied/rejected` events and SSE subscription pattern.
- `research/docs/2026-03-06-claude-agent-sdk-event-schema.md` — Claude Agent SDK message types. Documents `SDKMessage` union and transcript structure.
- `research/docs/2026-03-14-event-bus-callback-elimination-sdk-event-types.md` — Event catalog across all three SDKs. Cross-references user input events.
- `research/docs/2026-02-15-subagent-premature-completion-SUMMARY.md` — Investigation of premature completion bugs. Relevant because HIL detection must not cause similar issues.

## Related Research

- `research/web/2026-04-14-copilot-sdk-hil-events.md` — Fresh SDK investigation confirming Copilot HIL event shapes and subscription API
- `research/web/2026-04-14-opencode-sdk-hil-events.md` — Fresh SDK investigation confirming OpenCode question event shapes and subscription API
- `research/web/2026-04-14-claude-agent-sdk-hil-transcript.md` — Fresh SDK investigation confirming Claude transcript structure for tool_use/tool_result detection

---

## Open Questions

1. **Post-HIL cooldown timing**: The proposed 3-second cooldown for Claude after HIL clears is a fixed value. Should this be configurable per-stage or adaptive based on system performance?

2. **Copilot send() wrapper timeout**: If `user_input.completed` never fires (e.g., agent crashes mid-HIL), the `hilPending` flag blocks `session.idle` forever. Should there be a fallback timeout?

3. **OpenCode event stream error handling**: The proposed `catch(() => {})` on the background IIFE silently swallows stream errors. Should these be logged or should the HIL detection gracefully degrade?

4. **Automatic pane attach**: The design spec shows "↵ enter to respond" but the user must manually navigate to the tmux window. Should pressing Enter on an `awaiting_input` node automatically attach to that pane?

5. **Multiple concurrent HIL**: If two stages both enter `awaiting_input`, the user needs to respond to each. The current design handles this visually (both nodes pulse blue), but should there be a priority indicator or queue?

6. **Headless stages**: Headless stages (no tmux pane) cannot receive user input via the terminal. If a headless stage triggers HIL, should it error immediately or is HIL impossible for headless by design?
