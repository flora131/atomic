# OpenTUI Keyboard Input Handling Research

**Date:** 2026-02-22  
**Repositories:** `anomalyco/opentui` and `anomalyco/opencode`  
**Focus:** Understanding Shift+Enter handling for newline insertion

---

## Summary

OpenTUI provides a sophisticated keyboard input handling system that:
1. Uses multiple protocols (Kitty keyboard protocol, modifyOtherKeys mode, standard ANSI)
2. Normalizes key sequences across different terminals
3. Implements a flexible keybinding system with customizable actions
4. Handles Shift+Enter for newlines in textarea components
5. Provides a two-tier event system with preventDefault/stopPropagation support

The key insight is that OpenTUI detects terminal capabilities and uses the best available protocol, with Kitty keyboard protocol being preferred, followed by modifyOtherKeys, and finally standard ANSI sequences.

---

## 1. Key Events and Escape Sequences Handling

### Input Processing Pipeline

**Source:** DeepWiki search on `anomalyco/opentui`  
**Key Files:**
- `packages/core/src/lib/parse.keypress.ts` - Main parsing logic
- `packages/core/src/lib/stdin-buffer.ts` - Input buffering
- `packages/core/src/zig/terminal.zig` - Terminal capability detection

**Process Flow:**

1. **Raw Input Buffer** - `process.stdin` → `StdinBuffer`
   - Buffers raw bytes from stdin
   - Manages timing for ESC sequences (distinguishes standalone ESC from escape sequence start)
   - Emits `data` events to registered handlers

2. **Key Handler Registration** - `setupInput()` 
   - Registers input handlers chain
   - `KeyHandler.processInput()` handles keyboard-related sequences

3. **Key Parsing** - `parseKeypress()` function
   - Converts raw input sequence → `ParsedKey` object
   - Processing order:
     1. **Filter Non-Keyboard Events**
        - Mouse events
        - Terminal response sequences (window size, cursor position, device attributes)
        - Bracketed paste markers
     
     2. **Kitty Keyboard Protocol** (if enabled via `useKittyKeyboard`)
        - Enhanced key reporting with disambiguation
        - Reports press/repeat/release events
        - Example: `\x1b[97;5u` for Ctrl+a
        - Example: `\x1b[57352u` for up arrow
        - Handled by `parseKittyKeyboard()` function
     
     3. **modifyOtherKeys Mode**
        - Format: `CSI 27 ; modifier ; code ~`
        - Encodes modified keys (Shift+Enter, Ctrl+Escape)
        - Example: `\x1b[27;5;13~` for Ctrl+Enter
        - Example: `\x1b[27;2;13~` for Shift+Enter
     
     4. **Standard ANSI & Control Characters**
        - Arrow keys: `\x1b[A` for "up"
        - Control chars: `\r` for "return", `\t` for "tab", `\x1b` for "escape"
        - Meta+char: `\x1b ` for Alt+Space

### ParsedKey Interface

```typescript
interface ParsedKey {
  name: string;        // Key name (e.g., "a", "return", "left")
  ctrl: boolean;       // Ctrl modifier
  meta: boolean;       // Alt/Option modifier
  shift: boolean;      // Shift modifier
  option: boolean;     // Option modifier (macOS)
  sequence: string;    // Raw escape sequence
  eventType?: string;  // "press", "repeat", "release" (Kitty protocol)
  source?: string;     // "raw", "kitty", etc.
}
```

### Event Emission

**KeyEvent Class:**
- Extends `ParsedKey`
- Adds `preventDefault()` and `stopPropagation()` methods
- Emitted with priority: global listeners → renderable-specific listeners
- If `stopPropagation()` called, further listeners not notified

**React Integration:**
- `useKeyboard` hook for registering keyboard event handlers

---

## 2. Textarea Shift+Enter Handling

**Source:** DeepWiki search on `anomalyco/opentui`  
**Key Files:**
- `packages/core/src/renderables/textarea.ts` - TextareaRenderable implementation
- `packages/core/src/renderables/input.ts` - InputRenderable implementation
- `packages/core/src/lib/keymapping.ts` - Keybinding utilities

### TextareaRenderable Component

**Shift+Enter Detection:**
1. Terminal sends escape sequence: `\x1b[27;2;13~` (modifyOtherKeys format)
2. `parseKeypress()` identifies:
   - `name: "return"`
   - `shift: true`
3. Modifier bitmask where `1` indicates Shift key

**Key Processing:**
```typescript
// In TextareaRenderable.handleKeyPress()
1. Constructs bindingKey from KeyEvent (name + modifiers)
2. Looks up action in _keyBindingsMap
3. Executes corresponding action handler
```

**Default Keybinding:**
- `return` + `shift` → `newline` action
- `newline` action handler inserts new line into text buffer

**Test Example:**
```typescript
// From test suite
currentMockInput.pressEnter({ meta: true }) 
// Results in newline insertion (when keybindings swapped in test)
```

### InputRenderable Component

**Key Difference from Textarea:**
- Extends `TextareaRenderable`
- **Overrides** newline behavior
- Constructor maps both `return` and `linefeed` → `submit` (regardless of modifiers)
- `newLine()` method always returns `false` - explicitly prevents newlines
- Ensures single-line input field behavior

---

## 3. Key Mapping and Binding System

**Source:** DeepWiki search on `anomalyco/opentui`  
**Key File:** `packages/core/src/lib/keymapping.ts`

### Core Components

#### 1. KeyBinding Interface
```typescript
interface KeyBinding {
  name: string;           // Key name (e.g., "a", "return", "left")
  ctrl?: boolean;         // Ctrl modifier
  shift?: boolean;        // Shift modifier
  meta?: boolean;         // Alt/Option modifier
  super?: boolean;        // Cmd/Win modifier
  action: string;         // Component-specific action string
}
```

#### 2. KeyAliasMap
```typescript
type KeyAliasMap = Record<string, string>;
// Example mappings:
// "enter" → "return"
// "esc" → "escape"
```
Allows flexibility in key name definitions while ensuring consistent internal processing.

#### 3. Key Functions

**getKeyBindingKey()**
- Serializes `KeyBinding` → unique string identifier
- Format: concatenates key name + modifier flags
- Example: `"a"` with `meta: true` → `"a:0:0:1:0"`

**mergeKeyBindings()**
- Combines default + custom keybindings
- Custom bindings override defaults for same key combination

**buildKeyBindingsMap()**
- Input: Array of `KeyBinding` objects + optional `KeyAliasMap`
- Output: `Map<string, action>`
- Keys: serialized keybinding strings (from `getKeyBindingKey()`)
- Values: corresponding actions
- Generates entries for aliased key names

### Component Implementation

**Example: TextareaRenderable**

```typescript
// 1. Define Action Types
type TextareaAction = 
  | "move-left" 
  | "move-right" 
  | "undo" 
  | "redo"
  | "newline"
  // ... etc

// 2. Default Keybindings
const defaultTextareaKeybindings: KeyBinding<TextareaAction>[] = [
  { name: "return", shift: true, action: "newline" },
  // ... more bindings
];

// 3. Component Instantiation
constructor(options: TextareaOptions) {
  // Merge default + custom keybindings
  const mergedBindings = mergeKeyBindings(
    defaultTextareaKeybindings,
    options.keyBindings || []
  );
  
  // Build internal map
  this._keyBindingsMap = buildKeyBindingsMap(
    mergedBindings,
    { ...defaultKeyAliases, ...options.keyAliasMap }
  );
  
  // Map actions → handler functions
  this._actionHandlers = new Map([
    ["move-left", () => this.moveCursorLeft()],
    ["newline", () => this.insertText("\n")],
    // ... more handlers
  ]);
}

// 4. Key Press Handling
handleKeyPress(event: KeyEvent) {
  // Serialize event → keybinding string
  const bindingKey = getKeyBindingKey(event);
  
  // Look up action
  const action = this._keyBindingsMap.get(bindingKey);
  
  // Execute handler
  if (action) {
    const handler = this._actionHandlers.get(action);
    handler?.();
  } else if (!hasModifiers) {
    // Insert text if no binding found
    this.insertText(event.name);
  }
}
```

### Custom Keybinding Example

```typescript
// From SelectRenderable test
const { select } = await createSelectRenderable(currentRenderer, {
  width: 20,
  height: 10,
  options: sampleOptions,
  keyBindings: [
    { name: "h", action: "move-up" },
    { name: "l", action: "move-down" },
  ],
});
```

### Dynamic Updates
Keybindings and aliases can be updated after component creation:
```typescript
component.keyBindings = newBindings;
component.keyAliasMap = newAliases;
```

---

## 4. Terminal-Specific Differences Handling

**Source:** DeepWiki search on `anomalyco/opentui`  
**Key Files:**
- `packages/core/src/zig/terminal.zig` - Capability detection & protocol enablement
- `packages/core/src/lib/stdin-buffer.ts` - Sequence buffering
- `packages/core/src/lib/parse.keypress.ts` - Multi-protocol parsing

### Multi-Layered Normalization Strategy

#### Phase 1: Terminal Capability Detection

**Process:**
1. Send capability query escape sequences to terminal
2. Parse responses to detect supported features
3. Enable appropriate input protocols based on capabilities

**Capability Queries:**
- `xtversion` - Terminal name/version
- SGR pixel mouse support
- Unicode mode
- Focus tracking
- Bracketed paste
- Kitty keyboard protocol support

**Processing:**
- `processCapabilityResponse()` in `packages/core/src/zig/terminal.zig`
- Updates `Capabilities` struct with detected features

#### Phase 2: Protocol Enablement

**Priority Order:**

1. **Kitty Keyboard Protocol** (Preferred)
   - **When:** Terminal supports it (detected via capability query)
   - **Enabled via:** `setKittyKeyboard()` in `terminal.zig`
   - **Benefits:**
     - Enhanced key reporting
     - Disambiguation of escape codes
     - Event types (press/repeat/release)
     - Alternate keys support
   - **Example:** Shift+Enter as distinct from Enter

2. **modifyOtherKeys Mode** (Fallback)
   - **When:** Terminal doesn't support Kitty protocol
   - **Enabled via:** `setModifyOtherKeys()` in `terminal.zig`
   - **Format:** `CSI 27; modifier; code ~`
   - **Purpose:** Encodes modified keys that lack standard escape sequences
   - **Examples:**
     - Ctrl+Enter: `\x1b[27;5;13~`
     - Shift+Enter: `\x1b[27;2;13~`
     - Alt+Space: Similar format

3. **Standard ANSI** (Universal Fallback)
   - **When:** Neither Kitty nor modifyOtherKeys available
   - **Format:** Traditional ANSI escape sequences
   - **Limitation:** Some key combinations not distinguishable

#### Phase 3: Input Processing Pipeline

**StdinBuffer (packages/core/src/lib/stdin-buffer.ts):**
```typescript
// Critical for handling fragmented escape sequences
- Accumulates incoming bytes
- isCompleteSequence() determines if chunk is complete
- Emits complete sequences to parseKeypress()
```

**Why Critical:**
- Escape sequences may arrive in chunks
- Prevents misinterpretation of partial sequences
- Essential for mouse events & double-escape sequences (Option+Arrow on macOS)

**parseKeypress() Multi-Protocol Parsing:**

```typescript
function parseKeypress(sequence: string, options: ParseOptions): ParsedKey | null {
  // 1. Filter non-keyboard events
  if (isMouseEvent(sequence) || isTerminalResponse(sequence)) {
    return null;
  }
  
  // 2. Try Kitty keyboard protocol (if enabled)
  if (options.useKittyKeyboard) {
    const kittyKey = parseKittyKeyboard(sequence);
    if (kittyKey) return { ...kittyKey, source: "kitty" };
  }
  
  // 3. Try modifyOtherKeys format
  const modifiedKey = parseModifyOtherKeys(sequence);
  if (modifiedKey) return modifiedKey;
  
  // 4. Parse standard ANSI sequences
  const ansiKey = parseAnsiSequence(sequence);
  if (ansiKey) return ansiKey;
  
  // 5. Parse raw ASCII/UTF-8
  return parseRawKey(sequence);
}
```

### Normalization Result

**Output: ParsedKey Interface**
```typescript
interface ParsedKey {
  name: string;      // Normalized key name
  ctrl: boolean;     // Normalized modifiers
  meta: boolean;
  shift: boolean;
  option: boolean;
  sequence: string;  // Original raw sequence
  source?: string;   // Parsing method used
}
```

### Terminal-Specific Handling Examples

**macOS Terminal:**
- Option+Arrow sends double-escape sequences
- StdinBuffer ensures complete sequence before parsing

**Windows Terminal:**
- May need explicit configuration for Shift+Enter
- modifyOtherKeys mode provides compatibility

**Kitty, WezTerm, etc.:**
- Native Kitty keyboard protocol support
- Best key reporting accuracy

---

## 5. OpenCode's Chat Input Implementation

**Source:** DeepWiki search on `anomalyco/opencode`  
**Key Files:**
- `packages/app/src/components/prompt-input.tsx` - Prompt component (desktop app)
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` - TUI Prompt component

### Shift+Enter Handling in Prompt Component

**Implementation Location:** `packages/app/src/components/prompt-input.tsx`

**Code Structure:**
```typescript
// In Prompt component
const handleKeyDown = (event: KeyboardEvent) => {
  // Check for Shift+Enter
  if (event.key === "Enter" && event.shiftKey) {
    // Add newline to input
    addPart("\n");
    
    // Prevent default Enter behavior (form submit)
    event.preventDefault();
    
    return;
  }
  
  // Regular Enter (without Shift) submits
  if (event.key === "Enter" && !event.shiftKey) {
    handleSubmit();
    return;
  }
  
  // Other keybindings...
  if (event.ctrlKey && event.key === "g") {
    // Cancel popovers or abort response
  }
  // Arrow keys for history navigation
};
```

### Component Configuration

**PromptProps Interface:**
```typescript
interface PromptProps {
  info: PromptInfo;                      // Prompt information
  imageAttachments: ImageAttachment[];   // Attached images
  mode: "normal" | "shell";              // Input mode
  working: boolean;                      // Processing state
  editor: EditorReference;               // Editor instance ref
  addToHistory: (input: string) => void; // History management
  setMode: (mode: string) => void;       // Mode switching
  onSubmit: (input: string) => void;     // Submit callback
}
```

**Additional Features:**
- **Input Modes:** "normal" vs "shell"
- **Autocomplete:** Integration with suggestion system
- **Command History:** Arrow key navigation through previous inputs
- **Image Attachments:** Support for attaching images to prompts

### Additional Keybindings in Prompt

```typescript
// From handleKeyDown implementation
Ctrl+G: Cancel popovers / abort running response
Up/Down Arrow: Navigate command history
Enter: Submit message (without Shift)
Shift+Enter: Insert newline
```

### Keybind Configuration

**Documentation Reference:** `input_newline` keybind
```
shift+return
ctrl+return  
alt+return
ctrl+j
```

This shows multiple keybinding options for inserting newlines across different interfaces.

### Terminal Configuration for Windows Terminal

**Note:** Some terminals don't send modifier keys by default for Shift+Enter.

**Windows Terminal Configuration:**
Add to `settings.json`:
```json
{
  "actions": [
    {
      "command": {
        "action": "sendInput",
        "input": "\u001b[27;2;13~"
      },
      "keys": "shift+enter"
    }
  ]
}
```

This ensures Windows Terminal sends the correct escape sequence (`\u001b[27;2;13~`) for Shift+Enter, which OpenTUI can then parse correctly.

### Architecture Notes

**Desktop Application vs TUI:**
- Desktop app (`packages/app`) uses SolidJS UI components
- Direct DOM event handling in `prompt-input.tsx`
- TUI version (`packages/opencode/src/cli/cmd/tui`) uses OpenTUI components
- Both implement similar Shift+Enter logic but at different layers

**Integration with OpenTUI:**
- Desktop app handles keyboard at DOM level (browser/Electron)
- TUI uses OpenTUI's terminal input processing
- Both normalize Shift+Enter → newline behavior

---

## Key Takeaways for VSCode Terminal Newline Extension

### 1. Multi-Protocol Support is Essential
- Different terminals support different protocols
- Implement fallback chain: Kitty → modifyOtherKeys → ANSI
- Capability detection before protocol enablement

### 2. Escape Sequence for Shift+Enter
**modifyOtherKeys format:** `\x1b[27;2;13~`
- CSI = `\x1b[`
- 27 = modifyOtherKeys indicator
- 2 = Shift modifier (bitmask)
- 13 = Enter key code
- ~ = sequence terminator

### 3. Terminal Configuration Required
For terminals that don't send modifiers by default:
```json
// Windows Terminal
{
  "keys": "shift+enter",
  "command": { "action": "sendInput", "input": "\u001b[27;2;13~" }
}
```

### 4. Input Buffering is Critical
- Escape sequences may arrive fragmented
- Need complete sequence detection before parsing
- Prevents misinterpretation of partial sequences

### 5. Keybinding System Design
- Serialize key events to unique strings
- Map to actions via lookup table
- Support custom bindings that override defaults
- Use aliases for key name flexibility

### 6. Two-Level Event Handling
- Global listeners (application-level)
- Component-specific listeners (focused component)
- Support for `preventDefault()` and `stopPropagation()`

### 7. Testing Considerations
- Mock different terminal escape sequences
- Test capability detection logic
- Verify fallback behavior when protocols unavailable
- Test input buffering with fragmented sequences

---

## Additional Resources

- **DeepWiki Searches:**
  - [Key Event Handling](https://deepwiki.com/search/how-does-opentui-handle-key-ev_cfe838a7-e298-423a-b20d-d8ac68bb9326)
  - [Shift+Enter in Textarea](https://deepwiki.com/search/how-does-opentuis-input-or-tex_2c972152-bdf4-43dd-ac69-dac4a82fc3ec)
  - [Keybinding System](https://deepwiki.com/search/what-key-mapping-or-binding-sy_feb9c5a1-c83d-413b-8894-0d04f286f50b)
  - [Terminal-Specific Handling](https://deepwiki.com/search/how-does-opentui-handle-termin_abfb17f7-7ba0-468e-b2a8-30b38361c497)
  - [OpenCode Chat Input](https://deepwiki.com/search/how-does-opencode-use-opentui_3f57410e-9463-4eb3-9a2a-bc8e631d9798)

- **OpenTUI Wiki Pages:**
  - [Input Handling](https://deepwiki.com/wiki/anomalyco/opentui#6)
  - [Input Components](https://deepwiki.com/wiki/anomalyco/opentui#4.3)

- **OpenCode Wiki Pages:**
  - [Architecture](https://deepwiki.com/wiki/anomalyco/opencode#2)
  - [Theme and UI Configuration](https://deepwiki.com/wiki/anomalyco/opencode#5.6)

---

## Implementation Recommendations

### For VSCode Extension

1. **Detect Terminal Capabilities First**
   - Query terminal for supported protocols
   - Enable Kitty protocol if available
   - Fallback to modifyOtherKeys if needed

2. **Implement Robust Parser**
   - Follow OpenTUI's parsing order
   - Handle fragmented sequences
   - Support multiple escape sequence formats

3. **User Configuration**
   - Provide instructions for terminal setup
   - Include escape sequence examples for popular terminals
   - Document Windows Terminal, iTerm2, Kitty configurations

4. **Testing Strategy**
   - Test with multiple terminal emulators
   - Mock different escape sequences
   - Verify fallback behavior
   - Test with fragmented input

5. **Keybinding Flexibility**
   - Allow users to customize newline key
   - Support aliases (Ctrl+J, Alt+Enter alternatives)
   - Provide escape hatch for conflicting bindings

---

**Research Completed:** 2026-02-22  
**Next Steps:** Apply findings to VSCode Terminal Newline Extension implementation
