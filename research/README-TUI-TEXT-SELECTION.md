# TUI Text Selection & Copy - Research Documentation

Complete research on how terminal TUI applications handle text selection and copying when mouse mode is enabled.

## 📚 Documentation Index

### Quick Start
- **[Quick Reference Card](tui-mouse-mode-quick-reference.md)** ⭐ START HERE
  - One-page cheat sheet with escape sequences and minimal working example
  - Copy-paste ready code snippets
  - Essential patterns and common pitfalls

### In-Depth Guides
- **[Comprehensive Guide](tui-text-selection-comprehensive-guide.md)**
  - Complete technical documentation (12,000+ words)
  - All solution strategies with pros/cons
  - Framework-specific implementations (blessed, terminal-kit, Ink)
  - Complete working examples with detailed explanations

- **[Research Summary](tui-text-selection-research.md)**
  - Executive summary of findings
  - Key insights from blessed, terminal-kit, and Ink research
  - Recommended approaches with code examples
  - Framework comparison

### Specialized Topics
- **[Copy Strategies](tui-copy-strategies.md)**
  - Deep dive into 5 different approaches
  - Shift+click bypass, selection mode toggle, app-level selection
  - Pause/resume patterns, hybrid approaches
  - Decision matrix for choosing the right strategy

- **[Terminal Mouse Escape Sequences](terminal-mouse-escape-sequences.md)**
  - Complete reference of escape codes
  - Mouse protocol evolution (X10 → VT200 → SGR)
  - Button codes, event formats
  - Quick lookup table

### Working Examples
- **[Complete Example](tui-selection-example.js)** ⭐ DEMO APP
  - Full TUI application with text selection support
  - Implements multiple copy strategies
  - Shows status indicators and help text
  - Ready to run: `node research/tui-selection-example.js`

- **[Mouse Mode Demo](tui-mouse-mode-demo.js)**
  - Interactive demonstration of mouse mode on/off
  - Real-time event logging
  - Educational tool for understanding mouse tracking

## 🎯 Key Findings

### The Core Problem
When a TUI app enables **mouse mode**, the terminal sends mouse events to the application instead of handling them natively. This **breaks text selection** - users can't select and copy text with the mouse.

### The Solution
Two main approaches work universally:

1. **Shift+Click** (Zero code, terminal-dependent)
   - Most modern terminals support Shift+click to bypass mouse mode
   - Just document it in your help text
   - Works in: iTerm2, GNOME Terminal, Alacritty, Windows Terminal, kitty

2. **Selection Mode Toggle** (20 lines, universal)
   - Provide hotkey (e.g., 's') to toggle mouse mode on/off
   - When off: users can select text normally
   - When on: app captures mouse events
   - Works everywhere

### Essential Code

```javascript
// Enable mouse tracking
process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');

// Disable mouse tracking (allow text selection)
process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');

// Toggle selection mode
let selectionMode = false;
function toggle() {
  selectionMode = !selectionMode;
  process.stdout.write(selectionMode ? 
    '\x1b[?1000l\x1b[?1006l' : 
    '\x1b[?1000h\x1b[?1006h'
  );
}
```

## 🔍 Research Methodology

This research examined:
- **blessed** (chjj/blessed) - Popular TUI library with comprehensive mouse support
- **terminal-kit** (cronvel/terminal-kit) - Advanced terminal manipulation library
- **Ink** (vadimdemedes/ink) - React for CLIs (limited mouse support)

Using DeepWiki queries to understand:
1. How each framework handles mouse mode
2. What escape sequences they use
3. How they solve the text selection problem
4. Patterns used by real TUI applications

## 📖 How to Use This Research

### For Quick Implementation
1. Read the [Quick Reference Card](tui-mouse-mode-quick-reference.md)
2. Copy the minimal example (20 lines)
3. Test with [tui-selection-example.js](tui-selection-example.js)

### For Deep Understanding
1. Start with [Research Summary](tui-text-selection-research.md)
2. Review [Copy Strategies](tui-copy-strategies.md) to choose your approach
3. Consult [Comprehensive Guide](tui-text-selection-comprehensive-guide.md) for details
4. Reference [Escape Sequences](terminal-mouse-escape-sequences.md) as needed

### For Your Framework
- **Using blessed?** See "Framework-Specific Implementations" in the Comprehensive Guide
- **Using terminal-kit?** Check the terminal-kit examples
- **Using Ink?** Manual escape sequence handling required
- **Custom/other?** Use the minimal example as a starting point

## 🧪 Testing

Run the demo apps to see it in action:

```bash
# Full-featured demo with multiple strategies
node research/tui-selection-example.js

# Simple mouse mode toggle demo
node research/tui-mouse-mode-demo.js
```

Try these actions:
1. Click around (mouse mode on - app captures events)
2. Press 's' to toggle selection mode
3. When selection mode is on, drag to select text
4. Copy with Cmd+C / Ctrl+C
5. Try Shift+click (if your terminal supports it)

## 📊 Escape Sequence Reference

| Feature | Enable | Disable |
|---------|--------|---------|
| VT200 Mouse | `\x1b[?1000h` | `\x1b[?1000l` |
| Cell Motion | `\x1b[?1002h` | `\x1b[?1002l` |
| SGR Format | `\x1b[?1006h` | `\x1b[?1006l` |
| Alt Screen | `\x1b[?1049h` | `\x1b[?1049l` |

## 🎓 Key Insights

1. **blessed's approach**: `program.pause()` disables mouse and switches to normal buffer
2. **terminal-kit's approach**: `grabInput(false)` releases control, `grabInput({mouse: ...})` to re-enable
3. **Ink's limitation**: No built-in mouse support, requires manual escape sequence handling
4. **Shift+click**: Terminal feature, not app-controlled, but widely supported
5. **Best practice**: Hybrid approach - document Shift+click AND provide toggle key

## 🔗 External References

- ECMA-48: Terminal control sequences standard
- XTerm documentation: SGR mouse mode specification
- VTE library: GNOME Terminal's underlying technology
- blessed source: `lib/program.js` for pause/resume implementation
- terminal-kit source: `lib/termconfig/xterm.js` for escape sequences

## 💡 Recommendations

**For new TUI apps:**
1. Enable mouse mode with SGR format for compatibility
2. Document Shift+click in help text (works for most users)
3. Add 's' key to toggle selection mode (universal fallback)
4. Show clear status indicator (e.g., "🖱️ MOUSE MODE" vs "📋 SELECTION MODE")
5. Always disable mouse on exit

**For existing apps:**
1. Add selection mode toggle first (easiest)
2. Then document Shift+click for convenience
3. Consider app-level selection for advanced features

## 📝 License & Usage

This research was conducted using:
- DeepWiki queries on public repositories
- Terminal documentation and standards
- Practical experimentation

All code examples are original and can be freely used. Framework-specific examples reference open-source libraries (blessed, terminal-kit, Ink) which have their own licenses.

---

**Questions or Issues?**

This research covers the fundamentals of terminal mouse mode and text selection. For specific implementation questions, refer to the comprehensive guide or examine the working examples.

**Last Updated:** February 2024
