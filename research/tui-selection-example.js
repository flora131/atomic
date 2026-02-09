#!/usr/bin/env node
/**
 * Complete example showing how to handle text selection in a TUI app
 * Demonstrates multiple strategies for allowing users to copy text
 */

const readline = require('readline');

class TUIApp {
  constructor() {
    this.mouseEnabled = false;
    this.selectionMode = false;
    this.mouseEvents = [];
    
    // Setup stdin
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    this.init();
  }
  
  init() {
    // Enter alternate screen buffer
    this.alternateScreen(true);
    
    // Enable mouse tracking
    this.enableMouse();
    
    // Setup input handling
    process.stdin.on('data', this.handleInput.bind(this));
    
    // Handle cleanup on exit
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => process.exit(0));
    
    this.render();
  }
  
  alternateScreen(enable) {
    if (enable) {
      // Save cursor, clear screen, switch to alternate buffer
      process.stdout.write('\x1b[?1049h');
    } else {
      // Restore normal buffer
      process.stdout.write('\x1b[?1049l');
    }
  }
  
  enableMouse() {
    // Enable multiple mouse protocols for better compatibility
    process.stdout.write('\x1b[?1000h'); // VT200 mouse (button press/release)
    process.stdout.write('\x1b[?1002h'); // Cell motion (drag tracking)
    process.stdout.write('\x1b[?1006h'); // SGR mouse mode (better coordinates)
    this.mouseEnabled = true;
  }
  
  disableMouse() {
    // Disable all mouse tracking
    process.stdout.write('\x1b[?1000l');
    process.stdout.write('\x1b[?1002l');
    process.stdout.write('\x1b[?1006l');
    this.mouseEnabled = false;
  }
  
  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    
    if (this.selectionMode) {
      // Enter selection mode: disable mouse tracking
      this.disableMouse();
    } else {
      // Exit selection mode: re-enable mouse tracking
      this.enableMouse();
    }
    
    this.render();
  }
  
  handleInput(data) {
    const str = data.toString();
    const bytes = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    
    // Quit (q or Ctrl+C)
    if (str === 'q' || str === '\u0003') {
      process.exit(0);
    }
    
    // Toggle selection mode (s key)
    if (str === 's' || str === 'S') {
      this.toggleSelectionMode();
      return;
    }
    
    // Help
    if (str === 'h' || str === 'H' || str === '?') {
      this.render();
      return;
    }
    
    // Detect mouse events (SGR format: ESC[<button;x;y[Mm])
    if (str.match(/\x1b\[<[\d;]+[Mm]/)) {
      this.mouseEvents.unshift(`Mouse: ${bytes}`);
      if (this.mouseEvents.length > 5) this.mouseEvents.pop();
      this.render();
      return;
    }
    
    // Log other input
    if (str.charCodeAt(0) >= 32) {
      this.mouseEvents.unshift(`Key: "${str}" (${bytes})`);
    } else {
      this.mouseEvents.unshift(`Key: ${bytes}`);
    }
    if (this.mouseEvents.length > 5) this.mouseEvents.pop();
    this.render();
  }
  
  render() {
    // Clear screen and move cursor to top
    process.stdout.write('\x1b[2J\x1b[H');
    
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║         TUI Text Selection & Copy Demo                            ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    
    // Status
    const status = this.selectionMode ? 
      '\x1b[32m✓ SELECTION MODE ON\x1b[0m - Mouse mode disabled, you can select text!' :
      '\x1b[33m○ MOUSE MODE ON\x1b[0m - Application captures mouse events';
    console.log(`Status: ${status}\n`);
    
    // Instructions
    console.log('═══ How to Copy Text ═══\n');
    console.log('  Strategy 1: Use Shift+Click (works in most modern terminals)');
    console.log('    → Hold Shift and drag to select, then Cmd+C / Ctrl+C to copy\n');
    
    console.log('  Strategy 2: Toggle Selection Mode');
    console.log('    → Press "s" to toggle selection mode on/off');
    console.log('    → When ON: mouse works normally, you can select and copy');
    console.log('    → When OFF: mouse events captured by this app\n');
    
    console.log('  Strategy 3: Exit to Normal Buffer');
    console.log('    → Press "q" to quit and return to normal terminal');
    console.log('    → You can then scroll back and copy from output\n');
    
    // Sample content to copy
    console.log('═══ Sample Content to Copy ═══\n');
    console.log('  Try copying this text using one of the methods above:');
    console.log('  ┌─────────────────────────────────────────────────────┐');
    console.log('  │ Hello World! This is a TUI application.             │');
    console.log('  │ You should be able to copy this text.               │');
    console.log('  │ Terminal mouse mode: ' + (this.mouseEnabled ? 'ENABLED ' : 'DISABLED') + '                    │');
    console.log('  └─────────────────────────────────────────────────────┘\n');
    
    // Recent events
    console.log('═══ Recent Input Events ═══\n');
    if (this.mouseEvents.length === 0) {
      console.log('  (No events yet - try clicking or pressing keys)\n');
    } else {
      this.mouseEvents.forEach(event => {
        console.log(`  ${event}`);
      });
      console.log('');
    }
    
    // Commands
    console.log('═══ Commands ═══\n');
    console.log('  [s] Toggle selection mode   [h] Help   [q] Quit\n');
    
    // Footer
    console.log('─'.repeat(70));
    console.log('Tip: Try clicking around to see mouse events captured!');
  }
  
  cleanup() {
    // Restore normal state
    this.disableMouse();
    this.alternateScreen(false);
    process.stdout.write('\x1b[?25h'); // Show cursor
    
    // Disable raw mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }
}

// Start the app
new TUIApp();
