---
date: 2026-02-09 04:25:26 UTC
researcher: Claude
git_commit: 82248623bac5a478e57352c24ea29e988a181445
branch: lavaman131/feature/tui
repository: atomic
topic: "feat: markdown rendering for content in TUI (issue #171)"
tags: [research, codebase, markdown, rendering, tui, opentui, streaming, sdk, chat-ui]
status: complete
last_updated: 2026-02-09
last_updated_by: Claude
last_updated_note: "Resolved Q5 task list checkboxes: OpenTUI lacks checkbox handler, use unicode ☐/☑ substitution as workaround"
---

# Research: Markdown Rendering for Content in TUI (Issue #171)

## Research Question

Implement markdown rendering in the streamed outputs of the coding agent using OpenTUI, as described in [flora131/atomic#171](https://github.com/flora131/atomic/issues/171).

## Summary

The Atomic TUI has the `<markdown>` JSX element wired into `MessageBubble` at `src/ui/chat.tsx:1189-1193`, but **markdown rendering is currently inactive in production** because the required `syntaxStyle` prop is never provided. The `startChatUI()` function at `src/ui/index.ts:848` omits `syntaxStyle` when creating `ChatApp`, and the `ChatUIConfig` interface has no field for it. As a result, the conditional at line 1139 always takes the plain `<text>` fallback branch.

OpenTUI's `MarkdownRenderable` supports full CommonMark rendering (headers, bold, italic, code blocks with Tree-sitter highlighting, tables, blockquotes, lists, links) plus streaming mode. The `conceal` prop defaults to `true` (hiding formatting markers), and Tree-sitter syntax highlighting works automatically via an internal singleton fallback. The streaming pipeline is fully functional: all three SDKs normalize text deltas into `AgentMessage` objects consumed by `handleStreamMessage()`.

The core blockers for issue #171 are:
1. A `SyntaxStyle` instance must be created and provided to `ChatApp` to activate `<markdown>` rendering
2. Thinking/reasoning content from agents is silently dropped at the UI integration layer and must be surfaced with proper markdown rendering and a collapsible/togglable UI

## Detailed Findings

### 1. Current Markdown Rendering Implementation

#### OpenTUI `<markdown>` Element (Already In Use)

The TUI already renders assistant messages through OpenTUI's `<markdown>` JSX element at [`src/ui/chat.tsx:1189-1193`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/chat.tsx#L1189-L1193):

```tsx
<markdown
  content={trimmedContent}
  syntaxStyle={syntaxStyle}
  streaming={isActivelyStreaming}
/>
```

This is inside `MessageBubble`, which renders each assistant message. The rendering path is:
1. If `syntaxStyle` is available → render via `<markdown>` with streaming support
2. If `syntaxStyle` is NOT available → fall back to plain `<text wrapMode="char">` at line 1198

The fallback path at [`src/ui/chat.tsx:1197-1199`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/chat.tsx#L1197-L1199) renders raw text without any markdown formatting:
```tsx
<text wrapMode="char">{bulletSpan}{trimmedContent}</text>
```

#### Content Segmentation

`buildContentSegments()` at [`src/ui/chat.tsx:975`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/chat.tsx#L975) splits assistant message content into interleaved text and tool call segments. Text segments are rendered via the `<markdown>` element, while tool call segments are rendered via `<ToolResult>`.

#### CodeBlock Component

[`src/ui/code-block.tsx`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/code-block.tsx) provides a standalone `CodeBlock` component for syntax-highlighted code blocks. It includes:
- `parseCodeBlocks()` for extracting fenced code blocks from markdown
- `normalizeLanguage()` for mapping language aliases
- `CodeBlockProps` interface with `streaming`, `syntaxStyle`, and `showLineNumbers` support
- Uses OpenTUI's `SyntaxStyle` from `@opentui/core`

#### Theme and SyntaxStyle

[`src/ui/theme.tsx`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/theme.tsx) defines the theme system with `darkTheme` and `lightTheme`, exposing colors via `useTheme` and `useThemeColors` hooks. The `syntaxStyle` prop required by `<markdown>` is a `SyntaxStyle` instance from `@opentui/core`.

### 2. Streaming Pipeline (SDK → UI)

#### Unified SDK Types

[`src/sdk/types.ts`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/sdk/types.ts) defines the normalized interfaces:

| Type | Description |
|---|---|
| `AgentMessage` | `{ type: MessageContentType, content: string \| unknown, role?, metadata? }` |
| `MessageContentType` | `"text" \| "tool_use" \| "tool_result" \| "thinking"` |
| `Session.stream()` | Returns `AsyncIterable<AgentMessage>` |
| `CodingAgentClient` | Unified client interface implemented by all three SDKs |

#### Per-SDK Text Delta Sources

| SDK | File | Delta Event | Delta Content Path |
|---|---|---|---|
| Claude Agent | `src/sdk/claude-client.ts:442-448` | `stream_event` + `content_block_delta` + `text_delta` | `event.delta.text` |
| OpenCode | `src/sdk/opencode-client.ts:818-832` | `message.part.updated` (SSE) where `part.type === "text"` | `properties.delta` |
| Copilot | `src/sdk/copilot-client.ts:293-297` | `assistant.message_delta` callback | `event.data.deltaContent` |

All three SDKs yield `{ type: "text", content: <delta_string>, role: "assistant" }` via their `stream()` method. Each has a deduplication flag (`hasYieldedDeltas` or `yieldedTextFromResponse`) to prevent emitting both incremental deltas AND the complete message.

#### Stream Consumer

[`src/ui/index.ts:577-660`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/index.ts#L577-L660) — `handleStreamMessage()` is the single consumer function for all SDKs:

1. Calls `session.stream(content)` to get `AsyncIterable<AgentMessage>`
2. Wraps in `abortableAsyncIterable()` (line 133) for Ctrl+C interruption
3. Iterates with `for await`, calling `onChunk(message.content)` for `type === "text"` messages
4. Routes `tool_use` and `tool_result` messages to separate handlers

#### React State Integration

[`src/ui/chat.tsx:3401`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/chat.tsx#L3401) — `sendMessage` callback:

1. Creates placeholder assistant message (`content: ""`, `streaming: true`)
2. Sets up `handleChunk` callback: `msg.content + chunk` via React `setMessages` state update
3. On complete: finalizes message, processes next queued message

### 3. OpenTUI Markdown Rendering Capabilities

OpenTUI's `MarkdownRenderable` (available as `<markdown>` in JSX) provides:

#### Supported Markdown Elements

| Element | Support | Styling Mechanism |
|---|---|---|
| Headings (H1-H6) | Yes | `markup.heading.1` through `markup.heading.6` syntax groups |
| Bold (`**text**`) | Yes | Bold attribute |
| Italic (`*text*`) | Yes | Italic attribute |
| Strikethrough (`~~text~~`) | Yes | Strikethrough attribute |
| Inline code (`` `code` ``) | Yes | `markup.raw` syntax group |
| Fenced code blocks | Yes | Delegated to `CodeRenderable` with Tree-sitter syntax highlighting |
| Links (`[text](url)`) | Yes | OSC 8 terminal hyperlinks |
| Images (`![alt](url)`) | Yes | Renders alt text and URL |
| Tables | Yes | Full alignment support (left/center/right), unicode, inline formatting |
| Blockquotes | Yes | Rendered with leading `>` marker |
| Ordered lists | Yes | Numbered prefix |
| Unordered lists | Yes | `- ` prefix |
| Horizontal rules | Yes | Rendered with punctuation style |
| Task lists (GFM) | No | Dependencies exist but no explicit rendering logic |

#### Key Props

| Prop | Type | Description |
|---|---|---|
| `content` | `string` | The markdown string to render |
| `syntaxStyle` | `SyntaxStyle` | Required; defines styling rules for markdown elements |
| `streaming` | `boolean` | Enables incremental parsing for streaming content |
| `conceal` | `boolean` | When true, hides formatting markers like `**`, backticks, `[]()` |
| `treeSitterClient` | `TreeSitterClient` | Optional; enables Tree-sitter syntax highlighting for code blocks |
| `renderNode` | `(token, context) => Renderable` | Custom token renderer |

#### SyntaxStyle Configuration

SyntaxStyle maps markdown elements to visual styles:

```typescript
const syntaxStyle = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromValues(1, 0.5, 0, 1), bold: true },
  "markup.heading.2": { fg: RGBA.fromValues(0.8, 0.4, 0, 1), bold: true },
  "markup.raw":       { fg: RGBA.fromValues(0.6, 0.6, 0.6, 1) },
  "markup.list":      { fg: RGBA.fromValues(0.5, 0.5, 1, 1) },
  keyword:            { fg: RGBA.fromValues(1, 0, 0, 1), bold: true },
  string:             { fg: RGBA.fromValues(0, 1, 0, 1) },
  default:            { fg: RGBA.fromValues(1, 1, 1, 1) },
});
```

Or from a theme definition:
```typescript
const syntaxStyle = SyntaxStyle.fromTheme([
  { scope: ["keyword"], style: { foreground: "#ff0000", bold: true } },
  { scope: ["string"], style: { foreground: "#00ff00" } },
]);
```

#### Streaming Mode

When `streaming={true}`, `MarkdownRenderable` uses incremental parsing. Content can be updated at runtime by setting the `content` property; the component re-parses incrementally and reuses existing block renderables when possible.

#### Text Styling Primitives

OpenTUI exposes styled text via `TextChunk` objects and helper functions:

| Function | Effect |
|---|---|
| `bold(input)` | Bold text |
| `italic(input)` | Italic text |
| `underline(input)` | Underlined text |
| `strikethrough(input)` | Strikethrough text |
| `dim(input)` | Dim/faint text |
| `link(url)(input)` | OSC 8 hyperlink |
| `red()`, `green()`, etc. | Named foreground colors |
| `fg(color)`, `bg(color)` | Custom foreground/background colors |
| `t` template literal | Compose styled text: `` t`Hello ${red("World")}` `` |

### 4. External Markdown Rendering Libraries (Ecosystem Survey)

For reference, these are external options (though OpenTUI's built-in `<markdown>` is the primary path):

| Library | Weekly DL | Streaming | Syntax HL | Bun | Last Updated |
|---|---|---|---|---|---|
| `marked-terminal` | ~2.8M | No | Yes (cli-highlight) | Likely | ~1 year ago |
| `markdansi` | ~2.1K | **Yes** (purpose-built for LLM) | Pluggable hook | **Yes** (explicit) | ~8 days ago |
| `ink-markdown` | ~26 | No | Yes (via marked-terminal) | Unknown | ~2 years ago |
| `cli-markdown` | — | No | Yes | Unknown | ~7 months ago |
| `markdown-to-ansi` | — | No | No | Likely | ~4 years ago |
| `charsm` (Glamour WASM) | — | No | Yes (Glamour engine) | Likely (WASM) | ~2024 |
| `Bun.markdown` (built-in) | N/A | Callback-driven | No (manual) | **Native** | Bun v1.3.8+ |
| `remend` | — | **Yes** (stream fixer) | N/A (preprocessor) | Likely | Recent |

**Key finding**: OpenTUI already bundles `marked` internally for its `<markdown>` element and handles streaming natively. External libraries are not needed for this feature.

### 5. SDK-Specific Content Delivery Details

#### Claude Agent SDK (`src/sdk/claude-client.ts`)

- Imports from `@anthropic-ai/claude-agent-sdk`
- `query()` returns `AsyncGenerator<SDKMessage>`
- Text deltas: `sdkMessage.type === "stream_event"` → `event.type === "content_block_delta"` → `event.delta.type === "text_delta"` → `event.delta.text`
- Complete messages: `sdkMessage.type === "assistant"` → `message.content[0].text`
- Requires `includePartialMessages: true` for stream events
- `extractMessageContent()` at line 120-150 handles type discrimination

#### OpenCode SDK (`src/sdk/opencode-client.ts`)

- Imports from `@opencode-ai/sdk/v2/client`
- Dual-source: direct `session.prompt()` response + SSE `message.part.updated` events
- Text deltas via SSE: `properties.delta` where `part.type === "text"`
- Direct response: `result.data.parts` array where `part.type === "text"` → `part.text`
- `yieldedTextFromResponse` flag deduplicates
- Uses a queue-and-resolve pattern for SSE deltas

#### Copilot SDK (`src/sdk/copilot-client.ts`)

- Imports from `@github/copilot-sdk`
- Event-driven: `sdkSession.on(eventHandler)` callback
- Text deltas: `assistant.message_delta` → `event.data.deltaContent`
- Reasoning: `assistant.reasoning_delta` → `event.data.deltaContent`
- Complete: `assistant.message` → `event.data.content`
- Uses push-into-queue pattern: `chunks.push()` + `notifyConsumer()`
- `hasYieldedDeltas` never reset across tool turns (intentional, per code comment at line 323-327)

### 6. Tool Event Rendering (Parallel Channel)

Tool events flow through a separate channel from the text stream, via `client.on("tool.start", ...)` and `client.on("tool.complete", ...)` at [`src/ui/index.ts:324-570`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/index.ts#L324-L570). The `toolEventsViaHooks` flag prevents duplicate tool rendering when both the stream and event channels report tool activity.

Tool results are rendered by [`src/ui/components/tool-result.tsx`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/components/tool-result.tsx) with status indicators and collapsible output. The tool registry at [`src/ui/tools/registry.ts`](https://github.com/flora131/atomic/blob/82248623bac5a478e57352c24ea29e988a181445/src/ui/tools/registry.ts) provides custom renderers per tool type (Read, Edit, Bash, Write, Glob, Grep).

## Code References

- `src/ui/chat.tsx:1189-1193` — OpenTUI `<markdown>` JSX element rendering assistant content
- `src/ui/chat.tsx:1197-1199` — Plain text fallback when no `syntaxStyle` available
- `src/ui/chat.tsx:975` — `buildContentSegments()` splitting text and tool call segments
- `src/ui/chat.tsx:1042` — `MessageBubble` component
- `src/ui/chat.tsx:3401` — `sendMessage` callback wiring chunks to React state
- `src/ui/chat.tsx:322` — `ChatMessage` interface
- `src/ui/index.ts:577-660` — `handleStreamMessage()` unified stream consumer
- `src/ui/index.ts:133-162` — `abortableAsyncIterable()` abort wrapper
- `src/ui/index.ts:324-570` — `subscribeToToolEvents()` parallel event channel
- `src/ui/code-block.tsx` — `CodeBlock` component with `parseCodeBlocks()` and `normalizeLanguage()`
- `src/ui/theme.tsx` — Theme system (`darkTheme`, `lightTheme`, `useTheme`, `useThemeColors`)
- `src/ui/components/tool-result.tsx` — Tool result rendering
- `src/ui/tools/registry.ts` — Tool result registry with per-tool renderers
- `src/ui/hooks/use-streaming-state.ts` — `useStreamingState` hook
- `src/ui/hooks/use-message-queue.ts` — `useMessageQueue` hook
- `src/sdk/types.ts:140-179` — `AgentMessage`, `MessageContentType` types
- `src/sdk/types.ts:199-235` — `Session` interface with `stream()` method
- `src/sdk/claude-client.ts:120-150` — `extractMessageContent()` for Claude messages
- `src/sdk/claude-client.ts:404-474` — Claude `stream()` implementation
- `src/sdk/opencode-client.ts:394-506` — OpenCode `handleSdkEvent()` SSE mapping
- `src/sdk/opencode-client.ts:796-991` — OpenCode `stream()` dual-source implementation
- `src/sdk/copilot-client.ts:124-140` — Copilot event type mapping
- `src/sdk/copilot-client.ts:265-371` — Copilot `stream()` event queue implementation
- `src/sdk/base-client.ts:32-104` — Shared `EventEmitter` class

## Architecture Documentation

### Data Flow: SDK → Markdown Rendering

```
SDK (Claude/OpenCode/Copilot)
  │ native stream events (SDK-specific format)
  ▼
SDK Client (claude-client.ts / opencode-client.ts / copilot-client.ts)
  │ normalizes to AgentMessage { type: "text", content: string }
  │ yields via AsyncIterable<AgentMessage>
  ▼
handleStreamMessage() (ui/index.ts:577)
  │ iterates stream, calls onChunk(message.content) for text
  ▼
sendMessage → handleChunk (ui/chat.tsx:3401)
  │ appends chunk to ChatMessage.content via React setState
  ▼
MessageBubble (ui/chat.tsx:1042)
  │ calls buildContentSegments() to interleave text + tool calls
  ▼
<markdown> element (ui/chat.tsx:1189)    OR    <text> fallback (ui/chat.tsx:1197)
  │ (when syntaxStyle available)               (when syntaxStyle not available)
  ▼
OpenTUI MarkdownRenderable
  │ uses marked lexer → TextChunk/CodeRenderable
  │ Tree-sitter syntax highlighting for code blocks
  ▼
Terminal output (ANSI-styled text)
```

### Conditional Rendering Logic

The decision between `<markdown>` and plain `<text>` is made in `MessageBubble` based on whether `syntaxStyle` is truthy:

```tsx
return syntaxStyle ? (
  <markdown content={trimmedContent} syntaxStyle={syntaxStyle} streaming={isActivelyStreaming} />
) : (
  <text wrapMode="char">{bulletSpan}{trimmedContent}</text>
);
```

### OpenTUI Component Hierarchy for Text Display

| Component | JSX Element | Purpose |
|---|---|---|
| `MarkdownRenderable` | `<markdown>` | Full markdown rendering with streaming |
| `CodeRenderable` | `<code>` | Syntax-highlighted code via Tree-sitter |
| `TextRenderable` | `<text>` | Plain styled text display |
| `SpanRenderable` | `<span>` | Inline text modifier (custom fg/bg) |
| `BoldSpanRenderable` | `<strong>`, `<b>` | Bold text modifier |
| `ItalicSpanRenderable` | `<em>`, `<i>` | Italic text modifier |
| `UnderlineSpanRenderable` | `<u>` | Underline text modifier |
| `LinkRenderable` | `<a>` | Clickable hyperlink (OSC 8) |
| `ASCIIFontRenderable` | `<ascii-font>` | ASCII art font rendering |

## Historical Context (from research/)

- `research/docs/2026-01-31-opentui-library-research.md` — Original OpenTUI capability research including markdown rendering details
- `research/docs/2026-02-01-chat-tui-parity-implementation.md` — Chat TUI parity implementation across Claude, OpenCode, Copilot agents
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` — Claude Code CLI UI patterns (message queuing, autocomplete, timing, collapsible outputs)
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` — Sub-agent UI with OpenTUI and independent context windows
- `research/docs/2026-01-31-claude-agent-sdk-research.md` — Claude Agent SDK v2 TypeScript research
- `research/docs/2026-01-31-opencode-sdk-research.md` — OpenCode SDK research
- `research/docs/2026-01-31-github-copilot-sdk-research.md` — GitHub Copilot SDK research
- `research/claude-ui-analysis.md` — Claude Code UI analysis (chat experience elements)

## Related Research

- `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` — SDK migration patterns affecting the streaming pipeline
- `research/docs/2026-02-06-mcp-tool-calling-opentui.md` — MCP tool calling in the TUI chat interface
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` — Skill loading with custom status UI components

## Resolved Questions

### Q1: When is `syntaxStyle` falsy, causing the plain-text fallback?

**Answer: `syntaxStyle` is ALWAYS `undefined` in production. Markdown rendering is currently inactive.**

The `syntaxStyle` prop flows through this chain:

1. `startChatUI()` at `src/ui/index.ts:843-876` creates `ChatApp` via `React.createElement` — **the `syntaxStyle` prop is not included** in the props object
2. `ChatUIConfig` interface at `src/ui/index.ts:32-55` **has no `syntaxStyle` field** — there is no way to pass it through the public API
3. `ChatApp` destructures `syntaxStyle` at `src/ui/chat.tsx:1271` with **no default value** — it is `undefined`
4. `MessageBubble` receives `undefined` at `src/ui/chat.tsx:3624` — forwarded as-is
5. The conditional `syntaxStyle ?` at `src/ui/chat.tsx:1139` evaluates to `false` — **always takes the plain `<text>` fallback**

The only `SyntaxStyle` instance in the codebase is `inputSyntaxStyle` at `src/ui/chat.tsx:858-863`, created via `SyntaxStyle.create()` and used exclusively for the input textarea's slash-command highlighting. It is never assigned to the message rendering `syntaxStyle` prop.

The theme system at `src/ui/theme.tsx` does **not** create or provide a `SyntaxStyle` instance — it only contains color palette data (`ThemeColors` with hex strings).

**Implication**: To enable markdown rendering, a `SyntaxStyle` instance must be created (via `SyntaxStyle.create()`, `SyntaxStyle.fromStyles()`, or `SyntaxStyle.fromTheme()`) and passed to `ChatApp`. This requires either:
- Adding a `syntaxStyle` field to `ChatUIConfig` and threading it through `startChatUI()`
- Creating a `SyntaxStyle` instance inside `ChatApp` (e.g., at mount time or as module-level constant)

### Q2: Should `conceal={true}` be set to hide formatting markers?

**Answer: `conceal` already defaults to `true` — no explicit prop needed.**

The OpenTUI `MarkdownRenderable` constructor at `node_modules/@opentui/core/index.js:8152` uses:

```javascript
this._conceal = options.conceal ?? this._contentDefaultOptions.conceal;
```

And `_contentDefaultOptions.conceal` is `true` (line 8143). When the prop is omitted (as it is in `src/ui/chat.tsx:1145-1149`), the nullish coalescing operator resolves to `true`.

**What conceal hides when active:**
| Element | Concealed Form | Unconcealed Form |
|---|---|---|
| Bold | styled text (no `**`) | `**text**` with styling |
| Italic | styled text (no `*`) | `*text*` with styling |
| Strikethrough | styled text (no `~~`) | `~~text~~` with styling |
| Inline code | styled text (no backticks) | `` `code` `` with styling |
| Headings | styled text (no `#`) | `# text` with styling |
| Links | `text (url)` | `[text](url)` |
| Images | alt text only | `![alt](url)` |
| Fenced code blocks | code only (no fence delimiters) | ` ```lang\ncode\n``` ` |

The `conceal` state propagates to child `CodeRenderable` instances and also drives Tree-sitter highlight query concealment rules defined in `node_modules/@opentui/core/assets/markdown/highlights.scm` and `markdown_inline/highlights.scm`.

**Implication**: No action needed for conceal. The default `true` provides the expected clean rendering experience.

### Q3: Is a `treeSitterClient` being passed for code block syntax highlighting?

**Answer: No explicit `treeSitterClient` is passed, but OpenTUI's internal fallback handles it automatically.**

- Zero references to `treeSitterClient`, `TreeSitterClient`, or `tree-sitter`/`treesitter` exist anywhere in `src/`
- The `<markdown>` element at `src/ui/chat.tsx:1145-1149` does not receive a `treeSitterClient` prop
- The `<code>` elements in `src/ui/code-block.tsx:243-256` also do not receive it
- `web-tree-sitter` v0.25.10 exists in `bun.lock` as a transitive dependency of `@opentui/core`

**The fallback mechanism:**

`MarkdownRenderable` stores `options.treeSitterClient` directly at `node_modules/@opentui/core/index.js:8154`:
```javascript
this._treeSitterClient = options.treeSitterClient;  // undefined when not passed
```

When it creates child `CodeRenderable` instances for fenced code blocks at line 8439-8449, it passes `treeSitterClient: this._treeSitterClient` (which is `undefined`).

However, `CodeRenderable`'s constructor at line 2863 has a fallback:
```javascript
this._treeSitterClient = options.treeSitterClient ?? getTreeSitterClient();
```

Since `undefined ?? getTreeSitterClient()` triggers the right-hand side, a singleton `TreeSitterClient` is created automatically via `getTreeSitterClient()` (at `index-h3dbfsf6.js:8305-8317`), which uses the global data path from OpenTUI's `DataPathsManager`.

**Implication**: Syntax highlighting for fenced code blocks inside `<markdown>` will work automatically through the fallback. No explicit `treeSitterClient` prop is required. The same fallback also applies to standalone `<code>` elements in `CodeBlock`.

### Q4: Should "thinking" content also be markdown-rendered?

**Answer: Yes — thinking content must be properly rendered. It is currently silently dropped at the UI integration layer.**

**This is in scope for issue #171.** Thinking/reasoning content is a first-class output from all three agent SDKs and must be rendered with markdown formatting, not discarded.

**Current state (broken):**

1. All three SDKs produce `AgentMessage` with `type: "thinking"`:
   - Claude: `extractMessageContent()` at `src/sdk/claude-client.ts:145-146` — from `firstBlock.type === "thinking"`
   - Copilot: event handler at `src/sdk/copilot-client.ts:301-308` — from `assistant.reasoning_delta` events
   - OpenCode: response parser at `src/sdk/opencode-client.ts:885-890` — from `part.type === "reasoning"`

2. `handleStreamMessage()` at `src/ui/index.ts:611-640` iterates the stream with three conditional branches:
   - Line 613: `message.type === "text"` → calls `onChunk(message.content)` ✓
   - Line 618: `message.type === "tool_use"` → notifies tool start handler ✓
   - Line 631: `message.type === "tool_result"` → notifies tool complete handler ✓
   - **No branch for `message.type === "thinking"`** → silently dropped ✗

3. The `onChunk` callback signature is `(chunk: string) => void` — no type discriminator is available. Even if thinking chunks were forwarded via `onChunk`, the React layer could not distinguish them from regular text.

4. The `ChatMessage` interface at `src/ui/chat.tsx:322-351` has no field for thinking content, content type, or reasoning visibility.

5. No toggle, setting, or configuration exists to control thinking/reasoning visibility.

6. `Model.capabilities.reasoning` boolean at `src/models/model-transform.ts:22` is metadata only — not connected to any UI rendering logic.

**Required changes to bring thinking content into scope:**

1. **Integration layer** (`src/ui/index.ts`): Add a branch in `handleStreamMessage()` for `message.type === "thinking"`. Either:
   - Add a separate `onThinkingChunk` callback alongside `onChunk`
   - Or extend the callback signature to include chunk type metadata (e.g., `onChunk(chunk: string, type: "text" | "thinking")`)

2. **Chat message model** (`src/ui/chat.tsx`): Add a `thinking?: string` field (or `thinkingContent?: string`) to the `ChatMessage` interface to accumulate thinking chunks separately from `content`.

3. **Message rendering** (`src/ui/chat.tsx` `MessageBubble`): Add rendering logic for thinking content with:
   - A collapsible/togglable section (collapsed by default) — matching the pattern used by Claude Code and Copilot CLI where reasoning is shown in a dimmed, expandable block
   - Markdown rendering via `<markdown>` (same as regular content) with a distinct visual style (e.g., dimmed foreground, italic, or a "Thinking..." header)
   - Streaming support — thinking content streams before the main response text

4. **Visibility toggle**: Wire `Model.capabilities.reasoning` to a UI control (e.g., Ctrl+T keybinding, matching Copilot CLI's toggle) that shows/hides thinking blocks across all messages. Persist the preference across the session.

5. **Handler registration**: Add a `registerThinkingChunkHandler` pattern in `src/ui/index.ts` (parallel to `registerToolStartHandler`) or extend the existing `onStreamMessage` signature.

### Q5 (Resolved): Task list checkboxes (GFM)

**Answer: `marked` tokenizes GFM task lists correctly, but OpenTUI's `renderListChunks` has no `checkbox` case — checkbox tokens render as raw text (`[x] ` / `[ ] `) with no styling. Unicode checkboxes should be used as a workaround.**

**Detailed analysis:**

OpenTUI's `marked` lexer runs with `gfm: true` (at `node_modules/@opentui/core/index.js:8095`) and correctly produces `{ type: "checkbox", raw: "[x] ", checked: true }` tokens for task list items. However, the rendering pipeline has no handler for this token type:

| Method | Location | Checkbox handling |
|---|---|---|
| `renderListChunks` | `index.js:8377-8406` | No check for `item.task`, `item.checked`, or `child.type === "checkbox"` |
| `renderTokenToChunks` | `index.js:8410-8430` | No `case "checkbox"` — falls to `default`, outputs `token.raw` as plain text |
| `renderInlineToken` | `index.js:8231-8325` | No `case "checkbox"` — for loose lists, checkbox is silently dropped (no `.tokens` or `.text` property) |

**What happens at runtime:**

- **Non-loose task lists** (`- [x] item`): The checkbox token hits `renderTokenToChunks`'s default branch, which outputs `token.raw` (`"[x] "` or `"[ ] "`) as unstyled plain text. The result is `- [x] item text` rendered literally — functional but with no visual distinction.

- **Loose task lists** (items separated by blank lines): The checkbox token reaches `renderInlineToken`, which has no checkbox case. Since checkbox tokens lack `.tokens` and `.text` properties, **nothing is output** — the checkbox marker is silently dropped entirely.

- **Additional rendering bug**: The `i === 0` optimization in `renderListChunks` (lines 8389, 8393) assumes the first child token is `"text"` or `"paragraph"`. For task lists, `marked` unshifts the checkbox token to index 0, pushing the text content to index 1. The text at index 1 never gets `renderInlineContent` treatment, so **inline formatting inside task list items (bold, links, etc.) is not processed**.

**Tree-sitter highlight queries do define** `@markup.list.unchecked` and `@markup.list.checked` captures (at `assets/markdown/highlights.scm:130-132`), but these are for Tree-sitter code highlighting, not the `marked`-based `MarkdownRenderable` chunk pipeline.

**Workaround for Atomic TUI**: Since OpenTUI cannot be relied upon to render task list checkboxes with proper styling, the implementation should use **unicode checkbox substitution** as a post-processing step on the content string before passing it to `<markdown>`:

| Markdown source | Unicode replacement |
|---|---|
| `- [ ] ` | `- ☐ ` (U+2610 BALLOT BOX) |
| `- [x] ` or `- [X] ` | `- ☑ ` (U+2611 BALLOT BOX WITH CHECK) |

This substitution converts task list syntax into regular unordered list items with unicode characters, which `MarkdownRenderable` renders correctly through its standard list handling. The substitution should be applied with a simple regex on the content string before it reaches the `<markdown>` element's `content` prop.

## Remaining Open Questions

1. **Content trimming**: `trimmedContent = segment.content.trimStart()` at line 1182 trims leading whitespace before markdown rendering. This could affect indentation-sensitive markdown like code blocks or nested lists if they appear at the start of a segment.
