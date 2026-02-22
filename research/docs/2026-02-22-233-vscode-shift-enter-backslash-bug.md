---
date: 2026-02-22 02:59:49 UTC
researcher: Copilot
git_commit: c9492ea791f23ee999fe04824d4d8e89a9229f36
branch: lavaman131/hotfix/vscode-term-newline
repository: atomic
topic: "[BUG] Shift+Enter produces backslash instead of newline in VS Code terminal (Issue #233)"
tags: [research, codebase, shift-enter, vscode, copilot, opentui, keyboard-input, kitty-protocol]
status: complete
last_updated: 2026-02-22
last_updated_by: Copilot
---

# Research: Shift+Enter Backslash Bug in VS Code Terminal (Issue #233)

## Research Question

Why does pressing Shift+Enter in the Atomic TUI (VS Code integrated terminal) produce a backslash (`\`) instead of a newline? Focus on the Copilot agent path. How does OpenCode handle Shift+Enter with OpenTUI as a working reference?

## Summary

The bug occurs because the **VS Code integrated terminal does NOT send a distinguishable escape sequence for Shift+Enter** in its default mode. Without the Kitty keyboard protocol enabled, VS Code's xterm.js sends a plain `\r` (carriage return) for both Enter and Shift+Enter — meaning Shift+Enter is indistinguishable from Enter. The backslash character appearing is the result of some terminals or keyboard layouts mapping Shift+Enter to a literal `\` character that gets inserted into the textarea before Enter fires, triggering the existing backslash line-continuation fallback (lines 5357-5371 in `src/ui/chat.tsx`).

The input handling is **agent-agnostic** — Copilot, OpenCode, and Claude all share the same keyboard handling code path through the shared `<textarea>` component in `src/ui/chat.tsx`. The issue is not Copilot-specific at the SDK level; it's a terminal escape sequence interpretation issue in the shared UI layer.

OpenTUI (used by both Atomic and OpenCode) handles this through a **multi-protocol fallback chain**: Kitty keyboard protocol → modifyOtherKeys mode → standard ANSI. The Atomic TUI already enables Kitty keyboard protocol via `useKittyKeyboard: { disambiguate: true }`, but VS Code requires the user to enable `terminal.integrated.enableKittyKeyboardProtocol: true` in VS Code settings for the protocol to actually work.

## Detailed Findings

### 1. Root Cause Analysis

#### What happens when Shift+Enter is pressed in VS Code terminal

1. **VS Code default mode**: xterm.js does NOT send a special escape sequence for Shift+Enter. It sends the same `\r` as a regular Enter key.
2. **Some terminal/keyboard combos**: Shift+Enter may produce a `\` character followed by `\r`, which OpenTUI receives as two separate events — a backslash character insertion, then a return key event.
3. **The backslash fallback fires**: At `src/ui/chat.tsx:5361`, the `handleSubmit()` function detects a trailing `\` and converts it to a newline instead of submitting — this is the "line continuation" workaround that was specifically designed for this VS Code behavior.

**Key code path** (`src/ui/chat.tsx:5357-5371`):
```typescript
// Line continuation: trailing \ before Enter inserts a newline instead of submitting.
// This serves as a universal fallback for terminals where Shift+Enter
// sends "\" followed by Enter (e.g., VSCode integrated terminal).
// Only applies when the terminal doesn't support the Kitty keyboard protocol.
if (!kittyKeyboardDetectedRef.current && value.endsWith("\\")) {
  const textarea = textareaRef.current;
  if (textarea) {
    const newValue = value.slice(0, -1) + "\n";
    textarea.gotoBufferHome();
    textarea.gotoBufferEnd({ select: true });
    textarea.deleteChar();
    textarea.insertText(newValue);
  }
  return;
}
```

#### Why the bug manifests

The backslash continuation logic at line 5361 is only supposed to fire when:
1. Kitty keyboard protocol is NOT detected (`!kittyKeyboardDetectedRef.current`)
2. The input ends with `\`

The bug reported in issue #233 is that users **see the backslash in the input area** rather than it being cleanly converted. This suggests one of:
- The backslash is being inserted as a visible character by OpenTUI before the return event fires, creating a visual artifact
- The timing between the `\` insertion and the Enter event processing causes the backslash to briefly appear
- Multiple backslashes accumulate when pressing Shift+Enter repeatedly

### 2. Current Shift+Enter Detection Strategies (5 levels)

The codebase implements 5 detection strategies in `src/ui/chat.tsx`:

| # | Strategy | Code Location | Condition | Works in VS Code? |
|---|----------|--------------|-----------|-------------------|
| 1 | Kitty protocol direct | Lines 4909 | `event.shift \|\| event.meta` on return/linefeed | ❌ Not without VS Code setting |
| 2 | Ctrl+J universal fallback | Line 4910 | `event.name === "linefeed"` without modifiers | ✅ Always works |
| 3 | CSI u escape sequence | Line 4911 | Raw ends with `u`, matches `\x1b[(?:13\|10)` | ❌ Not without Kitty protocol |
| 4 | Shifted return in raw | Line 4912 | Raw contains `;2` and isn't plain `\r`/`\n` | ❌ Not without Kitty protocol |
| 5 | Backslash continuation | Lines 5361-5370 | Input ends with `\`, Kitty not detected | ⚠️ Works but shows `\` artifact |

**Key bindings defined** (`src/ui/chat.tsx:4189-4197`):
```typescript
const textareaKeyBindings: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "linefeed", action: "newline" },
  { name: "return", shift: true, action: "newline" },
  { name: "linefeed", shift: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "linefeed", meta: true, action: "newline" },
];
```

### 3. Renderer Initialization — Kitty Protocol Enabled

**`src/ui/index.ts:1640-1647`**:
```typescript
state.renderer = await createCliRenderer({
  useMouse: true,
  enableMouseMovement: false,
  openConsoleOnError: false,
  useAlternateScreen: true,
  exitOnCtrlC: false,
  useKittyKeyboard: { disambiguate: true },
});
```

The Atomic TUI **does request** Kitty keyboard protocol support. The issue is that VS Code's xterm.js only responds to this request if the user has enabled `terminal.integrated.enableKittyKeyboardProtocol: true` in VS Code settings.

### 4. Agent-Agnostic Architecture

**Critical finding**: The keyboard input handling is completely agent-agnostic. All three agents (Copilot, OpenCode, Claude) use the same:
- `<textarea>` component (`src/ui/chat.tsx:5774`)
- Key bindings (`textareaKeyBindings` at line 4190)
- Shift+Enter detection logic (lines 4900-4920)
- Backslash fallback (lines 5357-5371)
- `handleSubmit()` function (line 5348)

The only Copilot-specific code in the input path is Ralph panel dismissal (`lines 5432-5441`), which is irrelevant to this bug.

### 5. How OpenCode Handles Shift+Enter with OpenTUI

#### OpenTUI's Multi-Protocol Input System

**Key files in `anomalyco/opentui`**:
- `packages/core/src/lib/parse.keypress.ts` — Main key parsing logic
- `packages/core/src/lib/stdin-buffer.ts` — Input buffering for fragmented sequences
- `packages/core/src/zig/terminal.zig` — Terminal capability detection
- `packages/core/src/lib/keymapping.ts` — Keybinding system

**Protocol fallback chain**:
1. **Kitty Keyboard Protocol** (preferred): Sends `\x1b[13;2u` for Shift+Enter
2. **modifyOtherKeys Mode** (fallback): Sends `\x1b[27;2;13~` for Shift+Enter
3. **Standard ANSI** (universal): No way to distinguish Shift+Enter from Enter

**OpenTUI's parseKeypress() processing order**:
```
Raw input → StdinBuffer → parseKeypress():
  1. Filter non-keyboard events (mouse, terminal responses)
  2. Try Kitty protocol parsing (parseKittyKeyboard())
  3. Try modifyOtherKeys parsing
  4. Parse standard ANSI sequences
  5. Parse raw ASCII/UTF-8
```

**Terminal capability detection**: OpenTUI queries the terminal for supported features at startup (`terminal.zig:processCapabilityResponse()`) and enables the best available protocol.

#### OpenCode's Direct Implementation

**Desktop app** (`packages/app/src/components/prompt-input.tsx`):
```typescript
if (event.key === "Enter" && event.shiftKey) {
  addPart("\n");
  event.preventDefault();
  return;
}
```

**TUI app**: Uses OpenTUI's `TextareaRenderable` with default keybindings:
```typescript
{ name: "return", shift: true, action: "newline" }
```

**OpenCode documents** that users on Windows Terminal need to configure:
```json
{
  "actions": [{
    "command": { "action": "sendInput", "input": "\u001b[27;2;13~" },
    "keys": "shift+enter"
  }]
}
```

### 6. VS Code Terminal Escape Sequence Behavior

| Key Combo | VS Code Default | VS Code + Kitty Protocol | Standard Terminal |
|-----------|----------------|--------------------------|-------------------|
| Enter | `\r` | `\x1b[13u` | `\r` |
| Shift+Enter | `\r` (same!) | `\x1b[13;2u` | `\r` (same!) |
| Alt+Enter | `\x1b\r` | `\x1b[13;3u` | `\x1b\r` |
| Ctrl+J | `\n` (0x0A) | `\x1b[106;5u` | `\n` (0x0A) |

**VS Code setting to enable Kitty protocol**:
```json
{ "terminal.integrated.enableKittyKeyboardProtocol": true }
```

## Code References

- `src/ui/chat.tsx:4189-4197` — Textarea key bindings (Shift+Enter → newline)
- `src/ui/chat.tsx:4250-4256` — Kitty keyboard protocol detection
- `src/ui/chat.tsx:4900-4920` — Multi-strategy Shift+Enter detection
- `src/ui/chat.tsx:5348-5380` — handleSubmit() with backslash fallback
- `src/ui/chat.tsx:5357-5371` — Backslash line continuation fallback (the "workaround")
- `src/ui/chat.tsx:5774-5791` — Textarea JSX with keyBindings prop
- `src/ui/chat.tsx:3166-3167` — textareaRef and kittyKeyboardDetectedRef
- `src/ui/index.ts:1640-1647` — Renderer creation with `useKittyKeyboard: { disambiguate: true }`
- `src/sdk/clients/copilot.ts:734-775` — Copilot HITL input handler (not related to keyboard)

## Architecture Documentation

### Input Flow (all agents)
```
Terminal → stdin → OpenTUI StdinBuffer → parseKeypress() → KeyEvent
  → useKeyboard() hook (src/ui/chat.tsx:4250)
    → Kitty protocol detection (line 4254)
    → Shift+Enter detection (lines 4900-4920)
      → textarea.insertText("\n") if detected
    → Falls through to textarea component
  → <textarea> component (line 5774)
    → keyBindings match → "submit" action → handleSubmit()
      → Backslash fallback check (line 5361)
      → Send message to SDK client
```

### Why the Bug is Not Copilot-Specific
The `agentType` prop is only used for:
- Display suffixes (line 3411)
- Ralph panel state management (lines 3870, 5405, 5432)
- Never for keyboard input processing

## Historical Context (from research/)

- `research/docs/2026-02-14-opencode-opentui-sdk-research.md` — Previous research on OpenCode/OpenTUI integration
- `research/docs/2026-02-16-opentui-deepwiki-research.md` — OpenTUI architecture research
- `research/docs/2026-02-16-opencode-deepwiki-research.md` — OpenCode architecture research
- `research/docs/2026-02-22-vscode-shift-enter-escape-sequences.md` — VS Code escape sequence research (created during this investigation)
- `research/docs/2026-02-22-opentui-key-handling.md` — OpenTUI key handling research (created during this investigation)

## Related Research

- `research/docs/2026-02-22-vscode-shift-enter-escape-sequences.md` — Detailed VS Code/xterm.js escape sequence analysis
- `research/docs/2026-02-22-opentui-key-handling.md` — OpenTUI keyboard input handling deep dive

## Open Questions

1. **Is the backslash visual artifact the actual bug?** The backslash continuation fallback exists and works, but users see `\` characters in the input area. Is the issue that the `\` should be intercepted before it's displayed, or that the fallback should work differently?
2. **Should Atomic detect VS Code and show a hint?** When `TERM_PROGRAM=vscode` is detected and Kitty protocol is not available, should the TUI show a message suggesting the user enable `terminal.integrated.enableKittyKeyboardProtocol`?
3. **Can OpenTUI's modifyOtherKeys fallback help?** OpenTUI supports modifyOtherKeys mode as a second-tier fallback. Does VS Code's xterm.js respond to modifyOtherKeys requests, which could provide Shift+Enter disambiguation without requiring the Kitty protocol setting?
4. **Is the Kitty protocol query actually failing silently?** The renderer enables `useKittyKeyboard: { disambiguate: true }`, which should send the protocol enablement escape sequence. If VS Code doesn't support it (without the setting), does the query fail silently or does VS Code respond negatively?
