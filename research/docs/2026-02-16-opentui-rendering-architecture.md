# OpenTUI Core Rendering Architecture

**Date:** 2026-02-16  
**Source:** `docs/opentui/` (local copy of anomalyco/opentui)

This document describes the core rendering architecture of OpenTUI, focusing on how components are rendered, laid out, and updated during streaming/dynamic content changes.

---

## 1. Core Rendering Primitives

### 1.1 Base Architecture

#### BaseRenderable (`Renderable.ts:135-197`)
All OpenTUI components inherit from `BaseRenderable`, which provides:
- **Identification**: Every renderable has a unique `num` (auto-incremented) and `id` (string identifier)
- **Tree Structure**: `parent` reference and abstract methods: `add()`, `remove()`, `insertBefore()`, `getChildren()`
- **Dirty Tracking**: `_dirty` flag to mark when re-rendering is needed via `markDirty()` / `markClean()`
- **Visibility**: `_visible` boolean property
- **Destruction**: `destroy()` and `destroyRecursively()` methods for cleanup

#### Renderable (`Renderable.ts:203+`)
The main `Renderable` class extends `BaseRenderable` and adds:
- **Yoga Layout Node**: Each renderable wraps a `yogaNode` (Yoga flexbox layout engine)
- **Position & Size**: `_x`, `_y`, `_width`, `_height` properties computed from layout
- **Z-Index Ordering**: `_zIndex` for render order, maintains `_childrenInZIndexOrder` array
- **Transform**: `_translateX` and `_translateY` for translation without layout changes
- **Opacity**: `_opacity` (0.0-1.0) with stack-based rendering
- **Overflow**: `_overflow` property controls clipping via scissor rects
- **Focus Management**: `_focusable` and `_focused` flags, integrates with context's focus system
- **Event Handling**: Mouse, keyboard, paste event listeners
- **Frame Buffering**: Optional `frameBuffer` for rendering to texture then compositing
- **Live Mode**: `_live` flag propagates up tree to request continuous rendering

### 1.2 BoxRenderable (`renderables/Box.ts`)

The fundamental container component.

**Options** (`BoxOptions`, lines 17-31):
- `backgroundColor`: Color string or RGBA
- `border`: Boolean or array of border sides (`"top" | "right" | "bottom" | "left"`)
- `borderStyle`: `"single" | "double" | "rounded" | "thick"` etc.
- `borderColor`: Color for borders
- `focusedBorderColor`: Different border color when focused
- `customBorderChars`: Custom border characters object
- `shouldFill`: Whether to fill background
- `title`: Optional title displayed in border
- `titleAlignment`: `"left" | "center" | "right"`
- `gap`, `rowGap`, `columnGap`: Flexbox gap properties

**Implementation Details**:
- Lines 43-98: Constructor parses colors, border configuration, applies Yoga borders/gaps
- Lines 100-110: `initializeBorder()` handles deferred border initialization for Solid.js compatibility
- Lines 211-228: `renderSelf()` calls `buffer.drawBox()` with all visual properties
- Lines 230-248: `getScissorRect()` adjusts scissor rect to account for border insets
- Lines 250-257: `applyYogaBorders()` sets Yoga edge values (0 or 1) for layout
- Lines 259-273: `applyYogaGap()` sets gap values in Yoga layout

### 1.3 TextRenderable (`renderables/Text.ts`)

Component for rendering styled text content.

**Inheritance Chain**: `TextRenderable` → `TextBufferRenderable` → `EditBufferRenderable` → `Renderable`

**Key Properties** (lines 14-20):
- `_text`: StyledText object containing text chunks with formatting
- `_hasManualStyledText`: Flag to differentiate manual vs. node-based content
- `rootTextNode`: Root `RootTextNodeRenderable` for managing text node children

**Text Content Management**:
- Lines 26-46: Constructor initializes with StyledText, creates root text node
- Lines 48-61: `updateTextBuffer()` updates internal text buffer from StyledText
- Lines 75-83: `content` setter accepts string or StyledText, updates buffer and triggers layout
- Lines 86-97: `updateTextFromNodes()` gathers styled text from child TextNodes when dirty

**Child Management** (lines 99-125):
- `add()`, `remove()`, `insertBefore()`: Delegate to `rootTextNode`
- `clear()`: Removes all children and resets to empty text
- `getTextChildren()`: Returns text node children

**Lifecycle** (lines 127-129):
- `onLifecyclePass()`: Called before render to update text from child nodes

### 1.4 TextNodeRenderable (`renderables/TextNode.ts`)

Lightweight nodes for building text content trees within `TextRenderable`.

**Structure** (lines 34-51):
- `_fg`, `_bg`: Optional foreground/background colors
- `_attributes`: Bit flags for BOLD, ITALIC, UNDERLINE, etc.
- `_link`: Optional link URL
- `_children`: Array of strings or child TextNodeRenderables
- `parent`: Reference to parent TextNodeRenderable

**Content Building** (lines 67-113):
- `add()`: Accepts string, TextNodeRenderable, or StyledText
  - Line 68-78: String children are directly added
  - Line 81-94: TextNodeRenderable children set parent reference
  - Line 96-110: StyledText is converted to TextNode array
- `insertBefore()`: Inserts child before anchor node
- `replace()`: Replaces child at specific index

**Style Gathering** (`renderables/TextNode.ts:151-200`):
- `gatherWithInheritedStyle()`: Recursively gathers text chunks with inherited styling
  - Merges parent fg/bg/attributes with local overrides
  - Returns array of TextChunks for text buffer

### 1.5 RootTextNodeRenderable (`renderables/TextNode.ts:204+`)

Special TextNode that interfaces between TextRenderable and text node tree.

**Key Methods**:
- `fromString()`: Static factory to create node from plain string
- `gatherWithInheritedStyle()`: Returns chunks by gathering from all children
- `add()`, `remove()`, `insertBefore()`: Manage child nodes and mark dirty

---

## 2. ScrollBox Sticky Behavior

### 2.1 ScrollBoxRenderable Structure (`renderables/ScrollBox.ts`)

**Component Hierarchy** (lines 60-67):
- `wrapper`: BoxRenderable (column flex container)
  - `viewport`: BoxRenderable (overflow: hidden, main viewing area)
    - `content`: ContentRenderable (translated container holding actual children)
  - `horizontalScrollBar`: ScrollBarRenderable
- `verticalScrollBar`: ScrollBarRenderable (sibling to wrapper)

**Options** (`ScrollBoxOptions`, lines 44-58):
- `stickyScroll`: Boolean to enable sticky scroll behavior
- `stickyStart`: `"bottom" | "top" | "left" | "right"` - initial sticky edge
- `scrollX`, `scrollY`: Enable horizontal/vertical scrolling
- `scrollAcceleration`: Custom scroll acceleration strategy
- `viewportCulling`: Enable viewport culling optimization

### 2.2 Sticky Scroll Implementation

**State Variables** (lines 87-95):
- `_stickyScroll`: Master enable flag
- `_stickyScrollTop`, `_stickyScrollBottom`, `_stickyScrollLeft`, `_stickyScrollRight`: Track which edge is stuck
- `_stickyStart`: Initial sticky edge preference
- `_hasManualScroll`: Flag to disable sticky when user manually scrolls
- `_isApplyingStickyScroll`: Guard flag to prevent treating programmatic scrolls as manual

**Scroll Position Setters** (lines 119-151):

When `scrollTop` is set (lines 119-132):
1. Updates `verticalScrollBar.scrollPosition`
2. If not applying sticky scroll programmatically:
   - Calculates max scroll: `maxScrollTop = scrollHeight - viewport.height`
   - Only sets `_hasManualScroll = true` if:
     - Not currently at a sticky position (`!isAtStickyPosition()`)
     - There's meaningful scrollable content (`maxScrollTop > 1`)
3. Calls `updateStickyState()`

Similar logic for `scrollLeft` (lines 138-151).

**State Update Logic** (`updateStickyState()`, lines 161-200):

Vertical scrolling (lines 167-182):
- If `scrollTop <= 0`: Sets `_stickyScrollTop = true`, clears bottom
  - If `stickyStart === "top"` or content fits: Clears `_hasManualScroll`
- If `scrollTop >= maxScrollTop`: Sets `_stickyScrollBottom = true`, clears top
  - If `stickyStart === "bottom"`: Clears `_hasManualScroll`
- Else (middle): Clears both sticky flags

Horizontal scrolling (lines 184-199): Similar logic for left/right edges.

**Applying Sticky Start** (`applyStickyStart()`, lines 202-227):

Wraps scroll position changes in `_isApplyingStickyScroll = true` guard:
- `"top"`: Sets scroll position to 0, marks top as sticky
- `"bottom"`: Sets scroll position to max, marks bottom as sticky
- `"left"`: Sets scroll position to 0, marks left as sticky
- `"right"`: Sets scroll position to max, marks right as sticky

**Content Size Changes** (`recalculateBarProps()`, lines 633-678):

Called when content or viewport resizes (lines 288-294):
1. Wraps entire method in `_isApplyingStickyScroll = true` guard (line 636)
2. Updates scrollbar sizes from content dimensions (lines 638-641)
3. If `_stickyScroll` enabled:
   - Calculates new max scroll values (lines 644-645)
   - If has `_stickyStart` and no manual scroll: Re-applies sticky start (lines 647-649)
   - Otherwise: Maintains sticky edge positions (lines 650-661)
     - If `_stickyScrollBottom` and scrollable: Snaps to new bottom
     - If `_stickyScrollRight` and scrollable: Snaps to new right
4. Schedules render via `process.nextTick()` (line 675)

**Example Flow - Streaming Chat**:
1. Create ScrollBox with `stickyScroll: true, stickyStart: "bottom"`
2. Constructor calls `applyStickyStart("bottom")` (lines 344-346)
3. As messages are added:
   - Content height increases
   - `onSizeChange` callback fires (line 288)
   - `recalculateBarProps()` is called
   - Because `_hasManualScroll === false` and `_stickyScrollBottom === true`:
     - Scroll position is set to new `maxScrollTop` (line 653)
   - ScrollBox stays stuck to bottom showing latest content
4. If user scrolls up:
   - `scrollTop` setter detects not at sticky position (line 127)
   - Sets `_hasManualScroll = true` (line 128)
   - Future content changes will NOT auto-scroll (line 647 condition fails)
5. If user scrolls back to bottom:
   - `updateStickyState()` detects `scrollTop >= maxScrollTop`
   - Sets `_stickyScrollBottom = true` (line 175)
   - If matches `stickyStart`: Clears `_hasManualScroll` (line 176)
   - Future content changes resume auto-scrolling

### 2.3 Scroll Event Handling

**Mouse Scroll** (`onMouseEvent()`, lines 421-468):
- Lines 422-460: Handles scroll wheel events
  - Supports acceleration via `scrollAccel.tick(now)`
  - Accumulates fractional scrolling in `scrollAccumulatorY/X`
  - Only updates when integer scroll amount is reached
  - Sets `_hasManualScroll = true` if content is scrollable (lines 462-467)

**Keyboard Scrolling** (`handleKeyPress()`, lines 477-492):
- Delegates to scrollbar `handleKeyPress()` methods
- On success: Sets `_hasManualScroll = true` and resets accumulators

**Programmatic Scrolling**:
- `scrollBy()` (lines 361-370): Delegates to scrollbar, doesn't set manual scroll directly
- `scrollTo()` (lines 372-381): Uses setters which handle manual scroll logic

### 2.4 Auto-scroll During Selection Drag

**Auto-scroll State** (lines 72-82):
- `autoScrollMouseX/Y`: Current mouse position
- `autoScrollThresholdVertical/Horizontal`: Edge distance to trigger scroll (3px)
- `autoScrollSpeedSlow/Medium/Fast`: Speed tiers (6, 36, 72 px/s)
- `isAutoScrolling`: Active flag
- `cachedAutoScrollSpeed`: Pre-calculated speed based on mouse position
- `autoScrollAccumulatorX/Y`: Fractional scroll accumulation

**Implementation** (lines 499-583):
- `startAutoScroll()` (lines 499-509): Caches speed, sets `live = true` for continuous updates
- `updateAutoScroll()` (lines 511-526): Updates mouse position and speed cache
- `handleAutoScroll()` (lines 547-583): Called each frame via `onUpdate()`
  - Calculates scroll amount from cached speed and delta time
  - Accumulates fractional scrolling
  - Updates scroll position when integer threshold reached
  - Requests selection update from context

---

## 3. Layout Engine (Yoga/Flexbox)

### 3.1 Yoga Integration

**Configuration** (`Renderable.ts:199-201`):
```typescript
const yogaConfig: Config = Yoga.Config.create()
yogaConfig.setUseWebDefaults(false)
yogaConfig.setPointScaleFactor(1)
```

**Node Creation** (`Renderable.ts:286`):
- Each Renderable creates a `Yoga.Node` with shared config
- Node is freed in `destroy()` (line 1441)

### 3.2 Layout Properties

**Setup** (`setupYogaProperties()`, lines 646-726):

Flexbox properties (lines 648-681):
- `flexDirection`: Column, row, row-reverse, column-reverse
- `flexWrap`: Wrap, nowrap, wrap-reverse
- `alignItems`, `alignSelf`, `justifyContent`: Alignment
- `flexGrow`, `flexShrink`, `flexBasis`: Flex sizing
- `enableLayout`: Flag to enable/disable layout calculations

Size properties (lines 683-690):
- `width`, `height`: Set via `node.setWidth()` / `setHeight()`
- Supports numbers, percentages (`"50%"`), or `"auto"`
- `minWidth`, `maxWidth`, `minHeight`, `maxHeight`: Constraints (lines 718-723)

Position properties (lines 692-716):
- `position`: `"relative" | "absolute"`
- `top`, `right`, `bottom`, `left`: Position offsets
- Supports numbers, percentages, or `"auto"`

Margin & Padding (lines 728-776):
- Accepts individual edges or grouped (all, horizontal, vertical)
- Supports numbers, percentages, or `"auto"` (margin only)
- Applied via `node.setMargin()` / `setPadding()` with `Edge` enum

### 3.3 Children Management

**Adding Children** (`add()`, lines 1102-1154):
1. Converts VNode to Renderable via `maybeMakeRenderable()` (line 1107)
2. If inserting at index, delegates to `insertBefore()` (lines 1119-1123)
3. Otherwise:
   - If already a child: Removes and re-adds (lines 1125-1128)
   - If new child:
     - Calls `replaceParent()` to update parent reference (line 1129)
     - Marks `needsZIndexSort` for render order (line 1130)
     - Adds to `renderableMapById` and `_childrenInZIndexOrder` (lines 1131-1132)
     - Registers lifecycle pass if needed (lines 1134-1136)
     - Propagates live count (lines 1138-1140)
4. Adds Yoga node as child: `yogaNode.insertChild(childLayoutNode, index)` (line 1146)
5. Adds to `_childrenInLayoutOrder` array (line 1145)
6. Marks `childrenPrimarySortDirty` and adds to `_shouldUpdateBefore` (lines 1148-1149)
7. Requests render (line 1151)

**Inserting Before** (`insertBefore()`, lines 1156-1254):
- Similar to `add()` but inserts before anchor child
- Finds anchor index in `_childrenInLayoutOrder` (line 1221)
- Inserts at that position in both layout order and Yoga tree (lines 1233-1235)

**Removing Children** (`remove()`, lines 1256-1285):
- Removes from `renderableMapById` and both child arrays (lines 1262-1264)
- Removes from Yoga tree: `yogaNode.removeChild(child.yogaNode)` (line 1266)
- Propagates negative live count (lines 1268-1270)
- Calls `child.destroy()` to clean up child (line 1279)
- Emits `LayoutEvents.REMOVED` (line 1280)

### 3.4 Z-Index Sorting

**Sorting** (`ensureZIndexSorted()`, lines 558-567):
- Only sorts if `needsZIndexSort` flag is set
- Sorts `_childrenInZIndexOrder` by `_zIndex` property ascending
- Lower z-index renders first (appears behind)

**Usage**:
- Called before rendering children (line 1328 in `updateLayout()`)
- Updated when z-index property changes (line 545)
- Set when children are added/removed

---

## 4. Content Reflow and Delta Rendering

### 4.1 Layout Calculation

**Root Layout** (`RootRenderable.calculateLayout()`, lines 1687-1690):
- Entry point: `yogaNode.calculateLayout(width, height, Direction.LTR)`
- Computes layout for entire tree in one pass
- Emits `LayoutEvents.LAYOUT_CHANGED` event

**Triggering Layout** (lines 1638-1641 in `RootRenderable.render()`):
```typescript
if (this.yogaNode.isDirty()) {
  this.calculateLayout()
}
```

**Layout is marked dirty when**:
- Children are added/removed
- Size properties change
- Position properties change
- Margin/padding changes
- Flexbox properties change

### 4.2 Three-Pass Rendering

**Render Flow** (`RootRenderable.render()`, lines 1623-1673):

**Pass 0: Lifecycle Pass** (lines 1626-1629):
- Iterates all registered lifecycle passes
- Calls `onLifecyclePass()` on each renderable
- Used by TextRenderable to update from child nodes (lines 127-129 in Text.ts)

**Pass 1: Calculate Layout** (lines 1638-1641):
- Only if `yogaNode.isDirty()`
- Calls `calculateLayout()` to compute entire tree

**Pass 2: Update Layout & Collect Render List** (lines 1643-1645):
- Clears `renderList` array
- Calls `this.updateLayout(deltaTime, renderList)`
- Recursively walks tree building list of render commands

**Pass 3: Execute Render Commands** (lines 1647-1673):
- Clears hit grid scissor rects (line 1648)
- Iterates render list starting from index 1 (skipping root's entry)
- Executes each command type:
  - `"render"`: Calls `renderable.render(buffer, deltaTime)` (lines 1652-1656)
  - `"pushScissorRect"`: Pushes scissor and hit grid rect (lines 1658-1661)
  - `"popScissorRect"`: Pops both (lines 1662-1665)
  - `"pushOpacity"`: Pushes opacity level (lines 1666-1668)
  - `"popOpacity"`: Pops opacity level (lines 1669-1671)

### 4.3 Layout Update Traversal

**Update Layout** (`Renderable.updateLayout()`, lines 1277-1358):

**Layout Update** (lines 1304-1318):
1. Calls `updateFromLayout()` to sync position/size from Yoga (line 1304)
2. Updates newly added children in `_shouldUpdateBefore` set (lines 1308-1315)
   - Ensures their positions are current before culling
   - Clears the set after processing
3. Early exit if destroyed during `onResize` callbacks (line 1318)

**Opacity Handling** (lines 1320-1324):
- If `_opacity < 1.0`: Pushes `pushOpacity` command before rendering self
- Pops after children rendered (lines 1355-1357)

**Self Render** (line 1326):
- Adds `render` command with reference to this renderable

**Scissor Rect (Overflow)** (lines 1330-1342):
- If `_overflow !== "visible"` and has dimensions:
  - Calls `getScissorRect()` to get clipping bounds
  - Pushes `pushScissorRect` command before children
  - Pops after children (lines 1352-1354)

**Children Traversal** (lines 1343-1350):
1. Gets visible children via `_getVisibleChildren()` (line 1343)
2. Iterates `_childrenInZIndexOrder` (line 1344)
3. If child not visible: Only calls `updateFromLayout()` (line 1346)
4. If visible: Recursively calls `child.updateLayout()` (line 1349)

**Visible Children** (lines 1384-1386):
- Default: Returns all children by number
- ScrollBox overrides to implement viewport culling

### 4.4 Position/Size Sync

**Update From Layout** (`updateFromLayout()`, lines 1016-1042):
1. Reads computed layout from Yoga: `yogaNode.getComputedLayout()` (line 1017)
2. Stores old dimensions (lines 1019-1022)
3. Updates position: `_x = layout.left`, `_y = layout.top` (lines 1024-1025)
4. Updates size (max with 1): `_widthValue`, `_heightValue` (lines 1027-1032)
5. If size changed: Calls `onLayoutResize()` (lines 1034-1036)
6. If position changed: Marks parent's `childrenPrimarySortDirty` (lines 1038-1041)

**On Layout Resize** (`onLayoutResize()`, lines 1044-1051):
- Calls `handleFrameBufferResize()` if buffered (line 1047)
- Calls `onResize()` hook (line 1048)
- Requests render (line 1049)

**Frame Buffer Resize** (`handleFrameBufferResize()`, lines 1053-1065):
- If buffered and dimensions valid:
  - Resizes existing buffer or creates new one
  - Frame buffer stores pre-rendered content for compositing

**On Resize Hook** (`onResize()`, lines 1089-1093):
- Calls user `onSizeChange()` callback (line 1090)
- Emits `"resize"` event (line 1091)
- Overridden by subclasses for custom behavior

### 4.5 Render Command Execution

**Individual Render** (`Renderable.render()`, lines 1360-1382):

**Buffer Selection** (lines 1361-1364):
- If buffered: Renders to own `frameBuffer`
- Otherwise: Renders to parent's buffer

**Render Hooks** (lines 1366-1374):
- `renderBefore()`: Custom pre-render logic (lines 1366-1368)
- `renderSelf()`: Component's main rendering (line 1370)
- `renderAfter()`: Custom post-render logic (lines 1372-1374)

**State Updates** (lines 1376-1377):
- Marks clean (stops re-rendering until next dirty)
- Adds to hit grid for mouse hit testing

**Compositing** (lines 1379-1381):
- If buffered: Draws frame buffer to parent buffer at `(x, y)`

### 4.6 Delta Rendering

**Dirty Tracking**:
- `markDirty()` sets `_dirty = true` (line 176)
- `requestRender()` marks dirty and tells context to render (lines 474-477)
- `markClean()` sets `_dirty = false` after render (line 1376)

**Optimization**:
- Only renderables that changed request renders
- Layout recalculation only happens if Yoga tree is dirty
- Hit grid only rebuilds if elements changed (checked in renderer loop line 1908)

**Renderer Loop** (`renderer.ts:1847-1946`):
1. Calculates delta time since last frame (lines 1857-1861)
2. Updates FPS counter (lines 1863-1868)
3. Executes animation frame callbacks (lines 1874-1882)
4. Executes frame callbacks (lines 1884-1893)
5. Calls `root.render(nextRenderBuffer, deltaTime)` (line 1895)
6. Runs post-process functions (lines 1897-1899)
7. Renders console overlay (line 1901)
8. Calls `renderNative()` to output to terminal (line 1905)
9. Rechecks hover state if hit grid changed (lines 1908-1910)
10. Schedules next frame based on target FPS (lines 1926-1933)

**Viewport Culling** (`ContentRenderable._getVisibleChildren()`, lines 34-41 in ScrollBox.ts):
- If `_viewportCulling` enabled:
  - Calls `getObjectsInViewport()` with viewport bounds
  - Only returns children intersecting viewport
  - Children outside viewport: Layout updates but no render
- Otherwise: Returns all children

---

## 5. Event System

### 5.1 Event Types

**LayoutEvents** (`Renderable.ts:39-44`):
- `LAYOUT_CHANGED`: Layout was recalculated
- `ADDED`: Child was added
- `REMOVED`: Child was removed
- `RESIZED`: Component was resized

**RenderableEvents** (`Renderable.ts:46-49`):
- `FOCUSED`: Component gained focus
- `BLURRED`: Component lost focus

**RendererEvents** (`types.ts:53-58`):
- `resize`: Terminal window resized `(width, height)`
- `key`: Raw key input `(data: Buffer)`
- `memory:snapshot`: Memory usage snapshot
- `selection`: Text selection changed
- `debugOverlay:toggle`: Debug overlay toggled

### 5.2 Mouse Events

**Mouse Event Structure** (`renderer.ts:130-157`):
- `type`: `"down" | "up" | "move" | "drag" | "drag-end" | "drop" | "over" | "out" | "scroll"`
- `x`, `y`: Screen coordinates
- `button`: `MouseButton.LEFT | RIGHT | MIDDLE | ...`
- `modifiers`: `{ shift, alt, ctrl }`
- `scroll`: Optional scroll info `{ direction, delta }`
- `isDragging`: Whether mouse is being dragged
- `source`: Source renderable for drop events

**Mouse Event Flow**:
1. Raw input parsed by `MouseParser` (`renderer.ts:1149+`)
2. Hit test finds renderable under cursor: `hitTest(x, y)` (line 1380)
3. Creates `MouseEvent` instance wrapping renderable (line 1314)
4. Calls `renderable.processMouseEvent(event)` (line 1314)
5. Event propagates up tree via `parent.processMouseEvent()` (lines 1467-1469)

**Event Handlers** (`Renderable.ts:1477-1528`):

Setter properties map to internal listeners:
- `onMouse`: Catches all mouse events (lines 1477-1480)
- `onMouseDown`, `onMouseUp`, `onMouseMove` (lines 1482-1495)
- `onMouseDrag`, `onMouseDragEnd`, `onMouseDrop` (lines 1497-1509)
- `onMouseOver`, `onMouseOut`, `onMouseScroll` (lines 1511-1523)

**Event Processing** (`processMouseEvent()`, lines 1462-1470):
1. Calls generic `_mouseListener` (line 1463)
2. Calls type-specific listener from `_mouseListeners[type]` (line 1464)
3. Calls `onMouseEvent()` virtual method (line 1465)
4. Propagates to parent if not stopped (lines 1467-1469)

### 5.3 Keyboard Events

**Focus System**:
- Only one renderable can be focused at a time
- Managed by renderer via `_currentFocusedRenderable` (line 428 in renderer.ts)
- `focusRenderable()` / `blurRenderable()` methods

**Focus Lifecycle** (`focus()`, lines 381-411):
1. Guards against re-focusing or non-focusable (line 382)
2. Registers with context: `ctx.focusRenderable(this)` (line 384)
3. Sets `_focused = true` (line 385)
4. Creates `keypressHandler` that:
   - Calls user `_keyListeners["down"]` (line 390)
   - Calls `handleKeyPress()` if not prevented (lines 393-395)
5. Creates `pasteHandler` similarly (lines 398-406)
6. Registers handlers with context's key input (lines 408-409)
7. Emits `RenderableEvents.FOCUSED` (line 410)

**Blur Lifecycle** (`blur()`, lines 413-430):
1. Guards against non-focused (line 414)
2. Sets `_focused = false` (line 416)
3. Unregisters handlers from context (lines 419-427)
4. Emits `RenderableEvents.BLURRED` (line 429)

**Key Event Structure** (from `lib/KeyHandler.ts`):
- `name`: Key name (e.g., "a", "enter", "up")
- `ctrl`, `shift`, `alt`, `meta`: Modifier flags
- `sequence`: Raw escape sequence
- `defaultPrevented`: Whether default action prevented

### 5.4 Selection Events

**Selection System** (`lib/selection.ts`):
- Renderer maintains `currentSelection` (line 238 in renderer.ts)
- Started by mouse down on selectable renderable (lines 1223-1233)
- Updated during drag (lines 1236-1244)
- Finished on mouse up (lines 1247-1254)

**Selection Lifecycle**:
1. Mouse down on selectable renderable
   - Checks `shouldStartSelection(x, y)` (line 1228)
   - Calls `startSelection(renderable, x, y)` (line 1230)
2. Mouse drag while selecting
   - Calls `updateSelection(renderable, x, y)` (line 1237)
   - Triggers auto-scroll in ScrollBox (lines 470-474)
3. Mouse up
   - Calls `finishSelection()` (line 1253)
   - Clears dragging state

**Selection Callbacks**:
- `onSelectionChanged(selection)`: Called on renderable when selection updates
- `getSelectedText()`: Retrieves selected text content
- `hasSelection()`: Whether renderable has active selection

### 5.5 Content Change Events

**EditBuffer Components** (Input, Textarea):
- `CursorChangeEvent`: `{ line, visualColumn }` (line 11 in EditBufferRenderable.ts)
- `ContentChangeEvent`: Fired when text changes (line 16)

**Component-Specific Events**:
- `SelectRenderable`: `SELECTION_CHANGED`, `ITEM_SELECTED` (lines 59-62 in Select.ts)
- `TabSelectRenderable`: `SELECTION_CHANGED`, `ITEM_SELECTED` (lines 54-57 in TabSelect.ts)
- `InputRenderable`: `INPUT`, `CHANGE`, `ENTER` (lines 24-28 in Input.ts)

---

## 6. React Bindings

### 6.1 Reconciler Setup

**Host Config** (`react/src/reconciler/host-config.ts:15-250`):

React Reconciler configuration that maps React operations to OpenTUI renderables.

**Instance Creation** (`createInstance()`, lines 36-52):
1. Gets component type from catalogue (line 42)
2. Creates instance: `new components[type](ctx, { id, ...props })` (line 48)
3. Returns renderable instance

**Text Creation** (`createTextInstance()`, lines 107-113):
- Must be inside text context (checked line 108)
- Creates TextNode from string: `TextNodeRenderable.fromString(text)` (line 112)

### 6.2 Tree Operations

**appendChild** (line 55-57):
- Directly calls `parent.add(child)`

**removeChild** (line 60-62):
- Calls `parent.remove(child.id)`

**insertBefore** (lines 65-67, 70-72):
- Calls `parent.insertBefore(child, beforeChild)`
- Works for both regular containers and root

**commitUpdate** (lines 147-150):
- Calls `updateProperties()` to apply prop changes
- Calls `instance.requestRender()` to trigger re-render

**commitTextUpdate** (lines 153-156):
- Updates TextNode children: `textInstance.children = [newText]`
- Requests render

### 6.3 Context Tracking

**Host Context** (lines 91-99):

Tracks whether inside text component:
```typescript
interface HostContext {
  isInsideText: boolean
}
```

**getRootHostContext** (lines 91-93):
- Returns `{ isInsideText: false }` for root

**getChildHostContext** (lines 96-99):
- Sets `isInsideText: true` if type is "text" or text node key
- Prevents creating text nodes outside text components

### 6.4 Property Updates

**setInitialProperties** (`utils/index.ts`):
- Called during `finalizeInitialChildren()` (line 137)
- Maps React props to renderable properties
- Handles special cases like focus, children rendering

**updateProperties** (`utils/index.ts`):
- Called during `commitUpdate()` (line 148)
- Diffs old and new props
- Applies only changed properties
- Handles additions, removals, and updates

### 6.5 Component Mapping

**Component Catalogue** (`components/index.ts:25-48`):

Maps JSX tag names to renderable constructors:
```typescript
{
  box: BoxRenderable,
  text: TextRenderable,
  scrollbox: ScrollBoxRenderable,
  input: InputRenderable,
  textarea: TextareaRenderable,
  // ... text modifiers
  span: SpanRenderable,
  b: BoldSpanRenderable,
  i: ItalicSpanRenderable,
  u: UnderlineSpanRenderable,
  br: LineBreakRenderable,
  a: LinkRenderable,
}
```

**Extension** (`extend()`, lines 66-68):
- Allows adding custom component types
- Merges into component catalogue
- Available in JSX via registered names

### 6.6 Dynamic Children

**List Rendering**:
React's reconciler handles list diffing automatically:
1. Maps children to instances via `createInstance()`
2. Matches by key or index
3. Calls `insertBefore()` for position changes
4. Calls `appendChild()` for new children
5. Calls `removeChild()` for removed children

**Conditional Rendering**:
React's reconciler handles conditionals:
1. If component becomes null/undefined: Calls `removeChild()`
2. If component appears: Calls `appendChild()` or `insertBefore()`
3. Maintains tree structure automatically

**Example**:
```tsx
<scrollbox stickyScroll stickyStart="bottom">
  {messages.map(msg => (
    <text key={msg.id}>{msg.content}</text>
  ))}
</scrollbox>
```

When new message added:
1. React reconciler calls `createInstance("text", ...)`
2. Calls `scrollbox.add(textRenderable)`
3. OpenTUI adds to `_childrenInLayoutOrder` array
4. Marks Yoga tree dirty
5. Next render: Layout recalculates, text appears at bottom
6. ScrollBox's `recalculateBarProps()` fires
7. If sticky bottom: Scrolls to show new message

### 6.7 Lifecycle Integration

**Commit Phases**:

**prepareForCommit** (line 80-82):
- Returns null (no special preparation needed)

**resetAfterCommit** (line 85-88):
- Calls `containerInfo.requestRender()`
- Triggers layout/render pass after React updates

**Cleanup**:

**hideInstance** (lines 168-171):
- Sets `visible = false` on renderable
- Removes from layout automatically via Yoga

**detachDeletedInstance** (lines 247-250):
- If no parent: Calls `destroyRecursively()`
- Cleans up entire subtree

---

## Key Implementation Files

- **`Renderable.ts`**: Base renderable classes, layout integration, event handling
- **`renderables/Box.ts`**: Box component (borders, background, flexbox container)
- **`renderables/Text.ts`**: Text component (styled text rendering)
- **`renderables/TextNode.ts`**: Text node tree for building text content
- **`renderables/ScrollBox.ts`**: Scrollable container with sticky scroll
- **`renderer.ts`**: Main renderer loop, event dispatch, terminal output
- **`react/src/reconciler/host-config.ts`**: React reconciler integration
- **`react/src/components/index.ts`**: Component catalogue and extension

---

## Summary

OpenTUI uses a **three-pass rendering system**:

1. **Lifecycle Pass**: Pre-render updates (text from nodes, etc.)
2. **Layout Pass**: Yoga calculates positions/sizes
3. **Render Pass**: Walks tree, builds render commands, executes drawing

**Sticky scroll** works by:
- Tracking which edge is sticky and whether user manually scrolled
- Automatically adjusting scroll position when content size changes
- Disabling auto-scroll when user manually interacts
- Re-enabling when user scrolls back to sticky edge

**Reflow** happens when:
- Children added/removed (marks Yoga dirty)
- Size properties change (marks Yoga dirty)
- Content grows (triggers size change, layout recalc, render)

**React integration** maps JSX operations to renderable methods via reconciler, with automatic diffing and tree synchronization.
