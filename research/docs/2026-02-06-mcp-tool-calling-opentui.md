---
date: 2026-02-06 12:00:00 UTC
researcher: Claude Opus 4.6
git_commit: 196037794048ec119e4a32812db944fee949717c
branch: lavaman131/feature/tui
repository: atomic
topic: "MCP tool calling support for OpenTUI chat interface"
tags: [research, codebase, mcp, tool-calling, opentui, claude-agent-sdk, opencode-sdk, copilot-sdk, tui, model-context-protocol]
status: complete
last_updated: 2026-02-06
last_updated_by: Claude Opus 4.6
---

# Research: MCP Tool Calling Support for OpenTUI

## Research Question

How should MCP (Model Context Protocol) tool calling be implemented in the OpenTUI-based chat interface so that MCP tools have the same tool calling interface as built-in tools? This covers: (1) the current tool/function calling architecture and message flow, (2) how MCP tools are currently referenced or partially implemented across all three SDK backends, (3) what the MCP specification requires for tool calling, and (4) what specific changes are needed to make MCP tool calls work uniformly with existing tools.

## Summary

MCP tool calling in the Atomic TUI is **partially working for Claude only** and **completely non-functional for OpenCode and Copilot**. The Claude Agent SDK auto-discovers MCP servers from `.mcp.json` via `settingSources: ["project"]` in `initClaudeOptions()`, meaning Claude sessions automatically have access to MCP tools. However, the OpenCode and Copilot clients completely ignore the `mcpServers` field in `SessionConfig`. On the UI side, MCP tool events already flow through the unified event system (`tool.start`/`tool.complete`) when using Claude, but the tool renderer registry has no MCP-specific renderers -- MCP tools fall through to `defaultToolRenderer` (generic wrench icon). The core architecture gap is that neither the `chatCommand` nor the UI layer passes `mcpServers` config to session creation, and two of three SDK backends don't consume it even if it were passed. The fix requires: (1) loading MCP config from `.mcp.json`/`.opencode/opencode.json` at session creation time, (2) implementing MCP server lifecycle management in OpenCode and Copilot clients, (3) optionally adding MCP-aware tool renderers for better UX.

## Detailed Findings

### 1. Current Tool Calling Architecture

The tool calling pipeline has three layers:

#### Layer 1: SDK Event Emission
Each client maps SDK-native events to the unified `EventType` system defined in `src/sdk/types.ts`:

- **Claude** (`src/sdk/claude-client.ts`): Maps `PreToolUse` -> `tool.start`, `PostToolUse` -> `tool.complete` (lines 109-112). Tool names come from the SDK's hook event data.
- **OpenCode** (`src/sdk/opencode-client.ts`): Maps SSE `message.part.updated` events to `tool.start`/`tool.complete` based on `part.state` (lines 458-476). Tool names from `part.tool` field.
- **Copilot** (`src/sdk/copilot-client.ts`): Maps `tool.execution_start` -> `tool.start`, `tool.execution_complete` -> `tool.complete` (lines 120-135). Uses `toolCallIdToName` map (line 114) to bridge start/complete events.

#### Layer 2: UI Event Subscription
`src/ui/index.ts` subscribes to events via `subscribeToToolEvents()` (lines 281-432). This function registers handlers for `tool.start`, `tool.complete`, `permission.requested`, `human_input_required`, `subagent.start`, and `subagent.complete`. These handlers update React state that drives the chat UI.

#### Layer 3: Tool Rendering
`src/ui/components/tool-result.tsx` renders tool output. It calls `getToolRenderer(toolName)` from `src/ui/tools/registry.ts` (line 538), which does a dictionary lookup:

```
TOOL_RENDERERS[toolName] || defaultToolRenderer
```

The `defaultToolRenderer` (line 464) shows a generic wrench icon with the raw tool name. There are ~30+ specific renderers for built-in tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, etc.) but **zero MCP-specific renderers**.

### 2. MCP Implementation Status Per Client

#### Claude Client -- Partially Working
The Claude Agent SDK has native MCP support. Key implementation points:

- **`src/sdk/init.ts` line 27**: `settingSources: ["project"]` enables auto-discovery of `.mcp.json` at the project root. This is how Claude sessions get MCP servers without explicit config passing.
- **`src/sdk/claude-client.ts` lines 270-281**: `createSession()` converts `SessionConfig.mcpServers` to Claude SDK format when explicitly passed.
- **`src/sdk/claude-client.ts` lines 776-783**: `registerTool()` wraps custom tools as MCP servers via `createSdkMcpServer()` from `@anthropic-ai/claude-code`.

Because of `settingSources: ["project"]`, Claude sessions automatically discover and connect to MCP servers listed in `.mcp.json`. MCP tool events then flow through the normal `PreToolUse`/`PostToolUse` hooks. The tool names follow the `mcp__<server>__<tool>` convention (e.g., `mcp__deepwiki__ask_question`).

**What works**: MCP tools are invoked by the Claude model, events fire correctly through the unified system, and the UI renders them (albeit with the generic `defaultToolRenderer`).

**What doesn't work**: The `chatCommand` in `src/commands/chat.ts` (lines 170-172) only passes `model` to `SessionConfig` -- it doesn't pass `mcpServers`. This works for Claude only because of the auto-discovery mechanism.

#### OpenCode Client -- Not Implemented
- `src/sdk/opencode-client.ts` has **zero MCP implementation**.
- Line 1019 contains the comment: `"OpenCode tools are registered server-side via MCP or config"` -- acknowledging MCP exists but deferring to the server.
- `createSession()` does not consume `config.mcpServers` at all.
- OpenCode has its own MCP config in `.opencode/opencode.json` under the `mcp` section, but the client SDK does not expose an API to register additional MCP servers at session creation time.
- OpenCode handles MCP server-side: the `opencode` binary reads `.opencode/opencode.json` and manages MCP connections internally. The SDK client (`@opencode/sdk`) only receives tool events as SSE messages.

**Implication**: For OpenCode, MCP tools should work if the `.opencode/opencode.json` config is properly set up, since the server manages MCP connections. The atomic client just needs to ensure tool events are properly captured and rendered. The `mcp` section in `.opencode/opencode.json` already has `deepwiki` configured.

#### Copilot Client -- Not Implemented
- `src/sdk/copilot-client.ts` has **zero MCP references**.
- `createSession()` (lines 566-605) ignores `config.mcpServers` entirely.
- The Copilot SDK supports MCP through its own mechanisms (`SessionConfig.mcpServers`, `mcpServerName`/`mcpToolName` in events).
- Tool events from MCP tools would need to flow through `tool.execution_start`/`tool.execution_complete` events with MCP-specific metadata.

**Implication**: Copilot MCP support requires passing `mcpServers` to the Copilot SDK's session creation and ensuring MCP tool events are properly captured.

### 3. MCP Protocol Requirements

From the MCP specification (JSON-RPC 2.0 based):

#### Tool Discovery
- Client sends `tools/list` to server
- Server responds with array of tool definitions (name, description, inputSchema)
- Tools can be dynamically added/removed with `notifications/tools/list_changed`

#### Tool Invocation
- Client sends `tools/call` with `{ name, arguments }`
- Server responds with `{ content: [{ type: "text"|"image"|"resource", ... }] }`
- Each tool result has `isError` boolean for error handling

#### Transport Types
- **stdio**: Local process communication (spawn server as child process)
- **HTTP + SSE**: Remote server communication (HTTP POST for requests, SSE for streaming)
- **In-process**: SDK-native (e.g., `createSdkMcpServer()` in Claude Agent SDK)

#### Tool Naming Convention
Claude SDK uses `mcp__<server-name>__<tool-name>` (double underscore separator). This convention is visible in `src/ui/commands/agent-commands.ts` where `mcp__deepwiki__ask_question` is used at lines 494, 509, 546.

### 4. Current MCP Configuration Files

#### `.mcp.json` (Project Root -- Claude Format)
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

#### `.opencode/opencode.json` (OpenCode Format)
```json
{
  "mcp": {
    "deepwiki": {
      "type": "remote",
      "url": "https://mcp.deepwiki.com/sse",
      "enabled": true
    }
  }
}
```

#### `.claude/settings.json`
Contains `"enableAllProjectMcpServers": true` (line 9), which allows Claude to use all MCP servers from `.mcp.json`.

### 5. What's Broken and Why

| Issue | Root Cause | Affected Clients |
|-------|-----------|-----------------|
| MCP tools not available in session | `chatCommand` doesn't pass `mcpServers` to SessionConfig | All (Claude works around this via auto-discovery) |
| OpenCode MCP tools not loading | Client doesn't consume `mcpServers` config; relies on server-side `.opencode/opencode.json` | OpenCode |
| Copilot MCP tools not loading | Client ignores `mcpServers` in `createSession()` | Copilot |
| MCP tools render with generic icon | No MCP-specific entries in `TOOL_RENDERERS` registry | All |
| No MCP tool name parsing | UI doesn't parse `mcp__server__tool` to extract server/tool names | All |

### 6. Architecture for Fix

#### Approach A: Leverage Existing SDK MCP Mechanisms (Recommended)

Each SDK already has its own MCP handling:
- **Claude**: Auto-discovery via `settingSources: ["project"]` -- already works
- **OpenCode**: Server-side MCP via `.opencode/opencode.json` -- already configured
- **Copilot**: SDK-level MCP via `SessionConfig.mcpServers`

The fix should:
1. **For Claude**: No changes needed for MCP server discovery. It already works.
2. **For OpenCode**: Verify that the OpenCode binary properly loads MCP from `.opencode/opencode.json` and that tool events flow correctly through SSE. The client doesn't need to manage MCP servers -- the server does.
3. **For Copilot**: Pass `mcpServers` from config to the Copilot SDK's session creation. Load MCP config from `.mcp.json` or a copilot-specific config.

#### Approach B: Unified MCP Management Layer

Build a shared MCP client that manages server connections across all backends:
- Parse `.mcp.json` at startup
- Spawn/connect to MCP servers
- Register tools via each client's `registerTool()` method
- Handle tool invocation and result routing

**Trade-off**: More complex, more code, but gives full control over MCP behavior regardless of SDK support level.

#### UI Rendering Fix (Both Approaches)

Add MCP tool name parsing and rendering to the tool registry:

```typescript
// In registry.ts
function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return null;
  return { server: match[1], tool: match[2] };
}

// Register a catch-all MCP renderer
function getMcpToolRenderer(toolName: string): ToolRenderer | null {
  const parsed = parseMcpToolName(toolName);
  if (!parsed) return null;
  return {
    icon: "🔌", // or server-specific icon
    label: `${parsed.server}/${parsed.tool}`,
    render: (input, output) => { /* format MCP result */ }
  };
}

// Update getToolRenderer to check MCP first
export function getToolRenderer(toolName: string): ToolRenderer {
  return TOOL_RENDERERS[toolName] ?? getMcpToolRenderer(toolName) ?? defaultToolRenderer;
}
```

### 7. Event Flow Comparison

When an MCP tool is invoked, the event flow should be identical to built-in tools:

```
Agent Model → tool.start (toolName: "mcp__deepwiki__ask_question", toolInput: {...})
    → MCP Server processes request
    → tool.complete (toolName: "mcp__deepwiki__ask_question", toolResult: {...}, success: true)
    → UI renders via getToolRenderer("mcp__deepwiki__ask_question")
```

For Claude, this flow already works. For OpenCode, the events come through SSE with the tool name in `part.tool`. For Copilot, the events come through `tool.execution_start`/`tool.execution_complete`.

The key insight is that **MCP tools should be indistinguishable from built-in tools in the event stream**. The only difference is the tool name format (`mcp__` prefix) and potentially richer result types (images, resources).

## Code References

| File | Lines | Description |
|------|-------|-------------|
| `src/sdk/types.ts` | 26-35 | `McpServerConfig` interface |
| `src/sdk/types.ts` | 102-121 | `SessionConfig` with `mcpServers` field |
| `src/sdk/types.ts` | 229-240 | `EventType` union (includes `tool.start`/`tool.complete`) |
| `src/sdk/types.ts` | 297-316 | `ToolStartEventData`/`ToolCompleteEventData` |
| `src/sdk/claude-client.ts` | 109-112 | Claude event mapping (PreToolUse/PostToolUse) |
| `src/sdk/claude-client.ts` | 270-281 | MCP server config conversion in `createSession()` |
| `src/sdk/claude-client.ts` | 776-783 | `registerTool()` wraps tools as MCP servers |
| `src/sdk/opencode-client.ts` | 458-476 | Tool event emission from SSE part updates |
| `src/sdk/opencode-client.ts` | 1019 | Comment acknowledging server-side MCP |
| `src/sdk/copilot-client.ts` | 114 | `toolCallIdToName` map for bridging events |
| `src/sdk/copilot-client.ts` | 120-135 | Copilot event mapping |
| `src/sdk/copilot-client.ts` | 566-605 | `createSession()` ignores mcpServers |
| `src/sdk/init.ts` | 27 | `settingSources: ["project"]` for MCP auto-discovery |
| `src/sdk/base-client.ts` | 32-104 | Shared `EventEmitter` class |
| `src/ui/index.ts` | 281-432 | `subscribeToToolEvents()` event subscription |
| `src/ui/components/tool-result.tsx` | 233 | `getToolRenderer(toolName)` call |
| `src/ui/tools/registry.ts` | 464 | `defaultToolRenderer` definition |
| `src/ui/tools/registry.ts` | 538 | `getToolRenderer()` lookup function |
| `src/ui/commands/agent-commands.ts` | 494, 509, 546 | `mcp__deepwiki__ask_question` usage |
| `src/commands/chat.ts` | 170-172 | SessionConfig only passes `model` |
| `.mcp.json` | - | Claude MCP server config (deepwiki) |
| `.opencode/opencode.json` | - | OpenCode MCP config (deepwiki) |
| `.claude/settings.json` | 9 | `enableAllProjectMcpServers: true` |

## Architecture Documentation

### Current State

```
┌─────────────────────────────────────────────────────────┐
│                    Chat UI (OpenTUI)                     │
│  subscribeToToolEvents() → tool.start/tool.complete     │
│  getToolRenderer(toolName) → specific or default        │
├─────────────────────────────────────────────────────────┤
│                 Unified Event System                     │
│  EventType: tool.start | tool.complete | ...            │
├──────────────┬──────────────────┬───────────────────────┤
│  Claude SDK  │  OpenCode SDK    │  Copilot SDK          │
│  ✅ MCP via  │  ❌ No MCP in   │  ❌ No MCP in         │
│  auto-disc.  │  client; server  │  client; SDK          │
│  + explicit  │  handles MCP     │  supports it          │
│  config      │  internally      │  but unused           │
└──────────────┴──────────────────┴───────────────────────┘
```

### Target State

```
┌─────────────────────────────────────────────────────────┐
│                    Chat UI (OpenTUI)                     │
│  subscribeToToolEvents() → tool.start/tool.complete     │
│  getToolRenderer(toolName) → MCP-aware lookup           │
│  parseMcpToolName() for mcp__* prefix                   │
├─────────────────────────────────────────────────────────┤
│                 Unified Event System                     │
│  EventType: tool.start | tool.complete | ...            │
│  (MCP tools identical to built-in tools in events)      │
├──────────────┬──────────────────┬───────────────────────┤
│  Claude SDK  │  OpenCode SDK    │  Copilot SDK          │
│  ✅ MCP via  │  ✅ MCP via      │  ✅ MCP via           │
│  auto-disc.  │  server-side     │  SessionConfig        │
│  (no change) │  .opencode.json  │  .mcpServers          │
│              │  (verify events) │  (pass config)        │
└──────────────┴──────────────────┴───────────────────────┘
```

## Historical Context

- MCP support was first introduced via the Claude Agent SDK integration (2026-01-31, `2026-01-31-claude-agent-sdk-research.md`)
- The `McpServerConfig` type was added to the unified SDK types early in the SDK abstraction design
- The OpenCode SDK research (`2026-01-31-opencode-sdk-research.md`) noted that OpenCode handles MCP server-side
- The Copilot SDK research (`2026-01-31-github-copilot-sdk-research.md`) documented Copilot's MCP support via `SessionConfig.mcpServers`
- The tool renderer registry was built for built-in tools and never extended for MCP tools

## Open Questions

1. **Should MCP tools have server-specific renderers?** For example, `mcp__deepwiki__ask_question` could have a custom renderer with a wiki/book icon and formatted markdown output. Or should all MCP tools use a single generic MCP renderer?

2. **OpenCode MCP event verification**: Does the OpenCode binary properly emit tool events for MCP tool calls through SSE? If MCP tools are handled server-side, do their events appear in the same `message.part.updated` format as built-in tools?

3. **Copilot MCP config source**: Should Copilot read from `.mcp.json` (Claude format) or should there be a Copilot-specific MCP config? The Copilot SDK accepts `McpServerConfig[]` in `SessionConfig.mcpServers`.

4. **MCP tool result types**: MCP supports rich result types (text, image, resource). The current `ToolCompleteEventData.toolResult` is typed as `unknown`. Should the UI add special rendering for MCP image results or embedded resources?

5. **MCP server lifecycle**: Who manages MCP server processes (spawn/kill)? For Claude, the SDK handles it. For OpenCode, the server handles it. For Copilot, the atomic client may need to manage MCP server processes directly.

6. **Dynamic tool discovery**: MCP servers can add/remove tools at runtime via `notifications/tools/list_changed`. Should the UI support dynamically updating available tools mid-session?
