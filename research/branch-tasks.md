# Branch: fix/tui-input-state

## Overview

This branch addresses TUI bugs related to **user input handling and UI state management** across all agents (Claude Code, OpenCode, GitHub Copilot).

## Issues

### #257 — Task list persists after completion
The task list widget remains visible after all tasks complete instead of auto-clearing.

### #256 — Spinner remains active after double Ctrl+C
After a double Ctrl+C workflow interruption, the spinner continues running instead of stopping. Affects Dev & Production.

### #255 — @ symbol not resolving adjacent to punctuation
The `@` symbol does not resolve file/context references when placed next to parentheses, brackets, or braces.

### #253 — Change message enqueue shortcut
The message enqueue shortcut needs to change from Ctrl+Q to Cmd+Shift+Enter (Mac) / Ctrl+Shift+Enter (Windows).

### #252 — No auto-compaction UI
Users cannot see when context compaction is happening. There is no visual indicator for the auto-compaction process.

### #251 — Task list stale state
The task list widget gets stuck at the last item indefinitely instead of updating or clearing.

### #250 — Message disappears when ask_question tool runs
The message in the chat box disappears and the stream freezes when the `ask_question` tool is invoked.

### #249 — Stream freezes with ask_question and queued message
When `ask_question` is called while a message is queued, the stream freezes entirely.

### #247 — Prompt history not working when streaming
The prompt history (up/down arrow navigation) does not function while a response is actively streaming.

## Grouping Rationale

All issues in this branch relate to **user input handling** (keyboard shortcuts, @ resolution, prompt history) and **UI state management** (task list lifecycle, spinner state, compaction indicators, ask_question interactions). These are interconnected through the TUI's input/state management layer.
