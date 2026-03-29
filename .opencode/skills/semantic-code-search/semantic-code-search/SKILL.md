---
name: semantic-code-search
description: "Semantic code search accelerates codebase discovery and should be complemented by text-based search (grep/glob) for exact matches. Use this skill when code search is needed, when indexing the codebase, or when the user asks about ccc, cocoindex-code, or the codebase index. If ccc is not initialized, fall back to text search tools immediately unless the user explicitly requests semantic indexing. Trigger phrases include 'search the codebase', 'find code related to', 'update the index', 'ccc', 'cocoindex-code'."
---

# ccc - Semantic Code Search & Indexing

`ccc` is the CLI for CocoIndex Code, providing semantic search over the current codebase and index management.

## Ownership

The agent owns the `ccc` lifecycle for the current project — initialization, indexing, and searching.

- **Graceful fallback**: If `ccc search` fails with an initialization error (e.g., "Not in an initialized project directory"), IMMEDIATELY fall back to grep/glob/LSP tools. Do NOT run `ccc init && ccc index` automatically — this causes excessive waiting while the index builds. The user should not be blocked by indexing they did not request.
- **Explicit initialization**: If the user explicitly asks to use semantic search, `ccc`, or `cocoindex-code`, THEN initialize and index the project (`ccc init` from the project root, then `ccc index`) before searching. Only perform initialization when explicitly requested.
- **Index freshness**: When `ccc` is already initialized, keep the index up to date by running `ccc index` (or `ccc search --refresh`) when the index may be stale — e.g., at the start of a session, or after making significant code changes (new files, refactors, renamed modules). There is no need to re-index between consecutive searches if no code was changed in between.
- **Complement with text search**: ALWAYS complement semantic search results with targeted grep/glob for exact string matches (error messages, config values, import paths). Semantic search finds conceptually related code; text search finds exact occurrences.
- **Installation**: If `ccc` itself is not found (command not found), refer to [management.md](references/management.md) for installation instructions and inform the user.

## Searching the Codebase

To perform a semantic search:

```bash
ccc search <query terms>
```

The query should describe the concept, functionality, or behavior to find, not exact code syntax. For example:

```bash
ccc search database connection pooling
ccc search user authentication flow
ccc search error handling retry logic
```

### Filtering Results

- **By language** (`--lang`, repeatable): restrict results to specific languages.

  ```bash
  ccc search --lang python --lang markdown database schema
  ```

- **By path** (`--path`): restrict results to a glob pattern relative to project root. If omitted, defaults to the current working directory (only results under that subdirectory are returned).

  ```bash
  ccc search --path 'src/api/*' request validation
  ```

### Pagination

Results default to the first page. To retrieve additional results:

```bash
ccc search --offset 5 --limit 5 database schema
```

If all returned results look relevant, use `--offset` to fetch the next page — there are likely more useful matches beyond the first page.

### Working with Search Results

Search results include file paths and line ranges. To explore a result in more detail:

- Use the editor's built-in file reading capabilities (e.g., the `Read` tool) to load the matched file and read lines around the returned range for full context.
- When working in a terminal without a file-reading tool, use `sed -n '<start>,<end>p' <file>` to extract a specific line range.

## Settings

To view or edit embedding model configuration, include/exclude patterns, or language overrides, see [settings.md](references/settings.md).

## Management & Troubleshooting

For installation, initialization, daemon management, troubleshooting, and cleanup commands, see [management.md](references/management.md).
