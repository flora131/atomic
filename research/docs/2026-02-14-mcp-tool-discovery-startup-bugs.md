---
date: 2026-02-14 21:38:21 UTC
researcher: Claude (Opus 4.6)
git_commit: d2fc7c13bf8c330648bac9909d180d8070cb6a59
branch: lavaman131/hotfix/telemetry
repository: atomic
topic: "MCP Tool Discovery at Startup: Three Bugs in /mcp Command Output"
tags: [research, codebase, mcp, mcp-config, mcp-output, builtin-commands, claude-client, opencode-client, mcp-server-list]
status: complete
last_updated: 2026-02-14
last_updated_by: Claude (Opus 4.6)
---

# Research

## Research Question

Document the complete MCP tool/server discovery and initialization flow from startup through to UI display, focusing on three specific bugs:
1. The `/mcp` command label appearing in its own output
2. "No MCP tools available" being displayed despite servers being configured and connected
3. Individual server tools/resources not being populated (showing "none" instead of actual tools like `read_wiki_structure`, `read_wiki_contents`, etc.)

Trace the data flow from MCP config loading → server connection → tool discovery → state storage → UI rendering to identify where each bug originates.

## Summary

Three distinct bugs cause the `/mcp` command to display incorrect output. The root causes are:

1. **`/mcp` label in output**: The `buildMcpSnapshotView()` function hardcodes `commandLabel: "/mcp"`, and `McpServerListIndicator` renders it as a visible text element at the top of the output.

2. **"No MCP tools available"**: The project-level `.mcp.json` defines a `deepwiki` server WITHOUT a `tools` field, which overrides the builtin default (which HAS `tools: ["ask_question"]`). The deduplication logic in `discoverMcpConfigs()` replaces the entire object — there is no field-level merge. Combined with the fact that `getMcpSnapshot()` returns `null` before the first message is sent, the tool list falls back to `server.tools` from config, which is now `undefined`, resulting in an empty tools array.

3. **Correct tools not showing**: The actual MCP tools (like `read_wiki_structure`, `read_wiki_contents`, `ask_question`, `read_wiki_contents`) are only discoverable at runtime through `getMcpSnapshot()`, which requires an active session with a completed query. Before the first message, the Claude client's `getMcpSnapshot()` returns `null` (no `sdkSessionId` or `query` available), and the OpenCode client's `buildOpenCodeMcpSnapshot()` may also return empty data if MCP servers haven't initialized.

## Detailed Findings

### MCP Config Discovery Flow

The MCP config discovery starts in the CLI entry point and flows through to the TUI.

#### 1. CLI Entry (`src/commands/chat.ts:193`)

`chatCommand()` calls `discoverMcpConfigs()` with no arguments (uses `process.cwd()`). The result is assigned to `sessionConfig.mcpServers`.

#### 2. Discovery Function (`src/utils/mcp-config.ts:153-188`)

Sources are loaded in priority order (lowest to highest):

1. **Built-in defaults** (line 160): `BUILTIN_MCP_SERVERS` array containing deepwiki with `tools: ["ask_question"]`
2. **User-level configs** (lines 163-165): `~/.claude/.mcp.json`, `~/.copilot/mcp-config.json`, `~/.github/mcp-config.json`
3. **Project-level configs** (lines 168-173): `.mcp.json`, `.copilot/mcp-config.json`, `.github/mcp-config.json`, `opencode.json`, etc.

Deduplication at lines 176-179 uses a Map keyed by server name — **last entry wins with full object replacement, no field-level merge**.

#### 3. The `.mcp.json` Override (Root Cause of Bugs 2 & 3)

The project-level `.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "deepwiki": {
      "type": "http",
      "url": "https://mcp.deepwiki.com/mcp"
    }
  }
}
```

This defines `deepwiki` WITHOUT a `tools` field. The built-in at `src/utils/mcp-config.ts:127-135` defines:

```typescript
const BUILTIN_MCP_SERVERS: McpServerConfig[] = [
  {
    name: "deepwiki",
    type: "http",
    url: "https://mcp.deepwiki.com/mcp",
    tools: ["ask_question"],
    enabled: true,
  },
];
```

Because the project-level `.mcp.json` is parsed after the builtins, the dedup loop at line 178 (`byName.set(server.name, server)`) replaces the builtin's deepwiki entry entirely. The resulting `McpServerConfig` for deepwiki has `tools: undefined`.

### Session Creation and MCP Snapshot

#### Lazy Session Creation (`src/ui/index.ts:812-854`)

Sessions are only created when the first message is sent via `ensureSession()`. Before any message, `state.session` is `null`. The `/mcp` command's `context.session` will be `null`.

#### Claude Client `getMcpSnapshot` (`src/sdk/claude-client.ts:669-707`)

Before the first message:
- `state.sdkSessionId` is `null` (only set by `processMessage()` on first SDK message)
- `state.query` is `null` (createSession passes `null` to `wrapQuery()` at line 846)
- Result: returns `null` at line 687

Even after session creation but before a message, the Claude client has no query or SDK session ID, so `getMcpSnapshot` returns `null`.

When a session IS active and a query has been made, `getMcpSnapshot` creates a temporary query with `maxTurns: 0` and calls `statusQuery.mcpServerStatus()` (line 690). This returns the SDK's list of connected MCP servers with their tools. The tools are extracted as `status.tools?.map((tool) => tool.name)` at line 696. This is the runtime path that would return the actual tool names (`read_wiki_structure`, `read_wiki_contents`, `ask_question`, etc.), but it requires a prior query to have completed.

#### OpenCode Client `buildOpenCodeMcpSnapshot` (`src/sdk/opencode-client.ts:815-908`)

Uses three concurrent SDK calls via `Promise.allSettled()`:
- `sdkClient.mcp.status()` for auth status
- `sdkClient.tool.ids()` for tool IDs (in `mcp__<server>__<tool>` format)
- `sdkClient.experimental.resource.list()` for resources

When MCP servers haven't fully initialized, these may return empty data or fail, resulting in an empty or null snapshot.

### `/mcp` Command Execution (`src/ui/commands/builtin-commands.ts:425-496`)

The execute function:

1. **Line 431**: Calls `discoverMcpConfigs(undefined, { includeDisabled: true })` to get static configs
2. **Lines 436-443**: Attempts `context.session?.getMcpSnapshot()`. When session is null or snapshot returns null, `runtimeSnapshot` stays `null`.
3. **Line 449**: Calls `buildMcpSnapshotView({ servers, toggles, runtimeSnapshot })`

### Snapshot View Construction (`src/ui/utils/mcp-output.ts:162-208`)

When `runtimeSnapshot` is null:
- `getRuntimeServerSnapshot()` at line 171 returns `undefined` for every server
- Tool list falls back to `normalizeToolNames(server.name, server.tools)` at line 174
- For deepwiki (overridden by `.mcp.json`), `server.tools` is `undefined`
- `normalizeToolNames()` at line 71 returns `[]` for `undefined` input
- Server appears with zero tools

The `noToolsAvailable` flag at line 205:
```typescript
noToolsAvailable: snapshotServers.length > 0 && snapshotServers.every((server) => server.tools.length === 0),
```
This evaluates to `true` because all servers have empty tool arrays.

The `commandLabel` at line 201:
```typescript
commandLabel: "/mcp",
```
This is unconditionally set and rendered by `McpServerListIndicator`.

### UI Rendering

#### `McpServerListIndicator` (`src/ui/components/mcp-server-list.tsx:23-118`)

- **Line 37**: Renders `snapshot.commandLabel` as accented text — this is the `/mcp` label in the output
- **Lines 42-47**: Shows "No MCP servers configured." if `!snapshot.hasConfiguredServers`
- **Lines 49-54**: Shows "No MCP tools available." if `snapshot.hasConfiguredServers && snapshot.noToolsAvailable`
- **Lines 56-115**: Renders each server with tools, resources, and resource templates

#### `chat.tsx` Integration

- **Line 4813-4814**: When user types `/mcp`, `addMessage("user", trimmedValue)` shows the command as a user message
- **Lines 3444-3460**: `result.mcpSnapshot` is attached to the last assistant message
- **Lines 1533-1536**: `McpServerListIndicator` is rendered when `message.mcpSnapshot` is present

### Bug 1: `/mcp` Command Label in Output

**Location**: `src/ui/utils/mcp-output.ts:201` and `src/ui/components/mcp-server-list.tsx:37`

**Mechanism**: `buildMcpSnapshotView` sets `commandLabel: "/mcp"`. `McpServerListIndicator` renders it:
```tsx
<text style={{ fg: colors.accent, attributes: 1 }}>{snapshot.commandLabel}</text>
```

The user already sees `/mcp` as their typed input (added by `chat.tsx:4814`). The `commandLabel` creates a second `/mcp` in the assistant response area.

### Bug 2: "No MCP tools available"

**Root cause chain**:
1. `.mcp.json` at project root defines `deepwiki` without `tools` field
2. `discoverMcpConfigs()` dedup replaces builtin (which has `tools: ["ask_question"]`) with project config (which has `tools: undefined`)
3. Before first message, `getMcpSnapshot()` returns `null` (Claude) or empty data (OpenCode)
4. `buildMcpSnapshotView` falls back to `server.tools` from config, which is `undefined`
5. `normalizeToolNames(server.name, undefined)` returns `[]`
6. `noToolsAvailable` evaluates to `true` (all servers have zero tools)
7. `McpServerListIndicator` renders "No MCP tools available."

### Bug 3: Correct Tools Not Showing

**Root cause chain**:
1. Same config override as Bug 2 — `server.tools` is `undefined` in the fallback path
2. Runtime tool discovery via `getMcpSnapshot()` requires an active session with a completed query
3. The Claude SDK's `mcpServerStatus()` only works when `sdkSessionId` or `query` is available (both `null` before first message)
4. Even after session creation, `createSession()` at `claude-client.ts:830-847` deliberately does NOT create an initial query to avoid leaking subprocess
5. The OpenCode client needs registered MCP servers to be initialized before `tool.ids()` returns populated data

The actual deepwiki tools (`read_wiki_structure`, `read_wiki_contents`, `ask_question`) would only appear:
- After the first message has been sent (which triggers a query)
- And only if `getMcpSnapshot()` successfully queries the SDK for runtime MCP status
- And only if the SDK has finished connecting to the deepwiki MCP server

## Code References

- `src/utils/mcp-config.ts:127-135` - BUILTIN_MCP_SERVERS definition with `tools: ["ask_question"]`
- `src/utils/mcp-config.ts:153-188` - `discoverMcpConfigs()` discovery and dedup logic
- `src/utils/mcp-config.ts:176-179` - Dedup loop (last wins, full object replacement)
- `.mcp.json` - Project-level config overriding builtin deepwiki (no `tools` field)
- `src/ui/utils/mcp-output.ts:162-208` - `buildMcpSnapshotView()` snapshot construction
- `src/ui/utils/mcp-output.ts:201` - `commandLabel: "/mcp"` hardcoded
- `src/ui/utils/mcp-output.ts:205` - `noToolsAvailable` flag computation
- `src/ui/utils/mcp-output.ts:70-74` - `normalizeToolNames()` returns `[]` for `undefined` input
- `src/ui/components/mcp-server-list.tsx:37` - Renders `commandLabel` as visible text
- `src/ui/components/mcp-server-list.tsx:49-54` - Renders "No MCP tools available" message
- `src/ui/commands/builtin-commands.ts:425-496` - `/mcp` command definition and execute function
- `src/ui/commands/builtin-commands.ts:436-443` - Runtime snapshot fetch (null when no session)
- `src/sdk/claude-client.ts:669-707` - Claude `getMcpSnapshot` closure (returns null pre-query)
- `src/sdk/claude-client.ts:830-847` - `createSession` passes `null` query to `wrapQuery`
- `src/sdk/opencode-client.ts:815-908` - OpenCode `buildOpenCodeMcpSnapshot`
- `src/ui/chat.tsx:4813-4814` - User message echo for slash commands
- `src/ui/chat.tsx:3444-3460` - MCP snapshot attached to assistant message
- `src/ui/chat.tsx:1533-1536` - McpServerListIndicator rendered for messages with snapshots

## Architecture Documentation

### MCP Config Discovery Architecture

```
CLI Startup (src/commands/chat.ts)
  │
  ├─ discoverMcpConfigs() (src/utils/mcp-config.ts:153)
  │    ├─ BUILTIN_MCP_SERVERS (deepwiki with tools: ["ask_question"])
  │    ├─ User-level configs (~/.claude/.mcp.json, ~/.copilot/*, ~/.github/*)
  │    ├─ Project-level configs (.mcp.json, .copilot/*, .github/*, opencode.*)
  │    └─ Dedup by name (last wins, full replacement)
  │
  ├─ sessionConfig.mcpServers = discovered servers
  │
  └─ startChatUI(client, config) (src/ui/index.ts:269)
       │
       ├─ Lazy session creation via ensureSession() (line 812)
       │    └─ client.createSession(sessionConfig) (line 848)
       │         ├─ Claude: buildSdkOptions() → options.mcpServers (line 312)
       │         └─ OpenCode: registerMcpServers() → sdkClient.mcp.add() (line 655)
       │
       └─ /mcp command (src/ui/commands/builtin-commands.ts:425)
            ├─ discoverMcpConfigs() for static config
            ├─ session.getMcpSnapshot() for runtime data
            ├─ buildMcpSnapshotView() merges both
            └─ McpServerListIndicator renders result
```

### Tool Display Fallback Chain

```
Tool display priority:
  1. runtimeServer.tools (from getMcpSnapshot → SDK runtime introspection)
  2. server.tools (from McpServerConfig → config file/builtin)
  3. [] (when both are undefined)
```

### Session Lifecycle and MCP Snapshot Availability

```
Timeline:
  ┌─ TUI starts ──────────────────────────────────────────────────┐
  │  session = null                                                │
  │  getMcpSnapshot → null (no session)                            │
  │  /mcp shows: static config tools only                         │
  │                                                                │
  ├─ User sends first message ────────────────────────────────────┤
  │  ensureSession() → client.createSession()                      │
  │  Claude: state.query = null, state.sdkSessionId = null         │
  │  getMcpSnapshot → null (no query yet)                          │
  │                                                                │
  ├─ First query begins streaming ────────────────────────────────┤
  │  Claude: state.query = newQuery, state.sdkSessionId = captured │
  │  getMcpSnapshot → can now call mcpServerStatus()               │
  │  /mcp shows: runtime tools (ask_question, read_wiki_*, etc.)   │
  └────────────────────────────────────────────────────────────────┘
```

## Historical Context (from research/)

- `research/docs/2026-02-08-164-mcp-support-discovery.md` - Original MCP support and discovery research (ticket #164)
- `research/docs/2026-02-06-mcp-tool-calling-opentui.md` - MCP tool calling and OpenTUI integration research

## Open Questions

1. Should `discoverMcpConfigs()` use field-level merging instead of full object replacement when deduplicating servers by name? This would allow project-level configs to override specific fields (e.g., `url`) while preserving others from the builtin (e.g., `tools`).

2. Should `getMcpSnapshot()` be made available before the first message by running a lightweight probe query during `createSession()` or `start()`? The Claude client's `start()` already runs a probe query for model detection — it could potentially also capture MCP server status.

3. Should the `commandLabel` rendering be removed from `McpServerListIndicator`, since the user's typed command is already shown as a user message?

4. Should the `/mcp` command be aware of the deepwiki builtin's tool list as a fallback when the runtime snapshot is unavailable, even if the project config doesn't declare tools?
