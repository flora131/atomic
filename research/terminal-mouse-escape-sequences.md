# Terminal Mouse Mode Research

## Mouse Protocol Escape Sequences

Based on blessed and terminal-kit implementations:

### Basic Mouse Tracking Modes:
- X10 Mouse: `\x1b[?9h` (enable) / `\x1b[?9l` (disable)
  - Only reports button press, no release or motion
  
- VT200 Mouse (Normal tracking): `\x1b[?1000h` / `\x1b[?1000l`
  - Reports button press and release only
  
- Button-Event tracking: `\x1b[?1001h` / `\x1b[?1001l`
  - Hilite mouse tracking
  
- Cell Motion tracking: `\x1b[?1002h` / `\x1b[?1002l`
  - Reports motion only when button is pressed (drag)
  
- All Motion tracking: `\x1b[?1003h` / `\x1b[?1003l`
  - Reports all mouse motion, even without buttons pressed
  
### Extended Mouse Protocols:
- UTF-8 Mouse Mode: `\x1b[?1005h` / `\x1b[?1005l`
  - Extends coordinates beyond 223 rows/cols using UTF-8
  
- SGR Mouse Mode: `\x1b[?1006h` / `\x1b[?1006l`
  - Modern protocol with better coordinate handling
  - Reports events as `\x1b[<button;x;y[Mm]` where M = press, m = release
  
- URXVT Mouse Mode: `\x1b[?1015h` / `\x1b[?1015l`
  - Alternative protocol for rxvt-unicode terminal

### Other Related Modes:
- Bracketed Paste Mode: `\x1b[?2004h` / `\x1b[?2004l`
  - Wraps pasted text with `\x1b[200~` prefix and `\x1b[201~` suffix
  
- Alternate Screen Buffer: `\x1b[?47h` or `\x1b[?1049h` / `\x1b[?47l` or `\x1b[?1049l`
  - Used to switch between normal and alternate screen
