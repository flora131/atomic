# OpenTUI Library Research

**Date:** January 31, 2026  
**Repository:** [anomalyco/opentui](https://github.com/anomalyco/opentui)  
**Documentation:** [DeepWiki - OpenTUI](https://deepwiki.com/anomalyco/opentui)

---

## Summary

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs) with a dual-layer architecture combining TypeScript for high-level logic and Zig for performance-critical operations. It provides flexbox-based layouts via Yoga, efficient native rendering with double-buffering, and framework integrations for React and SolidJS.

**Key Highlights:**
- Flexbox-based layout system using Yoga engine
- Native Zig rendering with double-buffering and diffing
- React and SolidJS reconcilers for declarative UI development
- Modern terminal protocol support (Kitty keyboard/mouse)
- Rich text handling with syntax highlighting

**Status:** Currently in development - NOT production ready

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component System](#component-system)
3. [Layout System](#layout-system)
4. [Styling and Theming](#styling-and-theming)
5. [Event Handling](#event-handling)
6. [Chat Interface Patterns](#chat-interface-patterns)
7. [Source File References](#source-file-references)
8. [Limitations and Known Issues](#limitations-and-known-issues)
9. [Additional Resources](#additional-resources)

---

## Architecture Overview

### Package Structure

OpenTUI is structured as a monorepo with three main packages:

| Package | Purpose |
|---------|---------|
| `@opentui/core` | Standalone core library with imperative API, native rendering, and UI primitives |
| `@opentui/react` | React reconciler for declarative TUI development |
| `@opentui/solid` | SolidJS reconciler for reactive integration |

### Dual-Layer Architecture

#### TypeScript Layer
Handles higher-level functionality:
- **Component System**: Manages `BaseRenderable`, `Renderable`, `BoxRenderable`, and `TextRenderable` hierarchies
- **Layout Engine**: Integrates Yoga for layout calculations and measure functions
- **Event System**: Manages focus, input routing, and event handling
- **Text Views**: Provides high-level text buffer APIs (`TextBufferView`, `EditorView`)
- **Syntax Highlighting**: Uses `web-tree-sitter` for syntax highlighting

#### Zig Native Layer
Handles performance-critical operations:
- **OptimizedBuffer**: Manages cell grid and grapheme pool for efficient rendering
- **Native Renderer**: Implements double buffering and diff algorithm for screen updates
- **Text Storage**: Uses rope structure for text storage with undo stacks and memory pooling
- **Terminal I/O**: Handles raw stdin/stdout, ANSI generation, and capability detection
- **UTF-8 Processing**: Manages grapheme parsing and width calculation

### FFI Integration

Communication between TypeScript and Zig layers uses Bun's FFI with `bun-ffi-structs`:
- Wrapper pattern for type safety
- Guard-based safety mechanisms
- Ownership transfer and resource cleanup

**Source:** [DeepWiki - High-Level Architecture](https://deepwiki.com/anomalyco/opentui#1.2)

---

## Component System

### Layout & Display Components

| Component | Description |
|-----------|-------------|
| `<box>` | Container with borders, background colors, and flexbox layout |
| `<scrollbox>` | Scrollable container for content |
| `<text>` | Styled text content display |
| `<ascii-font>` | Renders text using ASCII art fonts |
| `<markdown>` | Renders markdown content |

### Input Components

| Component | Description |
|-----------|-------------|
| `<input>` | Single-line text input with placeholder and focus states |
| `<textarea>` | Multi-line text input field |
| `<select>` | Option selector component |
| `<tab-select>` | Tab-based selection component |

### Code & Diff Components

| Component | Description |
|-----------|-------------|
| `<code>` | Code blocks with syntax highlighting |
| `<line-number>` | Code with line numbers and diagnostic indicators |
| `<diff>` | Diff viewer for code changes |

### Text Modifiers

Used within `<text>` components for inline styling:
- `<span>` - Inline styled text
- `<strong>`, `<b>` - Bold text
- `<em>`, `<i>` - Italic text
- `<u>` - Underlined text
- `<br>` - Line breaks
- `<a>` - Hyperlinks

### Component API Examples

#### Box Component

```typescript
<box
  border={true}
  padding={1}
  flexDirection="column"
  title="My Panel"
  backgroundColor="#1a1a1a"
  borderColor="#00ff00"
  borderStyle="single"
>
  {children}
</box>
```

#### Text Component

```typescript
<text fg="#00ff00" bg="#000000" content="Hello, Terminal!" />
```

#### Input Component

```typescript
<input
  placeholder="Type a message..."
  focused={true}
  onInput={(value) => console.log(value)}
  onSubmit={(value) => handleSubmit(value)}
/>
```

#### Select Component

```typescript
<select
  options={[
    { label: 'Option 1', value: '1' },
    { label: 'Option 2', value: '2' }
  ]}
  onChange={(option) => handleChange(option)}
  onSelect={(option) => handleSelect(option)}
/>
```

### React Hooks

| Hook | Purpose |
|------|---------|
| `useRenderer()` | Access to `CliRenderer` instance |
| `useKeyboard(handler, options?)` | Handle global keyboard events |
| `useOnResize(callback)` | Respond to terminal resize events |
| `useTerminalDimensions()` | Get current terminal dimensions |
| `useTimeline(options?)` | Create animations using timeline system |

**Source:** [DeepWiki - Quick Start with React](https://deepwiki.com/anomalyco/opentui#2.2)

---

## Layout System

OpenTUI uses the **Yoga layout engine** for CSS flexbox-like layout capabilities.

### Flexbox Properties

| Property | Description | Setter |
|----------|-------------|--------|
| `flexDirection` | Main axis direction: `"row"`, `"column"`, `"row-reverse"`, `"column-reverse"` | `node.setFlexDirection()` |
| `flexGrow` | Ability to grow | `yogaNode.setFlexGrow(grow)` |
| `flexShrink` | Ability to shrink | `yogaNode.setFlexShrink(value)` |
| `alignItems` | Cross-axis alignment | `yogaNode.setAlignItems()` |
| `justifyContent` | Main-axis alignment | `yogaNode.setJustifyContent()` |
| `padding` | Inner spacing | `node.setPadding()` |
| `margin` | Outer spacing | `node.setMargin()` |

### Absolute Positioning

```typescript
<box
  position="absolute"
  top={0}
  right={0}
  bottom={0}
  left={0}
>
  {content}
</box>
```

### Responsive Design

OpenTUI handles terminal size changes automatically:

1. **Terminal Dimension Tracking**: `CliRenderer` tracks `_terminalWidth` and `_terminalHeight`
2. **Resize Event Handling**: `processResize` method updates dimensions
3. **Root Layout Recalculation**: Triggers `yogaNode.calculateLayout()`
4. **Component Updates**: Each `Renderable` calls `updateFromLayout()` with new dimensions

#### Using Hooks for Responsiveness

```typescript
function ResponsiveComponent() {
  const { width, height } = useTerminalDimensions();
  
  return (
    <box flexDirection={width > 80 ? 'row' : 'column'}>
      {/* Content adapts to terminal size */}
    </box>
  );
}
```

**Note:** Grid layout is NOT supported - OpenTUI uses flexbox only via Yoga.

**Source:** [DeepWiki - Box Component](https://deepwiki.com/anomalyco/opentui#4.1.1)

---

## Styling and Theming

### Color System

Colors are managed using the `RGBA` class with support for:
- RGB integers
- Float values
- Hex strings (e.g., `"#00ff00"`)

#### Color Utilities

```typescript
import { RGBA, parseColor, red, blue, bgBlack, fg, bg } from '@opentui/core';

// Using convenience functions
const errorColor = red();
const warningBg = bgBlack();

// Custom colors
const customFg = fg('#00ff00');
const customBg = bg('#1a1a1a');
```

### Text Styling

#### Text Attributes

```typescript
import { TextAttributes, bold, italic, underline } from '@opentui/core';

// Combine attributes with bitwise OR
const boldUnderline = TextAttributes.BOLD | TextAttributes.UNDERLINE;
```

#### VStyles Helpers

```typescript
import { vstyles } from '@opentui/core';

// Basic styles
vstyles.bold("Important Message");
vstyles.italic("Emphasized text");
vstyles.underline("Linked text");

// Combined styles
vstyles.boldItalic("Bold and italic");

// Colors
vstyles.color("#00ff00", "Green text");
vstyles.bgColor("#1a1a1a", "With background");
```

### Border Styling

```typescript
<box
  border={true}
  borderStyle="single"  // or "double"
  borderColor="#00ff00"
  focusedBorderColor="#00ffff"
  customBorderChars={{/* custom characters */}}
>
  {content}
</box>
```

### Syntax Highlighting

```typescript
import { SyntaxStyle } from '@opentui/core';

const darkTheme = SyntaxStyle.fromTheme({
  keyword: '#ff79c6',
  string: '#f1fa8c',
  comment: '#6272a4',
  // ... more token styles
});

<code
  content={sourceCode}
  filetype="typescript"
  syntaxStyle={darkTheme}
/>
```

### Theme Implementation

OpenTUI does NOT have built-in dark/light theme toggle. Implement theming by:

1. Define theme objects with color values
2. Pass theme colors to component props dynamically
3. Use React context or state management for theme switching

```typescript
const themes = {
  dark: {
    bg: '#1a1a1a',
    fg: '#ffffff',
    accent: '#00ff00'
  },
  light: {
    bg: '#ffffff',
    fg: '#1a1a1a',
    accent: '#0066ff'
  }
};

function ThemedBox({ theme, children }) {
  return (
    <box backgroundColor={themes[theme].bg}>
      <text fg={themes[theme].fg}>{children}</text>
    </box>
  );
}
```

**Source:** [DeepWiki - Framework Integration](https://deepwiki.com/anomalyco/opentui#7)

---

## Event Handling

### Event Flow Architecture

```
Raw Input (stdin) -> StdinBuffer -> Input Parsers -> Dispatch -> Renderable
```

1. **Raw Input**: `process.stdin` receives raw bytes
2. **Input Buffering**: `StdinBuffer` assembles bytes into sequences
3. **Parsing**: `KeyHandler` (keyboard) and `MouseParser` (mouse) interpret sequences
4. **Dispatch**: Events routed to focused `Renderable` or hit-tested target

### Keyboard Input

#### KeyEvent Object

```typescript
interface KeyEvent {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  eventType: 'press' | 'release';
  preventDefault(): void;
  stopPropagation(): void;
}
```

#### Using useKeyboard Hook

```typescript
import { useKeyboard } from '@opentui/react';

function ChatInput() {
  useKeyboard((event) => {
    if (event.name === 'escape') {
      event.preventDefault();
      handleCancel();
    }
  });
  
  return <input />;
}
```

#### Direct Event Listeners

```typescript
const inputRenderable = new InputRenderable(renderer, {
  onKeyDown: (event) => {
    if (event.ctrl && event.name === 'c') {
      handleCopy();
    }
  }
});
```

### Mouse Events

#### Supported Mouse Events

| Event | Description |
|-------|-------------|
| `onMouseDown` | Mouse button pressed |
| `onMouseUp` | Mouse button released |
| `onMouseMove` | Mouse moved |
| `onMouseOver` | Mouse entered element |
| `onMouseOut` | Mouse left element |
| `onMouseDrag` | Mouse dragged |
| `onMouseDragEnd` | Drag ended |
| `onMouseDrop` | Drop event |
| `onMouseScroll` | Scroll wheel event |

#### Mouse Event Handling

```typescript
const box = new BoxRenderable(renderer, {
  onMouseDown: (event) => {
    console.log(`Clicked at (${event.x}, ${event.y})`);
    event.propagationStopped = true; // Stop propagation
  },
  onMouseScroll: (event) => {
    handleScroll(event.delta);
  }
});
```

### Global Input Handlers

```typescript
// Add handler to end of chain
renderer.addInputHandler((sequence) => {
  // Process raw input
  return false; // Return true to consume
});

// Add handler to beginning of chain
renderer.prependInputHandler((sequence) => {
  // Process before other handlers
  return false;
});
```

### Focus Management

```typescript
// Set focus programmatically
inputRenderable.focus();

// Check focus state
if (inputRenderable.focused) {
  // Handle focused state
}
```

**Source:** [DeepWiki - High-Level Architecture](https://deepwiki.com/anomalyco/opentui#1.2)

---

## Chat Interface Patterns

### Basic Chat Structure

```typescript
import { 
  createCliRenderer, 
  BoxRenderable, 
  TextRenderable, 
  ScrollBoxRenderable 
} from "@opentui/core";

async function createChatInterface() {
  const renderer = await createCliRenderer();

  // Chat message container with sticky scroll
  const chatContainer = new ScrollBoxRenderable(renderer, {
    rootOptions: {
      border: true,
      title: "Chat",
      flexGrow: 1,
    },
    scrollY: true,
    stickyScroll: true,      // Enable sticky scroll
    stickyStart: "bottom",   // Stick to bottom for new messages
    viewportCulling: true,   // Optimize for many messages
  });

  renderer.root.add(chatContainer);
  renderer.start();
  
  return { renderer, chatContainer };
}
```

### Adding Chat Messages

```typescript
function addChatMessage(
  container: ScrollBoxRenderable, 
  sender: string, 
  message: string
) {
  const messageBox = new BoxRenderable(renderer, {
    flexDirection: "row",
    marginBottom: 1,
    padding: { left: 1, right: 1 },
  });

  const senderText = new TextRenderable(renderer, {
    content: `${sender}: `,
    fg: sender === "User" ? "#00FF00" : "#00FFFF",
    marginRight: 1,
  });
  
  const messageText = new TextRenderable(renderer, {
    content: message,
    flexGrow: 1,
  });

  messageBox.add(senderText);
  messageBox.add(messageText);
  container.add(messageBox);
}
```

### Streaming Text Rendering

For AI responses that arrive incrementally:

```typescript
import { CodeRenderable } from "@opentui/core";

function createStreamingMessage(container: ScrollBoxRenderable) {
  const messageBox = new BoxRenderable(renderer, {
    flexDirection: "row",
    marginBottom: 1,
  });

  const senderText = new TextRenderable(renderer, {
    content: "AI: ",
    fg: "#00FFFF",
  });

  // Use CodeRenderable for streaming with syntax highlighting
  const streamingContent = new CodeRenderable(renderer, {
    content: "",
    filetype: "markdown",
    streaming: true,
    drawUnstyledText: true,  // Render immediately
    flexGrow: 1,
  });

  messageBox.add(senderText);
  messageBox.add(streamingContent);
  container.add(messageBox);

  return streamingContent;
}

// Update streaming content as it arrives
async function handleStreamingResponse(
  streamingContent: CodeRenderable,
  responseStream: AsyncIterable<string>
) {
  let fullContent = "";
  
  for await (const chunk of responseStream) {
    fullContent += chunk;
    streamingContent.content = fullContent;
  }
}
```

### MarkdownRenderable for Streaming

```typescript
import { MarkdownRenderable } from "@opentui/core";

const streamingMarkdown = new MarkdownRenderable(renderer, {
  content: "",
  streaming: true,  // Enable incremental parsing
  flexGrow: 1,
});

// Update as content streams in
streamingMarkdown.content = newMarkdownContent;
```

### Complete Chat Interface Example

```typescript
import { 
  createCliRenderer, 
  BoxRenderable, 
  TextRenderable, 
  ScrollBoxRenderable,
  InputRenderable 
} from "@opentui/core";

async function buildChatApp() {
  const renderer = await createCliRenderer();

  // Main container
  const mainContainer = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
  });

  // Chat history
  const chatHistory = new ScrollBoxRenderable(renderer, {
    rootOptions: {
      border: true,
      title: "Messages",
      flexGrow: 1,
    },
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
  });

  // Input area
  const inputContainer = new BoxRenderable(renderer, {
    border: true,
    height: 3,
    title: "Type a message",
  });

  const messageInput = new InputRenderable(renderer, {
    placeholder: "Enter message...",
    flexGrow: 1,
    onSubmit: (value) => {
      addMessage(chatHistory, "User", value);
      messageInput.value = "";
      // Trigger AI response...
    },
  });

  inputContainer.add(messageInput);
  mainContainer.add(chatHistory);
  mainContainer.add(inputContainer);
  renderer.root.add(mainContainer);

  // Focus the input
  messageInput.focus();
  
  renderer.start();
}
```

**Source:** [DeepWiki - ScrollBox](https://deepwiki.com/anomalyco/opentui#4.1.2)

---

## Source File References

### Core Package (`packages/core/src/`)

| File | Class/Module |
|------|--------------|
| `packages/core/src/renderer.ts` | `CliRenderer` - main renderer class |
| `packages/core/src/renderables/Box.ts` | `BoxRenderable` |
| `packages/core/src/renderables/Text.ts` | `TextRenderable` |
| `packages/core/src/renderables/ScrollBox.ts` | `ScrollBoxRenderable` |
| `packages/core/src/renderables/Input.ts` | `InputRenderable` |
| `packages/core/src/renderables/Code.ts` | `CodeRenderable` |
| `packages/core/src/renderables/Markdown.ts` | `MarkdownRenderable` |
| `packages/core/src/renderables/composition/constructs.ts` | `Box`, `Text` helper functions |

### Native Layer (`packages/core/src/zig/`)

| File | Purpose |
|------|---------|
| `packages/core/src/zig/renderer.zig` | Native Zig renderer |
| `packages/core/src/zig/lib.zig` | FFI interface definitions |

### Framework Integrations

| File | Purpose |
|------|---------|
| `packages/react/src/components/index.ts` | React component catalogue |
| `packages/solid/src/types/elements.ts` | SolidJS type definitions |

### Test Snapshots

| File | Purpose |
|------|---------|
| `packages/core/src/tests/__snapshots__/absolute-positioning.snapshot.test.ts.snap` | Absolute positioning examples |

---

## Limitations and Known Issues

### Production Readiness

> **WARNING:** OpenTUI is explicitly stated to be in development and NOT ready for production use.

### Known Bugs

| Issue | Description |
|-------|-------------|
| **Multi-width Characters** | `offsetToCharOffset` in `extmarks.ts` doesn't correctly handle multi-width display characters (e.g., Chinese characters), causing incorrect highlighting in `Textarea` |
| **Renderer Destroy Crash** | Calling `renderer.destroy()` without first unmounting React components causes native Yoga "use-after-free" crash |
| **InputRenderable Change Event** | `CHANGE` event only emits when Enter is pressed (documented as "will be fixed in the future") |

### Development Limitations

| Limitation | Details |
|------------|---------|
| **Runtime Requirement** | Requires Bun as runtime and package manager |
| **Build Requirement** | Requires Zig for compiling native modules during development |
| **React Extension** | Extended components require manual TypeScript module augmentation |
| **Console Output** | `console.log` output is not visible when running OpenTUI applications |

### Workarounds

#### Proper Cleanup Pattern

```typescript
// Always unmount React before destroying renderer
root.unmount();
await renderer.destroy();
```

#### Multi-width Character Handling

Be aware of potential visual offset issues when dealing with non-ASCII text. Consider using ASCII-only content for critical UI elements.

**Source:** [DeepWiki - Debugging](https://deepwiki.com/anomalyco/opentui#9.4)

---

## Additional Resources

### Wiki Pages

| Topic | Link |
|-------|------|
| Overview | [DeepWiki - Overview](https://deepwiki.com/anomalyco/opentui#1) |
| Package Structure | [DeepWiki - Package Structure](https://deepwiki.com/anomalyco/opentui#1.1) |
| High-Level Architecture | [DeepWiki - Architecture](https://deepwiki.com/anomalyco/opentui#1.2) |
| Installation | [DeepWiki - Installation](https://deepwiki.com/anomalyco/opentui#2.1) |
| Quick Start with React | [DeepWiki - React Quick Start](https://deepwiki.com/anomalyco/opentui#2.2) |
| Quick Start with Solid | [DeepWiki - Solid Quick Start](https://deepwiki.com/anomalyco/opentui#2.3) |
| Quick Start with Core | [DeepWiki - Core Quick Start](https://deepwiki.com/anomalyco/opentui#2.4) |
| Renderable System | [DeepWiki - Renderable System](https://deepwiki.com/anomalyco/opentui#3.1) |
| Layout System (Yoga) | [DeepWiki - Layout System](https://deepwiki.com/anomalyco/opentui#3.2) |
| Rendering Pipeline | [DeepWiki - Rendering Pipeline](https://deepwiki.com/anomalyco/opentui#3.3) |
| Event System | [DeepWiki - Event System](https://deepwiki.com/anomalyco/opentui#3.4) |
| Box Component | [DeepWiki - Box](https://deepwiki.com/anomalyco/opentui#4.1.1) |
| ScrollBox Component | [DeepWiki - ScrollBox](https://deepwiki.com/anomalyco/opentui#4.1.2) |
| Text Components | [DeepWiki - Text](https://deepwiki.com/anomalyco/opentui#4.2.1) |
| Input Components | [DeepWiki - Input](https://deepwiki.com/anomalyco/opentui#4.3.1) |
| Code Components | [DeepWiki - Code](https://deepwiki.com/anomalyco/opentui#4.4.1) |
| Keyboard Events | [DeepWiki - Keyboard Events](https://deepwiki.com/anomalyco/opentui#6.1) |
| Mouse Events | [DeepWiki - Mouse Events](https://deepwiki.com/anomalyco/opentui#6.2) |
| React Integration | [DeepWiki - React Integration](https://deepwiki.com/anomalyco/opentui#7.1) |
| SolidJS Integration | [DeepWiki - SolidJS Integration](https://deepwiki.com/anomalyco/opentui#7.2) |
| Native Layer | [DeepWiki - Native Layer](https://deepwiki.com/anomalyco/opentui#8) |
| Debugging | [DeepWiki - Debugging](https://deepwiki.com/anomalyco/opentui#9.4) |

### GitHub Repository

- **Repository:** https://github.com/anomalyco/opentui
- **Issues:** https://github.com/anomalyco/opentui/issues

---

## Gaps and Future Investigation

1. **Grid Layout**: No grid layout system - only flexbox via Yoga
2. **Theme System**: No built-in theme toggle - requires manual implementation
3. **Accessibility**: No documentation found on accessibility features
4. **Animation API**: `useTimeline` hook mentioned but not fully documented
5. **Performance Benchmarks**: No performance comparison data available
6. **Error Boundaries**: No React error boundary patterns documented

---

*Research conducted using DeepWiki AI-powered documentation analysis on January 31, 2026*
