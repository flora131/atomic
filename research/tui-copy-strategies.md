# TUI Application Text Selection & Copy Strategies

## The Problem

When a TUI application enables mouse mode (e.g., `\x1b[?1000h`), the terminal emulator sends mouse events to the application instead of handling them natively. This **breaks native text selection** - users can't select and copy text using their mouse.

## Solution Strategies

### 1. **Temporarily Disable Mouse Mode (Most Common)**

**How it works:**
- Application monitors for specific key combinations (e.g., Shift+Modifier)
- When detected, temporarily send `\x1b[?1000l` to disable mouse tracking
- Terminal emulator now handles mouse events natively → text selection works
- Re-enable mouse mode when done: `\x1b[?1000h`

**Implementations:**
- **blessed**: `program.pause()` method disables mouse, switches to normal buffer
- **terminal-kit**: `term.grabInput(false)` releases mouse control
- Used by many TUI apps for spawning child processes or pausing

**Example flow:**
```javascript
// Normal operation - mouse enabled
process.stdout.write('\x1b[?1000h\x1b[?1006h');

// User presses special key to enter "selection mode"
function enterSelectionMode() {
  process.stdout.write('\x1b[?1000l\x1b[?1006l'); // Disable mouse
  // Now user can select text normally
}

// User exits selection mode
function exitSelectionMode() {
  process.stdout.write('\x1b[?1000h\x1b[?1006h'); // Re-enable mouse
}
```

### 2. **Use Shift Key Bypass (Terminal Feature)**

**How it works:**
- Many modern terminal emulators have a built-in feature:
  - Normal click → app gets mouse event
  - **Shift+click** → terminal handles natively (text selection)
- Application doesn't need to do anything special
- This is **terminal-dependent** behavior

**Supported in:**
- iTerm2: Shift+click for selection when app has mouse mode
- GNOME Terminal/VTE: Shift+click bypasses mouse mode
- Alacritty: Shift+click for selection
- Windows Terminal: Shift+click for selection
- kitty: Shift+click for selection

**Limitation:**
- Not universal - doesn't work in all terminals
- No programmatic control for the app

### 3. **Application-Level Selection with Copy Command**

**How it works:**
- App keeps mouse mode enabled
- Implements its own text selection using mouse events
- Provides keyboard shortcut (not Ctrl+C) to copy selected text
- App writes to system clipboard using platform-specific APIs

**Example:**
```javascript
// App tracks selection internally
let selectionStart = null;
let selectionEnd = null;

// On mouse down/drag, update selection
onMouseEvent(event) {
  if (event.type === 'mousedown') {
    selectionStart = {x: event.x, y: event.y};
  }
  if (event.type === 'drag') {
    selectionEnd = {x: event.x, y: event.y};
    renderSelection();
  }
}

// On Ctrl+Shift+C or custom keybind
onCopyShortcut() {
  const text = extractTextFromSelection();
  copyToClipboard(text); // Use clipboard API
}
```

**Pros:**
- Works in all terminals
- Full control over selection appearance
- Can implement custom selection logic

**Cons:**
- Can't use standard Ctrl+C (used for SIGINT)
- Requires clipboard library (clipboardy, copy-paste, etc.)
- More complex implementation

### 4. **Hybrid Approach**

**How it works:**
- Use Shift+click bypass when available (no code needed)
- Provide toggle key for selection mode (disable mouse mode)
- Document both methods for users

**Example:**
```
Usage:
- Shift+click: Select text (works in most modern terminals)
- Press 's': Enter selection mode (mouse mode off)
- Press Esc: Exit selection mode (mouse mode on)
```

### 5. **Use Alternative Screen Buffer**

**How it works:**
- Switch to normal buffer when user wants to copy
- Normal buffer preserves scrollback with selectable text
- Switch back to alternate buffer to resume

**Example:**
```javascript
// In alternate screen (app UI)
process.stdout.write('\x1b[?1049h'); // Enable alt screen

// User wants to copy from scrollback
function showScrollback() {
  process.stdout.write('\x1b[?1049l'); // Switch to normal screen
  // User can now scroll and select from normal buffer
}

// Resume app
function resumeApp() {
  process.stdout.write('\x1b[?1049h'); // Back to alt screen
}
```

## Detecting Copy Shortcuts

**Challenge:** Can't use Ctrl+C in raw mode (it's SIGINT)

**Common alternatives:**
- **Ctrl+Shift+C**: `\x1b[67;5u` (with modifyOtherKeys)
- **Cmd+C** (macOS): Often passed through by terminal
- **Custom key**: Alt+C, Ctrl+Y, etc.

**Detection in raw mode:**
```javascript
process.stdin.on('data', (data) => {
  // Ctrl+Shift+C might come as: \x1b[67;5u
  // Or in some terminals as different sequences
  
  if (isCtrlShiftC(data)) {
    handleCopy();
  }
});
```

## Recommended Approach for Modern TUI Apps

**Best practice (what most apps do):**

1. **Enable mouse mode by default** for interactive features
2. **Document Shift+click** for text selection (works in most terminals)
3. **Provide toggle key** (like 's' or '/') to enter selection mode:
   - Disable mouse tracking
   - Show message: "Selection mode - use mouse to select text"
   - Exit with Esc or same key
4. **Alternative**: Implement app-level selection with Ctrl+Shift+C

This gives users flexibility across different terminals while maintaining good UX.

