# Atomic CLI Message Truncation and Transcript Parity Technical Design Document / RFC

| Document Metadata      | Details     |
| ---------------------- | ----------- |
| Author(s)              | Developer   |
| Status                 | Draft (WIP) |
| Team / Owner           | Atomic CLI  |
| Created / Last Updated | 2026-02-15  |

## 1. Executive Summary

This RFC defines a parity contract for Atomic's chat history behavior: the main chat view remains capped to the last 50 messages, shows a "hidden earlier messages" header when truncation occurs, and preserves full transcript access via Ctrl+O. It also standardizes reset behavior so both `/clear` and `/compact` consistently clear or rebuild context across normal view and transcript view. To keep runtime memory stable, history outside the active chat window is persisted to a tmp-file transcript buffer (`/tmp/atomic-cli/history-{pid}.json`) rather than retained in unbounded in-memory arrays. The proposal formalizes the current split-history architecture, consolidates reset semantics into a single lifecycle contract, and adds explicit parity test coverage. Expected impact is predictable transcript UX, safer maintenance, lower memory pressure in long sessions, and fewer context-loss regressions.[^r1][^r2]

## 2. Context and Motivation

PRD/Requirement Link: `research/docs/2026-02-15-opentui-opencode-message-truncation-research.md` (acts as current requirements artifact for this change scope).

### 2.1 Current State

Atomic already uses a split-history architecture:

- Main chat pane is bounded (`MAX_VISIBLE_MESSAGES = 50`) and evicted messages are persisted to disk-backed transcript history.
- Hidden message count is computed from transient overflow plus previously trimmed count and rendered as a header in normal chat view.
- Ctrl+O toggles transcript mode, which merges persisted history with in-memory messages to render full session content.
- `/clear` and `/compact` both clear/reset message state and transcript buffers, with `/compact` preserving a summary baseline.

This architecture is performant and generally aligned with the requested behavior, but implementation logic is distributed across chat state handlers, command execution paths, and utility modules.[^r1]

### 2.2 The Problem

- **User Impact:** Without a documented contract and stronger parity tests, regressions can silently hide transcript context, break Ctrl+O full-history expectations, or leave stale history after `/clear` and `/compact`.
- **Business/Delivery Impact:** Team velocity slows when behavior must be re-verified manually after UI/state refactors.
- **Technical Debt:** Truncation and reset behavior depends on multiple call paths; parity target wording ("like OpenCode") is ambiguous because OpenCode surfaces multiple history UX patterns across TUI and app surfaces.[^r2][^r3]

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] Preserve 50-message cap in primary chat pane with deterministic windowing behavior.
- [ ] Keep only the active chat window in memory and persist overflow history to tmp-file buffer.
- [ ] Always show hidden-message header in primary chat when earlier messages were trimmed.
- [ ] Ensure Ctrl+O always renders complete transcript (`history buffer + in-memory messages`) for current session.
- [ ] Enforce consistent reset semantics for `/clear` and `/compact` across normal chat and transcript modes.
- [ ] Add explicit parity-focused tests that lock these behaviors and prevent regressions.

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT introduce OpenCode web-style "load earlier messages" pagination controls in this version.
- [ ] We will NOT change default cap from 50 unless product direction explicitly redefines parity target.
- [ ] We will NOT redesign transcript UI visuals beyond existing header/hint behavior.
- [ ] We will NOT add backend storage, remote persistence, or cross-session transcript syncing.

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture Diagram

```mermaid
flowchart TB
    User[User]

    subgraph ChatSurface[Primary Chat Surface]
        Input[Incoming message/tool events]
        WindowFn[Message windowing<br/>MAX_VISIBLE_MESSAGES=50]
        ChatList[Visible message list]
        HiddenHeader[Hidden count header]
    end

    subgraph TranscriptSurface[Transcript Surface Ctrl+O]
        HistoryRead[Read persisted history buffer]
        Merge[Merge history + in-memory]
        TranscriptView[Full transcript renderer]
    end

    subgraph Lifecycle[Lifecycle Commands]
        ClearCmd[/clear]
        CompactCmd[/compact]
        ResetContract[Unified context reset contract]
    end

    subgraph Storage[Local Persistence]
        HistoryFile[/tmp/atomic-cli/history-{pid}.json]
    end

    User --> Input
    Input --> WindowFn
    WindowFn --> ChatList
    WindowFn --> HiddenHeader
    WindowFn -->|evicted messages| HistoryFile

    HistoryFile --> HistoryRead
    ChatList --> Merge
    HistoryRead --> Merge
    Merge --> TranscriptView

    ClearCmd --> ResetContract
    CompactCmd --> ResetContract
    ResetContract --> ChatList
    ResetContract --> HistoryFile
    ResetContract --> TranscriptView
```

### 4.2 Architectural Pattern

The selected pattern is **Split-History with Dual Rendering Surfaces**:

1. Keep the interactive chat surface bounded for readability/performance.
2. Persist evicted messages to a tmp-file history buffer.
3. Render full transcript only in dedicated transcript mode.
4. Apply a shared reset contract for lifecycle commands to maintain state consistency.

This pattern is already present and is retained; this RFC formalizes and hardens it.[^r1]

### 4.3 Key Components

| Component                                        | Responsibility                                        | Technology Stack              | Justification                                   |
| ------------------------------------------------ | ----------------------------------------------------- | ----------------------------- | ----------------------------------------------- |
| `chat.tsx` windowing path                        | Apply bounded message window and compute hidden count | TypeScript, OpenTUI React     | Core UX and state orchestration point           |
| `message-window.ts`                              | Encapsulate truncate/compute window logic             | TypeScript utility module     | Deterministic behavior and unit-testable logic  |
| `conversation-history-buffer.ts`                 | Persist/read/clear transcript history                 | Local JSON temp file          | Enables full transcript while keeping chat fast |
| `TranscriptView`                                 | Render full merged transcript in Ctrl+O mode          | OpenTUI component             | Dedicated full-history surface                  |
| Built-in command handlers (`/clear`, `/compact`) | Trigger lifecycle reset behaviors                     | Command framework in UI layer | Source of context reset and compaction flow     |

## 5. Detailed Design

### 5.1 API Interfaces

This change is internal-facing; interfaces are command/state contracts rather than external HTTP APIs.

#### Windowing Contract

```ts
computeMessageWindow(messages, maxVisible, trimmedCount) => {
  visibleMessages: Message[];
  hiddenMessageCount: number;
}
```

#### Eviction + Persistence Contract

```ts
applyMessageWindow(messages, maxVisible) => {
  visibleMessages: Message[];
  evictedMessages: Message[];
}
// evictedMessages MUST be appended to transcript history buffer
```

#### Lifecycle Reset Contract (Proposed Consolidated Behavior)

```ts
resetConversationContext({
  destroySession: boolean,
  clearMessages: boolean,
  compactionSummary?: string
}) => void
```

Rules:

- `destroySession=true` clears history buffer, trimmed count, in-memory messages, and exits transcript mode.
- `clearMessages=true` clears in-memory messages and trimmed count.
- `compactionSummary` repopulates history buffer with compacted baseline marker only.

### 5.2 Data Model / Schema

No relational schema changes are required. State model is:

| State Element         | Type                  | Constraints                   | Description                                 |
| --------------------- | --------------------- | ----------------------------- | ------------------------------------------- |
| `messages`            | `ChatMessage[]`       | Bounded to 50 in primary view | Active in-memory message list               |
| `trimmedMessageCount` | `number`              | `>= 0`                        | Count of messages trimmed from primary view |
| `historyBuffer`       | JSON file             | Append-only until reset       | Persisted evicted transcript messages       |
| `showTranscript`      | `boolean`             | UI mode flag                  | Controls Ctrl+O transcript rendering        |
| `compactionSummary`   | `string \| undefined` | Optional                      | Summary baseline after `/compact`           |

### 5.3 Algorithms and State Management

#### Message Ingestion and Truncation

1. New messages append to `messages`.
2. Windowing utility returns `visibleMessages + evictedMessages`.
3. Evicted messages append to history buffer.
4. Hidden count is recalculated and drives header visibility.

#### Temp-Buffer-First History Policy

1. Primary chat state holds only the active message window (`<= 50`) plus transient streaming state.
2. Any message evicted by windowing is appended immediately to `/tmp/atomic-cli/history-{pid}.json`.
3. Ctrl+O transcript mode reconstructs the full conversation from `historyBuffer + messages`.
4. `/clear` must wipe tmp history buffer; `/compact` must replace it with compacted summary baseline only.

#### Ctrl+O Transcript Rendering

1. On transcript toggle, read entire history buffer.
2. Merge `historyBuffer` and current `messages`.
3. Render merged collection in `TranscriptView`.

#### `/clear` and `/compact` Consistency Rules

- `/clear`: hard reset (session destroy + buffer wipe + trimmed-count reset + transcript exit).
- `/compact`: clear prior conversation context but retain a summary baseline so future context starts from compacted summary, not empty state.

These semantics already exist and become explicit acceptance criteria in this RFC.[^r1]

## 6. Alternatives Considered

| Option                                                                     | Pros                                                       | Cons                                           | Reason for Rejection                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Option A: Keep full transcript in memory only                              | Simplest runtime model                                     | Memory growth risk, poor long sessions         | Violates bounded-chat performance goals           |
| Option B: Show all messages directly in primary pane                       | No mode switching needed                                   | UI noise, scrolling performance degradation    | Conflicts with readability and TUI responsiveness |
| Option C: Implement OpenCode app-style incremental backfill                | Rich timeline controls                                     | Larger UX and state complexity, broader scope  | Not required for current parity target            |
| Option D: Keep split-history pattern and codify parity contract (Selected) | Matches current architecture, minimal risk, clear behavior | Requires targeted hardening and test expansion | Selected for lowest risk and highest clarity      |

## 7. Cross-Cutting Concerns

### 7.1 Security and Privacy

- Transcript buffer may contain sensitive prompt/tool output content; file lifecycle must continue to respect clear/compact semantics.
- No new external data flows are introduced.
- Reset paths must avoid partial clears that leave stale local context accessible via transcript mode.

### 7.2 Observability Strategy

- Add/standardize debug-level logs around:
    - Number of evicted messages per windowing operation.
    - Hidden-message count calculations.
    - `/clear` and `/compact` reset events.
- Add regression-focused test assertions for hidden-count/header behavior and transcript reconstruction path.

### 7.3 Scalability and Capacity Planning

- Bounded primary view (`50`) keeps render complexity stable for interactive operations.
- History buffer grows with session duration; this is acceptable for local temp storage and existing workflow assumptions.
- Ctrl+O full transcript render remains intentionally separate to isolate heavier rendering from the main chat loop.[^r1]

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

- [ ] Phase 1: Add/expand parity tests to encode required behavior before refactors.
- [ ] Phase 2: Consolidate reset logic behind a single lifecycle helper/contract (internal refactor only).
- [ ] Phase 3: Validate manual UX in main pane and Ctrl+O transcript with clear/compact command sequences.
- [ ] Phase 4: Merge with no feature flag (behavior-preserving hardening).

### 8.2 Data Migration Plan

- No persistent database migration required.
- Local temp history format remains unchanged.
- Backward compatibility: sessions created before rollout continue using existing history buffer semantics.

### 8.3 Test Plan

- **Unit Tests:**
    - `computeMessageWindow` hidden-count correctness.
    - `applyMessageWindow` eviction correctness for boundary/off-by-one cases.
    - Overflow path appends evicted messages to tmp history buffer without growing in-memory list beyond cap.
    - Reset helper behavior for `/clear` and `/compact` input combinations.
- **Integration Tests:**
    - Main chat shows hidden-count header after message count exceeds 50.
    - Ctrl+O renders merged transcript from history + in-memory messages.
    - `/clear` removes both visible and transcript context.
    - `/compact` resets context and retains summary baseline only.
- **End-to-End Tests:**
    - Long conversation scenario (>50 messages) with transcript inspection.
    - Sequence: chat -> Ctrl+O -> `/compact` -> Ctrl+O -> `/clear` -> Ctrl+O.

## 9. Open Questions / Unresolved Issues

Resolved decisions (2026-02-15):

- [x] **Parity target scope:** OpenCode TUI truncation behavior only.
- [x] **Message cap:** Keep fixed at 50.
- [x] **Hidden-message header copy:** Keep current copy for now.
- [x] **Temp history retention policy:** No explicit TTL for now; keep current session lifecycle cleanup behavior.

## Research Citations

[^r1]: `research/docs/2026-02-15-opentui-opencode-message-truncation-research.md` (Detailed Findings and Architecture Documentation, lines 35-57 and 91-99).

[^r2]: `research/docs/2026-02-15-opentui-opencode-message-truncation-research.md` (Summary and OpenCode/OpenTUI findings, lines 31-33 and 59-74).

[^r3]: `research/docs/2026-02-15-opentui-opencode-message-truncation-research.md` (Open Questions, lines 116-120).
