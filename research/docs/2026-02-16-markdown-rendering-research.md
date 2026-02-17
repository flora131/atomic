---
title: Markdown Rendering of Agent Responses Across SDK Options
date: 2026-02-16
commit: 6af1e299542eccf73089e955e110c656d7361da4
branch: lavaman131/hotfix/sub-agent-display
research_question: How to implement markdown rendering of agent responses across all SDK options (Claude Agent SDK, OpenCode SDK, Copilot SDK) using OpenTUI
---

# Markdown Rendering of Agent Responses Across SDK Options

## Executive Summary

The Atomic TUI currently renders all agent text responses as **plain text** via `<text>` elements, despite having markdown rendering infrastructure partially built. OpenTUI provides two production-ready components for rendering markdown in the terminal: `MarkdownRenderable` (`<markdown>`) and `CodeRenderable` (`<code filetype="markdown">`). OpenCode (which uses OpenTUI under the hood) demonstrates both approaches, gated by a feature flag. All three SDK clients (Claude Agent SDK, OpenCode SDK, Copilot SDK) stream text as plain strings via the unified `AgentMessage` interface, requiring no SDK-specific changes to enable markdown rendering.

The core change needed is replacing the plain `<text>` element in `TextPartDisplay` with either `<markdown>` or `<code filetype="markdown">`, passing the existing (but unused) `markdownSyntaxStyle` and `streaming` state as props.

## Table of Contents

1. [Current State: Atomic TUI Text Rendering](#1-current-state-atomic-tui-text-rendering)
2. [OpenTUI Markdown Rendering Components](#2-opentui-markdown-rendering-components)
3. [OpenCode Reference Implementation](#3-opencode-reference-implementation)
4. [SDK Response Format Analysis](#4-sdk-response-format-analysis)
5. [OpenTUI Rendering Pipeline Deep Dive](#5-opentui-rendering-pipeline-deep-dive)
6. [OpenTUI Framework Bindings (React)](#6-opentui-framework-bindings-react)
7. [Theme and Syntax Style Integration](#7-theme-and-syntax-style-integration)
8. [Gap Analysis and Integration Points](#8-gap-analysis-and-integration-points)
9. [Key Files Reference](#9-key-files-reference)

---

## 1. Current State: Atomic TUI Text Rendering

### The Problem

Agent text responses are rendered as **plain text** with no markdown formatting, syntax highlighting, or structural rendering.

**`TextPartDisplay`** at `src/ui/components/parts/text-part-display.tsx:18`:
```tsx
<text style={{ fg: colors.foreground }}>{trimmedContent}</text>
```

This is a plain `<text>` element — no markdown parsing, no syntax highlighting, no `<markdown>` or `<code>` component usage.

### Unused Infrastructure

The codebase already has markdown rendering infrastructure that is **created but never applied**:

1. **`createMarkdownSyntaxStyle()`** at `src/ui/theme.tsx:468` — builds a `SyntaxStyle` using Catppuccin colors with scope mappings for headings, keywords, strings, comments, etc.

2. **`markdownSyntaxStyle`** created at `src/ui/chat.tsx:1715`:
   ```tsx
   const markdownSyntaxStyle = useMemo(
     () => createMarkdownSyntaxStyle(theme.colors, theme.isDark),
     [theme]
   );
   ```
   This is passed to `MessageBubble` as `syntaxStyle`, but `MessageBubble` aliases it as `_syntaxStyle` (unused destructured parameter) at line 1414.

3. **`CodeBlock`** component at `src/ui/code-block.tsx:187` — supports `<code>` JSX with `SyntaxStyle` and `streaming`, but is **not used** in the message rendering pipeline.

### Parts-Based Rendering System

Messages use a `Part[]` array dispatched via `PART_REGISTRY` at `src/ui/components/parts/registry.tsx:22`:

| Part Type | Renderer | Description |
|---|---|---|
| `text` | `TextPartDisplay` | Plain text (needs markdown) |
| `reasoning` | `ReasoningPartDisplay` | Thinking/reasoning content |
| `tool` | `ToolPartDisplay` | Tool execution with state machine |
| `agent` | `AgentPartDisplay` | Sub-agent tree |
| `task-list` | `TaskListPartDisplay` | Task list items |
| `skill-load` | `SkillLoadPartDisplay` | Skill loading status |
| `mcp-snapshot` | `McpSnapshotPartDisplay` | MCP server snapshot |
| `context-info` | `ContextInfoPartDisplay` | Context window info |
| `compaction` | `CompactionPartDisplay` | Compaction summary |

The `MessageBubbleParts` component at `src/ui/components/parts/message-bubble-parts.tsx:26` iterates over parts and dispatches each to its renderer.

### Streaming Data Flow

1. User submits via `<textarea onSubmit>` at `chat.tsx:5270`
2. `handleStreamMessage()` at `src/ui/index.ts:1037` calls `session.stream(content)` on the active SDK client
3. Text chunks arrive as `message.type === "text"` at line 1084
4. Each chunk calls `onChunk(chunk)` → `handleTextDelta()` at `src/ui/parts/handlers.ts:23`
5. `handleTextDelta` appends the delta to the last streaming `TextPart`, or creates a new `TextPart`
6. `TextPartDisplay` renders the accumulated `part.content` as plain text

---

## 2. OpenTUI Markdown Rendering Components

### Option A: `<markdown>` — MarkdownRenderable

Source: `docs/opentui/packages/core/src/renderables/Markdown.ts` (~855 lines)

The `MarkdownRenderable` uses the `marked` library to tokenize markdown content and creates separate child renderables for each block type:

- **Paragraphs/headings** → `TextRenderable` with styled `TextChunk[]`
- **Fenced code blocks** → `CodeRenderable` with language-specific tree-sitter highlighting
- **Tables** → Table layout renderables
- **Block quotes** → Indented styled boxes
- **Lists** → Styled list items with markers

**Props (MarkdownOptions):**

| Property | Type | Default | Description |
|---|---|---|---|
| `content` | `string` | `""` | Markdown source text |
| `syntaxStyle` | `SyntaxStyle` | required | Style definitions for all token types |
| `conceal` | `boolean` | `true` | Hide markdown syntax markers (`#`, `*`, backticks) |
| `streaming` | `boolean` | `false` | Optimize for incremental content updates |
| `treeSitterClient` | `TreeSitterClient` | auto | Custom tree-sitter client for code blocks |
| `renderNode` | `(token, context) => Renderable` | - | Custom per-token rendering callback |

**Streaming mode:**
- Uses `parseMarkdownIncremental()` from `markdown-parser.ts` which reuses unchanged tokens from previous parse
- Keeps the last `trailingUnstable = 2` tokens as potentially incomplete (e.g., `# Hello` may become `# Hello World`)
- Content setter triggers `updateBlocks()` which diffs new tokens against existing block states and updates in-place
- Tables get special handling: incomplete rows render as raw markdown, transitioning to formatted tables once complete

**Incremental parser** at `docs/opentui/packages/core/src/renderables/markdown-parser.ts`:
```typescript
function parseMarkdownIncremental(
  newContent: string,
  prevState: ParseState | null,
  trailingUnstable: number = 2
): ParseState
```

### Option B: `<code filetype="markdown">` — CodeRenderable

Source: `docs/opentui/packages/core/src/renderables/Code.ts` (~303 lines)

The `CodeRenderable` treats markdown as "just another language" — it uses tree-sitter's markdown grammar to parse and highlight all markdown syntax as styled text. This is simpler but less structurally rich (no box-rendered code blocks, no table layouts).

**Props (CodeOptions):**

| Property | Type | Default | Description |
|---|---|---|---|
| `content` | `string` | `""` | Source code / markdown text |
| `filetype` | `string` | - | Language identifier (e.g., `"markdown"`) |
| `syntaxStyle` | `SyntaxStyle` | required | Style definitions |
| `conceal` | `boolean` | `true` | Hide formatting markers |
| `drawUnstyledText` | `boolean` | `true` | Show text before highlighting completes |
| `streaming` | `boolean` | `false` | Incremental highlight updates |
| `onHighlight` | `OnHighlightCallback` | - | Modify highlights before rendering |

**Async highlighting pipeline:**
1. `content` setter marks `_highlightsDirty = true`, increments `_highlightSnapshotId`
2. During `renderSelf()`, `startHighlight()` is called asynchronously
3. `TreeSitterClient.highlightOnce(content, filetype)` sends to Web Worker
4. Worker parses with tree-sitter WASM, returns `SimpleHighlight[]` tuples
5. Snapshot ID checked — if content changed during highlight, result is discarded
6. `treeSitterToTextChunks()` converts highlights to styled `TextChunk[]` via `SyntaxStyle`
7. Chunks wrapped in `StyledText`, written to native `TextBuffer`
8. `requestRender()` triggers a new frame

### Comparison

| Aspect | `<markdown>` | `<code filetype="markdown">` |
|---|---|---|
| Parser | `marked` (block-level tokenizer) | tree-sitter (markdown grammar) |
| Code blocks | Delegates to `CodeRenderable` per block | Highlights inline with injection queries |
| Tables | Dedicated table renderable | Tree-sitter highlight only |
| Lists | Styled list items with indentation | Tree-sitter highlight only |
| Headings | Sized/styled `TextRenderable` | Tree-sitter color + bold |
| Block quotes | Indented styled boxes | Tree-sitter highlight only |
| Streaming | Incremental token reuse | Incremental re-highlight |
| Conceal | Token-level marker hiding | Tree-sitter conceal queries |
| Rendering fidelity | High (structural blocks) | Medium (flat styled text) |
| Complexity | Higher | Lower |

---

## 3. OpenCode Reference Implementation

OpenCode uses OpenTUI and demonstrates both approaches, gated by `Flag.OPENCODE_EXPERIMENTAL_MARKDOWN`.

### TextPart Rendering (`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1370-1399`)

**Default mode** (lines 1385-1395) — uses `<code filetype="markdown">`:
```tsx
<code
  filetype="markdown"
  drawUnstyledText={false}
  streaming={true}
  syntaxStyle={syntax()}
  content={props.part.text.trim()}
  conceal={ctx.conceal()}
  fg={theme.text}
/>
```

**Experimental mode** (lines 1377-1383) — uses `<markdown>`:
```tsx
<markdown
  syntaxStyle={syntax()}
  streaming={true}
  content={props.part.text.trim()}
  conceal={ctx.conceal()}
/>
```

### ReasoningPart Rendering (lines 1337-1368)

Uses `<code filetype="markdown">` with `subtleSyntax()` — a dimmed variant:
```tsx
<code
  filetype="markdown"
  drawUnstyledText={false}
  streaming={true}
  syntaxStyle={subtleSyntax()}
  content={"_Thinking:_ " + content()}
  conceal={ctx.conceal()}
  fg={theme.textMuted}
/>
```

The `subtleSyntax` variant applies `thinkingOpacity` (default 0.6) to all foreground colors' alpha channels.

### OpenCode Event Pipeline

OpenCode uses SolidJS + SSE for streaming:
1. SDK client subscribes to SSE via `sdk.event.subscribe()`
2. Events batched in 16ms windows using `batch()` for single render passes
3. `message.part.delta` events concatenate text: `part[field] = (existing ?? "") + event.properties.delta`
4. `<scrollbox>` with `stickyScroll={true}` and `stickyStart="bottom"` auto-scrolls

### OpenCode Theme System

Themes define ~70+ named colors including 14 markdown-specific tokens:
- `markdownText`, `markdownHeading`, `markdownLink`, `markdownCode`, `markdownBlockQuote`
- `markdownEmph`, `markdownStrong`, `markdownList`, `markdownImage`
- `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, etc.

`generateSyntax()` calls `SyntaxStyle.fromTheme()` with ~80+ scope-to-style rules mapping tree-sitter capture names to colors.

---

## 4. SDK Response Format Analysis

### Unified Interface

All three SDKs stream `AgentMessage` objects (defined at `src/sdk/types.ts:193-202`):

```typescript
interface AgentMessage {
  type: MessageContentType;      // "text" | "tool_use" | "tool_result" | "thinking"
  content: string | unknown;
  role?: MessageRole;
  metadata?: MessageMetadata;
}
```

Text content arrives as **plain strings** — all markdown formatting is in the string itself. No SDK-specific handling is needed for markdown rendering.

### Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

- **Streaming**: `query()` returns `AsyncIterable<SDKMessage>` iterated via `for await`
- **Text deltas**: `stream_event` with `content_block_delta` → `text_delta` → yields `{ type: "text", content: deltaString }`
- **Thinking**: `content_block_delta` → `thinking_delta` → yields `{ type: "thinking", content: thinkingString }` with `metadata.streamingStats.thinkingMs`
- **Tool calls**: `assistant` messages with `tool_use` content blocks → `{ type: "tool_use", content: { name, input, toolUseId } }`

### OpenCode SDK (`@opencode-ai/sdk`)

- **Streaming**: Dual-path — direct response via `sdkClient.session.prompt()` returning `result.data.parts[]`, or SSE deltas via `message.part.delta` events
- **Text deltas**: `message.part.updated` where `part.type === "text"` → emitted as `message.delta` with `contentType: "text"`
- **Thinking**: `part.type === "reasoning"` → emitted as `message.delta` with `contentType: "reasoning"`
- **Tool calls**: `part.type === "tool"` with status tracking (`pending` → `running` → `completed`/`error`)

### Copilot SDK (`@github/copilot-sdk`)

- **Streaming**: Event-based via `sdkSession.on(event => ...)` with queue-based async generator
- **Text deltas**: `assistant.message_delta` events carry `event.data.deltaContent` → `{ type: "text", content: deltaContent }`
- **Thinking**: `assistant.reasoning_delta` events → `{ type: "thinking", content: deltaContent }` with wall-clock timing
- **Tool calls**: `tool.execution_start`/`tool.execution_complete` events with `toolCallId` correlation

### Key Observation

All three SDKs deliver text as incrementally-growing strings via `handleTextDelta()` at `src/ui/parts/handlers.ts:23`. The accumulated `TextPart.content` is the complete markdown string that needs rendering. No SDK-specific markdown extraction or transformation is required.

---

## 5. OpenTUI Rendering Pipeline Deep Dive

### Architecture Overview

```
StyledText / TextChunk[]
    ↓
TextBuffer (native Zig FFI)
    ↓
TextBufferView (viewport/wrap/selection)
    ↓
Yoga flexbox layout (measure function)
    ↓
OptimizedBuffer (per-cell RGBA arrays)
    ↓
CliRenderer (ANSI diff output to terminal)
```

### Core Types

**`TextChunk`** — the fundamental styled text unit:
```typescript
interface TextChunk {
  __isChunk: true;
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes?: number;  // bitmask: BOLD|DIM|ITALIC|UNDERLINE|BLINK|INVERSE|HIDDEN|STRIKETHROUGH
  link?: { url: string };
}
```

**`StyledText`** — branded wrapper around `TextChunk[]` with template literal API:
```typescript
import { t, bold, red, fg } from "@opentui/core";
const styled = t`Hello ${red("World")} with ${bold("bold")} text!`;
```

**`SyntaxStyle`** — native Zig-backed style registry:
```typescript
// Create from style definitions
const style = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex("#94e2d5"), bold: true },
  "markup.raw": { fg: RGBA.fromHex("#6c7086") },
  "keyword": { fg: RGBA.fromHex("#cba6f7"), bold: true },
  "default": { fg: RGBA.fromHex("#cdd6f4") },
});

// Or from theme token arrays
const style = SyntaxStyle.fromTheme([
  { scope: ["keyword"], style: { foreground: "#ff0000", bold: true } },
]);
```

### Rendering Lifecycle

1. **Content update**: `content` setter on `MarkdownRenderable` or `CodeRenderable` triggers `updateBlocks()` or marks `_highlightsDirty`
2. **Lifecycle pass**: `onLifecyclePass()` synchronizes text node tree changes before layout
3. **Layout calculation**: Yoga's `calculateLayout()` invokes custom measure function via `textBufferView.measureForDimensions()`
4. **Layout update**: `updateLayout()` recursively walks tree, reads computed layout, builds flat `RenderCommand[]` array
5. **Rendering**: Iterates render commands, each renderable's `renderSelf()` calls `buffer.drawTextBuffer(textBufferView, x, y)` via native FFI
6. **Output**: `CliRenderer` diffs the buffer and emits ANSI escape sequences

### Tree-Sitter Integration

**`TreeSitterClient`** — singleton Web Worker-based parser:
- `highlightOnce(content, filetype)` — one-shot highlighting, returns `SimpleHighlight[]` tuples `[startOffset, endOffset, groupName, meta?]`
- Automatic singleton via `getTreeSitterClient()`
- Built-in parsers: TypeScript, JavaScript, Zig, Markdown
- Additional parsers loaded via WASM

**`treeSitterToTextChunks()`** — sweep-line algorithm converting highlights to styled chunks:
1. Creates start/end boundary events from all highlights
2. Sorts boundaries by offset (ends before starts at same offset)
3. Iterates maintaining `activeHighlights` set
4. Merges active styles by specificity (dot-count), resolving via `SyntaxStyle`
5. Creates `TextChunk` with merged fg, bg, and attribute bitmask

**Markdown tree-sitter queries** (from `@opentui/core/assets/`):
- `markdown/highlights.scm` — block-level syntax (headings, code fences, lists)
- `markdown/injections.scm` — delegates fenced code blocks to language parsers via `(#set-lang-from-info-string!)`
- `markdown_inline/highlights.scm` — inline syntax (bold, italic, code spans, links) with conceal directives

### Scroll and Viewport

- `ScrollBoxRenderable` provides scrollable containers with viewport culling (skips off-screen children)
- `stickyScroll` + `stickyStart="bottom"` enables auto-scroll to bottom as new content appears
- Mouse scroll with `MacOSScrollAccel` for acceleration

---

## 6. OpenTUI Framework Bindings (React)

Atomic uses `@opentui/react` (React-based bindings). Key details:

### Component Catalogue (`react/src/components/index.ts:25-48`)

| JSX Tag | Renderable Constructor |
|---|---|
| `box` | `BoxRenderable` |
| `text` | `TextRenderable` |
| `code` | `CodeRenderable` |
| `diff` | `DiffRenderable` |
| `markdown` | `MarkdownRenderable` |
| `input` | `InputRenderable` |
| `select` | `SelectRenderable` |
| `textarea` | `TextareaRenderable` |
| `scrollbox` | `ScrollBoxRenderable` |
| `ascii-font` | `ASCIIFontRenderable` |
| `tab-select` | `TabSelectRenderable` |
| `line-number` | `LineNumberRenderable` |

React uses **kebab-case** for multi-word component names (vs Solid's snake_case).

### JSX Type Definitions

```typescript
// MarkdownProps = ComponentProps<MarkdownOptions, MarkdownRenderable>
// CodeProps = ComponentProps<CodeOptions, CodeRenderable>
```

Non-styled properties (excluded from `style` prop) for markdown: `content`, `syntaxStyle`, `treeSitterClient`, `conceal`, `renderNode`.

### React Reconciler

- Uses `react-reconciler` with mutation-based updates (`supportsMutation: true`)
- `createInstance` looks up tag in component catalogue, creates renderable: `new components[type](rootContainerInstance.ctx, { id, ...props })`
- `commitUpdate` calls `updateProperties(instance, type, oldProps, newProps)` then `instance.requestRender()`
- `resetAfterCommit` calls `containerInfo.requestRender()` to trigger a render cycle

### React Hooks Available

| Hook | Description |
|---|---|
| `useRenderer()` | Gets `CliRenderer` from `AppContext` |
| `useKeyboard(handler, options?)` | Subscribes to keypress/keyrelease |
| `useOnResize(callback)` | Subscribes to renderer resize events |
| `useTerminalDimensions()` | Returns `{ width, height }` state |
| `useTimeline(options?)` | Creates animation `Timeline` |

---

## 7. Theme and Syntax Style Integration

### Atomic's Current Theme System (`src/ui/theme.tsx`)

Two built-in themes based on Catppuccin:
- **`darkTheme`** (line 215): Catppuccin Mocha — base `#1e1e2e`, text `#cdd6f4`
- **`lightTheme`** (line 247): Catppuccin Latte — base `#eff1f5`, text `#4c4f69`

### `createMarkdownSyntaxStyle()` (line 468)

Already builds a complete `SyntaxStyle` with these mappings:

```typescript
SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex(heading), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex(heading), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex(heading), bold: true },
  "markup.heading.4": { fg: RGBA.fromHex(heading) },
  "markup.heading.5": { fg: RGBA.fromHex(heading) },
  "markup.heading.6": { fg: RGBA.fromHex(heading), dim: true },
  "markup.raw": { fg: RGBA.fromHex(raw) },
  "markup.list": { fg: RGBA.fromHex(list) },
  "markup.link": { fg: RGBA.fromHex(link), underline: true },
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "keyword": { fg: RGBA.fromHex(keyword), bold: true },
  "string": { fg: RGBA.fromHex(string) },
  "comment": { fg: RGBA.fromHex(comment), italic: true },
  // ... more styles
  "default": { fg: RGBA.fromHex(variable) },
});
```

**Style resolution hierarchy**: `markup.heading.1` → `markup.heading` → `default`

### OpenCode's Extended Theme (Reference)

OpenCode defines ~80+ scope rules in `generateSyntax()` including:
- Markdown-specific: `markdownText`, `markdownHeading`, `markdownCode`, `markdownBlockQuote`, `markdownEmph`, `markdownStrong`, `markdownList`
- Syntax: `syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`
- 30+ built-in themes with dark/light mode variants

---

## 8. Gap Analysis and Integration Points

### What Already Exists in Atomic

| Component | Status | Location |
|---|---|---|
| `@opentui/react` with `<markdown>` support | Installed (^0.1.79) | `package.json` |
| `@opentui/core` with `MarkdownRenderable` | Installed (^0.1.79) | `package.json` |
| `SyntaxStyle` import | Used in `theme.tsx` | `src/ui/theme.tsx:11` |
| `createMarkdownSyntaxStyle()` | Implemented | `src/ui/theme.tsx:468` |
| `markdownSyntaxStyle` instance | Created (unused) | `src/ui/chat.tsx:1715` |
| `CodeBlock` component | Implemented (unused) | `src/ui/code-block.tsx:187` |
| `TextPart.content` accumulation | Working | `src/ui/parts/handlers.ts:23` |
| `TextPart.isStreaming` flag | Working | `src/ui/parts/types.ts:50-56` |
| Streaming data flow from all SDKs | Working | `src/ui/index.ts:1037` |
| `<scrollbox>` with sticky scroll | Working | `src/ui/chat.tsx:5184` |
| `useThrottledValue` for render throttling | Working (100ms) | `src/ui/hooks/use-throttled-value.ts` |

### What Needs to Change

| Change | File | Description |
|---|---|---|
| Replace `<text>` with `<markdown>` or `<code filetype="markdown">` | `src/ui/components/parts/text-part-display.tsx` | Core rendering change |
| Wire `syntaxStyle` prop through `MessageBubble` | `src/ui/chat.tsx:1414` | Un-alias `_syntaxStyle` |
| Pass `syntaxStyle` to part renderers | `src/ui/components/parts/message-bubble-parts.tsx` | Thread prop through |
| Add `streaming` prop based on `part.isStreaming` | `src/ui/components/parts/text-part-display.tsx` | Enable streaming mode |
| Consider `ReasoningPartDisplay` upgrade | `src/ui/components/parts/reasoning-part-display.tsx` | Similar change for thinking text |
| Consider `conceal` toggle | `src/ui/chat.tsx` | User preference for showing/hiding markers |

### Implementation Patterns from OpenCode

**Pattern 1: Direct `<code filetype="markdown">` (simpler, default in OpenCode)**
```tsx
<code
  filetype="markdown"
  drawUnstyledText={false}
  streaming={part.isStreaming}
  syntaxStyle={syntaxStyle}
  content={part.content.trim()}
  conceal={concealEnabled}
  fg={colors.foreground}
/>
```

**Pattern 2: `<markdown>` (richer rendering, experimental in OpenCode)**
```tsx
<markdown
  syntaxStyle={syntaxStyle}
  streaming={part.isStreaming}
  content={part.content.trim()}
  conceal={concealEnabled}
/>
```

**Pattern 3: Dimmed reasoning variant**
```tsx
const subtleSyntaxStyle = useMemo(() => {
  // Apply 0.6 opacity to all foreground colors
  return createDimmedSyntaxStyle(syntaxStyle, 0.6);
}, [syntaxStyle]);
```

---

## 9. Key Files Reference

### Atomic TUI (Current Implementation)

| File | Line | Purpose |
|---|---|---|
| `src/ui/components/parts/text-part-display.tsx` | 18 | **TextPartDisplay** — currently plain `<text>`, needs markdown |
| `src/ui/components/parts/reasoning-part-display.tsx` | 18 | **ReasoningPartDisplay** — thinking content renderer |
| `src/ui/components/parts/registry.tsx` | 22 | **PART_REGISTRY** — maps part types to renderers |
| `src/ui/components/parts/message-bubble-parts.tsx` | 26 | **MessageBubbleParts** — iterates parts, dispatches to registry |
| `src/ui/chat.tsx` | 1414 | **MessageBubble** — receives `syntaxStyle` (aliases as `_syntaxStyle`, unused) |
| `src/ui/chat.tsx` | 1715 | **markdownSyntaxStyle** — created from theme (never applied) |
| `src/ui/theme.tsx` | 468 | **createMarkdownSyntaxStyle()** — builds SyntaxStyle from Catppuccin |
| `src/ui/code-block.tsx` | 187 | **CodeBlock** — `<code>` with SyntaxStyle (not used in pipeline) |
| `src/ui/index.ts` | 1037 | **handleStreamMessage()** — streaming loop calling `session.stream()` |
| `src/ui/parts/handlers.ts` | 23 | **handleTextDelta()** — appends text to TextPart.content |
| `src/ui/parts/types.ts` | 50-56 | **TextPart** — `{ type: "text", content: string, isStreaming: boolean }` |
| `src/ui/hooks/use-throttled-value.ts` | 20 | **useThrottledValue** — 100ms render throttling |

### SDK Clients

| File | Line | Purpose |
|---|---|---|
| `src/sdk/types.ts` | 193-202 | **AgentMessage** — unified `{ type, content, role?, metadata? }` |
| `src/sdk/types.ts` | 222-270 | **Session** — `stream()` returns `AsyncIterable<AgentMessage>` |
| `src/sdk/types.ts` | 571-639 | **CodingAgentClient** — unified interface |
| `src/sdk/claude-client.ts` | 554-757 | **ClaudeAgentClient.stream()** — Claude streaming |
| `src/sdk/opencode-client.ts` | 1050-1303 | **OpenCodeClient.stream()** — OpenCode streaming |
| `src/sdk/copilot-client.ts` | 277-423 | **CopilotClient.stream()** — Copilot streaming |

### OpenTUI Core (Reference)

| File | Purpose |
|---|---|
| `docs/opentui/packages/core/src/renderables/Markdown.ts` | MarkdownRenderable (~855 lines) |
| `docs/opentui/packages/core/src/renderables/markdown-parser.ts` | `parseMarkdownIncremental()` |
| `docs/opentui/packages/core/src/renderables/Code.ts` | CodeRenderable (~303 lines) |
| `docs/opentui/packages/core/src/renderables/Text.ts` | TextRenderable |
| `docs/opentui/packages/core/src/syntax-style.ts` | SyntaxStyle (native Zig FFI) |
| `docs/opentui/packages/core/src/lib/tree-sitter/client.ts` | TreeSitterClient (Web Worker) |
| `docs/opentui/packages/core/src/lib/tree-sitter-styled-text.ts` | `treeSitterToTextChunks()` |
| `docs/opentui/packages/core/src/text-buffer.ts` | TextBuffer (native Zig FFI) |
| `docs/opentui/packages/core/src/lib/styled-text.ts` | StyledText, TextChunk, helpers |

### OpenTUI React Bindings (Reference)

| File | Purpose |
|---|---|
| `docs/opentui/packages/react/src/components/index.ts` | Component catalogue (`"markdown"` → `MarkdownRenderable`) |
| `docs/opentui/packages/react/src/reconciler/host-config.ts` | React reconciler host config |
| `docs/opentui/packages/react/src/types/components.ts` | `MarkdownProps`, `CodeProps` types |
| `docs/opentui/packages/react/jsx-namespace.d.ts` | JSX `IntrinsicElements` definitions |

### OpenCode TUI (Reference Implementation)

| File | Purpose |
|---|---|
| `docs/opencode/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | TextPart/ReasoningPart rendering with `<markdown>`/`<code>` |
| `docs/opencode/packages/opencode/src/cli/cmd/tui/context/theme.tsx` | Theme system with `generateSyntax()` |
| `docs/opencode/packages/opencode/src/cli/cmd/tui/context/sync.tsx` | Event-to-store sync with binary search |
| `docs/opencode/packages/opencode/src/cli/cmd/tui/context/sdk.tsx` | SSE event batching (16ms) |

---

## Related Research

- `research/docs/2026-02-09-opentui-markdown-capabilities.md` — Earlier OpenTUI markdown research
- `research/docs/2026-02-14-opencode-opentui-sdk-research.md` — OpenCode/OpenTUI SDK integration
- `research/docs/2026-02-16-opentui-rendering-architecture.md` — Full rendering pipeline
- `research/docs/2026-02-16-opentui-deepwiki-research.md` — DeepWiki-sourced OpenTUI docs
- `research/docs/2026-02-16-opencode-deepwiki-research.md` — DeepWiki-sourced OpenCode docs
- `research/docs/2026-02-16-opencode-tui-chat-architecture.md` — OpenCode chat data model
- `research/docs/2026-02-16-opencode-message-rendering-patterns.md` — OpenCode rendering patterns
