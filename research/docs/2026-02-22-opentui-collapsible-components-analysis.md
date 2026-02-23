# OpenTUI Collapsible/Expandable Components Analysis

**Date:** 2026-02-22  
**Purpose:** Document existing OpenTUI capabilities for collapsible/expandable UI components  
**Status:** Documentation (As-Is Analysis)

---

## Executive Summary

OpenTUI does NOT provide built-in collapsible, accordion, toggle, or expandable components. The library provides low-level primitives (boxes, text, scrollboxes, mouse/keyboard events) that can be composed into collapsible UI patterns. The ralph-workflow codebase implements collapsible behavior through **React state management** + **conditional rendering** + **manual slice/visibility logic**.

**Key Findings:**
- No native `<collapsible>`, `<accordion>`, or `<toggle>` components exist in OpenTUI
- Collapsible patterns are built using: `useState` + conditional rendering + `maxVisible` props
- Mouse click handling exists via `onMouseDown`/`onMouseUp` but is NOT currently used in codebase
- Keyboard navigation is the primary interaction method via `useKeyboard()` hook
- Current collapsible implementations are **passive** (no click-to-expand) and **global** (keyboard shortcuts toggle state)

---

## 1. OpenTUI Component Catalog

### 1.1 Available Components

**From:** `node_modules/@opentui/react/src/components/index.d.ts` (lines 4-25)

OpenTUI provides these base components:

| Component | Description | File Reference |
|-----------|-------------|----------------|
| `<box>` | Container with borders, background, flexbox layout | `@opentui/core/renderables/Box.d.ts` |
| `<text>` | Styled text content display | Core renderables |
| `<code>` | Code blocks with syntax highlighting | Core renderables |
| `<diff>` | Diff viewer for code changes | Core renderables |
| `<markdown>` | Markdown content renderer | Core renderables |
| `<input>` | Single-line text input | Core renderables |
| `<select>` | Option selector dropdown | `@opentui/core/renderables/Select.d.ts` |
| `<textarea>` | Multi-line text input field | Core renderables |
| `<scrollbox>` | Scrollable container with viewport culling | `@opentui/core/renderables/ScrollBox.d.ts` |
| `<ascii-font>` | Renders text using ASCII art fonts | Core renderables |
| `<tab-select>` | Tab-based selection component | `@opentui/core/renderables/TabSelect.d.ts` |
| `<line-number>` | Code with line numbers and diagnostics | Core renderables |
| `<span>`, `<b>`, `<i>`, `<u>`, `<a>`, `<br>` | Inline text modifiers | React components |

**Notable Absences:**
- ❌ No `<collapsible>` component
- ❌ No `<accordion>` component  
- ❌ No `<toggle>` component
- ❌ No `<expandable>` component
- ❌ No `<details>` component (HTML-style disclosure widget)

### 1.2 Interactive Components

**`<select>` Component** (`Select.d.ts`, lines 1-50):
- Dropdown option selector with keyboard navigation
- Provides `onChange` and `onSelect` callbacks
- Built-in state management for selected option
- **NOT used for collapsible patterns** - it's a picker, not a disclosure widget

**`<tab-select>` Component** (`TabSelect.d.ts`):
- Tab-based selection interface
- Similar to `<select>` but with tab UI metaphor
- Also NOT applicable to collapse/expand patterns

---

## 2. OpenTUI Event System

### 2.1 Mouse Event Support

**From:** `node_modules/@opentui/core/Renderable.d.ts` (lines 130-140)

OpenTUI provides comprehensive mouse event handlers on all `Renderable` components:

```typescript
interface RenderableOptions {
  onMouse?: (event: MouseEvent) => void;
  onMouseDown?: (event: MouseEvent) => void;
  onMouseUp?: (event: MouseEvent) => void;
  onMouseMove?: (event: MouseEvent) => void;
  onMouseDrag?: (event: MouseEvent) => void;
  onMouseDragEnd?: (event: MouseEvent) => void;
  onMouseDrop?: (event: MouseEvent) => void;
  onMouseOver?: (event: MouseEvent) => void;
  onMouseOut?: (event: MouseEvent) => void;
  onMouseScroll?: (event: MouseEvent) => void;
}
```

**MouseEvent Structure** (from `research/docs/2026-02-16-opentui-rendering-architecture.md`, lines 520-528):
- `type`: `"down" | "up" | "move" | "drag" | "drag-end" | "drop" | "over" | "out" | "scroll"`
- `x`, `y`: Screen coordinates (terminal column/row)
- `button`: `MouseButton.LEFT | RIGHT | MIDDLE`
- `modifiers`: `{ shift, alt, ctrl }`
- `isDragging`: Whether mouse is being dragged

**Event Propagation** (lines 534-535):
- Events propagate up the component tree via `parent.processMouseEvent()`
- Can be stopped using `event.propagationStopped = true`

### 2.2 Keyboard Event Support

**From:** `@opentui/react` hooks (lines 11, `src/ui/chat.tsx`)

```typescript
import { useKeyboard } from "@opentui/react";

useKeyboard((event: KeyEvent) => {
  // event.name: key name (e.g., "a", "enter", "up")
  // event.ctrl, event.shift, event.alt, event.meta: modifier flags
  // event.preventDefault(): prevent default behavior
  // event.stopPropagation(): stop event bubbling
});
```

**KeyEvent Structure** (from research docs, lines 574-578):
- `name`: Key name (e.g., "a", "enter", "escape", "up", "down")
- `ctrl`, `shift`, `alt`, `meta`: Boolean modifier flags
- `sequence`: Raw escape sequence string
- `defaultPrevented`: Whether default action was prevented
- `eventType`: `"press" | "release"`

**Focus System** (lines 552-567):
- Only one renderable can be focused at a time
- Managed by renderer via `_currentFocusedRenderable`
- `focus()` and `blur()` lifecycle methods
- Focused renderable receives keyboard events first

---

## 3. Current Collapsible Implementations in Codebase

### 3.1 Pattern: Passive Collapsible with Global Toggle

**Example: TaskListIndicator** (`src/ui/components/task-list-indicator.tsx`)

**Props** (lines 35-46):
```typescript
interface TaskListIndicatorProps {
  items: TaskItem[];
  maxVisible?: number;           // Collapse after N items
  expanded?: boolean;            // Show all content
  showConnector?: boolean;
  maxContentLength?: number;     // Truncate text
}
```

**Implementation** (lines 96-109):
```typescript
export function TaskListIndicator({
  items,
  maxVisible = 10,
  expanded = false,
  showConnector = true,
  maxContentLength,
}: TaskListIndicatorProps): React.ReactNode {
  // ...
  const visibleItems = items.slice(0, maxVisible);  // Line 108
  const overflowCount = items.length - maxVisible;   // Line 109
  // ...
}
```

**Rendering Logic** (lines 112-166):
- `visibleItems.map()` renders only first N items
- `overflowCount` calculates hidden count
- If `expanded` is true: shows full item content without truncation (line 134)
- If `expanded` is false: truncates content via `truncateText()`
- NO click handler - expansion is controlled by parent state

**Visual Indicator** (lines 157-162):
```typescript
{isCollapsible && !expanded && (
  <box marginLeft={SPACING.CONTAINER_PAD}>
    <text style={{ fg: colors.muted }}>
      {MISC.collapsed} {hiddenCount} more lines
    </text>
  </box>
)}
```

**Collapse Icon** (`src/ui/constants/icons.ts`):
```typescript
export const MISC = {
  collapsed: "▸",  // Right-pointing triangle
  expanded: "▾",   // Down-pointing triangle (not used in current code)
  // ...
};
```

### 3.2 Pattern: Conditional ScrollBox

**Example: TaskListPanel** (`src/ui/components/task-list-panel.tsx`, lines 140-147)

```typescript
{/* Task list: use scrollbox only when items exceed threshold */}
{items.length > scrollThreshold ? (
  <scrollbox maxHeight={scrollThreshold}>
    {taskList}
  </scrollbox>
) : (
  taskList
)}
```

**Logic:**
- If item count > threshold (15 items), wrap in scrollbox
- Otherwise render inline without scrolling
- This is **adaptive container selection**, not true collapse/expand

### 3.3 Pattern: Collapsible Content with State

**Example: ToolResult CollapsibleContent** (`src/ui/components/tool-result.tsx`, lines 97-166)

**State Management** (line 270):
```typescript
const [expanded] = useState(initialExpanded);
```

**Slice Logic** (lines 115-117):
```typescript
const isCollapsible = content.length > maxCollapsedLines;
const displayLines = expanded ? content : content.slice(0, maxCollapsedLines);
const hiddenCount = content.length - maxCollapsedLines;
```

**Conditional Rendering** (lines 135-154):
```typescript
{displayLines.map((line, index) => (
  <text key={index} style={{ fg: lineColor }}>
    {line || " "}
  </text>
))}
```

**Collapse Indicator** (lines 157-163):
```typescript
{isCollapsible && !expanded && (
  <box marginLeft={SPACING.CONTAINER_PAD}>
    <text style={{ fg: colors.muted }}>
      {MISC.collapsed} {hiddenCount} more lines
    </text>
  </box>
)}
```

**Key Observation:**
- `expanded` state is set via `useState(initialExpanded)` but NEVER updated
- No `setExpanded` setter is defined (line 270)
- This means collapsed state is **immutable** after component mount
- No click or keyboard handler modifies this state

### 3.4 Global Keyboard Toggle Pattern

**Example: Chat Component Ctrl+T** (`src/ui/chat.tsx`, lines 4357-4380)

The main chat component uses `useKeyboard()` hook to listen for global keyboard shortcuts:

```typescript
useKeyboard(
  useCallback((event: KeyEvent) => {
    // Ctrl+T could toggle expanded state globally
    // Currently used for other functionality
    
    if (event.ctrl && event.name === "c") {
      // Copy or interrupt logic
    }
    // ... other global shortcuts
  }, [dependencies])
);
```

**Pattern:**
- Global keyboard listener at top-level component
- Shortcuts trigger state updates in parent component
- State flows down as props to collapsible children
- Children re-render with new `expanded` prop

**Current Usage:**
- Ctrl+C: Copy/Interrupt
- Ctrl+D: EOF/Exit
- Escape: Cancel dialogs
- **NO global toggle for collapse/expand** (Ctrl+T mentioned in comments but not implemented)

---

## 4. Interactive Element Capabilities

### 4.1 Click Handling - Available but Unused

**Technical Capability:**

OpenTUI supports click detection via `onMouseDown` on any `<box>` or `<text>` component:

```typescript
<box
  onMouseDown={(event) => {
    console.log(`Clicked at (${event.x}, ${event.y})`);
    setExpanded(!expanded);  // Could toggle state
  }}
>
  <text>{expanded ? "▾" : "▸"} Click to expand</text>
</box>
```

**Current Usage in Codebase:**

```bash
# Search results: 0 occurrences
$ grep -r "onMouseDown\|onClick" src/ui/components/*.tsx
# (no results)
```

**Observation:**
- OpenTUI mouse events are fully functional (research docs confirm)
- ralph-workflow codebase does NOT use mouse click handlers anywhere
- All interactions are keyboard-driven

### 4.2 Keyboard Navigation - Primary Interaction Method

**Current Implementation:**

Keyboard events are handled via:
1. **Global listener** in main chat component (`useKeyboard` at top level)
2. **Dialog-specific listeners** in modal components (`UserQuestionDialog`, `ModelSelectorDialog`)
3. **Input field handlers** for textarea and input components

**Navigation Patterns** (`src/ui/utils/navigation.ts`):
```typescript
export function navigateUp(currentIndex: number, listLength: number): number {
  return currentIndex > 0 ? currentIndex - 1 : listLength - 1;
}

export function navigateDown(currentIndex: number, listLength: number): number {
  return currentIndex < listLength - 1 ? currentIndex + 1 : 0;
}
```

**Used In:**
- `UserQuestionDialog`: Arrow keys navigate options (lines 50-51)
- `Autocomplete`: Arrow keys navigate suggestions
- NOT used for collapse/expand actions

### 4.3 State Toggling Patterns

**React State Pattern:**

All collapsible state is managed via standard React hooks:

```typescript
// Component state (most common)
const [expanded, setExpanded] = useState(false);

// Parent-controlled state (current pattern)
interface Props {
  expanded?: boolean;  // Passed from parent
}

// State flows down, never modified by child
```

**Observation:**
- Collapsible components accept `expanded` as a prop
- NO internal state management or toggle logic in child components
- Parent component holds state and passes it down
- This enables coordinated collapse/expand (e.g., "collapse all" button)

---

## 5. OpenTUI Rendering Architecture

### 5.1 How Components Render

**From:** `research/docs/2026-02-16-opentui-rendering-architecture.md`

**Three-Pass Rendering** (lines 357-383):

1. **Pass 0: Lifecycle Pass**
   - Calls `onLifecyclePass()` on registered renderables
   - Used by TextRenderable to update from child nodes
   
2. **Pass 1: Calculate Layout**
   - Only if Yoga layout tree is dirty
   - Computes flexbox layout for entire tree
   
3. **Pass 2: Update Layout & Collect Render List**
   - Walks tree, calls `updateLayout()` recursively
   - Builds flat list of render commands
   
4. **Pass 3: Execute Render Commands**
   - Iterates render list
   - Executes: `render`, `pushScissorRect`, `popScissorRect`, `pushOpacity`, `popOpacity`
   - Outputs to native Zig buffer

**Delta Rendering** (lines 464-474):
- Only components marked dirty re-render
- `markDirty()` sets `_dirty = true`
- `requestRender()` marks dirty and schedules frame
- `markClean()` called after render completes

**Implication for Collapsibles:**
- Changing `expanded` prop triggers React reconciliation
- React creates new virtual DOM with different children
- OpenTUI renderer sees structure change → marks tree dirty
- Next frame: layout recalculates and content re-renders
- Efficient: only changed portions re-render

### 5.2 Layout System (Yoga/Flexbox)

**From:** `research/docs/2026-02-16-opentui-rendering-architecture.md` (lines 249-331)

OpenTUI uses **Yoga layout engine** for CSS flexbox-like layout:

**Flexbox Properties:**
- `flexDirection`: `"row"` | `"column"` | `"row-reverse"` | `"column-reverse"`
- `flexGrow`, `flexShrink`, `flexBasis`: Flex sizing
- `alignItems`, `justifyContent`: Alignment
- `padding`, `margin`: Spacing

**Conditional Children Pattern:**

```typescript
<box flexDirection="column">
  <text>Header (always visible)</text>
  {expanded && (
    <>
      <text>Line 1 (conditionally rendered)</text>
      <text>Line 2 (conditionally rendered)</text>
      <text>Line 3 (conditionally rendered)</text>
    </>
  )}
</box>
```

**Layout Behavior:**
- When `expanded = false`: Yoga computes layout for header only
- When `expanded = true`: Yoga recomputes layout including new children
- Height adjusts automatically via flexbox
- No explicit height animation - instant reflow

### 5.3 ScrollBox and Viewport Culling

**From:** ScrollBox implementation (lines 488-493)

**Viewport Culling** (`ContentRenderable._getVisibleChildren()`):
```typescript
if (_viewportCulling) {
  // Returns only children intersecting viewport bounds
  return getObjectsInViewport(viewportBounds);
} else {
  return allChildren;
}
```

**Sticky Scroll** (lines 192-209):
- `stickyScroll`: Enable sticky behavior
- `stickyStart`: `"top"` | `"bottom"`
- Automatically scrolls to sticky edge when content changes
- Manual scroll disables sticky until user scrolls back to edge

**Usage in Collapsibles:**
- Wrap long lists in `<scrollbox maxHeight={N}>`
- Provides vertical scrolling when content exceeds height
- Alternative to "show first N items" pattern
- NOT a collapse/expand mechanism - always shows container

---

## 6. Building Collapsible Components with OpenTUI

### 6.1 Current Pattern: Stateless + Slice

**Architecture:**

```
Parent Component (stateful)
  ├─ useState(expanded)
  ├─ useKeyboard() for toggle
  └─ renders Child with expanded prop

Child Component (stateless)
  ├─ Accept expanded prop
  ├─ Slice content: expanded ? all : first(N)
  ├─ Render visible content
  └─ Show indicator if collapsed
```

**Example Implementation:**

```typescript
// Parent component
function MessageView() {
  const [expanded, setExpanded] = useState(false);
  
  useKeyboard((event) => {
    if (event.ctrl && event.name === "e") {
      setExpanded(prev => !prev);
    }
  });
  
  return <CollapsibleList items={data} expanded={expanded} />;
}

// Child component
function CollapsibleList({ items, expanded }) {
  const maxVisible = 10;
  const visible = expanded ? items : items.slice(0, maxVisible);
  const hidden = items.length - maxVisible;
  
  return (
    <box flexDirection="column">
      {visible.map(item => <text>{item}</text>)}
      {!expanded && hidden > 0 && (
        <text style={{ fg: colors.muted }}>
          ▸ {hidden} more items
        </text>
      )}
    </box>
  );
}
```

**Pros:**
- Simple implementation
- No complex state management in child
- Parent controls all expansion state
- Easy to implement "expand all" / "collapse all"

**Cons:**
- No per-item expand/collapse
- No click-to-toggle interaction
- Requires keyboard shortcuts or external controls

### 6.2 Potential Pattern: Click-to-Toggle (Not Implemented)

**Hypothetical Implementation:**

```typescript
function ClickableCollapsible({ title, children }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <box flexDirection="column">
      <box
        onMouseDown={(event) => {
          setExpanded(prev => !prev);
          event.propagationStopped = true;
        }}
        style={{ cursor: "pointer" }}  // Note: OpenTUI doesn't support CSS cursor
      >
        <text>
          {expanded ? "▾" : "▸"} {title}
        </text>
      </box>
      {expanded && (
        <box marginLeft={2}>
          {children}
        </box>
      )}
    </box>
  );
}
```

**Technical Requirements:**
1. ✅ `onMouseDown` handler available
2. ✅ React state management works
3. ✅ Conditional rendering supported
4. ❌ Visual hover feedback not implemented (no CSS cursor support)
5. ❌ Focus/keyboard navigation would need custom implementation

**Why Not Used:**
- Terminal UI conventions favor keyboard over mouse
- Mouse support varies across terminal emulators
- Keyboard shortcuts are more discoverable via help text
- Consistent with existing codebase patterns

### 6.3 Alternative Pattern: Accordion with Focus

**Concept:**

```typescript
function Accordion({ items }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  
  useKeyboard((event) => {
    if (event.name === "up") {
      setFocusedIndex(prev => Math.max(0, prev - 1));
    } else if (event.name === "down") {
      setFocusedIndex(prev => Math.min(items.length - 1, prev + 1));
    } else if (event.name === "return") {
      setExpandedIndex(prev => prev === focusedIndex ? null : focusedIndex);
    }
  });
  
  return (
    <box flexDirection="column">
      {items.map((item, i) => (
        <box
          key={i}
          flexDirection="column"
          border={i === focusedIndex}
          borderColor={colors.accent}
        >
          <text>
            {expandedIndex === i ? "▾" : "▸"} {item.title}
          </text>
          {expandedIndex === i && (
            <box marginLeft={2}>
              {item.content}
            </box>
          )}
        </box>
      ))}
    </box>
  );
}
```

**Features:**
- Arrow keys navigate items
- Enter toggles focused item
- Visual focus indicator via border
- Only one item expanded at a time
- Pure keyboard interaction

---

## 7. Constraints and Limitations

### 7.1 OpenTUI Limitations

**From Research Docs:**

1. **No Built-in Animation** (research findings)
   - No smooth height transitions
   - No CSS-like transitions or animations
   - Changes are instant (single-frame)
   - Could implement frame-by-frame animation via `useTimeline` hook (mentioned but not documented)

2. **No Built-in Collapse Components**
   - Must build from primitives
   - No `<details>`/`<summary>` equivalent
   - No accordion component library

3. **No Visual Hover State**
   - `onMouseOver`/`onMouseOut` events exist
   - But no built-in visual hover styling
   - Must manually change colors/borders on hover

4. **Terminal Mouse Support Varies**
   - Some terminals don't support mouse
   - Mouse events require terminal capability detection
   - Keyboard is more reliable

5. **No Grid Layout** (research docs, line 792)
   - Only flexbox via Yoga
   - Complex multi-column layouts are harder
   - Accordion with side-by-side content needs nested flexbox

### 7.2 Codebase Patterns

**Current Design Decisions:**

1. **Keyboard-First Interaction**
   - No mouse click handlers in codebase
   - All interactions via keyboard shortcuts
   - Consistent with terminal UI conventions

2. **Parent-Controlled State**
   - Collapsible components don't manage own state
   - Parent passes `expanded` prop
   - Centralized control but less flexible

3. **Passive Indicators**
   - "▸ N more items" shown but not clickable
   - No visual cue that it's interactive
   - Requires user to know keyboard shortcut

4. **Global Toggles Only**
   - No per-item expand/collapse
   - Ctrl+T would expand ALL collapsibles (if implemented)
   - Fine-grained control requires multiple shortcuts

5. **Immutable Collapsed State**
   - ToolResult component sets state once
   - Never updates during lifecycle
   - `expanded` is effectively a constant after mount

---

## 8. Streaming Content Rendering

### 8.1 How Streaming Works

**From:** `specs/ui-inline-streaming-vs-pinned-elements.md`

**Current Architecture** (lines 23-24):
- Chat content uses offset-based inline segment insertion
- Segments types: `text`, `tool`, `hitl`, `agents`, `tasks`
- Sorted by insertion offsets and rendered in message order

**Streaming Patterns:**

1. **Text Streaming** (`MessageBubbleParts.tsx`):
   - `TextPart` receives incremental content updates
   - OpenTUI `<markdown>` supports `streaming: true` flag
   - Content updates trigger dirty marking → re-render

2. **Tool Streaming**:
   - `ToolPart` accumulates output as it arrives
   - `ToolResult` component renders current state
   - Collapsed by default during streaming
   - Remains collapsed after completion (immutable state)

3. **Agent Tree Streaming** (`ParallelAgentsTree.tsx`):
   - `AgentPart` tracks array of parallel agents
   - Status updates cause re-render
   - Tree structure always visible (not collapsible)

### 8.2 Streaming + Collapsible Interaction

**Current Behavior:**

```typescript
// Tool output during streaming
<ToolResult
  toolName="bash"
  output={accumulatedOutput}  // Grows over time
  status="running"
  initialExpanded={false}       // Set once at creation
  maxCollapsedLines={5}
/>
```

**Observations:**
1. Collapsed state is set when tool starts
2. As output streams in, only first N lines visible
3. No automatic expansion when streaming completes
4. User cannot expand while streaming (state is immutable)

**Potential Issues:**
- User can't see full output without manual expansion
- Expansion requires knowing keyboard shortcut
- No visual feedback that more content is available during streaming

---

## 9. Summary Table

### 9.1 Component Availability

| Component Type | OpenTUI Native | Ralph-Workflow Custom | Interactive |
|----------------|----------------|----------------------|-------------|
| Collapsible Section | ❌ | ✅ (Stateless + Slice) | ❌ |
| Accordion | ❌ | ❌ | ❌ |
| Toggle Button | ❌ | ❌ | ❌ |
| Expandable List | ❌ | ✅ (maxVisible prop) | ❌ |
| Details/Summary | ❌ | ❌ | ❌ |
| Dropdown Menu | ✅ (`<select>`) | ✅ | ✅ (keyboard) |

### 9.2 Event Handling Capabilities

| Event Type | OpenTUI Support | Ralph Usage | Notes |
|------------|----------------|-------------|-------|
| Mouse Click | ✅ `onMouseDown` | ❌ | Available but unused |
| Mouse Hover | ✅ `onMouseOver` | ❌ | No visual hover states |
| Keyboard Press | ✅ `useKeyboard()` | ✅ | Primary interaction |
| Focus Management | ✅ Built-in | ✅ | Used in dialogs |
| Event Propagation | ✅ Supported | ✅ | Can stop propagation |

### 9.3 State Management Patterns

| Pattern | Implementation | Used For | Pros | Cons |
|---------|---------------|----------|------|------|
| Parent State + Props | `useState` in parent, prop drilling | Task lists, tool results | Simple, centralized | Less flexible |
| Local State | `useState` in component | ❌ Not used | Flexible | Harder to coordinate |
| Slice Array | `items.slice(0, maxVisible)` | Task lists, parallel agents | Efficient | No per-item control |
| Conditional Render | `{expanded && <content />}` | All collapsibles | Clean JSX | No animation |
| Immutable State | `useState(initial)` with no setter | Tool results | Predictable | Can't change after mount |

### 9.4 Rendering Primitives

| Primitive | OpenTUI Type | Purpose | Used For Collapsibles? |
|-----------|-------------|---------|------------------------|
| `<box>` | Container | Layout, borders, backgrounds | ✅ Wrapper for sections |
| `<text>` | Content | Render text with styling | ✅ Content lines |
| `<scrollbox>` | Container | Vertical/horizontal scrolling | ⚠️ Alternative to collapse |
| `flexDirection: "column"` | Layout | Stack items vertically | ✅ List items |
| `marginLeft` | Layout | Indent nested content | ✅ Hierarchical structure |
| Conditional `{expanded && ...}` | React | Show/hide content | ✅ Core collapse mechanism |

---

## 10. References

### 10.1 Research Documents

1. **`research/docs/2026-01-31-opentui-library-research.md`**
   - Component catalog (lines 84-163)
   - Event handling overview (lines 360-476)
   - Chat interface patterns (lines 480-669)
   - Known limitations (lines 711-750)

2. **`research/docs/2026-02-16-opentui-rendering-architecture.md`**
   - Rendering pipeline (lines 357-494)
   - Layout system (lines 249-331)
   - Event system (lines 497-600)
   - Mouse event flow (lines 519-549)
   - Keyboard event handling (lines 551-579)

3. **`specs/ui-inline-streaming-vs-pinned-elements.md`**
   - Inline vs pinned artifact placement (lines 12-40)
   - Current message segmentation (lines 23-24)
   - Placement policy proposal (lines 115-131)

### 10.2 Source Files Analyzed

| File | Key Sections | Findings |
|------|-------------|----------|
| `src/ui/components/task-list-indicator.tsx` | Lines 35-166 | Passive collapsible pattern |
| `src/ui/components/task-list-panel.tsx` | Lines 33-149 | Conditional scrollbox pattern |
| `src/ui/components/tool-result.tsx` | Lines 97-180, 270 | Immutable collapsed state |
| `src/ui/components/parallel-agents-tree.tsx` | Lines 1-150 | Non-collapsible tree display |
| `src/ui/components/user-question-dialog.tsx` | Lines 76-150 | Keyboard navigation pattern |
| `src/ui/chat.tsx` | Lines 4357-4380 | Global keyboard event handling |
| `src/ui/theme.tsx` | Lines 1-586 | Theme configuration (no collapsible-specific styles) |
| `node_modules/@opentui/core/renderables/Box.d.ts` | Lines 1-72 | Box component API |
| `node_modules/@opentui/core/Renderable.d.ts` | Lines 130-140 | Mouse event handlers |
| `node_modules/@opentui/react/src/components/index.d.ts` | Lines 1-43 | Component catalog |

### 10.3 Key Architectural Files

| File | Purpose | Location |
|------|---------|----------|
| OpenTUI Core Types | Type definitions for all renderables | `node_modules/@opentui/core/` |
| React Components | React reconciler and hooks | `node_modules/@opentui/react/` |
| Renderable Base Class | Core rendering and event logic | `node_modules/@opentui/core/Renderable.d.ts` |
| ScrollBox Implementation | Viewport culling and sticky scroll | `node_modules/@opentui/core/renderables/ScrollBox.d.ts` |

---

## 11. Conclusion

OpenTUI provides **no built-in collapsible components** but offers robust **primitives for building them**:

**Available:**
- ✅ Conditional rendering via React
- ✅ Mouse click events (`onMouseDown`/`onMouseUp`)
- ✅ Keyboard event handling (`useKeyboard()`)
- ✅ Flexbox layout system via Yoga
- ✅ Delta rendering for efficiency

**Missing:**
- ❌ Native `<collapsible>`, `<accordion>`, or `<toggle>` components
- ❌ Built-in expand/collapse animations
- ❌ Visual hover states for interactive elements
- ❌ Per-item expand/collapse UI patterns

**Current Implementation:**
- Collapsible behavior via **React state + conditional rendering**
- **Passive indicators** ("▸ N more items") without click handlers
- **Keyboard-driven** expansion via global shortcuts
- **Parent-controlled state** passed as props to child components
- **Slice-based** visibility (render first N items, hide rest)

**Rendering Mechanism:**
- OpenTUI uses **three-pass rendering**: lifecycle → layout → render commands
- **Yoga flexbox** computes layout automatically
- **Delta rendering** optimizes: only dirty components re-render
- **Conditional children** trigger layout recalculation
- **Instant reflow** - no animation, single-frame updates

**Interaction Patterns:**
- **Mouse events available** but **not used** in ralph-workflow codebase
- **Keyboard navigation** is primary interaction method
- **Global toggles** preferred over per-item controls
- **Immutable collapsed state** in some components (ToolResult)

**For Building Collapsibles:**
1. Use `useState()` in parent to manage expanded state
2. Pass `expanded` prop to child component
3. Child renders: `expanded ? allContent : content.slice(0, N)`
4. Add indicator: `{!expanded && <text>▸ {hiddenCount} more</text>}`
5. Optional: Add `onMouseDown` handler to toggle state
6. Optional: Use `useKeyboard()` for global keyboard shortcuts

---

**Document Status:** Complete - As-Is Documentation  
**Next Steps:** N/A (documentation only, no implementation)
