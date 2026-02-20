---
date: 2026-02-17 05:40:03 UTC
researcher: Claude Opus 4.6
git_commit: 355d8d90d540f33388d3e83d71e48236df5cfa91
branch: lavaman131/feature/tui-enhancements
repository: atomic
topic: "Command History Persistence for Chat TUI with ~/.atomic/.command_history"
tags: [research, codebase, tui, command-history, keyboard-events, input-handling, cursor-tracking]
status: complete
last_updated: 2026-02-17
last_updated_by: Claude Opus 4.6
---

# Research: Command History Persistence for Chat TUI

## Research Question

Research the current chat TUI input handling architecture to understand how to implement command history support. Specifically: (1) How does the text input component handle keyboard events (up/down arrow keys)? (2) How is cursor position tracked within the text input? (3) What is the current file structure for TUI components? (4) How does ~/.zsh_history work as a reference model for the ~/.atomic/.command_history file format and behavior? The key UX requirement: up/down arrows at cursor index 0 should navigate command history; at any other cursor position, they should navigate within the multi-line text box.

## Summary

The Atomic CLI already has an **in-memory prompt history** system in `src/ui/chat.tsx` (lines 1720-1723) that supports up/down arrow navigation through previously submitted prompts. However, this history is **session-scoped** — it is lost when the process exits. The spec `specs/tui-command-autocomplete-system.md` explicitly listed cross-session persistence as a non-goal, but the user now wants to add this feature.

The key components involved are:
1. **`src/ui/chat.tsx`** — The central hub for all input handling, keyboard events, cursor tracking, and prompt history state
2. **`@opentui/core` `TextareaRenderable`** — Provides `cursorOffset` (character offset) and `plainText` properties for cursor position tracking
3. **`src/ui/utils/conversation-history-buffer.ts`** — An existing NDJSON-based file persistence pattern that can serve as an architectural model
4. **`~/.atomic/` directory** — Already used for settings, tools, workflows, and tmp files — the natural home for `.command_history`

The current up/down arrow behavior uses a priority chain but does NOT check cursor position (cursor index 0). Instead, it checks broader application state (autocomplete visible, queue editing, streaming, etc.). The user's requirement to make history navigation conditional on cursor position at index 0 would be a new behavior distinct from the current implementation.

## Detailed Findings

### 1. Current In-Memory Prompt History System

**Location**: `src/ui/chat.tsx:1719-1723`

```typescript
// Prompt history for up/down arrow navigation
const [promptHistory, setPromptHistory] = useState<string[]>([]);
const [historyIndex, setHistoryIndex] = useState(-1);
// Store current input when entering history mode
const savedInputRef = useRef<string>("");
```

**Adding to history** (`src/ui/chat.tsx:4886-4890`):
```typescript
// Add to prompt history (avoid duplicates of last entry)
setPromptHistory(prev => {
  if (prev[prev.length - 1] === trimmedValue) return prev;
  return [...prev, trimmedValue];
});
setHistoryIndex(-1);
```

**Key behavior**:
- History is stored as a `string[]` in React state (in-memory only)
- New entries are appended on submit, with deduplication of the most recent entry
- `historyIndex` of `-1` means "not in history mode" (viewing current input)
- `savedInputRef` stores the current draft when entering history mode, restoring it when exiting

### 2. Current Up/Down Arrow Key Priority Chain

**Location**: `src/ui/chat.tsx:4253-4406`

The up/down arrow keys currently serve multiple purposes with the following priority chain:

| Priority | Condition | Behavior |
|----------|-----------|----------|
| 1 | `showAutocomplete && suggestions.length > 0` | Navigate autocomplete dropdown |
| 2 | `messageQueue.count > 0 && !isStreaming` (up only) | Navigate message queue |
| 3 | `isEditingQueue && messageQueue.count > 0` (down only) | Navigate message queue |
| 4 | `!showAutocomplete && !isEditingQueue && !isStreaming && queue empty && history.length > 0` | **Prompt history navigation (up)** |
| 5 | `!showAutocomplete && !isEditingQueue && !isStreaming && queue empty && historyIndex >= 0` | **Prompt history navigation (down)** |
| 6 | `!showAutocomplete && !isEditingQueue && !isStreaming && queue empty && input empty` | Scroll message scrollbox |

**Current prompt history up arrow handler** (`src/ui/chat.tsx:4339-4364`):
```typescript
if (event.name === "up" && !workflowState.showAutocomplete && !isEditingQueue && !isStreaming && messageQueue.count === 0 && promptHistory.length > 0) {
  const textarea = textareaRef.current;
  if (textarea) {
    const currentInput = textarea.plainText ?? "";
    if (historyIndex === -1) {
      // Entering history mode - save current input
      savedInputRef.current = currentInput;
      const newIndex = promptHistory.length - 1;
      setHistoryIndex(newIndex);
      textarea.gotoBufferHome();
      textarea.gotoBufferEnd({ select: true });
      textarea.deleteChar();
      textarea.insertText(promptHistory[newIndex]!);
    } else if (historyIndex > 0) {
      // Navigate to earlier prompt
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      textarea.gotoBufferHome();
      textarea.gotoBufferEnd({ select: true });
      textarea.deleteChar();
      textarea.insertText(promptHistory[newIndex]!);
    }
    return;
  }
}
```

**Important observation**: The current implementation does NOT check cursor position. Pressing up at any point in the text will trigger history navigation (when the other conditions are met). The user wants to change this so that history is only triggered when `cursorOffset === 0`.

### 3. Cursor Position Tracking

**Location**: `src/ui/chat.tsx` (various lines)

The `TextareaRenderable` ref provides cursor position via `cursorOffset`:

```typescript
const textareaRef = useRef<TextareaRenderable>(null);

// Reading cursor position:
textarea.cursorOffset     // number — character offset from start of text
textarea.plainText        // string — full text content

// Setting cursor position:
textarea.cursorOffset = newPosition;  // Direct assignment

// Movement methods:
textarea.gotoBufferHome()                       // Move to position 0
textarea.gotoBufferEnd({ select: true })        // Move to end, selecting all
```

The `onCursorChange` callback is used for tracking cursor changes:
```tsx
<textarea
  onCursorChange={handleTextareaCursorChange}
  // ...
/>
```

The `cursorOffset` property represents a character index from the beginning of the text (0-based). A value of `0` means the cursor is at the very beginning of the text input.

### 4. Textarea Text Replacement Pattern

The codebase uses a consistent pattern for replacing textarea content:
```typescript
textarea.gotoBufferHome();                    // Move cursor to start
textarea.gotoBufferEnd({ select: true });     // Select all text
textarea.deleteChar();                        // Delete selection
textarea.insertText(newContent);              // Insert new content
```

This pattern appears in: prompt history navigation (4349-4352, 4356-4360), queue editing (4270-4273), autocomplete completion (4447-4450), and submit clearing (4893-4896).

### 5. `~/.atomic/` Directory Usage Patterns

The `~/.atomic/` directory is already used for multiple persistence needs:

| Path | Purpose | File |
|------|---------|------|
| `~/.atomic/settings.json` | Global settings | `src/utils/settings.ts:58` |
| `~/.atomic/tools/` | Global custom tools | `src/sdk/tools/discovery.ts:51` |
| `~/.atomic/.tmp/` | Temporary files (MCP bridge, tool bundles) | `src/sdk/tools/opencode-mcp-bridge.ts:16` |
| `~/.atomic/workflows/sessions/` | Workflow session persistence | `src/workflows/session.ts:34` |

The pattern for creating/ensuring the directory exists:
```typescript
import { mkdirSync } from "node:fs";
mkdirSync(dir, { recursive: true });
```

### 6. Existing File Persistence Model: conversation-history-buffer.ts

**Location**: `src/ui/utils/conversation-history-buffer.ts`

This utility provides a reference architecture for append-only file persistence:

- **Format**: NDJSON (newline-delimited JSON) — one JSON object per line
- **Location**: `$TMPDIR/atomic-cli/history-{pid}.json` (session-scoped temp file)
- **Permissions**: `0o600` (owner read/write only)
- **Operations**: `appendToHistoryBuffer()`, `readHistoryBuffer()`, `clearHistoryBuffer()`, `replaceHistoryBuffer()`
- **Deduplication**: In-memory `Set<string>` of already-written IDs
- **Error handling**: Silent failures (best-effort writes)
- **Migration**: Detects and handles legacy JSON array format

This pattern can be adapted for command history by storing strings instead of `ChatMessage` objects.

### 7. Reference: Copilot CLI's `command-history-state.json`

**Found in**: `research/docs/2026-01-24-copilot-agent-detection-findings.md:211-224`

GitHub Copilot CLI stores command history in `~/.copilot/command-history-state.json`:
```json
{
  "commandHistory": [
    "explain the code",
    "/agent",
    "use explain-code to provide a two sentence overview of the repo",
    ...
  ]
}
```

This is a JSON file with a flat array of strings. No timestamps or metadata.

### 8. Reference: `~/.zsh_history` File Format

The `~/.zsh_history` file (with `EXTENDED_HISTORY` / `setopt EXTENDED_HISTORY`) uses this format:
```
: <timestamp>:<duration>;<command>
```

For example:
```
: 1707001234:0;ls -la
: 1707001345:0;git status
: 1707001456:0;echo "hello world"
```

**Key characteristics**:
- Each line starts with `: ` (colon space) prefix
- Timestamp is Unix epoch seconds
- Duration is wall-clock seconds (0 for instant commands)
- Command text follows the `;` separator
- Multi-line commands use `\` continuation at line endings
- Configurable max size via `HISTSIZE` (in-memory) and `SAVEHIST` (on disk)
- Deduplication options: `HIST_IGNORE_DUPS` (consecutive), `HIST_IGNORE_ALL_DUPS` (global)
- Navigation: up/down arrows cycle through entries, with cursor at the end of the recalled command
- Prefix search: `Ctrl+R` for reverse incremental search

**Simplified format for `.command_history`**: Since the Atomic CLI doesn't need duration tracking, a simplified NDJSON or line-based format would suffice.

### 9. TUI File Structure

**Core chat component**: `src/ui/chat.tsx` (monolithic ~5300 line file)
**Components**: `src/ui/components/` (autocomplete, dialogs, error screen, parts)
**Hooks**: `src/ui/hooks/` (streaming state, message queue, verbose mode, throttle)
**Utils**: `src/ui/utils/` (navigation, formatting, history buffer, message windowing)
**Commands**: `src/ui/commands/` (registry, builtin, agent, skill, workflow commands)
**Constants**: `src/ui/constants/` (icons, spacing)
**Entry point**: `src/ui/index.ts`

### 10. OpenTUI Input Handling Architecture

Based on research of the `anomalyco/opentui` repository:

- **`useKeyboard` hook** (`@opentui/react`): Registers a keyboard event handler that receives `KeyEvent` objects. Multiple `useKeyboard` hooks can coexist; events propagate unless `event.stopPropagation()` is called.
- **`KeyEvent` interface** (`@opentui/core`): Contains `name` (key identifier), `ctrl`, `shift`, `meta` (modifiers), `raw` (raw terminal escape sequence), and `stopPropagation()`.
- **`TextareaRenderable`** (`@opentui/core`): The ref type for `<textarea>` elements. Provides `plainText`, `cursorOffset`, `scrollY`, `insertText()`, `deleteChar()`, `gotoBufferHome()`, `gotoBufferEnd()`, `hasSelection()`, `getSelectedText()`.
- **`KeyBinding`** (`@opentui/core`): Declarative key binding configuration (name, modifiers → action like "submit" or "newline").
- **`<textarea>` component**: Built-in OpenTUI element with `keyBindings`, `onSubmit`, `onPaste`, `onContentChange`, `onCursorChange`, `wrapMode`, `maxHeight` props.

The textarea handles its own internal cursor movement (left/right/up/down within multi-line text) natively. The `useKeyboard` hook in the parent component fires BEFORE the textarea's internal handling, allowing the parent to intercept and prevent default behavior via early return.

### 11. Previous Design Decisions

**From** `specs/tui-command-autocomplete-system.md:69`:
> "We will NOT persist command history across sessions"

This was listed as a non-goal in the original autocomplete system spec. The current research is to reverse this decision and add cross-session persistence.

## Code References

- `src/ui/chat.tsx:1719-1723` — Prompt history state declarations
- `src/ui/chat.tsx:3856-4593` — Main `useKeyboard` handler
- `src/ui/chat.tsx:4253-4406` — Arrow key priority chain (autocomplete → queue → history → scroll)
- `src/ui/chat.tsx:4339-4364` — Up arrow prompt history handler
- `src/ui/chat.tsx:4366-4390` — Down arrow prompt history handler
- `src/ui/chat.tsx:4886-4890` — Adding submitted prompt to history
- `src/ui/chat.tsx:5254-5271` — Textarea JSX element with props
- `src/ui/chat.tsx:3795-3803` — Textarea key bindings configuration
- `src/ui/utils/conversation-history-buffer.ts:1-166` — NDJSON file persistence pattern
- `src/utils/settings.ts:55-64` — `~/.atomic/` path construction pattern
- `src/ui/utils/navigation.ts:1-30` — `navigateUp`/`navigateDown` helpers
- `specs/tui-command-autocomplete-system.md:69` — Original non-goal for cross-session history
- `research/docs/2026-01-24-copilot-agent-detection-findings.md:211-224` — Copilot CLI history format reference

## Architecture Documentation

### Current Keyboard Event Flow

```
Terminal Input
    │
    ▼
@opentui/core (parse raw input → KeyEvent)
    │
    ▼
useKeyboard handlers (parent → child propagation)
    │
    ├─► chat.tsx main handler (priority chain)
    │     ├─► Ctrl+C (always first)
    │     ├─► Ctrl+O, Ctrl+T, Ctrl+D
    │     ├─► Dialog skip check (activeQuestion || showModelSelector)
    │     ├─► ESC handling
    │     ├─► PageUp/PageDown
    │     ├─► Arrow keys (autocomplete → queue → history → scroll)
    │     ├─► Shift+Enter / Alt+Enter (newline)
    │     ├─► Tab (autocomplete completion)
    │     ├─► Enter (autocomplete execute / submit)
    │     └─► Ctrl+L (clear), Ctrl+Shift+T
    │
    ├─► Dialog handlers (model-selector, user-question) with stopPropagation()
    │
    └─► textarea internal handling (cursor movement, text input)
```

### Current Prompt History Data Flow

```
User submits text (handleSubmit)
    │
    ▼
setPromptHistory(prev => [...prev, trimmedValue])  // In-memory append
setHistoryIndex(-1)                                  // Reset to current
    │
    ▼
User presses Up arrow (when conditions met)
    │
    ├─► Save current input to savedInputRef
    ├─► Set historyIndex to last entry
    └─► Replace textarea content with history entry
    │
    ▼
User presses Down arrow (when historyIndex >= 0)
    │
    ├─► Navigate forward through history
    └─► If at end, restore savedInputRef and set historyIndex to -1
```

### Proposed Architecture: Persistent Command History

```
Startup
    │
    ▼
Read ~/.atomic/.command_history → parse → load into promptHistory state
    │
    ▼
User submits text (handleSubmit)
    │
    ├─► setPromptHistory(prev => [...prev, trimmedValue])  // In-memory
    └─► Append to ~/.atomic/.command_history file           // Persistent
    │
    ▼
User presses Up arrow at cursorOffset === 0
    │
    ├─► Check: textarea.cursorOffset === 0 ?
    │     ├─► YES: Navigate prompt history (existing behavior)
    │     └─► NO:  Let textarea handle (internal cursor movement within multi-line text)
    └─► ...
```

### Key Design Considerations for Implementation

1. **Cursor position check**: The `textarea.cursorOffset` property provides the character offset. Checking `cursorOffset === 0` before entering history mode would gate the behavior as requested.

2. **File format options**:
   - **Simple line-based** (like basic `.zsh_history`): One command per line, multi-line commands escaped with `\n` → `\\n`
   - **NDJSON** (like `conversation-history-buffer.ts`): `{"command":"...", "timestamp":...}` per line
   - **JSON array** (like Copilot's `command-history-state.json`): `{ "commandHistory": [...] }`

3. **Max history size**: Should be configurable. zsh defaults to HISTSIZE=1000, SAVEHIST=1000.

4. **Deduplication strategy**: Currently only deduplicates consecutive duplicates. Could optionally deduplicate globally (like zsh's `HIST_IGNORE_ALL_DUPS`).

5. **Where to put the new module**: A new file `src/ui/utils/command-history.ts` (or `src/ui/utils/prompt-history.ts`) following the pattern of `conversation-history-buffer.ts`.

6. **Loading on startup**: Read the file in a `useEffect` or initialization callback and populate `promptHistory` state.

7. **Interaction with existing priority chain**: The cursor position check (cursorOffset === 0) should be added to the existing up/down arrow history conditions at lines 4340 and 4367.

## Historical Context (from research/)

- `research/docs/2026-01-24-copilot-agent-detection-findings.md` — Documents Copilot CLI's `command-history-state.json` format as `{ "commandHistory": [...] }` — a flat array of strings
- `research/docs/2026-01-31-workflow-config-semantics.md:251` — Mentions `command-history-state.json` in the context of Copilot CLI's data directory structure
- `research/docs/2026-01-31-opentui-library-research.md` — Documents the OpenTUI component library used by the TUI

## Related Research

- `research/docs/2026-02-16-atomic-chat-architecture-current.md` — Current chat architecture documentation
- `research/docs/2026-02-16-chat-system-design-reference.md` — Chat system design reference
- `research/docs/2026-02-01-chat-tui-parity-implementation.md` — TUI feature parity research
- `specs/tui-command-autocomplete-system.md` — Original autocomplete spec (contains history non-goal)

## Open Questions

1. **File format choice**: Should `.command_history` use simple line-based format (like zsh), NDJSON (like conversation-history-buffer), or JSON (like Copilot)? Line-based is simplest and most shell-compatible; NDJSON allows metadata like timestamps.

2. **Max history entries**: What should the default limit be? (zsh defaults to 1000)

3. **Multi-line command handling**: When a user submits a multi-line prompt (using Shift+Enter), how should it be stored? Options: escape newlines, use NDJSON with the full string, or use a delimiter.

4. **Cursor position edge case**: When the textarea is empty, `cursorOffset` is 0 — should up arrow still enter history mode in this case? (This matches current behavior where empty input + up arrow scrolls messages, which would need to coexist.)

5. **Down arrow in multi-line text**: When the cursor is on the last line of a multi-line input and the user presses down, should this enter history mode (moving forward)? Or should it only work when text is empty / cursor is at position 0?

6. **Slash commands in history**: Should slash commands (e.g., `/clear`, `/help`) be excluded from the persistent history file?
