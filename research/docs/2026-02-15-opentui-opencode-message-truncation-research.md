---
date: 2026-02-15 20:20:00 UTC
researcher: GitHub Copilot CLI
git_commit: dbda8029862ba9e7bda5acce3a867a67d56cb048
branch: lavaman131/hotfix/sub-agents-ui
repository: atomic
topic: "Research the codebase and OpenTUI/OpenCode behavior for last-50 message truncation, truncated-count header, ctrl+o full history, and compact/clear exceptions"
tags:
    [
        research,
        codebase,
        atomic-cli,
        opentui,
        opencode,
        chat-history,
        truncation,
    ]
status: complete
last_updated: 2026-02-15
last_updated_by: GitHub Copilot CLI
---

# Research

## Research Question

Research the codebase and OpenTUI and OpenCode libraries mentioned in `src/AGENTS.md` to modify the OpenTUI chat interface to properly truncate to the last 50 messages like OpenCode does and display a header showing how many messages were truncated; ensure ctrl+o shows the full message list; and ensure compaction/clear reset behavior clears context for both normal view and ctrl+o.

## Summary

Atomic already implements a 50-message in-memory window, a truncated-count header in normal chat, and full transcript rendering in ctrl+o via disk-backed history + in-memory messages. The current clear/compact behavior also resets history consistently: `/clear` destroys session state and wipes transcript history, and `/compact` clears prior history and keeps only the new compaction summary context. DeepWiki research indicates OpenCode uses different patterns (TUI sync cap around 100 and web timeline backfill/load-earlier controls), while OpenTUI provides low-level truncation/rendering primitives rather than built-in message-count truncation headers.

## Detailed Findings

### Atomic: Main chat truncation to last 50 + truncated count header

- `MAX_VISIBLE_MESSAGES` is explicitly set to `50` (`src/ui/chat.tsx:865`).
- In-memory capping and eviction happen in `setMessagesWindowed`, which applies `applyMessageWindow(...)` and persists evicted messages to disk (`src/ui/chat.tsx:2000-2016`, `src/ui/utils/message-window.ts:39-56`).
- Visible/hidden computation is done by `computeMessageWindow(...)`, including both transient overflow and previously trimmed count (`src/ui/chat.tsx:871-877`, `src/ui/utils/message-window.ts:23-34`).
- Normal chat renders a header line showing hidden message count when `hiddenMessageCount > 0` (`src/ui/chat.tsx:5205-5212`), e.g. `↑ N earlier messages in transcript (ctrl+o)`.
- Tests verify last-50 behavior and hidden count semantics (`src/ui/utils/message-window.test.ts:9-57`).

### Atomic: ctrl+o full transcript behavior

- Ctrl+O toggles transcript mode (`src/ui/chat.tsx:4091-4095`).
- Transcript mode renders `TranscriptView` and passes the full merged list `[...]readHistoryBuffer(), ...messages]` (`src/ui/chat.tsx:5254-5262`).
- `TranscriptView` is a full-screen scrollable view for detailed transcript lines (`src/ui/components/transcript-view.tsx:1-6`, `src/ui/components/transcript-view.tsx:72-138`).
- Persistent history lives in temp storage (`/tmp/atomic-cli/history-{pid}.json`) via `appendToHistoryBuffer/readHistoryBuffer/clearHistoryBuffer` (`src/ui/utils/conversation-history-buffer.ts:15-90`).

### Atomic: compact/clear exception behavior

- `/clear` command returns `clearMessages: true` and `destroySession: true` (`src/ui/commands/builtin-commands.ts:195-207`).
- `/compact` calls `session.summarize()` and returns `clearMessages: true` with `compactionSummary` (`src/ui/commands/builtin-commands.ts:215-247`).
- Command execution path resets transcript/history state:
    - Session destroy path (`/clear`) clears history buffer, resets trimmed count, exits transcript mode (`src/ui/chat.tsx:3505-3520`).
    - `clearMessages` handling clears in-memory messages and trimmed count; if compaction summary exists it resets history buffer then appends summary marker (`src/ui/chat.tsx:3522-3535`).
- Command context `clearContext` also clears visible messages and state while restoring specific workflow refs (`src/ui/chat.tsx:3425-3443`).

### OpenCode findings (DeepWiki)

- DeepWiki reports OpenCode TUI sync state in `packages/opencode/src/cli/cmd/tui/context/sync.tsx` trims message arrays when length exceeds ~100 (triggered on `message.updated`).
- DeepWiki reports OpenCode app timeline behavior uses staged rendering/loading controls (e.g., `turnInit`, `turnBatch`, `historyMore`, `loadMore`, "Load earlier messages", "Render earlier messages") in `packages/app/src/pages/session.tsx`, `packages/app/src/pages/session/message-timeline.tsx`, and `packages/app/src/context/sync.tsx`.
- DeepWiki result indicates OpenCode UI exposes controls to fetch/render earlier content rather than a static truncated-count banner in the timeline UI.
- DeepWiki search references:
    - https://deepwiki.com/search/in-packagesopencodesrcclicmdtu_180a2762-e043-4a7e-aec0-8306e875c6dc
    - https://deepwiki.com/search/how-does-message-history-rende_f2888c85-36e0-4704-9549-dc12418e5bcc
    - https://deepwiki.com/search/does-opencode-show-a-headerban_8430e048-344f-433b-a054-882aa5ca0faf

### OpenTUI findings (DeepWiki)

- OpenTUI does not provide a built-in "N messages hidden" chat header pattern.
- OpenTUI exposes low-level primitives for truncation and rendering (e.g., `TextBufferView` truncate behavior and `TextBufferRenderable`), which can be used by consumers to implement list/header semantics.
- DeepWiki search reference:
    - https://deepwiki.com/search/does-opentui-include-builtin-c_ebe189a4-21ab-450f-a0b3-3e07f3fd7648

## Code References

- `src/ui/chat.tsx:865` - hard cap constant for visible messages.
- `src/ui/chat.tsx:2000-2016` - in-memory windowing + disk persistence for evicted messages.
- `src/ui/chat.tsx:5205-5212` - hidden-message header shown in normal chat.
- `src/ui/chat.tsx:5254-5262` - ctrl+o transcript uses full history buffer + current messages.
- `src/ui/chat.tsx:3505-3535` - `/clear` and `/compact` handling for transcript/state reset.
- `src/ui/utils/message-window.ts:23-56` - core windowing/truncation logic.
- `src/ui/utils/message-window.test.ts:9-57` - verification tests for last-50 and hidden counts.
- `src/ui/utils/conversation-history-buffer.ts:15-90` - persistent transcript storage and clearing.
- `src/ui/commands/builtin-commands.ts:195-247` - `/clear` and `/compact` command contracts.
- `src/ui/components/transcript-view.tsx:72-138` - full transcript rendering component.

## Architecture Documentation

Atomic uses a split-history architecture:

1. **Primary chat pane**: bounded in-memory list (`MAX_VISIBLE_MESSAGES=50`) for performance/readability.
2. **Transcript persistence layer**: evicted messages are appended to a temp-file buffer.
3. **Transcript mode (ctrl+o)**: reads persisted history and merges in-memory messages for full-session visibility.
4. **Lifecycle reset commands**:
    - `/clear`: hard reset (destroy session, clear history, reset transcript mode).
    - `/compact`: summarize and reset prior history to compacted context summary baseline.

## Historical Context (from research/)

- `research/docs/2026-02-01-chat-tui-parity-implementation.md` - documents `/clear` and `/compact` parity work in chat TUI.
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` - broader SDK/TUI consistency work touching context behavior.
- `research/docs/2026-02-13-token-counting-system-prompt-tools.md` - context window/token accounting and compaction-related usage patterns.
- `research/docs/2026-02-14-opencode-opentui-sdk-research.md` - prior OpenCode/OpenTUI investigation baseline.
- `research/docs/2026-02-13-ralph-task-list-ui.md` - notes on preserved UI state across context clears in Ralph flows.

## Related Research

- `research/docs/2026-02-12-sdk-ui-standardization-research.md`
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md`
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md`
- `research/docs/2026-01-31-opentui-library-research.md`
- `research/docs/2026-01-31-opencode-sdk-research.md`

## Open Questions

- The request references "last 50 messages like OpenCode"; DeepWiki results indicate OpenCode surfaces multiple history strategies (including TUI/state caps and app backfill controls), so confirm which OpenCode surface should be treated as the parity target.
- If parity requires OpenCode app-style incremental backfill controls instead of a static hidden-count header, that would imply a different UX target than Atomic’s current chat/header approach.
- GitHub permalinks were not generated because this worktree is on a non-main branch with no configured upstream tracking branch (`lavaman131/hotfix/sub-agents-ui`, upstream `none`).
