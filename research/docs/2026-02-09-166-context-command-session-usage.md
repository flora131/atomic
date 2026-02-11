---
date: 2026-02-09 04:20:30 UTC
researcher: Claude Opus 4.6
git_commit: 62175909c5c5df110a6de2cc22d64956b7242599
branch: lavaman131/feature/tui
repository: atomic
topic: "feat: add /context command to display session context usage (Issue #166)"
tags: [research, codebase, context-usage, token-counting, builtin-commands, sdk, mcp, skills, agents]
status: complete
last_updated: 2026-02-09
last_updated_by: Claude Opus 4.6
---

# Research: /context Command for Session Context Usage Display

## Research Question

[Issue #166](https://github.com/flora131/atomic/issues/166): Add a `/context` command that displays a comprehensive overview of the current session's context usage, including model info, token usage breakdown by category, MCP tools, custom agents, memory files, and skills with a visual usage indicator.

## Summary

The atomic codebase already has the core infrastructure to support a `/context` command: a command registration system, SDK clients with `getContextUsage()` and `getModelDisplayInfo()` methods, MCP server discovery, skill/agent registration with source tracking, and OpenTUI rendering primitives for visual displays. The main gaps are: (1) the `ContextUsage` interface is minimal (only input/output/max/percentage) with no category-level breakdown, (2) context window sizes are hardcoded to 200,000 across all three SDK clients, and (3) no token counting exists for individual components (system prompt, tools, skills, memory files). Each SDK has richer token data available that is currently not surfaced.

## Detailed Findings

### 1. Command Registration Pattern

A new `/context` command should follow the existing builtin command pattern.

**Registration site**: `src/ui/commands/builtin-commands.ts`
- All builtin commands are `CommandDefinition` objects with `name`, `description`, `category: "builtin"`, and an `execute(args, context)` function returning `CommandResult`
- Existing commands: `/help`, `/theme`, `/clear`, `/compact`, `/exit`, `/model`, `/mcp` (lines 30-484)
- Registration function: `registerBuiltinCommands()` at line 516 iterates `builtinCommands` array and registers each with `globalRegistry`
- Commands are registered during `initializeCommandsAsync()` at `src/ui/commands/index.ts:149`

**`CommandContext`** (`src/ui/commands/registry.ts:51-82`) provides:
- `session` -- active SDK session (has `getContextUsage()`)
- `agentType` -- which SDK backend is active (`"claude"` | `"opencode"` | `"copilot"`)
- `addMessage(role, content)` -- injects messages into chat
- `state` -- current UI/workflow state

**`CommandResult`** (`src/ui/commands/registry.ts:135-162`) supports:
- `success` / `message` -- basic outcome (message rendered as assistant bubble)
- `mcpServers` -- used by `/mcp` to pass data to `McpServerListIndicator` component
- This pattern (returning data in `CommandResult` for a dedicated component) is the model for `/context`

### 2. SDK Context/Token APIs

#### 2.1 Unified Interface

**`ContextUsage`** (`src/sdk/types.ts:184-193`):
```typescript
interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  maxTokens: number;        // Currently hardcoded to 200,000 in all clients
  usagePercentage: number;  // (input + output) / max * 100
}
```

**`Session.getContextUsage()`** (`src/sdk/types.ts:229`) -- available on all sessions.

**`ModelDisplayInfo`** (`src/sdk/types.ts:62-67`):
```typescript
interface ModelDisplayInfo {
  model: string;  // e.g., "Opus 4.5", "Copilot"
  tier: string;   // e.g., "Claude Code", "GitHub Copilot", "OpenCode"
}
```

**`CodingAgentClient.getModelDisplayInfo()`** (`src/sdk/types.ts:544`) -- available on all clients.

#### 2.2 Claude Client Token Data

- **Actual token tracking**: Accumulated from `sdkMessage.message.usage.input_tokens` / `output_tokens` per assistant message (`src/sdk/claude-client.ts:537-543`)
- **Context window**: Hardcoded `200000` (`src/sdk/claude-client.ts:489`). The SDK's `SDKResultMessage.modelUsage[model].contextWindow` provides the real value but is not currently captured
- **Model detection**: Via probe query at `start()`, reading `system.init` message model field (`src/sdk/claude-client.ts:810-833`)
- **Cache tokens available but unused**: `cache_creation_input_tokens` and `cache_read_input_tokens` exist on `Usage` type from `@anthropic-ai/sdk`
- **Pre-send token counting**: `@anthropic-ai/sdk` offers `client.messages.countTokens()` -- a free API for counting tokens of system prompts, tools, and messages

#### 2.3 Copilot Client Token Data

- **Actual token tracking**: From `assistant.usage` events with `inputTokens` / `outputTokens` (`src/sdk/copilot-client.ts:413-415`)
- **Context window**: Hardcoded `200000` (`src/sdk/copilot-client.ts:385`). The SDK's `session.usage_info` event provides real `tokenLimit` and `currentTokens` but is not subscribed to. Also, `listModels()` returns `capabilities.limits.max_context_window_tokens` per model
- **Cache tokens available but unused**: `cacheReadTokens`, `cacheWriteTokens` on `assistant.usage` events
- **Model info**: Via `listModels()` API, already called in `getModelDisplayInfo()` at line 839 but only extracts `name`/`id`, not limits

#### 2.4 OpenCode Client Token Data

- **Token tracking**: Mix of character-based estimates (`Math.ceil(length / 4)`) and real values from `result.data.info?.tokens` when available (`src/sdk/opencode-client.ts:739, 807, 939-943`)
- **Context window**: Hardcoded `200000` (`src/sdk/opencode-client.ts:1013`). The SDK's `model.limit.context` from the models endpoint provides the real value
- **Additional fields available**: `reasoning` tokens and `cache.read`/`cache.write` from `info.tokens`
- **Real summarization**: Only client with actual `session.summarize()` call (`src/sdk/opencode-client.ts:998`)

### 3. MCP Server Discovery

**`discoverMcpConfigs()`** (`src/utils/mcp-config.ts:130-157`):
- Returns `McpServerConfig[]` with all discovered MCP servers
- Scans user-level configs (`~/.claude/.mcp.json`, `~/.copilot/mcp-config.json`, `~/.github/mcp-config.json`) and project-level configs (`.mcp.json`, `.copilot/mcp-config.json`, `.github/mcp-config.json`, `opencode.json`, etc.)
- Each config has: `name`, `type` (stdio/http/sse), `command`, `args`, `url`, `enabled`
- Already used by `/mcp` command at `src/ui/commands/builtin-commands.ts:446`

**MCP tool naming convention**: `mcp__<server>__<tool>` (`src/ui/tools/registry.ts:515`)

### 4. Skills Inventory

**Builtin skills** (`src/ui/commands/skill-commands.ts:70-1443`):
- 8 skills: `commit`, `research-codebase`, `create-spec`, `implement-feature`, `create-gh-pr`, `explain-code`, `prompt-engineer`, `testing-anti-patterns`
- Each has embedded `prompt` content (the token cost of each skill is the token count of its prompt string)

**Disk-based skills** discovered from:
- Project: `.claude/skills/`, `.opencode/skills/`, `.github/skills/`, `.atomic/skills/`
- Global: `~/.claude/skills/`, `~/.opencode/skills/`, `~/.copilot/skills/`, `~/.atomic/skills/`
- Discovery: `discoverAndRegisterDiskSkills()` at line 1851
- Each has `source` field: `"project"` | `"atomic"` | `"user"` | `"builtin"`
- Content loaded from `SKILL.md` files via `loadSkillContent()` at line 1807

**Access pattern**: `globalRegistry.getAll()` (line 337) returns all registered commands; filter by `category === "skill"` to get skills. Alternatively, `BUILTIN_SKILLS` array plus disk-discovered skills.

### 5. Custom Agents Inventory

**Builtin agents** (`src/ui/commands/agent-commands.ts:240-1160`):
- 7 agents: `codebase-analyzer`, `codebase-locator`, `codebase-pattern-finder`, `codebase-online-researcher`, `codebase-research-analyzer`, `codebase-research-locator`, `debugger`
- Each has embedded `prompt` content and `tools` list

**Disk-based agents** discovered from:
- Project: `.claude/agents/`, `.opencode/agents/`, `.github/agents/`, `.atomic/agents/`
- Global: `~/.claude/agents/`, `~/.opencode/agents/`, `~/.copilot/agents/`, `~/.atomic/agents/`
- Discovery: `registerAgentCommands()` at line 1593
- Each has `source` field: `"project"` | `"atomic"` | `"user"` | `"builtin"`

**Access pattern**: Filter `globalRegistry.getAll()` by `category === "agent"`.

### 6. Memory Files

The SDKs handle memory files natively:
- **Claude**: CLAUDE.md loaded by SDK via `settingSources: ["project", "user"]` (`src/sdk/init.ts:27`)
- **Copilot**: `copilot-instructions.md` loaded via `loadCopilotInstructions()` (`src/config/copilot-manual.ts:150-171`) from `.github/copilot-instructions.md` or `~/.copilot/copilot-instructions.md`
- **OpenCode**: `AGENTS.md` loaded by SDK natively

Atomic also reads `src/CLAUDE.md` which serves as the project-level instruction file.

Known memory file paths to scan for:
- `CLAUDE.md`, `src/CLAUDE.md`, `.claude/CLAUDE.md`
- `.github/copilot-instructions.md`, `~/.copilot/copilot-instructions.md`
- `AGENTS.md`

### 7. UI Rendering Capabilities

**OpenTUI primitives** available for the `/context` display:
- `<box>` -- flexbox layout with `flexDirection`, `gap`, `border`, `borderStyle`, `borderColor`, `padding`
- `<text>` -- styled text with `fg`, `bg`, `attributes` (bold, dim, underline)
- `<span>` -- inline styled segments within `<text>` (for per-character coloring, gradient effects)
- `<scrollbox>` -- scrollable container

**Existing visual patterns to model after**:
- **Bar/meter**: No existing progress bar component, but `GradientText` at `src/ui/chat.tsx:250-268` demonstrates per-character coloring via `<span>` elements that could be adapted for a token usage bar
- **Colored categories**: `AGENT_COLORS` map at `src/ui/components/parallel-agents-tree.tsx:86-97` shows the pattern for category-specific colors
- **Status indicators**: `●` / `○` pattern used by MCP server list (`src/ui/components/mcp-server-list.tsx:56`), tool results, and loading indicators
- **Tree rendering**: `├─`, `└─`, `│ ` characters used in `ParallelAgentsTree` (`src/ui/components/parallel-agents-tree.tsx:102-107`)
- **Grouped lists**: `/model list` command groups models by provider with headers (`src/ui/commands/builtin-commands.ts:329-352`)

**Rendering approach for `/context`**: The command should return `CommandResult` with a custom field (e.g., `contextInfo`), and a dedicated component (e.g., `ContextInfoDisplay`) should render it, following the pattern used by `mcpServers` field and `McpServerListIndicator`.

### 8. Acceptance Criteria Mapping

From the issue:

| Requirement | Data Source | Status |
|---|---|---|
| Model info + total token usage | `client.getModelDisplayInfo()` + `session.getContextUsage()` | Available (context window hardcoded) |
| Category breakdown (system, tools, MCP, agents, memory, skills, messages) | Not directly available; requires token counting per component | Gap -- needs estimation or counting API |
| MCP tools with token costs | `discoverMcpConfigs()` for list; no token cost data | Partial -- list available, costs need estimation |
| Custom agents with token costs | `globalRegistry.getAll()` filtered by `"agent"` category; prompt content available | Partial -- list available, costs need estimation |
| Memory files with token costs | File paths known; content readable | Partial -- files discoverable, costs need estimation |
| Skills with token costs | `globalRegistry.getAll()` filtered by `"skill"` category; prompt content available | Partial -- list available, costs need estimation |
| Visual usage bar/meter | OpenTUI `<box>` + `<span>` for colored segments | Available primitives |

## Code References

### Command System
- `src/ui/commands/registry.ts:172-187` -- `CommandDefinition` interface
- `src/ui/commands/registry.ts:51-82` -- `CommandContext` interface
- `src/ui/commands/registry.ts:135-162` -- `CommandResult` interface
- `src/ui/commands/registry.ts:444` -- `globalRegistry` singleton
- `src/ui/commands/builtin-commands.ts:516-523` -- `registerBuiltinCommands()` registration
- `src/ui/commands/builtin-commands.ts:440-484` -- `/mcp` command (pattern for custom result fields)

### SDK Token/Context APIs
- `src/sdk/types.ts:184-193` -- `ContextUsage` interface
- `src/sdk/types.ts:62-67` -- `ModelDisplayInfo` interface
- `src/sdk/types.ts:494-553` -- `CodingAgentClient` interface
- `src/sdk/types.ts:199-235` -- `Session` interface with `getContextUsage()`
- `src/sdk/claude-client.ts:486-495` -- Claude `getContextUsage()` (hardcoded max 200k)
- `src/sdk/claude-client.ts:537-543` -- Claude token accumulation from SDK messages
- `src/sdk/claude-client.ts:863-873` -- Claude `getModelDisplayInfo()`
- `src/sdk/copilot-client.ts:381-389` -- Copilot `getContextUsage()` (hardcoded max 200k)
- `src/sdk/copilot-client.ts:413-415` -- Copilot token tracking from events
- `src/sdk/copilot-client.ts:828-857` -- Copilot `getModelDisplayInfo()`
- `src/sdk/opencode-client.ts:1008-1019` -- OpenCode `getContextUsage()` (hardcoded max 200k)
- `src/sdk/opencode-client.ts:939-943` -- OpenCode real token capture
- `src/sdk/opencode-client.ts:1187-1248` -- OpenCode `getModelDisplayInfo()`

### MCP Discovery
- `src/utils/mcp-config.ts:130-157` -- `discoverMcpConfigs()` unified discovery
- `src/utils/mcp-config.ts:18-37` -- Claude MCP config parser
- `src/utils/mcp-config.ts:44-68` -- Copilot MCP config parser
- `src/utils/mcp-config.ts:78-117` -- OpenCode MCP config parser

### Skills and Agents
- `src/ui/commands/skill-commands.ts:70-1443` -- `BUILTIN_SKILLS` array
- `src/ui/commands/skill-commands.ts:1851-1906` -- `discoverAndRegisterDiskSkills()`
- `src/ui/commands/agent-commands.ts:240-1160` -- `BUILTIN_AGENTS` array
- `src/ui/commands/agent-commands.ts:1593-1620` -- `registerAgentCommands()` discovery

### UI Components (Patterns)
- `src/ui/components/mcp-server-list.tsx:30-79` -- MCP server list (pattern for context display)
- `src/ui/components/parallel-agents-tree.tsx:86-97` -- Category color mapping
- `src/ui/components/parallel-agents-tree.tsx:102-107` -- Tree characters
- `src/ui/chat.tsx:250-268` -- `GradientText` per-character coloring
- `src/ui/chat.tsx:2475` -- How `mcpServers` result field triggers component rendering

### Command Result Processing
- `src/ui/chat.tsx:2192-2526` -- `executeCommand()` result processing
- `src/ui/chat.tsx:2475` -- `mcpServers` field attachment to message

### Memory Files
- `src/sdk/init.ts:24-33` -- Claude SDK init with `settingSources`
- `src/config/copilot-manual.ts:150-171` -- `loadCopilotInstructions()` for Copilot

## Architecture Documentation

### Token Estimation Strategy

Since no SDK provides a native category-level token breakdown, the `/context` command has two options:

1. **Character-based estimation** (4 chars/token): Used by OpenCode internally. Fast, no API calls. Apply to: system prompt text, skill prompts, agent prompts, memory file contents, MCP tool definitions.

2. **API-based counting** (Claude only): `client.messages.countTokens()` from `@anthropic-ai/sdk`. More accurate but requires API calls and is rate-limited. Only available for the Claude backend.

The project's existing convention uses estimation (see `src/sdk/opencode-client.ts:739`).

### Component Data Flow for /context

```
/context command execute()
  |
  |-- session.getContextUsage()  --> { inputTokens, outputTokens, maxTokens, usagePercentage }
  |-- client.getModelDisplayInfo() --> { model, tier }
  |-- discoverMcpConfigs()       --> McpServerConfig[]
  |-- globalRegistry.getAll()    --> CommandDefinition[] (filter by category)
  |-- scan memory file paths     --> file contents for estimation
  |
  v
  CommandResult { contextInfo: ContextDisplayInfo }
  |
  v
  ChatApp.executeCommand() detects contextInfo field
  |
  v
  ContextInfoDisplay component renders the data
```

### Proposed ContextDisplayInfo Shape

Based on the issue requirements and available data:

```typescript
interface ContextDisplayInfo {
  model: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  maxTokens: number;
  usagePercentage: number;
  categories: {
    name: string;
    tokens: number;
    color: string;
  }[];
  mcpServers: {
    name: string;
    toolCount: number;
    estimatedTokens: number;
  }[];
  agents: {
    name: string;
    source: string;  // "project" | "user" | "builtin"
    estimatedTokens: number;
  }[];
  memoryFiles: {
    path: string;
    estimatedTokens: number;
  }[];
  skills: {
    name: string;
    source: string;
    estimatedTokens: number;
  }[];
}
```

## Historical Context (from research/)

- `research/docs/2026-02-04-agent-subcommand-parity-audit.md` -- Confirms `getContextUsage()` is implemented on all three SDKs with varying precision: Claude uses real `message.usage`, OpenCode estimates from message lengths, Copilot uses `assistant.usage` events
- `research/docs/2026-02-08-164-mcp-support-discovery.md` -- Documents MCP config discovery patterns across all three SDK config formats
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` -- Documents skill loading from multiple config directories with priority-based override
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` -- Documents Claude Code CLI UI patterns including visual indicators
- `research/docs/2026-01-19-slash-commands.md` -- Documents slash command patterns across Claude, OpenCode, and Copilot

## Related Research

- `research/docs/2026-02-04-agent-subcommand-parity-audit.md` -- Token usage tracking section
- `research/docs/2026-02-08-164-mcp-support-discovery.md` -- MCP configuration discovery
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` -- Skill loading system
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` -- Independent context concepts
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` -- UI visual patterns

## Open Questions

1. **Token estimation accuracy**: Should the command use character-based estimation (4 chars/token) universally, or attempt Claude's `countTokens()` API when the backend is Claude? The estimation is fast but inaccurate; the API is accurate but adds latency and only works for Claude.

2. **Real context window sizes**: All three clients hardcode `maxTokens: 200000`. Should the `/context` command fix this by extracting real values from SDK APIs (Claude `ModelUsage.contextWindow`, Copilot `listModels().capabilities.limits.max_context_window_tokens`, OpenCode `model.limit.context`), or should the fix be in the SDK clients' `getContextUsage()` methods?

3. **MCP tool count and token cost**: MCP servers expose tools, but the tool definitions (and their token cost) are only known after the server is connected and tools are listed. The `McpServerConfig` does not include tool definitions -- those are resolved at the SDK level during session creation. How should the command surface MCP tool counts?

4. **System prompt visibility**: The system prompt is constructed internally by each SDK and is not easily accessible from the unified `Session` interface. Showing system prompt token cost would require either SDK changes or estimation from known prompt components.

5. **Visual design fidelity**: The issue includes a screenshot from Claude Code's `/context` command. Should the implementation match that exact layout, or adapt it to Atomic's existing visual language (gradient header, muted rose accents, tree characters)?
