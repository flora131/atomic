#!/usr/bin/env node
// Practical example demonstrating mouse mode toggling

const readline = require('readline');

// Enable raw mode
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

let mouseEnabled = true;

// Function to enable mouse tracking
function enableMouse() {
  // Enable SGR mouse mode + button tracking
  process.stdout.write('\x1b[?1000h'); // VT200 mouse
  process.stdout.write('\x1b[?1002h'); // Cell motion tracking  
  process.stdout.write('\x1b[?1006h'); // SGR mouse format
  mouseEnabled = true;
  console.log('\r\nMouse mode ENABLED - Mouse events captured by app');
  console.log('Try selecting text - it won\'t work!');
  console.log('Press "d" to disable mouse mode\r\n');
}

// Function to disable mouse tracking
function disableMouse() {
  process.stdout.write('\x1b[?1000l');
  process.stdout.write('\x1b[?1002l');
  process.stdout.write('\x1b[?1006l');
  mouseEnabled = false;
  console.log('\r\nMouse mode DISABLED - Terminal handles text selection');
  console.log('Now try selecting text - it should work!');
  console.log('Press "e" to re-enable mouse mode\r\n');
}

// Handle stdin data
process.stdin.on('data', (data) => {
  const str = data.toString();
  
  // Check for quit
  if (str === 'q' || str === '\u0003') { // q or Ctrl+C
    disableMouse();
    process.exit(0);
  }
  
  // Toggle mouse mode
  if (str === 'e' && !mouseEnabled) {
    enableMouse();
  } else if (str === 'd' && mouseEnabled) {
    disableMouse();
  }
  
  // Mouse event (SGR format: \x1b[<button;x;y[Mm])
  if (str.match(/\x1b\[<[\d;]+[Mm]/)) {
    console.log('Mouse event received:', str.split('').map(c => 
      c.charCodeAt(0) > 31 ? c : `\\x${c.charCodeAt(0).toString(16)}`
    ).join(''));
  }
});

console.clear();
console.log('=== Mouse Mode Demo ===\n');
console.log('This demonstrates how mouse mode affects text selection:\n');
enableMouse();
