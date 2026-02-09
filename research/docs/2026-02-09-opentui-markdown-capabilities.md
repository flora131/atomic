---
date: 2026-02-09 04:25:26 UTC
researcher: Claude
git_commit: 82248623bac5a478e57352c24ea29e988a181445
branch: lavaman131/feature/tui
repository: atomic
topic: "OpenTUI Markdown Rendering Capabilities"
tags: [research, opentui, markdown, rendering, tree-sitter, syntax-highlighting]
status: complete
last_updated: 2026-02-09
last_updated_by: Claude
last_updated_note: "Added detailed conceal behavior analysis and tree-sitter integration findings"
---

# OpenTUI Markdown Rendering Capabilities

## Research Question

What markdown rendering capabilities does OpenTUI (`anomalyco/opentui`) provide, and how are they used in the Atomic TUI?

## Summary

OpenTUI has a dedicated `MarkdownRenderable` component (`<markdown>` in JSX) that provides full CommonMark rendering. It uses the `marked` library internally for lexing/tokenizing, converts tokens into styled `TextChunk` objects and child renderables, and supports Tree-sitter-powered syntax highlighting for code blocks. The component supports streaming mode for incremental updates (e.g., from LLM output), dynamic theme switching, and a `conceal` mode that hides formatting markers.

## Detailed Findings

### MarkdownRenderable Component

**JSX usage:**
```tsx
<markdown
  content={markdownString}
  syntaxStyle={syntaxStyle}
  conceal={true}
  treeSitterClient={tsClient}
  streaming={true}
/>
```

**Imperative API:**
```typescript
const md = new MarkdownRenderable(renderer, {
  id: "markdown",
  content: "# Hello World\n\nSome **bold** and *italic* text.",
  syntaxStyle: mySyntaxStyle,
  conceal: true,
});
```

### Props Reference

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `content` | `string` | No | `undefined` | The markdown string to render |
| `syntaxStyle` | `SyntaxStyle` | Yes | — | Defines styling rules for markdown elements |
| `streaming` | `boolean` | No | `false` | Enables incremental parsing for streaming content |
| `conceal` | `boolean` | No | `true` | Hides formatting markers (`**`, backticks, `[]()`, etc.) |
| `treeSitterClient` | `TreeSitterClient` | No | `undefined` | Enables Tree-sitter syntax highlighting for code blocks |
| `renderNode` | `(token, context) => Renderable \| undefined \| null` | No | `undefined` | Custom token renderer |

### Supported Markdown Elements

| Element | Support | Styling Mechanism |
|---|---|---|
| Headings (H1-H6) | Yes | `markup.heading.1` through `markup.heading.6` syntax groups |
| Bold (`**text**`) | Yes | Bold text attribute |
| Italic (`*text*`) | Yes | Italic text attribute |
| Strikethrough (`~~text~~`) | Yes | Strikethrough text attribute |
| Inline code (`` `code` ``) | Yes | `markup.raw` syntax group |
| Fenced code blocks (` ```lang `) | Yes | Delegated to `CodeRenderable` with Tree-sitter |
| Links (`[text](url)`) | Yes | OSC 8 terminal hyperlinks |
| Images (`![alt](url)`) | Yes | Renders alt text and URL (terminal limitation) |
| Tables (GFM) | Yes | Full alignment (left/center/right), unicode, inline formatting |
| Blockquotes (`> text`) | Yes | Rendered with leading `>` marker |
| Ordered lists (`1. item`) | Yes | Numbered prefix |
| Unordered lists (`- item`) | Yes | `- ` prefix |
| Horizontal rules (`---`) | Yes | Punctuation style |
| Line breaks | Yes | Via `br` token |
| Task lists (`- [ ] item`) | **Partial** | `marked` tokenizes correctly, but `renderListChunks` has no `checkbox` handler — non-loose items render raw `[x]`/`[ ]` text; loose items silently drop the checkbox. Use unicode ☐/☑ substitution as workaround. |

### SyntaxStyle Configuration

From style definitions:
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

From theme arrays:
```typescript
const syntaxStyle = SyntaxStyle.fromTheme([
  { scope: ["keyword", "keyword.control"], style: { foreground: "#ff0000", bold: true } },
  { scope: ["string"], style: { foreground: "#00ff00" } },
]);
```

StyleDefinition interface:
```typescript
interface StyleDefinition {
  fg?: RGBA;
  bg?: RGBA;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}
```

### Streaming Mode

When `streaming={true}`, `MarkdownRenderable` uses incremental parsing. Key behaviors:
- Content updates trigger re-parsing
- Existing block renderables are reused when possible
- Append-only design suitable for LLM output
- Compatible with dynamic content updates via the `content` property

### CodeRenderable (Code Blocks)

Fenced code blocks within markdown are delegated to `CodeRenderable`, which uses `TreeSitterClient` for async syntax parsing:

1. Content/filetype change triggers re-highlighting
2. If `drawUnstyledText` is true, plain text renders immediately
3. Async `highlightOnce` call to Tree-sitter returns highlights
4. Highlights are converted to styled `StyledText` chunks
5. Styled chunks are applied to the native `TextBuffer`

Supports `streaming` mode for incremental code content and an `onHighlight` callback for custom modifications.

### Text Styling System

OpenTUI's `StyledText` / `TextChunk` system:

```typescript
interface TextChunk {
  __isChunk: true;
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes?: number;  // bitfield of TextAttributes
  link?: string;        // OSC 8 hyperlink URL
}
```

Helper functions: `bold()`, `italic()`, `underline()`, `strikethrough()`, `dim()`, `reverse()`, `blink()`, `link(url)()`, named colors (`red()`, `green()`, `blue()`, etc.), custom colors (`fg(color)()`, `bg(color)()`).

Template literal API:
```typescript
import { t, bold, fg, red } from "@opentui/core";
const styled = t`Hello ${red("World")} with ${bold("bold")} text!`;
```

## Conceal Behavior (Detailed)

The `conceal` prop defaults to `true` via `_contentDefaultOptions.conceal` at `node_modules/@opentui/core/index.js:8143`. The constructor uses `options.conceal ?? this._contentDefaultOptions.conceal`.

When `conceal` is `true`, the following are hidden:

| Element | Visible | Hidden |
|---|---|---|
| Bold | styled text | `**` markers |
| Italic | styled text | `*` markers |
| Strikethrough | styled text | `~~` markers |
| Inline code | styled text | backtick delimiters |
| Headings | styled text | `#` prefix markers |
| Links | `text (url)` | `[` and `]()` syntax |
| Images | alt text | `![]()` syntax |
| Fenced code blocks | code content | fence delimiters and language annotation |

Conceal also propagates to Tree-sitter highlight queries:
- `assets/markdown/highlights.scm`: ATX heading markers concealed with `(#set! conceal "")`, fenced code block delimiters concealed with `conceal ""` and `conceal_lines ""`
- `assets/markdown_inline/highlights.scm`: Code span delimiters, emphasis delimiters, link brackets, image syntax concealed
- HTML entities (`&nbsp;`, `&lt;`, etc.) are replaced with their rendered characters

Note: Bullet point concealment queries are **commented out** in `highlights.scm` (lines 111-127) due to parser spacing issues with list marker nodes.

## Tree-Sitter Integration

`CodeRenderable` has an automatic fallback at `node_modules/@opentui/core/index.js:2863`:

```javascript
this._treeSitterClient = options.treeSitterClient ?? getTreeSitterClient();
```

`getTreeSitterClient()` creates a singleton `TreeSitterClient` using the global data path. This means:
- Standalone `<code>` elements get syntax highlighting automatically
- `<markdown>`-embedded code blocks also get highlighting, because `MarkdownRenderable` passes `undefined` to `CodeRenderable`, which triggers the same `??` fallback
- No explicit `treeSitterClient` prop is needed for basic functionality
- `web-tree-sitter` v0.25.10 is a transitive dependency of `@opentui/core`

## Resources

- [GitHub: anomalyco/opentui](https://github.com/anomalyco/opentui)
- [DeepWiki: anomalyco/opentui](https://deepwiki.com/anomalyco/opentui)
- [Getting Started Guide](https://github.com/anomalyco/opentui/blob/main/packages/core/docs/getting-started.md)
- [npm: @opentui/core](https://www.npmjs.com/package/@opentui/core)
- Latest release: v0.1.77

## Limitations

1. **Task list checkboxes**: `marked` tokenizes GFM task lists correctly (`{ type: "checkbox", checked: boolean }`), but `renderListChunks` (`index.js:8377`) has no `checkbox` case. Non-loose items render literal `[x] `/`[ ] ` via the `renderTokenToChunks` default fallback. Loose items silently drop the checkbox marker because `renderInlineToken` has no checkbox case and the token lacks `.tokens`/`.text` properties. Additionally, the `i === 0` optimization in `renderListChunks` breaks for task items because the checkbox token occupies index 0, preventing inline formatting on the text at index 1. **Workaround**: Pre-process content with unicode substitution (`- [ ] ` → `- ☐ `, `- [x] ` → `- ☑ `) before passing to `<markdown>`
2. **Full Tree-sitter language list**: Not enumerated; tests confirm JS, TS, and markdown
3. **Production readiness**: README states "not ready for production use"
4. **Nested list depth**: Implicit support via recursive token iteration, not explicitly confirmed for deep nesting
5. **Image rendering**: Alt text and URL only (no sixel/kitty protocol image display)
