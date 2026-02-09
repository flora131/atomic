---
date: 2026-02-09 04:25:26 UTC
researcher: Claude
git_commit: 82248623bac5a478e57352c24ea29e988a181445
branch: lavaman131/feature/tui
repository: atomic
topic: "Terminal Markdown Rendering Libraries Survey"
tags: [research, markdown, terminal, ansi, streaming, bun, node]
status: complete
last_updated: 2026-02-09
last_updated_by: Claude
---

# Terminal Markdown Rendering Libraries Survey

## Research Question

What markdown rendering libraries are available for terminal/TUI applications in the Node.js/Bun ecosystem, particularly those supporting streaming and syntax highlighting?

## Summary

The ecosystem ranges from mature high-download packages (`marked-terminal` at ~2.8M weekly downloads) to modern streaming-first options built for LLM output (`markdansi`). OpenTUI already bundles `marked` internally for its `<markdown>` element, so external libraries are supplementary reference material. The most relevant finding for issue #171 is that OpenTUI's built-in rendering is the correct path, not an external library.

## Library Catalog

### Tier 1: Mature, High-Adoption

#### marked-terminal
- **npm**: [marked-terminal](https://www.npmjs.com/package/marked-terminal)
- **GitHub**: [mikaelbr/marked-terminal](https://github.com/mikaelbr/marked-terminal)
- **Version**: 7.3.0 | **License**: MIT | **Weekly DL**: ~2.8M
- **Streaming**: No
- **Syntax Highlighting**: Yes (cli-highlight)
- **Elements**: Headers, bold, italic, strikethrough, inline code, code blocks, blockquotes, horizontal rules, ordered/unordered lists, tables (cli-table3), links (supports-hyperlinks), emoji (node-emoji)
- **Bun**: Likely compatible (standard Node.js APIs, pure JS marked parser)
- **Dependencies**: marked (peer, >=1 <16), chalk ^5.4.1, cli-highlight, cli-table3, ansi-escapes, node-emoji, supports-hyperlinks
- **Last Updated**: ~1 year ago

### Tier 2: Streaming-Capable

#### markdansi
- **npm**: [markdansi](https://www.npmjs.com/package/markdansi)
- **GitHub**: [steipete/Markdansi](https://github.com/steipete/Markdansi)
- **Version**: 0.2.1 | **License**: MIT | **Weekly DL**: ~2.1K | **Size**: 70.2 kB
- **Streaming**: **Yes** — purpose-built for streaming LLM output via `createMarkdownStreamer` API
- **Syntax Highlighting**: Pluggable `highlighter(code, lang)` hook (no built-in)
- **Elements**: Headers, bold, italic, strikethrough, inline code, fenced code blocks (box, gutter, wrapping), GFM tables, task lists, ordered/unordered lists, OSC-8 hyperlinks, blockquotes, thematic breaks
- **Bun**: **Explicitly supported** (`bun add markdansi`). Requires Node >= 22.
- **Dependencies**: Zero native deps. ESM only. TypeScript.
- **Last Updated**: ~8 days ago (February 2026)
- **Notes**: Append-only design (no in-place redraw). Themes (default, dim, bright). CLI tool included. Width-aware wrapping.

### Tier 3: Framework-Specific

#### ink-markdown
- **npm**: [ink-markdown](https://www.npmjs.com/package/ink-markdown)
- **GitHub**: [cameronhunter/ink-markdown](https://github.com/cameronhunter/ink-markdown)
- **Version**: 1.0.4 | **License**: MIT | **Weekly DL**: ~26 | **Size**: 3.01 kB
- **Streaming**: No (re-render on prop change)
- **Syntax Highlighting**: Yes (via marked-terminal / cli-highlight)
- **Bun**: Unknown (depends on React + Ink compatibility)
- **Dependencies**: react, ink, marked-terminal
- **Last Updated**: ~2 years ago

### Tier 4: Alternative Parsers

#### markdown-it-terminal
- **npm**: [markdown-it-terminal](https://www.npmjs.com/package/markdown-it-terminal)
- **Version**: 0.4.0 | **Last Updated**: ~3 years ago
- **Streaming**: No
- **Syntax Highlighting**: Yes (cardinal)
- **Notes**: Plugin for markdown-it parser. Customization via ansi-styles. Does not work on Windows cmd.exe.

#### cli-markdown
- **npm**: [cli-markdown](https://www.npmjs.com/package/cli-markdown)
- **GitHub**: [grigorii-horos/cli-markdown](https://github.com/grigorii-horos/cli-markdown)
- **Version**: 3.5.1 | **License**: GPL-3.0-or-later | **Last Updated**: ~7 months ago
- **Notes**: Dual-mode: CLI and API. GPL license (restrictive).

#### markdown-to-ansi
- **npm**: [markdown-to-ansi](https://www.npmjs.com/package/markdown-to-ansi)
- **GitHub**: [vweevers/markdown-to-ansi](https://github.com/vweevers/markdown-to-ansi)
- **Version**: 1.0.0 | **License**: MIT | **Last Updated**: ~4 years ago
- **Notes**: Minimal, built on micromark. For short snippets only.

### Tier 5: Bun-Native

#### Bun.markdown (Built-in)
- **Available Since**: Bun v1.3.8 (January 29, 2026)
- **Streaming**: Callback-driven rendering enables incremental output
- **Syntax Highlighting**: No (manual via callbacks)
- **Elements**: Full CommonMark + GFM (tables, strikethrough, task lists, permissive autolinks). Optional: heading IDs, wiki links, LaTeX math.
- **Dependencies**: None (built into Bun runtime, Zig port of md4c)
- **Rendering Modes**: HTML output, callback-driven (for custom ANSI), React elements
- **Complementary APIs**: `Bun.wrapAnsi()` (ANSI-aware text wrapping), `Bun.stringWidth` (Unicode/ANSI display width)
- **Notes**: SIMD-accelerated in v1.3.9. Could produce zero-dep terminal renderer when combined with chalk.

### Tier 6: WASM/Go Bridges

#### charsm (Charm/Glamour WASM)
- **npm**: [charsm](https://www.npmjs.com/package/charsm)
- **GitHub**: [sklyt/charsm](https://github.com/sklyt/charsm)
- **Version**: 0.2.0
- **Notes**: WASM wrapper for Go's Lipgloss + Glamour. Theme support (tokyo-night). Horizontal alignment buggy. WASM init overhead.

### Streaming Markdown Parsers (Not Renderers)

These parse streaming markdown but require a separate renderer for terminal output:

| Library | Description | Link |
|---|---|---|
| `remend` | Auto-completes unterminated markdown blocks during streaming. Zero deps. Preprocessor. | [npm](https://www.npmjs.com/package/remend) |
| `@nlux/markdown` | Lightweight streaming parser for LLM apps. `MarkdownStreamParser` with `next()`/`complete()`. Browser-focused. | [npm](https://www.npmjs.com/package/@nlux/markdown) |
| `@lixpi/markdown-stream-parser` | Incremental state-machine parser. Subscription-based output. | [npm](https://www.npmjs.com/package/@lixpi/markdown-stream-parser) |
| `stream-markdown-parser` | AST-based streaming parser (markstream-vue ecosystem). | [npm](https://www.npmjs.com/package/stream-markdown-parser) |
| `streamdown` | Vercel's drop-in react-markdown replacement for AI streaming. Browser-focused. | [GitHub](https://github.com/vercel/streamdown) |

### Non-Node.js Reference Implementations

| Tool | Language | Description |
|---|---|---|
| Glow | Go | Terminal markdown reader from Charm. Gold standard for quality. |
| Glamour | Go | Stylesheet-based renderer used by GitHub CLI, GitLab CLI. |
| mdcat | Rust | CommonMark + syntect highlighting + inline images on supported terminals. |
| Textual streaming-markdown | Python | Only parses last block + stores start line → sub-1ms parsing at any document size. |

## Key Takeaway

For issue #171, **OpenTUI's built-in `<markdown>` element is the correct approach**. It already uses `marked` internally, supports streaming, Tree-sitter syntax highlighting, and is tightly integrated with the React JSX rendering model the codebase uses. External libraries would add complexity without meaningful benefit.

## Resources

- [marked-terminal GitHub](https://github.com/mikaelbr/marked-terminal)
- [markdansi GitHub](https://github.com/steipete/Markdansi)
- [Bun v1.3.8 Blog](https://bun.sh/blog/bun-v1.3.8)
- [Bun v1.3.9 Blog](https://bun.com/blog/bun-v1.3.9)
- [Charm ecosystem](https://charm.land/)
- [Will McGugan's Streaming Markdown](https://willmcgugan.github.io/streaming-markdown/)
