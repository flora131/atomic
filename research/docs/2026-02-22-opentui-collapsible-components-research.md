# OpenTUI Collapsible Components Research

**Date**: 2026-02-22  
**Repository**: anomalyco/opentui  
**Research Focus**: Component capabilities, interactive components, collapsible/accordion patterns, rendering system, and component API

---

## Executive Summary

OpenTUI is a modern terminal UI framework that provides React and SolidJS integrations for building interactive terminal applications. While it doesn't include built-in accordion/collapsible components, it provides a robust foundation for creating custom interactive components with:

- **Component extensibility** via custom `Renderable` classes
- **Full event handling** for keyboard and mouse interactions
- **State management** through React hooks or SolidJS signals
- **Flexbox-based layouts** using the Yoga layout engine
- **Dynamic visibility control** via the `visible` property and conditional rendering

---

## 1. OpenTUI Components Overview

### 1.1 Built-in Components

OpenTUI provides components across several categories:

#### Layout & Display Components
- **`<text>`**: Displays styled text content
  ```tsx
  <text>Hello World</text>
  <text>
    <span fg="red">Red Text</span>
  </text>
  <text>
    <strong>Bold</strong>, <em>Italic</em>, and <u>Underlined</u>
  </text>
  ```

- **`<box>`**: Container component with borders, backgrounds, and layout capabilities
  ```tsx
  <box border>
    <text>Simple box</text>
  </box>
  <box title="Settings" border borderStyle="double" padding={2} backgroundColor="blue">
    <text>Box content</text>
  </box>
  ```

- **`<scrollbox>`**: Scrollable container
- **`<ascii-font>` / `<ascii_font>`**: ASCII art fonts

#### Input Components
- **`<input>`**: Single-line text input field
  ```tsx
  <input placeholder="Enter your name..." focused />
  ```

- **`<textarea>`**: Multi-line text input field
  ```tsx
  <textarea ref={textareaRef} placeholder="Type here..." focused />
  ```

- **`<select>`**: List selection component
  ```tsx
  <select
    style={{ height: 22 }}
    options={options}
    focused={true}
    onChange={(index, option) => {
      setSelectedIndex(index)
      console.log("Selected:", option)
    }}
  />
  ```

- **`<tab-select>` / `<tab_select>`**: Horizontal tab-based selection

#### Code & Diff Components
- **`<code>`**: Code blocks with syntax highlighting
- **`<line-number>` / `<line_number>`**: Code with line numbers and diagnostics
- **`<diff>`**: Unified or split diff viewer

#### Text Modifiers (Inside `<text>` only)
- **`<span>`**: Inline styled text
- **`<strong>` / `<b>`**: Bold text
- **`<em>` / `<i>`**: Italic text
- **`<u>`**: Underline text
- **`<br>`**: Line break
- **`<a>`**: Link text with `href`

#### Other Components
- **`<markdown>`**: Markdown renderer
- **`<scrollbar>`**: Standalone scroll bar control
- **`<slider>`**: Numeric slider control
- **`<frame-buffer>` / `FrameBuffer`**: Low-level rendering surface

### 1.2 No Built-in Collapsible/Accordion Component

**Key Finding**: OpenTUI does not provide a built-in collapsible, accordion, or toggle component. However, these can be created as custom components by extending base renderables.

---

## 2. Interactive Components & Event Handling

### 2.1 Click Handling

OpenTUI provides comprehensive mouse event support through an event processing pipeline:

#### Mouse Event Flow
1. **Parsing**: Raw mouse bytes in SGR format processed by `MouseParser`
2. **Hit Testing**: `checkHit(x, y)` determines which component is at mouse coordinates using a `currentHitGrid`
3. **Event Creation**: `MouseEvent` object created with type, button, coordinates, and target
4. **Dispatch**: Event dispatched via `target.processMouseEvent(event)` - can bubble up parent chain
5. **Auto-Focus**: Left-click automatically focuses nearest focusable ancestor (unless `event.preventDefault()` called)

#### Mouse Event Handlers
Available handlers on components:
- `onMouseDown`
- `onMouseUp`
- `onMouseMove`
- `onMouseDrag`
- `onMouseOver`
- `onMouseOut`
- `onMouseScroll`

**Example**:
```typescript
const button = new BoxRenderable(renderer, {
  id: "button",
  border: true,
  onMouseDown: (event) => {
    console.log("Clicked at", event.x, event.y)
  },
  onMouseOver: (event) => {
    button.borderColor = "#FFFF00"
  },
  onMouseOut: (event) => {
    button.borderColor = "#FFFFFF"
  },
})
```

Mouse events bubble up the component tree. Use `event.stopPropagation()` to stop this propagation.

### 2.2 Key Press Handling

Keyboard events are managed by the `KeyHandler` and `InternalKeyHandler` classes, supporting ANSI, `modifyOtherKeys`, and Kitty keyboard protocols.

#### Key Event Flow
1. **Raw Input**: Keyboard bytes received from `stdin`
2. **Parsing**: `parseKeypress()` converts to `ParsedKey` object with key name, modifiers, and event type
3. **Event Emission**: `InternalKeyHandler` emits `KeyEvent` objects

#### Event Priority System
Two-tier event handling:
- **Global Listeners**: Registered via `renderer.keyInput.on("keypress", ...)` - processed first
- **Renderable Listeners**: `onKeyPress` handlers on individual components - processed after global handlers

Both event types provide:
- `preventDefault()` - Stop further processing by renderable handlers
- `stopPropagation()` - Stop iteration through remaining handlers

#### Global Keyboard Listener Example
```typescript
import { type KeyEvent } from "@opentui/core"

const keyHandler = renderer.keyInput

keyHandler.on("keypress", (key: KeyEvent) => {
  console.log("Key name:", key.name)
  console.log("Sequence:", key.sequence)
  console.log("Ctrl pressed:", key.ctrl)

  if (key.name === "escape") {
    console.log("Escape pressed!")
  } else if (key.ctrl && key.name === "c") {
    console.log("Ctrl+C pressed!")
  }
})
```

#### React Hook Example
```tsx
import { useKeyboard } from "@opentui/react"

function App() {
  useKeyboard((key) => {
    if (key.name === "escape") {
      process.exit(0)
    }
  })
  return <text>Press ESC to exit</text>
}
```

#### Renderable-Specific Handler Example
```typescript
const input = new InputRenderable(renderer, {
  id: "input",
  onKeyDown: (key) => {
    if (key.name === "escape") {
      input.blur()
    }
  },
  onPaste: (event) => {
    console.log("Pasted:", event.text)
  },
})
```

### 2.3 Paste Events

OpenTUI supports bracketed paste mode:
1. **Detection**: Detects `\x1b[200~` (start) and `\x1b[201~` (end) markers
2. **Buffering**: Content between markers is accumulated
3. **Stripping ANSI**: Pasted content cleaned of ANSI escape codes
4. **Emission**: `PasteEvent` emitted via `KeyHandler.processPaste()`

Listen globally via `renderer.keyInput.on("paste", ...)` or on focusable renderables with `onPaste` handler.

### 2.4 Custom Input Handlers

Add custom input handlers to process raw terminal sequences:
```typescript
renderer.addInputHandler((sequence) => {
  if (sequence === "\x1b[A") {
    // Up arrow - handle and consume
    return true
  }
  return false // Let other handlers process
})
```

Use `prependInputHandler()` to add handlers before built-in handlers.

---

## 3. State Management

OpenTUI integrates with React and SolidJS for state management, leveraging their native reactivity systems.

### 3.1 React Hooks

#### Standard React Hooks

**`useState`**: Add state to functional components
```tsx
function App() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [focused, setFocused] = useState<"username" | "password">("username")
  const [status, setStatus] = useState("idle")
  // ...
}
```

**`useEffect`**: Side effects in functional components
```tsx
function App() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return <text>Count: {count}</text>
}
```

### 3.2 OpenTUI-Specific Hooks

#### `useRenderer()`
Provides access to the `CliRenderer` instance:
```tsx
import { useRenderer } from "@opentui/react"

function App() {
  const renderer = useRenderer()

  useEffect(() => {
    renderer.console.show()
    console.log("Hello, from the console!")
  }, [])

  return <box />
}
```

#### `useKeyboard(handler, options?)`
Subscribe to keyboard events:
```tsx
import { useKeyboard } from "@opentui/react"

function App() {
  useKeyboard((key) => {
    if (key.name === "escape") {
      process.exit(0)
    }
  })

  return <text>Press ESC to exit</text>
}
```

Configure with `{ release: true }` to receive key release events.

#### `useOnResize(callback)`
Register callback for terminal resize events:
```tsx
import { useOnResize } from "@opentui/react"

function App() {
  useOnResize((width, height) => {
    console.log(`Terminal resized to ${width}x${height}`)
  })
  return <text>Resize-aware component</text>
}
```

#### `useTerminalDimensions()`
Get current terminal dimensions with auto-updates on resize:
```tsx
import { useTerminalDimensions } from "@opentui/react"

function App() {
  const { width, height } = useTerminalDimensions()

  return (
    <box>
      <text>
        Terminal dimensions: {width}x{height}
      </text>
    </box>
  )
}
```

#### `useTimeline(options?)`
Create and manage animations:
```tsx
import { useTimeline } from "@opentui/react"
import { useEffect, useState } from "react"

function App() {
  const [width, setWidth] = useState(0)

  const timeline = useTimeline({
    duration: 2000,
    loop: false,
  })

  useEffect(() => {
    timeline.add(
      { width },
      {
        width: 50,
        duration: 2000,
        ease: "linear",
        onUpdate: (animation) => {
          setWidth(animation.targets[0].width)
        },
      },
    )
  }, [])

  return <box style={{ width, backgroundColor: "#6a5acd" }} />
}
```

### 3.3 SolidJS Integration

For SolidJS, use native reactivity primitives like `createSignal` for state management:
```tsx
import { createSignal } from "solid-js"

function App() {
  const [count, setCount] = createSignal(0)
  
  return <text>Count: {count()}</text>
}
```

---

## 4. Terminal Rendering System

### 4.1 Rendering Architecture

OpenTUI uses a sophisticated multi-stage pipeline combining TypeScript orchestration with native Zig performance optimization.

#### Core Rendering Primitive: OptimizedBuffer

Uses a Structure of Arrays (SoA) layout for cache efficiency:
- `char: []u32` - Character/grapheme IDs
- `fg: []RGBA` - Foreground colors (float[4])
- `bg: []RGBA` - Background colors (float[4])
- `attributes: []u32` - Text attributes (bold, italic, etc.)

#### Buffer Drawing Methods (FFI)
- `bufferDrawText()` - Render UTF-8 text with colors
- `bufferFillRect()` - Fill rectangular regions
- `bufferDrawBox()` - Draw boxes with borders
- `bufferSetCell()` - Set individual cells
- `bufferPushScissorRect()` / `bufferPopScissorRect()` - Clipping regions

### 4.2 Rendering Pipeline Stages

Executes in the `loop()` method:

#### 1. Frame Scheduling
Maintains scheduling state with FPS throttling:
- `rendering: boolean` - Active render pass flag
- `updateScheduled: boolean` - Frame queued flag
- `targetFrameTime: number` - Minimum ms between frames (1000/targetFps)
- `minTargetFrameTime: number` - Hard limit (1000/maxFps)

#### 2. Layout Pass
Before rendering, `root.render()` is called, triggering layout calculation via Yoga's flexbox engine to compute positions and dimensions.

#### 3. TypeScript Render Pass
Components draw to `nextRenderBuffer`:
```
root.render(nextRenderBuffer, deltaTime)
postProcessFns execute
console renders to buffer
```

Each renderable's `render()` method:
1. Optionally uses an offscreen `frameBuffer` if buffered mode is enabled
2. Calls `renderBefore()` hook
3. Calls `renderSelf()` to draw content
4. Calls `renderAfter()` hook
5. Registers hit grid regions via `addToHitGrid()`
6. Composites buffered content back to main buffer if needed

#### 4. Native Render Pass (Zig)
The `renderNative()` method calls the FFI boundary:
```typescript
this.lib.render(this.rendererPtr, force)
```

This invokes the native `render()` function in Zig, which performs buffer diffing and ANSI generation.

### 4.3 Double Buffering System

#### TypeScript Buffers
- `nextRenderBuffer: OptimizedBuffer` - Target for component drawing
- `currentRenderBuffer: OptimizedBuffer` - Previous frame's output

#### Native Side (Zig)
After rendering, the native `render()` function:
1. Diffs `nextBuffer` vs `currentBuffer` cell-by-cell
2. Generates ANSI escape sequences for changed cells only
3. Swaps buffer pointers so next frame draws to the cleared previous buffer

### 4.4 Buffer Diffing Algorithm

Uses epsilon-based color comparison with `COLOR_EPSILON_DEFAULT = 0.00001` for float precision.

For each cell, compares:
- Character value (u32)
- Foreground RGBA
- Background RGBA
- Attributes bitfield

**Optimizations**:
- Consecutive cells with same colors use single SGR code
- Cursor movements use relative positioning when shorter
- Unchanged cells skip all output

### 4.5 Hit Grid Management

Parallel to rendering, hit grids map screen coordinates to renderable IDs:
- `currentHitGrid: []u32` - Active grid for mouse queries
- `nextHitGrid: []u32` - Grid being built during render
- `hitScissorStack: ArrayListUnmanaged(ClipRect)` - Clipping regions

During render, each renderable calls `addToHitGrid()` to register its screen region. After rendering, grids swap for next frame's mouse event dispatch.

### 4.6 Performance Characteristics

Frame timing respects FPS limits:
```typescript
const targetFrameTime = immediateRerenderRequested ? minTargetFrameTime : targetFrameTime
const delay = Math.max(1, targetFrameTime - Math.floor(overallFrameTime))
```

**Optional threaded rendering** prevents blocking the event loop during slow I/O by running stdout writes on a background thread while ANSI generation happens on the main thread.

---

## 5. Layout System

### 5.1 Layout Engine

OpenTUI uses the **Yoga layout engine** to provide CSS Flexbox-like layouts. Each `Renderable` object has a `YogaNode` for layout calculations.

#### Key Properties
- `x`, `y`, `width`, `height` - Computed by Yoga engine
- `updateFromLayout()` - Called after Yoga calculates layout
- `onLayoutResize()` - Triggered when size changes

### 5.2 Flexbox Support

Standard Flexbox properties available on `Renderable` objects:

- `flexGrow`, `flexShrink`, `flexBasis` - Control growth/shrinkage
- `flexDirection` - Main axis direction (`"row"`, `"column"`)
- `alignItems`, `justifyContent`, `alignSelf` - Alignment
- `flexWrap` - Control wrapping of flex items

**Example**:
```tsx
<box 
  flexDirection="row" 
  justifyContent="space-between" 
  alignItems="center"
>
  {/* children */}
</box>
```

### 5.3 Positioning

Two main positioning types:
- **Relative (Default)**: Elements flow normally within the layout
- **Absolute**: Elements positioned relative to parent using `top`, `right`, `bottom`, `left` properties

The `position` property on a `Renderable` determines positioning behavior.

### 5.4 Sizing

#### Fixed Sizes
```tsx
<box width={30} height={10} />
```

#### Percentage Sizes
```tsx
<box width="100%" height="50%" />
```

#### Flex Sizing
```tsx
<box flexGrow={1} flexShrink={0} flexBasis="auto" />
```

#### Constraints
```tsx
<box minWidth={20} maxWidth={100} minHeight={5} maxHeight={50} />
```

#### Spacing
- `margin` - Outer spacing
- `padding` - Inner spacing
- Axis-specific: `marginTop`, `paddingLeft`, etc.

### 5.5 Parent-Child Relationships

`Renderable` objects form a hierarchical tree structure:

- **`add()`**: Append a child `Renderable` to a parent
- **`remove()`**: Remove a child by its ID
- **`insertBefore()`**: Insert a child before a specified anchor child
- **`getChildren()`**: Get all children
- **`getChildrenCount()`**: Get child count
- **`getRenderable(id)`**: Get child by ID
- **`findDescendantById(id)`**: Find descendant by ID

When children are added or removed, their layout is updated accordingly.

---

## 6. Dynamic Show/Hide

### 6.1 Using the `visible` Property

Every `Renderable` component has a `visible` property:
```typescript
// Hide (also removes from layout)
panel.visible = false

// Show
panel.visible = true
```

When `visible` is set to `false`, the component is removed from layout calculation (similar to `display: none` in CSS).

Internally, setting `visible` calls `this.yogaNode.setDisplay(value ? Display.Flex : Display.None)` and triggers a re-render.

### 6.2 Conditional Rendering with React

Use standard React conditional rendering:
```tsx
function App() {
  const [showContent, setShowContent] = useState(true)
  
  return (
    <box>
      {showContent && (
        <text>Visible content</text>
      )}
      <text>Always visible</text>
    </box>
  )
}
```

### 6.3 Conditional Rendering with SolidJS

#### `<Show>` Component
Conditionally render based on a `when` prop with optional `fallback`:

```tsx
import { Show, createSignal } from "solid-js"

function App() {
  const [showContent, setShowContent] = createSignal(true)
  
  return (
    <box>
      <Show when={showContent()} fallback={<text>Fallback content</text>}>
        <text>Main content</text>
      </Show>
    </box>
  )
}
```

#### `<Switch>` and `<Match>` Components
For multiple conditional states:

```tsx
import { Switch, Match, createSignal } from "solid-js"

function App() {
  const [value, setValue] = createSignal("option1")
  
  return (
    <box>
      <Switch fallback={<text>No match</text>}>
        <Match when={value() === "option1"}>
          <text>Option 1 selected</text>
        </Match>
        <Match when={value() === "option2"}>
          <text>Option 2 selected</text>
        </Match>
      </Switch>
    </box>
  )
}
```

---

## 7. Component API

### 7.1 Component Definition with JSX/TSX

OpenTUI provides React and SolidJS integrations using JSX/TSX syntax. Components map JSX elements to underlying `Renderable` classes through a reconciler pattern.

#### Basic Component Example
```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

function App() {
  return <text>Hello, world!</text>
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

### 7.2 Props System

#### Direct Props and Style Prop
```tsx
// Direct props
<box backgroundColor="blue" padding={2}>
  <text>Hello, world!</text>
</box>

// Style prop
<box style={{ backgroundColor: "blue", padding: 2 }}>
  <text>Hello, world!</text>
</box>
```

#### Type-Safe Props
Props are automatically derived from the underlying `Renderable` constructor options using `ComponentProps<TOptions, TRenderable>`, which:
- Extracts properties from the renderable's constructor options
- Supports a `style` prop for styling properties
- Excludes non-styleable properties from the `style` object
- Includes React-specific props like `children` and event handlers

The JSX namespace declares `IntrinsicElements` with proper typing for each component.

### 7.3 Creating Custom Components

Custom components are created by:
1. Extending a base `Renderable` class (e.g., `BoxRenderable`)
2. Implementing custom rendering logic
3. Registering with the component catalog using `extend()`
4. Adding TypeScript declarations

#### Complete Custom Component Example

```tsx
import {
  BoxRenderable,
  createCliRenderer,
  OptimizedBuffer,
  RGBA,
  type BoxOptions,
  type RenderContext,
} from "@opentui/core"
import { createRoot, extend } from "@opentui/react"

// Create custom component class
class ButtonRenderable extends BoxRenderable {
  private _label: string = "Button"

  constructor(ctx: RenderContext, options: BoxOptions & { label?: string }) {
    super(ctx, {
      border: true,
      borderStyle: "single",
      minHeight: 3,
      ...options,
    })

    if (options.label) {
      this._label = options.label
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    const centerX = this.x + Math.floor(this.width / 2 - this._label.length / 2)
    const centerY = this.y + Math.floor(this.height / 2)

    buffer.drawText(this._label, centerX, centerY, RGBA.fromInts(255, 255, 255, 255))
  }

  set label(value: string) {
    this._label = value
    this.requestRender()
  }
}

// Add TypeScript support
declare module "@opentui/react" {
  interface OpenTUIComponents {
    consoleButton: typeof ButtonRenderable
  }
}

// Register the component
extend({ consoleButton: ButtonRenderable })

// Use in JSX
function App() {
  return (
    <box>
      <consoleButton label="Click me!" style={{ backgroundColor: "blue" }} />
      <consoleButton label="Another button" style={{ backgroundColor: "green" }} />
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

### 7.4 Key Lifecycle Methods

Essential methods for custom components:
- **`renderSelf(buffer, deltaTime)`**: Draw the component visuals
- **`renderBefore(buffer, deltaTime)`**: Hook called before rendering
- **`renderAfter(buffer, deltaTime)`**: Hook called after rendering
- **`handleKeyPress(key)`**: Handle keyboard input
- **`handleMouseDown(event)`**: Handle mouse clicks
- **`requestRender()`**: Trigger re-render when state changes
- **`onLayoutResize()`**: Called when component size changes

### 7.5 Component Catalog System

The component catalog maps JSX element names to `Renderable` constructors. Base components include `BoxRenderable`, `TextRenderable`, `InputRenderable`, and others.

Extend the catalog using `extend()`:
```typescript
extend({ 
  customComponent: CustomRenderable,
  anotherComponent: AnotherRenderable 
})
```

---

## 8. Building an Accordion/Collapsible Component

### 8.1 Core Approach

Create a custom interactive accordion by:
1. Extending a base renderable (like `BoxRenderable`)
2. Managing toggle state with internal properties
3. Handling keyboard/mouse events to toggle open/closed
4. Conditionally rendering children based on state

### 8.2 Complete Accordion Implementation

```typescript
import {
  BoxRenderable,
  RenderContext,
  OptimizedBuffer,
  RGBA,
  type BoxOptions,
} from "@opentui/core"
import { createRoot, extend } from "@opentui/react"

interface AccordionOptions extends BoxOptions {
  title?: string
  defaultOpen?: boolean
  onToggle?: (isOpen: boolean) => void
}

class AccordionRenderable extends BoxRenderable {
  private _title: string = "Accordion"
  private _isOpen: boolean = false
  private _onToggle?: (isOpen: boolean) => void

  constructor(ctx: RenderContext, options: AccordionOptions) {
    super(ctx, {
      border: true,
      borderStyle: "single",
      ...options,
    })

    if (options.title) this._title = options.title
    if (options.defaultOpen) this._isOpen = options.defaultOpen
    if (options.onToggle) this._onToggle = options.onToggle
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    // Draw toggle indicator and title
    const indicator = this._isOpen ? "▼" : "▶"
    const titleText = `${indicator} ${this._title}`
    const textColor = RGBA.fromInts(255, 255, 255, 255)

    buffer.drawText(titleText, this.x + 2, this.y + 1, textColor)
  }

  public handleKeyPress(key: any): boolean {
    if (key.name === "return" || key.name === "space") {
      this.toggle()
      return true // Event consumed
    }
    return false // Event not handled
  }

  public handleMouseDown(event: any): boolean {
    // Toggle on click
    this.toggle()
    return true // Event consumed
  }

  private toggle(): void {
    this._isOpen = !this._isOpen
    this._onToggle?.(this._isOpen)
    this.requestRender()
  }

  get isOpen(): boolean {
    return this._isOpen
  }

  set isOpen(value: boolean) {
    if (this._isOpen !== value) {
      this._isOpen = value
      this._onToggle?.(value)
      this.requestRender()
    }
  }

  set title(value: string) {
    this._title = value
    this.requestRender()
  }
}

// Register with React
declare module "@opentui/react" {
  interface OpenTUIComponents {
    accordion: typeof AccordionRenderable
  }
}

extend({ accordion: AccordionRenderable })
```

### 8.3 Usage with React State Management

```tsx
import { useState } from "react"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

function App() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <box flexDirection="column" padding={1}>
      <accordion
        title="Click to expand"
        onToggle={(open) => setIsOpen(open)}
        style={{ marginBottom: 1 }}
      />
      {isOpen && (
        <box padding={1} style={{ backgroundColor: "#333333" }}>
          <text>This content is shown when accordion is open</text>
          <text>You can put any content here!</text>
        </box>
      )}
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

### 8.4 Usage with SolidJS

```tsx
import { createSignal, Show } from "solid-js"
import { render } from "@opentui/solid"

function App() {
  const [isOpen, setIsOpen] = createSignal(false)

  return (
    <box flexDirection="column" padding={1}>
      <accordion
        title="Click to expand"
        onToggle={(open) => setIsOpen(open)}
        style={{ marginBottom: 1 }}
      />
      <Show when={isOpen()}>
        <box padding={1} style={{ backgroundColor: "#333333" }}>
          <text>This content is shown when accordion is open</text>
          <text>You can put any content here!</text>
        </box>
      </Show>
    </box>
  )
}

render(() => <App />)
```

### 8.5 Advanced Features

#### Multiple Accordions with Only One Open
```tsx
function AccordionGroup() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const accordions = [
    { title: "Section 1", content: "Content 1" },
    { title: "Section 2", content: "Content 2" },
    { title: "Section 3", content: "Content 3" },
  ]

  return (
    <box flexDirection="column" padding={1}>
      {accordions.map((accordion, index) => (
        <>
          <accordion
            title={accordion.title}
            onToggle={(open) => {
              if (open) {
                setOpenIndex(index)
              } else if (openIndex === index) {
                setOpenIndex(null)
              }
            }}
            isOpen={openIndex === index}
            style={{ marginBottom: 1 }}
          />
          {openIndex === index && (
            <box padding={1} style={{ backgroundColor: "#333333", marginBottom: 1 }}>
              <text>{accordion.content}</text>
            </box>
          )}
        </>
      ))}
    </box>
  )
}
```

#### Accordion with Animation (using Timeline)
```tsx
import { useTimeline } from "@opentui/react"
import { useState, useEffect } from "react"

function AnimatedAccordion() {
  const [isOpen, setIsOpen] = useState(false)
  const [contentHeight, setContentHeight] = useState(0)

  const timeline = useTimeline({ duration: 300, loop: false })

  useEffect(() => {
    timeline.add(
      { height: contentHeight },
      {
        height: isOpen ? 10 : 0,
        duration: 300,
        ease: "easeInOutCubic",
        onUpdate: (animation) => {
          setContentHeight(animation.targets[0].height)
        },
      },
    )
  }, [isOpen])

  return (
    <box flexDirection="column">
      <accordion
        title="Animated Section"
        onToggle={setIsOpen}
      />
      <box style={{ height: contentHeight, overflow: "hidden" }}>
        <text>Smoothly animated content!</text>
      </box>
    </box>
  )
}
```

---

## 9. Key Takeaways

### ✅ Strengths for Building Collapsible Components

1. **Extensible Component System**: Easy to create custom interactive components by extending base renderables
2. **Rich Event Handling**: Full support for keyboard and mouse interactions with bubbling and propagation control
3. **Flexible State Management**: Works with React hooks or SolidJS signals
4. **Powerful Layout Engine**: Yoga flexbox provides familiar CSS-like layouts
5. **Dynamic Visibility**: Components can be shown/hidden via `visible` property or conditional rendering
6. **Performance Optimized**: Double-buffered rendering with efficient diffing minimizes terminal output

### 🔧 Requirements for Building Collapsibles

To build a collapsible/accordion component in OpenTUI, you need to:

1. **Extend `BoxRenderable`** or another base component
2. **Implement state management** for open/closed state
3. **Override `renderSelf()`** to draw custom UI (toggle indicator, title)
4. **Add event handlers** (`handleKeyPress`, `handleMouseDown`) for interaction
5. **Call `requestRender()`** when state changes to trigger re-render
6. **Register the component** with `extend()` and add TypeScript declarations
7. **Use conditional rendering** in JSX to show/hide content based on state

### 📚 Additional Resources

- **DeepWiki Links**:
  - [Framework Integration](https://deepwiki.com/wiki/anomalyco/opentui#7)
  - [Custom Components](https://deepwiki.com/wiki/anomalyco/opentui#9.1)
  - [Input Handling](https://deepwiki.com/wiki/anomalyco/opentui#6)
  - [Rendering Pipeline](https://deepwiki.com/wiki/anomalyco/opentui#3.3)
  - [High-Level Architecture](https://deepwiki.com/wiki/anomalyco/opentui#1.2)

- **Search Results**:
  - [What components does OpenTUI provide?](https://deepwiki.com/search/what-components-does-opentui-p_4f5be4ed-62ed-4806-aad4-e53335285bbd)
  - [How does click handling work?](https://deepwiki.com/search/how-does-click-handling-and-ev_66ec2b3f-eaf0-4281-b63f-c0f6525e814f)
  - [How does state management work?](https://deepwiki.com/search/how-does-state-management-work_cfbec5f1-b9db-4c7c-a95a-c51bd925c5df)
  - [How does rendering work?](https://deepwiki.com/search/how-does-opentui-render-compon_b8a1004c-34ab-4f75-b51d-aa955c89a176)
  - [How are layouts structured?](https://deepwiki.com/search/how-are-layouts-structured-in_07287026-c890-4b72-b9ba-13901849a3e7)
  - [Dynamic show/hide](https://deepwiki.com/search/can-components-be-dynamically_97b0c7d4-b06e-4b4f-85dd-097056704963)
  - [Component definition](https://deepwiki.com/search/how-are-components-defined-in_9cacc1fd-973d-4b2e-8fd5-be3ed0a5f8ad)
  - [Creating accordion components](https://deepwiki.com/search/how-can-i-create-an-accordion_03e7b91c-4039-4766-a19f-0706c89eb446)

---

## 10. Conclusion

OpenTUI provides a solid foundation for building interactive terminal UIs with modern web framework patterns. While it doesn't include built-in accordion/collapsible components, the framework's extensibility, event handling, and state management capabilities make it straightforward to create custom interactive components.

The combination of:
- Custom `Renderable` classes for component logic
- React/SolidJS for state management and conditional rendering
- Rich event system for user interactions
- Flexbox-based layouts for responsive design
- Efficient rendering pipeline for performance

...provides all the necessary tools to build sophisticated interactive components like accordions, collapsibles, tabs, and more.

The accordion implementation examples provided in this document demonstrate a complete pattern that can be adapted for various interactive components in terminal applications.
