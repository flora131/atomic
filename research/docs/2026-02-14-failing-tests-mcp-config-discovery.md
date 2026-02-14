---
date: 2026-02-14 06:28:22 UTC
researcher: Copilot
git_commit: 9e875832c52690a7cc3db895b5f1b3b35487d1d0
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "Failing tests: MCP config discovery missing project-level .mcp.json"
tags: [research, codebase, mcp-config, test-failures, bug-fix]
status: complete
last_updated: 2026-02-14
last_updated_by: Copilot
---

# Research: Failing Tests — MCP Config Discovery

## Research Question
Identify and document the root cause of all currently failing tests in the codebase.

## Summary

5 tests are failing across 2 test files. All failures share a single root cause: `discoverMcpConfigs()` in `src/utils/mcp-config.ts` does **not** parse project-level `.mcp.json` files. It reads `.mcp.json` only from the user-level path (`~/.claude/.mcp.json`) but omits the project root (e.g., `<projectRoot>/.mcp.json`). The tests expect project-level `.mcp.json` to be discovered.

## Detailed Findings

### Failing Tests

**File: `tests/utils/mcp-config.test.ts`** — 2 failures

| Test Name | Line | Issue |
|---|---|---|
| `discovers project-level .mcp.json` | 449-463 | Writes `.mcp.json` to testDir root, expects `discoverMcpConfigs(testDir)` to find `claude_server`. Returns `undefined`. |
| `merges from multiple sources` | 591-612 | Writes `.mcp.json`, `.copilot/mcp-config.json`, and `opencode.json` to testDir. Expects all 3 servers found. `claude_only` from `.mcp.json` is not discovered. |

**File: `tests/ui/commands/builtin-commands.test.ts`** — 3 failures

| Test Name | Line | Issue |
|---|---|---|
| `returns mcpServers with discovered servers` | 361-391 | Writes `.mcp.json` to tmpDir with `remote_api` server. Changes cwd and calls mcpCommand. `remote_api` not found. |
| `enable returns success for known server` | 393-420 | Writes `.mcp.json` to tmpDir with `myserver`. Enable command fails because server is not discovered. |
| `disable returns success for known server` | 450-477 | Same as enable — `myserver` from `.mcp.json` is not discovered. |

### Root Cause

In `src/utils/mcp-config.ts:149-178`, the `discoverMcpConfigs` function's discovery order is:

1. Built-in defaults (deepwiki)
2. User-level: `~/.claude/.mcp.json`, `~/.copilot/mcp-config.json`, `~/.github/mcp-config.json`
3. Project-level: `.copilot/mcp-config.json`, `.github/mcp-config.json`, `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json`

**Missing:** Project-level `.mcp.json` (`<projectRoot>/.mcp.json`) is not included in step 3. The JSDoc comment at line 144 also omits it from the documented project-level sources.

### Fix Required

Add one line to `src/utils/mcp-config.ts` in the project-level section (after line 163, before line 164):
```typescript
sources.push(...parseClaudeMcpConfig(join(projectRoot, ".mcp.json")));
```

This should be placed as the first project-level source to maintain the existing priority convention (later sources override earlier ones, and `.mcp.json` is Claude-format which should be lowest priority among project configs).

The JSDoc at line 144 should also be updated to list `.mcp.json` among project-level configs.

## Code References

- `src/utils/mcp-config.ts:149-178` — `discoverMcpConfigs()` function with missing `.mcp.json` project-level path
- `src/utils/mcp-config.ts:18-38` — `parseClaudeMcpConfig()` parser (already exists, just not called for project-level)
- `src/utils/mcp-config.ts:159` — User-level `.mcp.json` call (exists at `~/.claude/.mcp.json`)
- `tests/utils/mcp-config.test.ts:449-463` — Failing test: discovers project-level .mcp.json
- `tests/utils/mcp-config.test.ts:591-612` — Failing test: merges from multiple sources
- `tests/ui/commands/builtin-commands.test.ts:361-391` — Failing test: returns mcpServers with discovered servers
- `tests/ui/commands/builtin-commands.test.ts:393-420` — Failing test: enable returns success for known server
- `tests/ui/commands/builtin-commands.test.ts:450-477` — Failing test: disable returns success for known server

## Architecture Documentation

The MCP discovery system uses format-specific parsers (`parseClaudeMcpConfig`, `parseCopilotMcpConfig`, `parseOpenCodeMcpConfig`) that normalize different config formats into a unified `McpServerConfig[]`. The `discoverMcpConfigs` function aggregates results from all parsers across user-level and project-level paths, deduplicating by name (last wins) and filtering disabled servers.

## Historical Context (from research/)

- `research/docs/2026-02-08-164-mcp-support-discovery.md` — Original MCP support and discovery design/spec

## Open Questions

None — the root cause and fix are clear.
