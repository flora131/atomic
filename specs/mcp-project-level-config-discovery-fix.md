# MCP Project-Level `.mcp.json` Config Discovery Fix

| Document Metadata      | Details                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| Author(s)              | Developer                                                                   |
| Status                 | Draft                                                                       |
| Team / Owner           | Atomic CLI                                                                  |
| Created / Last Updated | 2026-02-14                                                                  |

## 1. Executive Summary

The `discoverMcpConfigs()` function in `src/utils/mcp-config.ts` is missing project-level `.mcp.json` discovery. While user-level `~/.claude/.mcp.json` is parsed, the equivalent project-level path (`<projectRoot>/.mcp.json`) is not. This causes 5 test failures across 2 test files. The fix is a single line addition to add `parseClaudeMcpConfig(join(projectRoot, ".mcp.json"))` to the project-level discovery section, plus a JSDoc update.

## 2. Context and Motivation

### 2.1 Current State

The MCP config discovery system (`src/utils/mcp-config.ts:149-178`) aggregates MCP server configurations from three formats across user-level and project-level paths, normalizes them into a unified `McpServerConfig[]`, deduplicates by server name (last wins), and filters disabled servers.

**Discovery order (current implementation):**

1. Built-in defaults (deepwiki)
2. User-level: `~/.claude/.mcp.json`, `~/.copilot/mcp-config.json`, `~/.github/mcp-config.json`
3. Project-level: `.copilot/mcp-config.json`, `.github/mcp-config.json`, `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json`

**Gap:** Project-level `.mcp.json` (`<projectRoot>/.mcp.json`) is absent from step 3.

> Ref: [research/docs/2026-02-14-failing-tests-mcp-config-discovery.md](../research/docs/2026-02-14-failing-tests-mcp-config-discovery.md) — Root cause analysis confirming the missing path.

### 2.2 The Problem

- **Test Failures:** 5 tests fail because they write `.mcp.json` to a project directory and expect `discoverMcpConfigs()` to find it.
- **Design Violation:** The original MCP support design spec ([research/docs/2026-02-08-164-mcp-support-discovery.md](../research/docs/2026-02-08-164-mcp-support-discovery.md)) explicitly includes project-level `.mcp.json` as a discovery source:
  > "Location: project root or `~/.claude/.mcp.json`"
  
  > "When the user selects an agent in the chat, the appropriate config files should be read: **Claude agent**: Read `.mcp.json` (project root) + `~/.claude/.mcp.json` (personal)"
- **User Impact:** Users placing a `.mcp.json` file in their project root (standard Claude Code convention) will not have their MCP servers discovered by Atomic CLI.

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [x] `discoverMcpConfigs()` discovers `<projectRoot>/.mcp.json` as a project-level config source.
- [x] All 5 currently failing tests pass.
- [x] JSDoc for `discoverMcpConfigs` accurately reflects the full discovery order.

### 3.2 Non-Goals (Out of Scope)

- [ ] No new config formats or discovery paths beyond the documented `.mcp.json`.
- [ ] No changes to the deduplication or merge strategy (last-wins by name).
- [ ] No changes to parser logic in `parseClaudeMcpConfig`.
- [ ] No UI or command changes.

## 4. Proposed Solution (High-Level Design)

### 4.1 Change Overview

Add project-level `.mcp.json` parsing as the **first** project-level source in `discoverMcpConfigs()`. This maintains the existing priority convention where later sources override earlier ones — `.mcp.json` (Claude format) is lowest priority among project-level configs, matching how user-level `.mcp.json` is lowest priority among user-level configs.

### 4.2 Discovery Order After Fix

```
1. Built-in defaults (deepwiki)
2. User-level:
   a. ~/.claude/.mcp.json          (Claude format)
   b. ~/.copilot/mcp-config.json   (Copilot format)
   c. ~/.github/mcp-config.json    (Copilot format)
3. Project-level (higher priority — override user-level):
   a. <projectRoot>/.mcp.json                  (Claude format)  ← NEW
   b. <projectRoot>/.copilot/mcp-config.json   (Copilot format)
   c. <projectRoot>/.github/mcp-config.json    (Copilot format)
   d. <projectRoot>/opencode.json              (OpenCode format)
   e. <projectRoot>/opencode.jsonc             (OpenCode format)
   f. <projectRoot>/.opencode/opencode.json    (OpenCode format)
```

> Ref: [research/docs/2026-02-08-164-mcp-support-discovery.md](../research/docs/2026-02-08-164-mcp-support-discovery.md) — Summary table listing `.mcp.json` at project root as a discovery source.

### 4.3 Architectural Pattern

No architectural change. This is a single missing call to an existing parser function (`parseClaudeMcpConfig`) that is already used for the user-level equivalent.

## 5. Detailed Design

### 5.1 Code Change: `src/utils/mcp-config.ts`

**Location:** Lines 163-164 (between user-level and existing project-level sections)

**Add one line** at the beginning of the project-level section:

```typescript
// Project-level configs (higher priority — override user-level)
sources.push(...parseClaudeMcpConfig(join(projectRoot, ".mcp.json")));  // ← ADD THIS LINE
sources.push(...parseCopilotMcpConfig(join(projectRoot, ".copilot", "mcp-config.json")));
sources.push(...parseCopilotMcpConfig(join(projectRoot, ".github", "mcp-config.json")));
sources.push(...parseOpenCodeMcpConfig(join(projectRoot, "opencode.json")));
sources.push(...parseOpenCodeMcpConfig(join(projectRoot, "opencode.jsonc")));
sources.push(...parseOpenCodeMcpConfig(join(projectRoot, ".opencode", "opencode.json")));
```

**Reasoning for placement as first project-level source:**
- Mirrors user-level ordering where `.mcp.json` is first (line 159).
- Last-wins dedup means Copilot/OpenCode project configs will override `.mcp.json` for same-name servers, matching expected precedence.

> Ref: [research/docs/2026-02-14-failing-tests-mcp-config-discovery.md](../research/docs/2026-02-14-failing-tests-mcp-config-discovery.md) — Proposed fix location.

### 5.2 JSDoc Update: `src/utils/mcp-config.ts`

**Location:** Line 144

**Before:**
```
 * 3. Project-level configs (.copilot/mcp-config.json, .github/mcp-config.json, opencode.json, opencode.jsonc, .opencode/opencode.json)
```

**After:**
```
 * 3. Project-level configs (.mcp.json, .copilot/mcp-config.json, .github/mcp-config.json, opencode.json, opencode.jsonc, .opencode/opencode.json)
```

### 5.3 No Other Files Changed

The `parseClaudeMcpConfig` function (lines 18-38) already exists and handles all parsing, error handling (returns `[]` on failure), and normalization. No modifications are needed to any parser, type, test, or UI code.

## 6. Alternatives Considered

| Option | Pros | Cons | Reason for Rejection |
| --- | --- | --- | --- |
| A: Add `.mcp.json` as last project-level source | Highest priority among project configs | Breaks symmetry with user-level ordering; unexpected override of `.copilot` and `.github` configs | Priority mismatch with existing convention |
| B: Add `.mcp.json` as first project-level source (Selected) | Consistent with user-level ordering; lowest project-level priority | None identified | **Selected** |
| C: Add separate "Claude project" section | Clear separation | Over-engineers a one-line fix; breaks the clean user/project grouping | Unnecessary complexity |

## 7. Cross-Cutting Concerns

### 7.1 Error Handling

`parseClaudeMcpConfig` already wraps file reading in a try/catch and returns `[]` on any failure (file not found, parse error, etc.). No additional error handling is needed.

### 7.2 Performance

Adding one `readFileSync` call for a file that typically does not exist has negligible performance impact — the `catch` block returns immediately on `ENOENT`.

### 7.3 Security

No new attack surface. The function reads a config file from a known project-root path — the same pattern used for all other config sources.

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

This is a bug fix with no migration or feature flag required. Ship directly.

### 8.2 Test Plan

**Existing Tests (currently failing → should pass after fix):**

| Test File | Test Name | Line |
| --- | --- | --- |
| `tests/utils/mcp-config.test.ts` | `discovers project-level .mcp.json` | 449-463 |
| `tests/utils/mcp-config.test.ts` | `merges from multiple sources` | 591-612 |
| `tests/ui/commands/builtin-commands.test.ts` | `returns mcpServers with discovered servers` | 361-391 |
| `tests/ui/commands/builtin-commands.test.ts` | `enable returns success for known server` | 393-420 |
| `tests/ui/commands/builtin-commands.test.ts` | `disable returns success for known server` | 450-477 |

> Ref: [research/docs/2026-02-14-failing-tests-mcp-config-discovery.md](../research/docs/2026-02-14-failing-tests-mcp-config-discovery.md) — Full test failure inventory.

**Verification command:**
```bash
bun test tests/utils/mcp-config.test.ts tests/ui/commands/builtin-commands.test.ts
```

**No new tests needed** — the 5 failing tests already provide full coverage for this fix.

## 9. Open Questions / Unresolved Issues

None — the root cause, fix, and test coverage are fully identified.

## 10. References

| Document | Path |
| --- | --- |
| Root cause research | `research/docs/2026-02-14-failing-tests-mcp-config-discovery.md` |
| Original MCP discovery design | `research/docs/2026-02-08-164-mcp-support-discovery.md` |
| MCP support spec | `specs/mcp-support-and-discovery.md` |
| Implementation file | `src/utils/mcp-config.ts:149-178` |
