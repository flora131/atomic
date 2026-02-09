# Comprehensive Guide: Text Selection & Copy in Terminal TUI Applications

## Table of Contents
1. [The Problem](#the-problem)
2. [What is Mouse Mode?](#what-is-mouse-mode)
3. [Terminal Escape Sequences](#terminal-escape-sequences)
4. [Solution Strategies](#solution-strategies)
5. [Practical Implementation](#practical-implementation)
6. [Framework-Specific Examples](#framework-specific-examples)

---

## The Problem

Terminal TUI applications face a fundamental conflict:
- **Interactive features** (clickable buttons, draggable elements) require mouse tracking
- **Text selection** requires the terminal to handle mouse events natively
- **Both cannot work simultaneously** - only one can process mouse events

When a TUI app enables mouse mode, the terminal sends mouse events to the application as escape sequences instead of handling them for text selection. This means:
- Users cannot drag to select text
- Ctrl+C / Cmd+C doesn't copy selected text (because there's no selection)
- The terminal emulator's native selection UI doesn't appear

---

## What is Mouse Mode?

**Mouse mode** is a terminal feature where mouse events (clicks, drags, wheel) are captured and sent to the running application as input data, rather than being handled by the terminal emulator itself.

### How It Works

1. **Without mouse mode** (default):
   - Click & drag → terminal selects text visually
   - Wheel → terminal scrolls buffer
   - Right-click → terminal context menu
   
2. **With mouse mode enabled**:
   - Click & drag → application receives escape sequences like `\x1b[<0;10;5M`
   - Wheel → application receives wheel up/down events
   - Right-click → application receives right button events
   - **Text selection is broken** - terminal doesn't handle mouse for selection

### Mouse Tracking Hierarchy

Mouse protocols have evolved over time, each adding more capabilities:

```
X10 Mouse (1987)
  └─ VT200 Mouse (1988) - added button release
       └─ Button Event Tracking (1998)
            └─ Cell Motion Tracking (2002) - drag events
                 └─ All Motion Tracking (2002) - all movement
                      └─ UTF-8 Mouse (2005) - large terminals
                           └─ SGR Mouse (2006) - modern, reliable
                                └─ URXVT Mouse (2008) - rxvt variant
```

---

## Terminal Escape Sequences

### Mouse Tracking Modes

All mouse escape sequences follow the pattern: `ESC [ ? N h/l`
- `h` = enable (set)
- `l` = disable (reset)
- `N` = mode number

| Mode | Escape Code | Description | Event Types |
|------|-------------|-------------|-------------|
| X10 | `\x1b[?9h` / `\x1b[?9l` | Basic clicks only | Press only |
| VT200 | `\x1b[?1000h` / `\x1b[?1000l` | Button press & release | Press, Release |
| Button Event | `\x1b[?1001h` / `\x1b[?1001l` | Highlight tracking | Press, Release |
| Cell Motion | `\x1b[?1002h` / `\x1b[?1002l` | Drag events | Press, Release, Drag |
| All Motion | `\x1b[?1003h` / `\x1b[?1003l` | All mouse movement | Press, Release, Move |
| UTF-8 | `\x1b[?1005h` / `\x1b[?1005l` | UTF-8 coordinates | (extends others) |
| SGR | `\x1b[?1006h` / `\x1b[?1006l` | Modern format | (extends others) |
| URXVT | `\x1b[?1015h` / `\x1b[?1015l` | rxvt-unicode format | (extends others) |

### Mouse Event Format

**SGR Mouse Mode** (recommended, most reliable):
```
Press:   ESC [ < button ; x ; y M
Release: ESC [ < button ; x ; y m
```

Example: `\x1b[<0;10;5M` = left button press at column 10, row 5

**Button codes:**
- `0` = Left button
- `1` = Middle button
- `2` = Right button  
- `64` = Wheel up
- `65` = Wheel down

### Other Related Escape Sequences

**Alternate Screen Buffer:**
```bash
# Enter alternate screen (save cursor, clear screen)
\x1b[?1049h

# Exit alternate screen (restore original content)
\x1b[?1049l
```

**Bracketed Paste Mode:**
```bash
# Enable
\x1b[?2004h

# Pasted content comes as:
\x1b[200~actual pasted text\x1b[201~

# Disable
\x1b[?2004l
```

**Cursor Visibility:**
```bash
\x1b[?25h   # Show cursor
\x1b[?25l   # Hide cursor
```

**Screen Clearing:**
```bash
\x1b[2J     # Clear entire screen
\x1b[H      # Move cursor to top-left (home)
\x1b[2J\x1b[H  # Clear and home (common combo)
```

---

## Solution Strategies

### Strategy 1: Shift+Click Bypass (Easiest, Terminal-Dependent)

**How it works:**
- Most modern terminals have built-in bypass: Shift+click ignores mouse mode
- Application does nothing special - just enable mouse mode normally
- Users hold Shift while clicking/dragging to select text

**Pros:**
- Zero code required from application
- Natural UX for users familiar with modern terminals

**Cons:**
- Not universal - doesn't work in all terminals
- No visual indicator that Shift is needed
- No way to detect if terminal supports it

**Terminal Support:**
- ✅ iTerm2
- ✅ Terminal.app (macOS)
- ✅ GNOME Terminal / VTE-based
- ✅ Alacritty
- ✅ Windows Terminal
- ✅ kitty
- ✅ WezTerm
- ❌ Some older terminals (xterm, rxvt)

**Implementation:**
```javascript
// Just enable mouse mode normally
process.stdout.write('\x1b[?1000h'); // VT200
process.stdout.write('\x1b[?1006h'); // SGR format

// Document in help text:
console.log('To copy text: Hold Shift while selecting with mouse');
```

---

### Strategy 2: Selection Mode Toggle (Most Reliable)

**How it works:**
- Provide a hotkey (e.g., 's' or '/') to toggle "selection mode"
- When enabled: disable mouse tracking → terminal handles selection
- When disabled: re-enable mouse tracking → app gets mouse events

**Pros:**
- Works in ALL terminals
- Clear indication of current mode
- User has full control

**Cons:**
- Requires extra user action (press key)
- Need to communicate the feature to users
- State management in app

**Implementation:**
```javascript
let mouseEnabled = true;
let selectionMode = false;

function enableMouse() {
  process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
  mouseEnabled = true;
}

function disableMouse() {
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
  mouseEnabled = false;
}

function toggleSelectionMode() {
  selectionMode = !selectionMode;
  
  if (selectionMode) {
    disableMouse();
    showMessage('Selection mode ON - select and copy text with mouse');
  } else {
    enableMouse();
    showMessage('Selection mode OFF - mouse controls app');
  }
}

// In input handler
process.stdin.on('data', (data) => {
  if (data.toString() === 's') {
    toggleSelectionMode();
  }
});
```

**Used by:**
- blessed's `program.pause()` method
- Many TUI apps with 'copy mode' or 'selection mode'

---

### Strategy 3: Application-Level Selection (Full Control)

**How it works:**
- Keep mouse mode enabled at all times
- Implement text selection within the application using mouse events
- Provide custom keyboard shortcut (e.g., Ctrl+Shift+C) to copy selected text
- Use system clipboard API to actually copy the text

**Pros:**
- Works universally
- Can implement custom selection UI (colors, styles)
- Can restrict what's selectable
- Can add selection-related features (copy formats, etc.)

**Cons:**
- Most complex to implement
- Requires clipboard library
- Can't use standard Ctrl+C (conflicts with SIGINT)
- Must handle all edge cases (word selection, line selection, etc.)

**Implementation:**
```javascript
const clipboardy = require('clipboardy'); // npm install clipboardy

class Selection {
  constructor() {
    this.start = null;
    this.end = null;
    this.active = false;
  }
  
  onMouseDown(x, y) {
    this.start = {x, y};
    this.end = {x, y};
    this.active = true;
  }
  
  onMouseDrag(x, y) {
    if (this.active) {
      this.end = {x, y};
      this.render();
    }
  }
  
  onMouseUp() {
    this.active = false;
  }
  
  getText() {
    // Extract text from buffer between start and end
    return extractTextFromBuffer(this.start, this.end);
  }
  
  render() {
    // Highlight selected region with inverse colors
    // (implementation depends on rendering system)
  }
}

const selection = new Selection();

// Mouse event handlers
function handleMouseEvent(event) {
  if (event.type === 'mousedown') {
    selection.onMouseDown(event.x, event.y);
  } else if (event.type === 'drag') {
    selection.onMouseDrag(event.x, event.y);
  } else if (event.type === 'mouseup') {
    selection.onMouseUp();
  }
}

// Copy shortcut (Ctrl+Shift+C)
function handleKeyPress(key) {
  if (isCtrlShiftC(key)) {
    const text = selection.getText();
    clipboardy.writeSync(text);
    showMessage('Copied to clipboard!');
  }
}
```

**Used by:**
- terminal-kit's `TextBuffer` and `EditableTextBox`
- Some sophisticated TUI apps with rich text features

---

### Strategy 4: Pause & Resume (blessed approach)

**How it works:**
- Provide command to "pause" the application
- When paused:
  - Switch to normal screen buffer
  - Disable mouse mode
  - Show cursor
  - Display message about how to resume
- User can select/copy from normal terminal
- Press key to resume application

**Pros:**
- Clean separation of concerns
- Preserves scrollback buffer for copying
- User has familiar terminal environment for copying

**Cons:**
- Disrupts application flow
- Can't see live updates while paused
- More jarring UX

**Implementation:**
```javascript
function pause() {
  // Save state
  const savedCursor = getCursorPosition();
  const wasMouseEnabled = mouseEnabled;
  
  // Disable everything
  disableMouse();
  process.stdout.write('\x1b[?1049l'); // Normal buffer
  process.stdout.write('\x1b[?25h');   // Show cursor
  
  // Message
  console.log('\n\n=== Application Paused ===');
  console.log('You can now scroll and select text normally.');
  console.log('Press any key to resume...\n');
  
  // Disable raw mode temporarily
  process.stdin.setRawMode(false);
  
  // Return resume function
  return function resume() {
    process.stdin.setRawMode(true);
    process.stdout.write('\x1b[?1049h'); // Alt buffer
    if (wasMouseEnabled) enableMouse();
    restoreCursorPosition(savedCursor);
  };
}

// Usage
process.stdin.on('data', (data) => {
  if (data.toString() === 'p') { // Pause
    const resume = pause();
    
    // Wait for any key
    process.stdin.once('data', () => {
      resume();
    });
  }
});
```

**Used by:**
- blessed: `program.pause()`
- Apps that spawn subprocesses

---

### Strategy 5: Hybrid Approach (Recommended)

Combine multiple strategies for best user experience:

```javascript
class CopySupport {
  constructor() {
    this.mouseEnabled = false;
    this.selectionMode = false;
  }
  
  init() {
    this.enableMouse();
    this.showHelpMessage();
  }
  
  showHelpMessage() {
    console.log('┌─ Copy Text ─────────────────────────────────┐');
    console.log('│ Method 1: Shift+Click (most terminals)     │');
    console.log('│ Method 2: Press [s] for selection mode     │');
    console.log('│ Method 3: Press [q] to quit and scroll back│');
    console.log('└─────────────────────────────────────────────┘');
  }
  
  handleKey(key) {
    if (key === 's') {
      this.toggleSelectionMode();
    }
  }
  
  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    
    if (this.selectionMode) {
      this.disableMouse();
      this.showStatusBar('📋 SELECTION MODE - Select text with mouse');
    } else {
      this.enableMouse();
      this.showStatusBar('🖱️  MOUSE MODE - Interactive controls');
    }
  }
  
  enableMouse() {
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    this.mouseEnabled = true;
  }
  
  disableMouse() {
    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
    this.mouseEnabled = false;
  }
}
```

---

## Practical Implementation

### Complete Working Example

```javascript
#!/usr/bin/env node
const readline = require('readline');

class TUIWithCopySupport {
  constructor() {
    this.mouseEnabled = false;
    this.selectionMode = false;
    this.content = this.generateContent();
    
    this.setupTerminal();
  }
  
  setupTerminal() {
    // Enable raw mode for character-by-character input
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    // Enter alternate screen buffer
    process.stdout.write('\x1b[?1049h');
    
    // Hide cursor
    process.stdout.write('\x1b[?25l');
    
    // Enable mouse
    this.enableMouse();
    
    // Setup handlers
    process.stdin.on('data', this.handleInput.bind(this));
    process.on('exit', this.cleanup.bind(this));
    process.on('SIGINT', () => process.exit(0));
    
    this.render();
  }
  
  enableMouse() {
    // Enable VT200 mouse (basic button press/release)
    process.stdout.write('\x1b[?1000h');
    // Enable cell motion (drag tracking)
    process.stdout.write('\x1b[?1002h');
    // Enable SGR mouse mode (better coordinate handling)
    process.stdout.write('\x1b[?1006h');
    this.mouseEnabled = true;
  }
  
  disableMouse() {
    process.stdout.write('\x1b[?1000l');
    process.stdout.write('\x1b[?1002l');
    process.stdout.write('\x1b[?1006l');
    this.mouseEnabled = false;
  }
  
  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    
    if (this.selectionMode) {
      this.disableMouse();
    } else {
      this.enableMouse();
    }
    
    this.render();
  }
  
  handleInput(data) {
    const str = data.toString();
    
    // Quit
    if (str === 'q' || str === '\u0003') {
      process.exit(0);
    }
    
    // Toggle selection mode
    if (str === 's') {
      this.toggleSelectionMode();
      return;
    }
    
    // Detect mouse events
    if (str.match(/\x1b\[<[\d;]+[Mm]/)) {
      this.handleMouseEvent(str);
      return;
    }
  }
  
  handleMouseEvent(sequence) {
    // Parse SGR mouse event
    const match = sequence.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (match) {
      const [, button, x, y, type] = match;
      console.log(`\rMouse ${type === 'M' ? 'press' : 'release'}: button=${button} x=${x} y=${y}     `);
    }
  }
  
  generateContent() {
    return [
      '╔═══════════════════════════════════════════════════════════════╗',
      '║  Interactive TUI with Text Selection Support                  ║',
      '╚═══════════════════════════════════════════════════════════════╝',
      '',
      'This is sample content that you can copy.',
      '',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      '',
      '┌─ Sample Code Block ─────────────────────────────────┐',
      '│ function hello() {                                   │',
      '│   console.log("Hello, World!");                      │',
      '│ }                                                    │',
      '└──────────────────────────────────────────────────────┘',
      '',
    ];
  }
  
  render() {
    // Clear screen
    process.stdout.write('\x1b[2J\x1b[H');
    
    // Status bar
    const status = this.selectionMode 
      ? '\x1b[42;30m SELECTION MODE \x1b[0m Mouse selection enabled'
      : '\x1b[43;30m MOUSE MODE \x1b[0m Application controls mouse';
    
    console.log(status);
    console.log('');
    
    // Content
    this.content.forEach(line => console.log(line));
    
    // Instructions
    console.log('\n┌─ How to Copy Text ──────────────────────────────────────┐');
    console.log('│                                                          │');
    console.log('│  1. Shift+Click: Hold Shift and drag to select         │');
    console.log('│     (works in iTerm2, GNOME Terminal, Alacritty, etc.) │');
    console.log('│                                                          │');
    console.log('│  2. Press [s]: Toggle selection mode                    │');
    console.log('│     • ON: Mouse works normally for selection            │');
    console.log('│     • OFF: Mouse controls application                   │');
    console.log('│                                                          │');
    console.log('│  3. Press [q]: Quit to access terminal scrollback      │');
    console.log('│                                                          │');
    console.log('└──────────────────────────────────────────────────────────┘');
    
    // Footer
    console.log('\n\x1b[90m[s] Toggle selection mode  [q] Quit\x1b[0m');
  }
  
  cleanup() {
    // Disable mouse
    this.disableMouse();
    
    // Show cursor
    process.stdout.write('\x1b[?25h');
    
    // Exit alternate screen
    process.stdout.write('\x1b[?1049l');
    
    // Restore terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }
}

// Start the application
new TUIWithCopySupport();
```

---

## Framework-Specific Examples

### Blessed

```javascript
const blessed = require('blessed');

const screen = blessed.screen({
  smartCSR: true,
  mouse: true,
  keys: true
});

// Selection mode toggle
let selectionMode = false;

screen.key('s', () => {
  selectionMode = !selectionMode;
  
  if (selectionMode) {
    // Disable mouse in blessed
    screen.program.disableMouse();
    statusBar.setContent(' SELECTION MODE - Select text with mouse ');
  } else {
    // Re-enable mouse
    screen.program.enableMouse();
    statusBar.setContent(' MOUSE MODE - Interactive controls ');
  }
  
  screen.render();
});

// Or use blessed's pause/resume
screen.key('p', () => {
  const resume = screen.program.pause();
  // Terminal is now in normal mode, user can select/copy
  // Press any key to resume
  process.stdin.once('data', () => {
    resume();
    screen.render();
  });
});
```

### Terminal-Kit

```javascript
const termkit = require('terminal-kit');
const term = termkit.terminal;

let mouseEnabled = true;

// Enable mouse
term.grabInput({ mouse: 'drag' });

// Toggle selection mode
function toggleSelection() {
  mouseEnabled = !mouseEnabled;
  
  if (mouseEnabled) {
    term.grabInput({ mouse: 'drag' });
  } else {
    term.grabInput(false); // Disable all input grabbing
  }
  
  updateStatus();
}

// Handle key press
term.on('key', (name) => {
  if (name === 's') {
    toggleSelection();
  }
});
```

### Ink (React for CLIs)

```javascript
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useStdin } from 'ink';

function App() {
  const [selectionMode, setSelectionMode] = useState(false);
  const { stdin, setRawMode } = useStdin();
  
  useEffect(() => {
    // Ink doesn't have built-in mouse support
    // You'd need to manually handle escape sequences
    
    if (selectionMode) {
      // Disable mouse tracking
      process.stdout.write('\x1b[?1000l');
    } else {
      // Enable mouse tracking
      process.stdout.write('\x1b[?1000h');
    }
  }, [selectionMode]);
  
  // Input handler for 's' key
  useEffect(() => {
    const handler = (data) => {
      if (data.toString() === 's') {
        setSelectionMode(prev => !prev);
      }
    };
    
    stdin.on('data', handler);
    return () => stdin.off('data', handler);
  }, [stdin]);
  
  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          {selectionMode 
            ? '📋 SELECTION MODE' 
            : '🖱️  MOUSE MODE'}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>Press [s] to toggle selection mode</Text>
      </Box>
    </Box>
  );
}

render(<App />);
```

---

## Key Takeaways

1. **The fundamental trade-off**: Mouse tracking and text selection cannot coexist - only one can handle mouse events at a time.

2. **Best practice for modern TUI apps**:
   - Enable mouse mode for interactivity
   - Document Shift+click for selection (works in most terminals)
   - Provide toggle key (like 's') for selection mode as fallback
   - Show clear status indicator of current mode

3. **Essential escape sequences**:
   - Enable mouse: `\x1b[?1000h\x1b[?1006h`
   - Disable mouse: `\x1b[?1000l\x1b[?1006l`
   - Alt screen enter: `\x1b[?1049h`
   - Alt screen exit: `\x1b[?1049l`

4. **Terminal compatibility**:
   - Shift+click bypass works in most modern terminals (iTerm2, GNOME Terminal, Alacritty, Windows Terminal, kitty)
   - Selection mode toggle works universally
   - Always provide multiple methods for best UX

5. **Implementation complexity**:
   - Easiest: Document Shift+click (no code)
   - Simple: Selection mode toggle (10-20 lines)
   - Complex: Application-level selection (100s of lines)

