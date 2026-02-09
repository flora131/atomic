# TUI Text Selection & Copy Research - Executive Summary

## Summary

Terminal TUI applications face a fundamental challenge: **mouse mode and text selection are mutually exclusive**. When an app enables mouse tracking to capture clicks/drags for interactive features, the terminal stops handling mouse events for text selection. Users cannot select and copy text normally.

## Core Technical Details

### What is Mouse Mode?

Mouse mode instructs the terminal to send mouse events (clicks, drags, wheel) to the application as escape sequences instead of handling them natively. This enables interactive TUI features but **breaks native text selection**.

### Key Escape Sequences

**Enable Mouse Tracking:**
```bash
\x1b[?1000h    # VT200 mouse (button press/release)
\x1b[?1002h    # Cell motion (drag tracking)
\x1b[?1006h    # SGR mouse mode (modern format)
```

**Disable Mouse Tracking:**
```bash
\x1b[?1000l
\x1b[?1002l
\x1b[?1006l
```

**Screen Buffer Control:**
```bash
\x1b[?1049h    # Enter alternate screen
\x1b[?1049l    # Exit to normal screen
```

**Mouse Event Format (SGR):**
```
Press:   \x1b[<0;10;5M   (button 0, x=10, y=5)
Release: \x1b[<0;10;5m
```

## Solution Strategies

### 1. Shift+Click Bypass ⭐ (Easiest)

**How:** Modern terminals allow Shift+click to bypass mouse mode for selection.

**Pros:**
- Zero code required
- Natural for users

**Cons:**
- Not universal (doesn't work in all terminals)
- No programmatic control

**Supported Terminals:**
- ✅ iTerm2, Terminal.app (macOS)
- ✅ GNOME Terminal, Alacritty
- ✅ Windows Terminal, kitty, WezTerm
- ❌ Some older terminals

**Code:**
```javascript
// Just enable mouse mode and document Shift+click
process.stdout.write('\x1b[?1000h\x1b[?1006h');
console.log('Hold Shift and drag to select text');
```

---

### 2. Selection Mode Toggle ⭐⭐ (Most Reliable)

**How:** Provide hotkey to toggle between mouse mode and selection mode.

**Pros:**
- Works in ALL terminals
- Clear user control
- Simple to implement

**Cons:**
- Requires user action
- Need to communicate feature

**Code:**
```javascript
let selectionMode = false;

function toggleSelectionMode() {
  selectionMode = !selectionMode;
  
  if (selectionMode) {
    // Disable mouse → terminal handles selection
    process.stdout.write('\x1b[?1000l\x1b[?1006l');
    showMessage('Selection mode ON - select text with mouse');
  } else {
    // Re-enable mouse → app handles mouse
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    showMessage('Mouse mode ON - interactive controls');
  }
}

// In input handler
process.stdin.on('data', (data) => {
  if (data.toString() === 's') {
    toggleSelectionMode();
  }
});
```

**Used by:** blessed (`program.pause()`), many TUI apps

---

### 3. Application-Level Selection (Full Control)

**How:** App implements its own text selection using mouse events and copies to system clipboard.

**Pros:**
- Works universally
- Full control over UX
- Can add custom features

**Cons:**
- Complex implementation
- Requires clipboard library
- Can't use Ctrl+C (conflicts with SIGINT)

**Code:**
```javascript
const clipboardy = require('clipboardy');

class Selection {
  constructor() {
    this.start = null;
    this.end = null;
  }
  
  onMouseDown(x, y) {
    this.start = {x, y};
  }
  
  onMouseDrag(x, y) {
    this.end = {x, y};
    this.renderHighlight();
  }
  
  copy() {
    const text = this.extractText();
    clipboardy.writeSync(text);
  }
}

// Use Ctrl+Shift+C or custom keybind to copy
```

**Used by:** terminal-kit's `TextBuffer`, sophisticated TUI apps

---

### 4. Pause & Resume (blessed approach)

**How:** Temporarily exit to normal screen buffer where text selection works.

**Code:**
```javascript
function pause() {
  disableMouse();
  process.stdout.write('\x1b[?1049l'); // Normal buffer
  console.log('Paused - select and copy text, press any key to resume');
  
  return function resume() {
    process.stdout.write('\x1b[?1049h'); // Alt buffer
    enableMouse();
  };
}
```

**Used by:** blessed, apps that spawn subprocesses

---

## Recommended Approach (Hybrid) ⭐⭐⭐

Combine multiple strategies for best UX:

```javascript
class TUIApp {
  constructor() {
    this.enableMouse();
    this.showHelp();
  }
  
  showHelp() {
    console.log('╔═ Copy Text ═══════════════════════════════╗');
    console.log('║ 1. Shift+Click (works in modern terminals)║');
    console.log('║ 2. Press [s] to toggle selection mode     ║');
    console.log('║ 3. Press [q] to quit and scroll back      ║');
    console.log('╚════════════════════════════════════════════╝');
  }
  
  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    
    if (this.selectionMode) {
      this.disableMouse();
      this.showStatus('📋 SELECTION MODE - Select text with mouse');
    } else {
      this.enableMouse();
      this.showStatus('🖱️  MOUSE MODE - Interactive controls');
    }
  }
  
  enableMouse() {
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
  }
  
  disableMouse() {
    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
  }
}
```

## Framework-Specific Implementations

### Blessed
```javascript
const blessed = require('blessed');
const screen = blessed.screen({ smartCSR: true, mouse: true });

// Method 1: Toggle mouse
screen.key('s', () => {
  if (mouseEnabled) {
    screen.program.disableMouse();
  } else {
    screen.program.enableMouse();
  }
});

// Method 2: Pause/resume
screen.key('p', () => {
  const resume = screen.program.pause();
  process.stdin.once('data', resume);
});
```

### Terminal-Kit
```javascript
const term = require('terminal-kit').terminal;

term.grabInput({ mouse: 'drag' }); // Enable

// Toggle
function toggleSelection() {
  if (mouseEnabled) {
    term.grabInput(false); // Disable
  } else {
    term.grabInput({ mouse: 'drag' }); // Enable
  }
}
```

### Ink (React for CLIs)
```javascript
import { useEffect } from 'react';

function App() {
  const [selectionMode, setSelectionMode] = useState(false);
  
  useEffect(() => {
    // Ink doesn't have built-in mouse support
    // Manually send escape sequences
    const seq = selectionMode ? '\x1b[?1000l' : '\x1b[?1000h';
    process.stdout.write(seq);
  }, [selectionMode]);
  
  // Toggle with 's' key
}
```

## Mouse Protocol Evolution

```
X10 (1987) → VT200 (1988) → Cell Motion (2002) → SGR (2006)
   ↓             ↓                ↓                  ↓
Press only    + Release      + Drag events    Modern format
```

**Recommended:** VT200 (`?1000`) + SGR (`?1006`) for compatibility

## Complete Escape Sequence Reference

| Feature | Enable | Disable | Description |
|---------|--------|---------|-------------|
| VT200 Mouse | `\x1b[?1000h` | `\x1b[?1000l` | Button press/release |
| Cell Motion | `\x1b[?1002h` | `\x1b[?1002l` | Drag tracking |
| All Motion | `\x1b[?1003h` | `\x1b[?1003l` | All mouse movement |
| SGR Format | `\x1b[?1006h` | `\x1b[?1006l` | Modern coordinates |
| Alt Screen | `\x1b[?1049h` | `\x1b[?1049l` | Full-screen mode |
| Bracketed Paste | `\x1b[?2004h` | `\x1b[?2004l` | Detect pasted text |
| Cursor | `\x1b[?25h` | `\x1b[?25l` | Show/hide cursor |

## Key Insights from Research

1. **blessed** uses `program.pause()` which:
   - Disables mouse: `disableMouse()`
   - Switches to normal buffer: `normalBuffer()`
   - Shows cursor: `showCursor()`
   - Returns resume function

2. **terminal-kit** provides:
   - `grabInput({ mouse: 'button'|'drag'|'motion' })` to enable
   - `grabInput(false)` to disable
   - Higher-level components like `TextBuffer` handle selection internally

3. **Ink** doesn't have built-in mouse support:
   - Must manually write escape sequences
   - Use `useStdin()` hook to read input
   - Detect mouse events by parsing escape sequences

4. **Shift+click bypass** is a terminal feature, not app-controlled:
   - Works in iTerm2, GNOME Terminal, Alacritty, Windows Terminal, kitty
   - App just needs to document it

## Testing

Created working examples at:
- `/tmp/test_mouse_mode.js` - Interactive demo
- `/tmp/complete_example.js` - Full implementation

Run with: `node /tmp/complete_example.js`

## References

- blessed source: `lib/program.js` - mouse handling, pause/resume
- terminal-kit: `lib/termconfig/xterm.js` - escape sequences
- Terminal escape sequences: ECMA-48 standard
- SGR mouse mode: Introduced by xterm, widely supported

---

## Quick Start: Add Text Selection to Your TUI

```javascript
// 1. Enable mouse mode
process.stdout.write('\x1b[?1000h\x1b[?1006h');

// 2. Add selection mode toggle
let selectionMode = false;
process.stdin.on('data', (data) => {
  if (data.toString() === 's') {
    selectionMode = !selectionMode;
    const seq = selectionMode ? '\x1b[?1000l' : '\x1b[?1000h';
    process.stdout.write(seq + '\x1b[?1006' + (selectionMode ? 'l' : 'h'));
  }
});

// 3. Show help text
console.log('Copy text: Shift+Click or press [s] for selection mode');

// 4. Cleanup on exit
process.on('exit', () => {
  process.stdout.write('\x1b[?1000l\x1b[?1006l');
});
```

That's it! Your TUI now supports text selection. 🎉
