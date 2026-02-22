# VS Code Terminal Shift+Enter Escape Sequences Research

**Date**: 2026-02-22  
**Research Focus**: Understanding how VS Code integrated terminal handles Shift+Enter key combinations and differences from standard terminals

## Summary

VS Code's integrated terminal uses xterm.js and handles Shift+Enter differently than standard terminals. By default, xterm.js does **not** send a special escape sequence for Shift+Enter in standard mode. However, VS Code provides two mechanisms for applications to receive Shift+Enter events:

1. **Kitty Keyboard Protocol** - Modern protocol that disambiguates all key combinations
2. **PowerShell-specific mapping** - Custom escape sequence `\x1b[24~c` for PowerShell's PSReadLine

## Detailed Findings

### 1. Shift+Enter Escape Sequences

#### VS Code Terminal (xterm.js)

**Source**: [xterm.js repository](https://github.com/xtermjs/xterm.js)  
**Relevance**: Core terminal emulator used by VS Code

**Standard Input Mode**:
- **Shift+Enter**: Does NOT generate a special escape sequence by default
- **Alt+Enter**: Generates `\x1b\r` (ESC + CR)
- **Ctrl+Enter**: Does not generate a specific escape sequence in standard mode

**With Kitty Keyboard Protocol** (`CSI > 1 u`):
- **Enter (unmodified)**: Generates `\x1b[13u`
- **Ctrl+Enter**: Generates `\x1b[13;5u` (where `5` indicates Ctrl modifier)
- **Shift+Enter**: May not generate a special sequence unless considered ambiguous
- **Alt+Enter**: Would generate `\x1b[13;3u` (where `3` indicates Alt modifier)

**Win32 Input Mode**:
- **Shift+Enter**: Encodes as CSI format `\x1b[vk;sc;uc;kd;cs;rc_` with `SHIFT_PRESSED` flag set
- **Ctrl+Enter**: Produces `0x0A` (Line Feed) with `LEFT_CTRL_PRESSED` flag

**PowerShell-Specific Mapping** (VS Code):
- VS Code sends `\x1b[24~c` for Shift+Enter when:
  - Shell type is PowerShell
  - Shell integration is enabled
  - `terminal.integrated.enableWin32InputMode` is enabled
- This sequence is mapped to PSReadLine's `AddLine` function via `shellIntegration.ps1`

#### Standard Terminals (iTerm2, Alacritty, etc.)

**Traditional xterm behavior**:
- Most terminals send `\r` (0x0D, Carriage Return) for Enter
- Shift+Enter typically sends the same `\r` as unmodified Enter
- No standard escape sequence for Shift+Enter in legacy mode

**With Kitty Protocol Support**:
Terminals implementing the Kitty keyboard protocol can send:
- `\x1b[13;2u` for Shift+Enter (where `2` = 1 + Shift modifier bit)
- This requires the application to enable the protocol

### 2. Modified Key Encoding

#### xterm.js Modifier Encoding

**Modifiers in Kitty Protocol**:
```
shift     0b1         (1)
alt       0b10        (2)
ctrl      0b100       (4)
super     0b1000      (8)
hyper     0b10000     (16)
meta      0b100000    (32)
caps_lock 0b1000000   (64)
num_lock  0b10000000  (128)
```

**Escape Sequence Format**:
```
CSI unicode-key-code ; modifiers:event-type ; text-as-codepoints u
```

The modifier value is encoded as `1 + actual_modifiers`. Examples:
- Shift only: `1 + 1 = 2`
- Ctrl+Shift: `1 + 0b101 = 6`
- Default (no modifiers): `1`

#### Standard Terminal Encoding

Traditional terminals use simpler modifier encoding:
- Ctrl+key: Often sends control character (key code - 64)
- Alt+key: Sends ESC followed by the key character
- Shift+key: Modifies the character itself (lowercase to uppercase)

### 3. Known Issues with Shift+Enter

#### Issue: xterm.js #3382 - Alt+Shift+Key Modifier Handling

**Source**: [xtermjs/xterm.js#3382](https://github.com/xtermjs/xterm.js/issues/3382)  
**Status**: Closed (June 2025)

**Problem**: VS Code terminal was not correctly handling Shift modifier for Alt+Shift+key combinations. Pressing `Alt+Shift+H` showed `^[h` instead of expected `^[H`.

**Impact**: TUI applications relying on uppercase/lowercase distinction in Alt+Shift combinations received incorrect input.

#### Issue: VS Code #280016 - Enter Key in Input Boxes

**Source**: [microsoft/vscode#280016](https://github.com/microsoft/vscode/issues/280016)  
**Status**: Not planned

**Problem**: Enter key does not work in VS Code web input boxes (showInputBox API), affecting MCP Server UI and extensions using showInputBox.

**Note**: This is specific to VS Code web UI, not the integrated terminal.

#### Settings for Enhanced Key Handling

**`terminal.integrated.enableKittyKeyboardProtocol`**:
- Enables Kitty keyboard protocol for more detailed keyboard input reporting
- Allows applications to receive Shift+Enter and other modified key events
- Documentation states: "can, for example, enable Shift+Enter to be handled by the program"
- Source: [VS Code repository](https://github.com/microsoft/vscode)

**`terminal.integrated.enableWin32InputMode`**:
- Controls Win32 input mode for PowerShell
- When enabled with shell integration, maps Shift+Enter to `\x1b[24~c`
- Source: [VS Code repository](https://github.com/microsoft/vscode)

### 4. Differences: xterm.js vs Other Terminal Emulators

#### Standard xterm.js (VS Code Default)

**Key Characteristics**:
- Does not send special sequences for Shift+Enter by default
- Alt+Enter sends `\x1b\r` (ESC prefix pattern)
- Requires opt-in to modern protocols (Kitty, Win32 mode)
- Backward compatible with legacy applications

#### Kitty Protocol Terminals

**Terminals**: Kitty, Alacritty, WezTerm, iTerm2, Foot, Ghostty, Rio  
**Source**: [Kitty Keyboard Protocol Specification](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)

**Advantages**:
- Disambiguates all escape codes
- Reports event types (press, repeat, release)
- Provides alternate key codes (shifted key, base layout key)
- Supports all modifiers (Shift, Ctrl, Alt, Super, Hyper, Meta, Caps Lock, Num Lock)
- Can report associated text as Unicode codepoints

**Escape Sequence Format**:
```
CSI number ; modifiers [u~]
CSI 1; modifiers [ABCDEFHPQS]
```

Examples:
- `CSI 97;2u` - Shift+A (97 = lowercase 'a', 2 = 1+Shift)
- `CSI 13;5u` - Ctrl+Enter (13 = Enter, 5 = 1+Ctrl)
- `CSI 13;2u` - Shift+Enter (13 = Enter, 2 = 1+Shift)

#### Traditional Terminals (Legacy Mode)

**Terminals**: xterm, GNOME Terminal (without Kitty support)

**Limitations**:
- No way to reliably use multiple modifiers
- Ambiguous escape codes (different keys → same sequence)
- No event type reporting (press/release/repeat)
- Fragile Esc key detection using timing hacks

### 5. Workarounds for TUI Applications

#### Method 1: Enable Kitty Keyboard Protocol

**Application-side implementation**:
```bash
# At startup or when entering alternate screen
printf '\e[>1u'

# Application receives all keys in consistent format:
# CSI number ; modifiers [u~]
# Shift+Enter = CSI 13;2u

# At exit or when leaving alternate screen
printf '\e[<u'
```

**VS Code user setting**:
```json
{
  "terminal.integrated.enableKittyKeyboardProtocol": true
}
```

**Supported applications/libraries**:
- Vim, Neovim, Emacs (with kkp package), Kakoune, Helix
- Notcurses, Crossterm, Textual, Vaxis, Bubbletea
- Fish shell, Nushell

**References**:
- [Kitty Protocol Documentation](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
- [Neovim PR #18181](https://github.com/neovim/neovim/pull/18181)
- [Crossterm PR #688](https://github.com/crossterm-rs/crossterm/pull/688)

#### Method 2: Progressive Enhancement

Query terminal capabilities and adapt:

```bash
# Query current keyboard protocol flags
printf '\e[?u'

# Terminal replies with:
# CSI ? flags u

# Push current state onto stack
printf '\e[>{u'

# Enable features as bit flags:
# 1  - Disambiguate escape codes
# 2  - Report event types
# 4  - Report alternate keys
# 8  - Report all keys as escape codes
# 16 - Report associated text

# Enable multiple features
printf '\e[=11u'  # Flags 1 + 2 + 8 = 11

# Pop state from stack when exiting
printf '\e[<{u'
```

#### Method 3: Detect VS Code Terminal

Check for VS Code-specific environment variables and shell integration:

```bash
# Check for VS Code shell integration
if [ -n "$VSCODE_SHELL_INTEGRATION" ]; then
  # Running in VS Code terminal with shell integration
  # Can use VS Code-specific features
fi

# Check terminal type
if [ "$TERM_PROGRAM" = "vscode" ]; then
  # Running in VS Code terminal
fi
```

**VS Code Shell Integration Sequences** (OSC 633):
- `OSC 633 ; A ST` - PromptStart
- `OSC 633 ; B ST` - CommandStart
- `OSC 633 ; C ST` - CommandExecuted
- `OSC 633 ; D [; <ExitCode>] ST` - CommandFinished

Applications can parse these sequences to detect VS Code terminal.

#### Method 4: Alternative Key Bindings

If Shift+Enter cannot be reliably detected:
- Use Ctrl+J or Ctrl+M (common alternatives)
- Use Alt+Enter (sends `\x1b\r` reliably)
- Provide configuration option for users to choose key binding
- Use Enter in insert mode, require explicit command for newline

#### Method 5: Shell-Specific Solutions

**PowerShell**:
VS Code automatically handles Shift+Enter for PowerShell when:
- Shell integration is enabled (default)
- `terminal.integrated.enableWin32InputMode` is true

**Bash/Zsh**:
Use `bind` or `bindkey` to map Shift+Enter:
```bash
# Bash
bind '"\e[13;2u": "\n"'  # If Kitty protocol is enabled

# Zsh
bindkey '\e[13;2u' self-insert  # If Kitty protocol is enabled
```

### 6. Progressive Enhancement Flags

**Source**: [Kitty Keyboard Protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)

The Kitty protocol defines progressive enhancement through bit flags:

| Flag | Value | Meaning |
|------|-------|---------|
| 0b1 | 1 | Disambiguate escape codes |
| 0b10 | 2 | Report event types (press/repeat/release) |
| 0b100 | 4 | Report alternate keys |
| 0b1000 | 8 | Report all keys as escape codes |
| 0b10000 | 16 | Report associated text |

**Example Usage**:
```bash
# Enable disambiguation and event reporting
printf '\e[=3u'  # Flags: 1 + 2 = 3

# Enable all features
printf '\e[=31u'  # Flags: 1 + 2 + 4 + 8 + 16 = 31
```

### 7. Implementation Examples

#### Detect and Enable Kitty Protocol

```c
// C example for TUI application
#include <stdio.h>
#include <termios.h>
#include <unistd.h>

void enable_kitty_protocol() {
    // Query if terminal supports Kitty protocol
    printf("\033[?u");
    fflush(stdout);
    
    // Enable disambiguation (flag 1)
    printf("\033[=1u");
    fflush(stdout);
}

void disable_kitty_protocol() {
    // Reset to default mode
    printf("\033[<u");
    fflush(stdout);
}

// Parse Shift+Enter: \e[13;2u
// Parse Ctrl+Enter: \e[13;5u
```

#### Rust with Crossterm

```rust
use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    terminal,
};

fn main() -> Result<(), std::io::Error> {
    terminal::enable_raw_mode()?;
    
    loop {
        if let Event::Key(KeyEvent {
            code: KeyCode::Enter,
            modifiers,
            ..
        }) = event::read()?
        {
            if modifiers.contains(KeyModifiers::SHIFT) {
                println!("Shift+Enter pressed!");
            } else if modifiers.contains(KeyModifiers::CONTROL) {
                println!("Ctrl+Enter pressed!");
            } else {
                println!("Enter pressed!");
            }
        }
    }
    
    terminal::disable_raw_mode()?;
    Ok(())
}
```

## Gaps and Limitations

### Information Not Found

1. **Exact behavior of xterm.js Shift+Enter in all modes**: The DeepWiki search indicated that in standard mode, Shift+Enter doesn't generate a special sequence, but exact behavior with all configuration combinations is not fully documented.

2. **VS Code terminal version-specific changes**: The research found references to issues and PRs but didn't uncover a comprehensive changelog of Shift+Enter handling across VS Code versions.

3. **Performance impact**: No information found on performance implications of enabling Kitty keyboard protocol in large-scale terminal applications.

### Uncertainties

1. **Win32 Input Mode specifics**: While the format `\x1b[vk;sc;uc;kd;cs;rc_` is mentioned, the exact encoding of all parameters for Shift+Enter needs further investigation.

2. **Browser compatibility**: VS Code in browser (code.visualstudio.com) may handle keys differently due to browser event handling, but specific details are limited.

3. **Terminal theme interaction**: Whether terminal color themes or font settings affect key sequence generation is unclear.

## Recommendations for TUI Applications

### For Maximum Compatibility

1. **Primary approach**: Enable Kitty keyboard protocol with progressive enhancement
   - Query support with `CSI ? u`
   - Enable at minimum flag 1 (disambiguate)
   - Parse modern sequences: `CSI 13;2u` for Shift+Enter

2. **Fallback approach**: Provide alternative key bindings
   - Document that Shift+Enter may not work in all terminals
   - Offer Ctrl+J, Alt+Enter, or custom binding options
   - Use configuration file for user customization

3. **VS Code detection**: Check for `VSCODE_SHELL_INTEGRATION` or `TERM_PROGRAM=vscode`
   - Enable VS Code-specific workarounds if detected
   - Document VS Code terminal settings users should enable

4. **Testing matrix**: Test in multiple environments
   - VS Code with Kitty protocol enabled/disabled
   - iTerm2, Alacritty, Kitty (native Kitty protocol)
   - Legacy terminals (xterm, GNOME Terminal)
   - tmux/screen (multiplexers may alter sequences)

### VS Code User Settings

Recommend users enable:
```json
{
  "terminal.integrated.enableKittyKeyboardProtocol": true,
  "terminal.integrated.enableWin32InputMode": true  // For PowerShell
}
```

## Additional Resources

### Documentation
- [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html) - Comprehensive reference for terminal control codes
- [Kitty Keyboard Protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) - Modern keyboard protocol specification
- [xterm.js API Documentation](https://xtermjs.org/docs/) - VS Code's terminal emulator library

### GitHub Issues
- [xtermjs/xterm.js#3382](https://github.com/xtermjs/xterm.js/issues/3382) - Alt+Shift+key modifier handling
- [xtermjs/xterm.js#4665](https://github.com/xtermjs/xterm.js/issues/4665) - WebGL rendering issue
- [microsoft/vscode#280016](https://github.com/microsoft/vscode/issues/280016) - Enter key in input boxes (web)
- [Kitty discussion #3248](https://github.com/kovidgoyal/kitty/issues/3248) - Public discussion of keyboard protocol

### Implementation Examples
- [Neovim Kitty Protocol Support](https://github.com/neovim/neovim/pull/18181)
- [Crossterm Kitty Protocol](https://github.com/crossterm-rs/crossterm/pull/688)
- [Vim Kitty Protocol](https://github.com/vim/vim/commit/63a2e360cca2c70ab0a85d14771d3259d4b3aafa)

### Related Projects
- [Fixterms Proposal](http://www.leonerd.org.uk/hacks/fixterms/) - Original keyboard protocol proposal (has bugs, see Kitty spec for corrections)
- [Notcurses Library](https://github.com/dankamongmen/notcurses/issues/2131) - TUI library with Kitty protocol support
- [Textual Framework](https://github.com/Textualize/textual/pull/4631) - Python TUI framework with modern protocol support

## Conclusion

VS Code's integrated terminal (xterm.js) does not send a special escape sequence for Shift+Enter by default in standard input mode. Applications can receive Shift+Enter events by:

1. **Enabling Kitty keyboard protocol** - Most robust solution, provides `\x1b[13;2u`
2. **Using VS Code settings** - Users enable `terminal.integrated.enableKittyKeyboardProtocol`
3. **PowerShell-specific** - Automatic with shell integration (`\x1b[24~c`)

The key difference between VS Code/xterm.js and other modern terminals (Kitty, Alacritty, WezTerm) is that the latter have native Kitty protocol support, while VS Code requires explicit user configuration. TUI applications should implement progressive enhancement to detect and utilize available keyboard protocols while providing fallback options for legacy terminals.

**Primary Reference**: [DeepWiki Search Results](https://deepwiki.com/search/how-does-the-vs-code-integrate_60837908-8b8d-46bf-b815-4b0af6b04d77)
