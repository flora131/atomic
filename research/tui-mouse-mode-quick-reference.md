# TUI Mouse Mode & Text Selection - Quick Reference Card

## The Problem
```
Mouse Mode ON  → App gets mouse events → Text selection BROKEN ❌
Mouse Mode OFF → Terminal handles mouse → Text selection WORKS ✅
```

## Essential Escape Sequences

### Mouse Control
```javascript
// Enable mouse tracking (most compatible combination)
'\x1b[?1000h'  // VT200: button press/release
'\x1b[?1002h'  // Cell motion: drag tracking  
'\x1b[?1006h'  // SGR: modern format

// Disable mouse tracking
'\x1b[?1000l\x1b[?1002l\x1b[?1006l'
```

### Screen Buffer
```javascript
'\x1b[?1049h'  // Enter alternate screen (fullscreen app)
'\x1b[?1049l'  // Exit to normal screen (restore terminal)
```

### Mouse Event Format (SGR)
```
Press:   \x1b[<0;10;5M   // button 0, x=10, y=5
Release: \x1b[<0;10;5m   // lowercase 'm' for release
Drag:    \x1b[<32;12;6M  // button with motion flag
```

### Button Codes
```
0  = Left button
1  = Middle button
2  = Right button
64 = Wheel up
65 = Wheel down
```

## Solution: Selection Mode Toggle (20 lines)

```javascript
let selectionMode = false;

function toggleSelectionMode() {
  selectionMode = !selectionMode;
  
  if (selectionMode) {
    // Disable mouse → user can select text
    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
    showStatus('📋 SELECTION MODE - Select and copy text');
  } else {
    // Enable mouse → app handles mouse events
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    showStatus('🖱️  MOUSE MODE - Interactive controls');
  }
}

// In your input handler
process.stdin.on('data', (data) => {
  if (data.toString() === 's') {
    toggleSelectionMode();
  }
});
```

## Alternative: Document Shift+Click

```javascript
// No code needed! Just document it:
console.log('To copy text: Hold Shift while dragging to select');

// Works in: iTerm2, Terminal.app, GNOME Terminal, 
//           Alacritty, Windows Terminal, kitty, WezTerm
```

## Complete Minimal Example

```javascript
#!/usr/bin/env node
const readline = require('readline');

// Setup
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

// Enter alternate screen + enable mouse
process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h');

let selectionMode = false;

// Input handler
process.stdin.on('data', (data) => {
  const key = data.toString();
  
  // Quit
  if (key === 'q') {
    cleanup();
    process.exit(0);
  }
  
  // Toggle selection mode
  if (key === 's') {
    selectionMode = !selectionMode;
    const seq = selectionMode ? 
      '\x1b[?1000l\x1b[?1006l' : 
      '\x1b[?1000h\x1b[?1006h';
    process.stdout.write(seq);
    render();
  }
  
  // Mouse event
  if (key.match(/\x1b\[<[\d;]+[Mm]/)) {
    console.log('Mouse event:', key);
  }
});

function render() {
  process.stdout.write('\x1b[2J\x1b[H'); // Clear screen
  console.log(selectionMode ? 
    '📋 Selection mode - select text with mouse' :
    '🖱️  Mouse mode - interactive controls');
  console.log('\n[s] Toggle mode  [q] Quit');
}

function cleanup() {
  process.stdout.write('\x1b[?1000l\x1b[?1006l'); // Disable mouse
  process.stdout.write('\x1b[?1049l'); // Normal screen
  process.stdin.setRawMode(false);
}

process.on('exit', cleanup);
render();
```

## Framework Integrations

### Blessed
```javascript
const screen = blessed.screen({ mouse: true });

// Toggle
screen.program.disableMouse();  // Allow selection
screen.program.enableMouse();   // App controls mouse

// Pause/resume
const resume = screen.program.pause(); // Switch to normal buffer
resume(); // Back to app
```

### Terminal-Kit
```javascript
const term = require('terminal-kit').terminal;

term.grabInput({ mouse: 'drag' });  // Enable
term.grabInput(false);              // Disable (allow selection)
```

### Ink
```javascript
// Manual escape sequences (Ink has no mouse support)
useEffect(() => {
  process.stdout.write(
    selectionMode ? '\x1b[?1000l' : '\x1b[?1000h'
  );
}, [selectionMode]);
```

## All Mouse Modes

| Mode | Code | Events |
|------|------|--------|
| X10 | `?9` | Press only |
| VT200 | `?1000` | Press + Release |
| Button Event | `?1001` | Highlight tracking |
| Cell Motion | `?1002` | Press + Release + Drag |
| All Motion | `?1003` | All movement |
| UTF-8 | `?1005` | Extended coords |
| SGR | `?1006` | Modern format ⭐ |
| URXVT | `?1015` | rxvt format |

**Recommended:** `?1000` + `?1002` + `?1006`

## Testing Your Implementation

```bash
# Run the demo
node research/tui-selection-example.js

# Try these actions:
# 1. Click around (app captures mouse)
# 2. Press 's' (enter selection mode)
# 3. Drag to select text (should work!)
# 4. Cmd+C / Ctrl+C to copy
# 5. Press 's' again (back to mouse mode)
# 6. Try Shift+click (if terminal supports it)
```

## Debugging Mouse Events

```javascript
process.stdin.on('data', (data) => {
  // Log raw bytes
  const hex = Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  console.log('Raw:', hex);
  
  // Detect mouse event
  if (data.toString().match(/\x1b\[<[\d;]+[Mm]/)) {
    const match = data.toString().match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (match) {
      const [, button, x, y, type] = match;
      console.log(`Mouse ${type === 'M' ? 'down' : 'up'} at (${x},${y}) button=${button}`);
    }
  }
});
```

## Common Pitfalls

❌ **Don't forget to disable mouse on exit**
```javascript
process.on('exit', () => {
  process.stdout.write('\x1b[?1000l\x1b[?1006l');
});
```

❌ **Don't enable mouse without SGR format**
```javascript
// Bad: Only ?1000 → coordinate issues
process.stdout.write('\x1b[?1000h');

// Good: With SGR format
process.stdout.write('\x1b[?1000h\x1b[?1006h');
```

❌ **Don't assume Shift+click works everywhere**
```javascript
// Always provide fallback
console.log('Copy: Shift+click (modern terminals) or press [s]');
```

## Resources

- Comprehensive guide: `research/tui-text-selection-comprehensive-guide.md`
- Working example: `research/tui-selection-example.js`
- Demo app: `research/tui-mouse-mode-demo.js`

---

**TL;DR:** Add 20 lines to toggle mouse mode with 's' key. Problem solved! 🎉
