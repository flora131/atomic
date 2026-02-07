# MCP Tool Calling Support for OpenTUI Chat Interface

| Document Metadata      | Details                                    |
| ---------------------- | ------------------------------------------ |
| Author(s)              | Developer                                  |
| Status                 | Draft (WIP)                                |
| Team / Owner           | Atomic TUI                                 |
| Created / Last Updated | 2026-02-06                                 |

## 1. Executive Summary

MCP tool calling doesn't work for any SDK backend. The Claude client hardcodes `type: "stdio"` when converting MCP config, breaking HTTP servers like deepwiki. The `chatCommand` never passes `mcpServers` to `SessionConfig`. The Copilot client ignores `mcpServers` entirely. Built-in agent commands are missing MCP tool references that their `.claude/agents/*.md` counterparts already have.

Fix: (1) pass `.mcp.json` config through `SessionConfig` in `chatCommand`, (2) fix Claude client to handle HTTP transport, (3) wire Copilot client to pass `mcpServers`, (4) sync built-in agent tool lists with `.claude/` definitions (add `mcp__deepwiki__ask_question` to debugger, online-researcher tools; align models), (5) wire `registerAgentCommands()` into init so disk agents override builtins, (6) add MCP-aware tool renderer.

> **Primary Research**: [research/docs/2026-02-06-mcp-tool-calling-opentui.md](../research/docs/2026-02-06-mcp-tool-calling-opentui.md)

## 2. Context and Motivation

### 2.1 Current State

**MCP config exists but is never loaded:**
- `.mcp.json`: `{ "mcpServers": { "deepwiki": { "type": "http", "url": "https://mcp.deepwiki.com/mcp" } } }`
- `.opencode/opencode.json`: `{ "mcp": { "deepwiki": { "type": "remote", "url": "...", "enabled": true } } }`

**Three SDK-level bugs:**

1. **`chatCommand` never passes MCP config** (`src/commands/chat.ts:169-172`): `SessionConfig` only gets `{ model }`.

2. **Claude client hardcodes stdio** (`src/sdk/claude-client.ts:274-279`): Every MCP server gets `{ type: "stdio", command: server.command }`, producing `{ type: "stdio", command: undefined }` for HTTP servers like deepwiki.

3. **Copilot client ignores mcpServers** (`src/sdk/copilot-client.ts:590-601`): `createSession()` never reads `config.mcpServers`.

**Built-in agents are out of sync with `.claude/agents/*.md`:**

| Agent | `.claude/` tools | TS builtin tools | `.claude/` model | TS model |
|-------|-----------------|-----------------|-----------------|----------|
| `codebase-online-researcher` | `mcp__deepwiki__ask_question`, `TodoWrite`, `ListMcpResourcesTool`, `ReadMcpResourceTool` + others | `mcp__deepwiki__ask_question` only (no MCP resource tools) | `opus` | `sonnet` |
| `debugger` | `mcp__deepwiki__ask_question`, `NotebookEdit`, `NotebookRead`, `TodoWrite`, `ListMcpResourcesTool`, `ReadMcpResourceTool` + others | **Missing** `mcp__deepwiki__ask_question` entirely | `opus` | `sonnet` |

**Agent discovery exists but is never called:**
- `agent-commands.ts:1528` defines `registerAgentCommands()` with full disk discovery
- `src/ui/commands/index.ts:131-146` (`initializeCommandsAsync()`) never calls it

### 2.2 The Problem

- No MCP tools work in any Atomic TUI session
- Built-in agents don't match their `.claude/` definitions (stale models, missing tools)
- MCP tools render as generic wrench icons

## 3. Goals and Non-Goals

### 3.1 Goals

- [ ] MCP tools (deepwiki) work for Claude, OpenCode, and Copilot sessions
- [ ] Built-in agent commands have deepwiki MCP pre-configured in their tool lists
- [ ] Built-in agent models/tools match `.claude/agents/*.md` (canonical source)
- [ ] Disk-based agent discovery is wired into init to keep definitions in sync going forward
- [ ] MCP tools render with a distinct icon and parsed server/tool name

### 3.2 Non-Goals

- [ ] No unified MCP management layer -- each SDK handles its own connections
- [ ] No per-server custom renderers -- single generic MCP renderer
- [ ] No new abstraction modules -- changes are inline in existing files
- [ ] No MCP config UI -- file-based only

## 4. Proposed Solution

### 4.1 Overview

Six targeted changes, all in existing files:

| # | What | Where | Lines Changed |
|---|------|-------|--------------|
| 1 | Extend `McpServerConfig` type for HTTP/SSE | `src/sdk/types.ts:26-35` | ~5 |
| 2 | Read `.mcp.json` and pass to `SessionConfig` | `src/commands/chat.ts:169-172` | ~10 |
| 3 | Fix Claude client: handle HTTP transport | `src/sdk/claude-client.ts:270-281` | ~10 |
| 4 | Wire Copilot client: pass `mcpServers` | `src/sdk/copilot-client.ts:590-601` | ~5 |
| 5 | Sync built-in agents with `.claude/` + wire discovery | `agent-commands.ts`, `index.ts` | ~15 |
| 6 | Add MCP tool renderer | `src/ui/tools/registry.ts`, `tool-result.tsx` | ~40 |

No new files. ~85 lines changed total.

## 5. Detailed Design

### 5.1 Extend `McpServerConfig` Type (`src/sdk/types.ts:26-35`)

Make `command` optional, add `type` and `url`:

```typescript
export interface McpServerConfig {
  name: string;
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}
```

### 5.2 Read `.mcp.json` in `chatCommand` (`src/commands/chat.ts`)

Inline read -- no abstraction needed:

```typescript
// Inside chatCommand(), before building chatConfig:
import { readFileSync } from "fs";
import { join } from "path";

let mcpServers: McpServerConfig[] | undefined;
try {
  const raw = readFileSync(join(process.cwd(), ".mcp.json"), "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed.mcpServers) {
    mcpServers = Object.entries(parsed.mcpServers).map(([name, cfg]: [string, any]) => ({
      name,
      type: cfg.type,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
      url: cfg.url,
    }));
  }
} catch {
  // No .mcp.json or invalid -- continue without MCP
}

const chatConfig: ChatUIConfig = {
  sessionConfig: {
    model,
    mcpServers,
  },
  // ...
};
```

### 5.3 Fix Claude Client HTTP Transport (`src/sdk/claude-client.ts:270-281`)

**Current** -- hardcodes `type: "stdio"`:
```typescript
options.mcpServers[server.name] = {
  type: "stdio",
  command: server.command,
  args: server.args,
  env: server.env,
};
```

**Fixed** -- branch on transport type:
```typescript
if (config.mcpServers && config.mcpServers.length > 0) {
  options.mcpServers = {};
  for (const server of config.mcpServers) {
    if (server.url) {
      options.mcpServers[server.name] = {
        type: server.type ?? "http",
        url: server.url,
      };
    } else if (server.command) {
      options.mcpServers[server.name] = {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: server.env,
      };
    }
  }
}
```

This is the critical fix. The current code produces `{ type: "stdio", command: undefined }` for HTTP servers like deepwiki.

### 5.4 Wire Copilot Client (`src/sdk/copilot-client.ts:590-601`)

Add `mcpServers` to the SDK session config:

```typescript
const sdkConfig: SdkSessionConfig = {
  // ... existing fields
  mcpServers: config.mcpServers?.map(s => ({
    name: s.name,
    type: s.type ?? (s.url ? "http" : "stdio"),
    command: s.command,
    args: s.args,
    env: s.env,
    url: s.url,
  })),
};
```

Verify the exact shape against `@github/copilot-sdk` types -- the field mapping may need adjustment.

### 5.5 Sync Built-in Agents + Wire Discovery

**Part A: Update `BUILTIN_AGENTS` to match `.claude/agents/*.md`**

In `agent-commands.ts`, sync the TS builtins with the `.claude/` canonical definitions:

For `codebase-online-researcher` (~line 487-496):
```typescript
tools: [
  "Glob", "Grep", "NotebookRead", "Read", "LS",
  "TodoWrite", "ListMcpResourcesTool", "ReadMcpResourceTool",
  "mcp__deepwiki__ask_question", "WebFetch", "WebSearch",
],
model: "opus",  // was "sonnet"
```

For `debugger` (~line 810-822):
```typescript
tools: [
  "Bash", "Task", "AskUserQuestion", "Edit", "Glob", "Grep",
  "NotebookEdit", "NotebookRead", "Read", "TodoWrite", "Write",
  "ListMcpResourcesTool", "ReadMcpResourceTool",
  "mcp__deepwiki__ask_question", "WebFetch", "WebSearch",
],
model: "opus",  // was "sonnet"
```

This ensures that even without disk-based discovery, the built-in agents have deepwiki MCP tools pre-configured.

**Part B: Wire `registerAgentCommands()` into init**

In `src/ui/commands/index.ts:131-146`, add one line:

```typescript
import { registerAgentCommands } from "./agent-commands.ts";

export async function initializeCommandsAsync(): Promise<number> {
  const beforeCount = globalRegistry.size();
  registerBuiltinCommands();
  await loadWorkflowsFromDisk();
  registerWorkflowCommands();
  registerSkillCommands();
  await registerAgentCommands();  // NEW: loads from .claude/agents/*.md, falls back to builtins
  const afterCount = globalRegistry.size();
  return afterCount - beforeCount;
}
```

The existing `registerAgentCommands()` at `agent-commands.ts:1528` already calls `registerBuiltinAgents()` then `discoverAgents()`. Disk-based agents from `.claude/agents/*.md` will be discovered and registered.

**Part C: Fix the override skip** in `registerAgentCommands()` at `agent-commands.ts:1540-1551`:

The current code skips disk agents when a builtin with the same name exists (there's a TODO about this at line 1549). Fix by replacing the skip logic:

```typescript
for (const agent of discoveredAgents) {
  const command = createAgentCommand(agent);
  // Disk agents always override builtins (project > builtin priority)
  globalRegistry.register(command);  // registry already handles name conflicts
}
```

The simplest fix is to just remove the `shouldAgentOverride` check and always register -- since builtins are registered first and disk agents have higher priority, the last-registered wins. Alternatively, unregister the old one first.

### 5.6 MCP Tool Renderer (`src/ui/tools/registry.ts`)

Add to the existing file -- no new files:

```typescript
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/);
  return match ? { server: match[1], tool: match[2] } : null;
}

export const mcpToolRenderer: ToolRenderer = {
  icon: "🔌",
  getTitle(props: ToolRenderProps): string {
    const firstKey = Object.keys(props.input)[0];
    if (firstKey) {
      const val = props.input[firstKey];
      if (typeof val === "string" && val.length < 60) return val;
    }
    return "MCP tool call";
  },
  render(props: ToolRenderProps): ToolRenderResult {
    const content: string[] = [];
    content.push("Input:");
    content.push(JSON.stringify(props.input, null, 2));
    if (props.output !== undefined) {
      content.push("");
      content.push("Output:");
      if (typeof props.output === "string") content.push(...props.output.split("\n"));
      else content.push(JSON.stringify(props.output, null, 2));
    }
    return { title: "MCP Tool Result", content, expandable: true };
  },
};
```

Update `getToolRenderer()` at line 538:

```typescript
export function getToolRenderer(toolName: string): ToolRenderer {
  if (TOOL_RENDERERS[toolName]) return TOOL_RENDERERS[toolName];
  if (parseMcpToolName(toolName)) return mcpToolRenderer;
  return defaultToolRenderer;
}
```

Update `src/ui/components/tool-result.tsx` to show parsed MCP name in the header:

```typescript
import { parseMcpToolName } from "../tools/registry.ts";

// Where tool label is displayed:
const mcpParsed = parseMcpToolName(toolName);
const displayLabel = mcpParsed ? `${mcpParsed.server} / ${mcpParsed.tool}` : toolName;
```

## 6. Alternatives Considered

| Option | Why Rejected |
|--------|-------------|
| New `src/sdk/mcp-config.ts` module | Unnecessary abstraction; inline `.mcp.json` read is ~8 lines |
| Unified MCP management layer | Overkill; SDKs handle MCP connections internally |
| Only fix SDK clients, don't sync agents | Built-in agents would still be missing MCP tool refs |
| Only sync agents, don't fix SDKs | MCP server connections would still be broken |

## 7. Cross-Cutting Concerns

- **Error handling**: `.mcp.json` read failures are caught silently -- chat continues without MCP. SDK-level MCP errors emit `tool.complete` with `success: false`.
- **Backward compat**: `McpServerConfig.command` becomes optional (was required). Existing callers unaffected since they already pass `command`.
- **OpenCode**: No client changes. MCP handled server-side via `.opencode/opencode.json`. Verify events flow through SSE.

## 8. Test Plan

**Unit Tests:**
- [ ] `tests/ui/tools/registry.test.ts` -- `parseMcpToolName()`: valid/invalid MCP names, `getToolRenderer()` returns MCP renderer for `mcp__*`
- [ ] `tests/sdk/claude-client.test.ts` -- `createSession()` handles HTTP-type MCP servers (produces `{ type: "http", url: "..." }` not `{ type: "stdio", command: undefined }`)
- [ ] `tests/sdk/copilot-client.test.ts` -- `createSession()` passes `mcpServers` when provided

**E2E Tests:**
- [ ] Claude session: invoke `mcp__deepwiki__ask_question`, verify `🔌` icon and `deepwiki / ask_question` label
- [ ] OpenCode session: invoke deepwiki MCP tool, verify events render
- [ ] Copilot session: invoke MCP tool, verify rendering

## 9. Files Changed

| File | Change |
|------|--------|
| `src/sdk/types.ts:26-35` | Make `command` optional, add `type` and `url` |
| `src/commands/chat.ts` | Read `.mcp.json` inline, pass `mcpServers` to `SessionConfig` |
| `src/sdk/claude-client.ts:270-281` | Branch on HTTP vs stdio transport |
| `src/sdk/copilot-client.ts:590-601` | Pass `mcpServers` to SDK config |
| `src/ui/commands/agent-commands.ts:487-496,810-822` | Sync tools/models with `.claude/agents/*.md` (add `mcp__deepwiki__*` to debugger, align models to `opus`) |
| `src/ui/commands/agent-commands.ts:1540-1551` | Fix override logic for disk agents |
| `src/ui/commands/index.ts:131-146` | Add `await registerAgentCommands()` call |
| `src/ui/tools/registry.ts` | Add `parseMcpToolName()`, `mcpToolRenderer`, update `getToolRenderer()` |
| `src/ui/components/tool-result.tsx` | Display parsed MCP server/tool name |

## 10. Open Questions

- [ ] **Copilot SDK MCP shape**: Verify `mcpServers` field shape in `@github/copilot-sdk` `SessionConfig`.
- [ ] **OpenCode tool name format**: Does OpenCode use `mcp__*` convention or something else for MCP tool names in SSE events?
- [ ] **Claude auto-discovery overlap**: If `settingSources: ["project"]` auto-discovery starts working with the HTTP fix, will explicit `mcpServers` cause duplicates? May need to skip explicit passing for Claude.
