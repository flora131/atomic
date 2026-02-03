---
date: 2026-02-03T16:50:07Z
researcher: Claude Opus 4.5
git_commit: 3ac4293f210df8b4639da065d31591986e54b18a
branch: lavaman131/feature/tui
repository: atomic
topic: "Model Parameters for Workflow Nodes, Custom Workflows, Model Command, Message Queuing, and Multi-Agent Configuration Parsing"
tags: [research, codebase, workflow, model-config, message-queue, tui, sdk, configuration, claude-code, opencode, copilot]
status: complete
last_updated: 2026-02-03T19:15:00Z
last_updated_by: Claude Opus 4.5
revision: 3
revision_notes: |
  Revision 3: Major architectural change - Atomic does NOT define custom formats for agents/skills/commands/MCP.
  Instead, Atomic parses and registers configurations from existing .claude/, .opencode/, .github/ directories.
  Only .atomic/workflows/ is Atomic-specific. Added comprehensive configuration schemas from official sources
  (Claude Code docs, OpenCode SDK via DeepWiki, Copilot CLI docs, Copilot SDK via DeepWiki).
  Includes complete frontmatter schemas, hook formats, MCP configurations, and normalization strategies.
---

# Research: Model Parameters, Custom Workflows, /model Command, and Message Queuing

## Research Question

Research the codebase to understand how to:
1. Add a model parameter to each node for the coding agent in the workflow
2. Create a basic workflow in `.atomic/workflows` to test defining custom workflows
3. Parse and register configurations from `.claude/`, `.opencode/`, `.github/` directories so models defined in sub-agents, skills, slash commands respect model settings (Atomic does NOT define its own custom format - only `.atomic/workflows/` is Atomic-specific)
4. Create a `/model` built-in command for model selection
5. Allow queuing messages in workflows and chats (study Claude Code's approach)

## Summary

This research covers six major areas for enhancing the Atomic CLI:

1. **Per-node model configuration** can be achieved by extending `NodeDefinition` with an optional `model` field and propagating it through `ExecutionContext` to SDK clients
2. **Custom workflows** are loaded from `.atomic/workflows/*.ts` files that export a factory function - example created at `.atomic/workflows/test-workflow.ts`
3. **Multi-agent configuration parsing**: Atomic parses and registers configurations from existing `.claude/`, `.opencode/`, and `.github/` directories - NO custom Atomic format for agents/skills/commands/MCP. Only `.atomic/workflows/` is Atomic-specific.
4. **`/model` command** follows the pattern of existing built-in commands in `builtin-commands.ts` with alias support (opus, sonnet, haiku) and cross-format normalization
5. **Message queuing** already has infrastructure (`useMessageQueue` hook) but lacks UI integration; **Claude Code uses "Boundary-aware Queuing"** with queue display, editing via up-arrow, and "Press up to edit queued messages" placeholder
6. **Configuration normalization** strategies documented for model formats, tool formats, and permissions across all three agent ecosystems

---

## Detailed Findings

### 1. Model Parameter for Workflow Nodes

#### Current Architecture

The workflow graph system uses `NodeDefinition` objects that execute via `ExecutionContext`:

**NodeDefinition** (`src/graph/types.ts:277-295`):
```typescript
export interface NodeDefinition<TState extends BaseState = BaseState> {
  id: NodeId;
  type: NodeType;
  execute: NodeExecuteFn<TState>;
  retry?: RetryConfig;
  name?: string;
  description?: string;
  // NOTE: No model field exists currently
}
```

**ExecutionContext** (`src/graph/types.ts:231-259`):
```typescript
export interface ExecutionContext<TState extends BaseState = BaseState> {
  state: TState;
  config: GraphConfig;
  errors: ExecutionError[];
  abortSignal?: AbortSignal;
  contextWindowUsage?: ContextWindowUsage;
  emit?: (signal: SignalData) => void;
  getNodeOutput?: (nodeId: NodeId) => unknown;
  // NOTE: No model field exists currently
}
```

#### Agent Node Pattern

Agent nodes currently accept model configuration through `AgentNodeConfig.sessionConfig`:

**AgentNodeConfig** (`src/graph/nodes.ts:57-94`):
```typescript
export interface AgentNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  agentType: AgentNodeAgentType;
  systemPrompt?: string;
  tools?: string[];
  outputMapper?: OutputMapper<TState>;
  sessionConfig?: Partial<SessionConfig>;  // Contains model field
  retry?: RetryConfig;
  name?: string;
  description?: string;
  buildMessage?: (state: TState) => string;
}
```

**SessionConfig** (`src/sdk/types.ts:114-133`):
```typescript
export interface SessionConfig {
  model?: string;  // Model identifier
  sessionId?: string;
  systemPrompt?: string;
  tools?: string[];
  mcpServers?: McpServerConfig[];
  permissionMode?: PermissionMode;
  maxBudgetUsd?: number;
  maxTurns?: number;
  agentMode?: OpenCodeAgentMode;
}
```

#### Proposed Extension

To support per-node model configuration:

1. **Add to NodeDefinition**:
```typescript
export interface NodeDefinition<TState extends BaseState = BaseState> {
  // ...existing fields
  model?: string | 'inherit';  // Model ID or 'inherit' from parent
}
```

2. **Add to ExecutionContext**:
```typescript
export interface ExecutionContext<TState extends BaseState = BaseState> {
  // ...existing fields
  model?: string;  // Current model for this execution context
}
```

3. **Add to GraphConfig** (for default):
```typescript
export interface GraphConfig<TState extends BaseState = BaseState> {
  // ...existing fields
  defaultModel?: string;  // Graph-wide default model
}
```

4. **Update GraphExecutor** (`src/graph/compiled.ts:519-531`):
```typescript
const context: ExecutionContext<TState> = {
  state,
  config: this.config,
  errors,
  abortSignal,
  // Add model resolution: node.model > parent model > config.defaultModel
  model: resolveModel(node, parentContext, this.config),
  emit: (_signal) => {},
  getNodeOutput: (nodeId) => state.outputs[nodeId],
};
```

#### SDK Model Configuration Patterns

**Claude Agent SDK**:
- V1: `query({ prompt, options: { model: 'claude-sonnet-4-5' } })`
- V2: `unstable_v2_createSession({ model: 'claude-sonnet-4-5' })`
- Sub-agents: `model: 'sonnet' | 'opus' | 'haiku' | 'inherit'`
- Runtime change: `query.setModel('claude-opus-4-5')` (streaming mode only)

**OpenCode SDK**:
- Global: `{ "model": "anthropic/claude-sonnet-4" }` in opencode.json
- Agent-level: frontmatter `model: anthropic/claude-opus-4-5`
- Provider variants: `{ "variants": { "high": { "thinking": { "budgetTokens": 10000 } } } }`

**Copilot SDK**:
- Session creation: `client.createSession({ model: 'gpt-5' })`
- No runtime model switching within sessions

---

### 2. Custom Workflow Definition Format

#### Current Mechanism

Custom workflows are loaded from `.atomic/workflows/` and `~/.atomic/workflows/` directories.

**Discovery** (`src/ui/commands/workflow-commands.ts:369-392`):
```typescript
export function discoverWorkflowFiles(): { path: string; source: "local" | "global" }[] {
  // Searches .atomic/workflows (local) and ~/.atomic/workflows (global)
  // Returns .ts files found
}
```

**Loading** (`src/ui/commands/workflow-commands.ts:428-478`):
```typescript
export async function loadWorkflowsFromDisk(): Promise<WorkflowMetadata[]> {
  const discovered = discoverWorkflowFiles();
  for (const { path, source } of discovered) {
    const module = await import(path);
    // Extract name, description, aliases from module exports
    // Validate default export is a function
    const metadata: WorkflowMetadata = {
      name: module.name ?? filename,
      description: module.description ?? `Custom workflow: ${name}`,
      aliases: module.aliases,
      createWorkflow: module.default,
      defaultConfig: module.defaultConfig,
      source,
    };
  }
}
```

#### Required Exports

A custom workflow file must export:

| Export | Required | Type | Description |
|--------|----------|------|-------------|
| `default` | Yes | `(config?) => CompiledGraph` | Factory function |
| `name` | No | `string` | Workflow name (defaults to filename) |
| `description` | No | `string` | Human-readable description |
| `aliases` | No | `string[]` | Alternative command names |
| `defaultConfig` | No | `Record<string, unknown>` | Default configuration |

#### Example Workflow File

**`.atomic/workflows/test-workflow.ts`**:
```typescript
import { graph, agentNode, toolNode } from "@bastani/atomic/graph";

export const name = "test-workflow";
export const description = "A basic test workflow for custom workflow validation";
export const aliases = ["test", "tw"];
export const defaultConfig = {
  maxIterations: 5,
  model: "claude-sonnet-4-5",
};

interface TestWorkflowState extends BaseState {
  message: string;
  result?: string;
}

export default function createTestWorkflow(
  config: Record<string, unknown> = {}
): CompiledGraph<TestWorkflowState> {
  const model = (config.model as string) ?? defaultConfig.model;

  const greetNode = toolNode<TestWorkflowState, void, string>({
    id: "greet",
    toolName: "greet",
    execute: async () => "Hello from test workflow!",
    outputMapper: (state, result) => ({ result }),
    name: "Greeting",
    description: "Emit a greeting message",
  });

  const agentProcessNode = agentNode<TestWorkflowState>({
    id: "process",
    agentType: "claude",
    sessionConfig: { model },
    buildMessage: (state) => `Process this: ${state.message}`,
    name: "Process with Agent",
    description: "Use agent to process the message",
  });

  return graph<TestWorkflowState>()
    .start(greetNode)
    .then(agentProcessNode)
    .end()
    .compile();
}
```

---

### 3. Configuration Loading and Model Respect

#### Current Config Directories

| Agent | Directory | Main Config | Model Location |
|-------|-----------|-------------|----------------|
| Claude | `.claude/` | `settings.json` | Command frontmatter `model:` |
| OpenCode | `.opencode/` | `opencode.json` | Agent frontmatter `model:`, provider section |
| Copilot | `.github/` | N/A | Not defined in config files |

#### Agent Frontmatter Parsing

**Location**: `src/ui/commands/agent-commands.ts:1003-1104`

The `parseMarkdownFrontmatter()` function extracts metadata from agent definition files:

```typescript
function parseMarkdownFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string
}
```

**Claude format** (`.claude/agents/*.md`):
```yaml
---
model: opus
allowed-tools: Bash, Task, Edit
---
```

**OpenCode format** (`.opencode/agents/*.md`):
```yaml
---
model: anthropic/claude-opus-4-5
tools:
  write: true
  edit: true
  bash: true
---
```

#### Tool Normalization

**Location**: `src/ui/commands/agent-commands.ts:1153-1169`

Different formats are normalized:
```typescript
export function normalizeTools(
  tools: string[] | Record<string, boolean> | undefined
): string[] | undefined
```

#### Model Propagation Gap

Currently, agent frontmatter parsing extracts `model` but it may not be consistently propagated to SDK session creation. The `AgentCommandInfo` interface includes `model`:

```typescript
export interface AgentCommandInfo {
  name: string;
  description: string;
  source: AgentSource;
  sourcePath?: string;
  prompt?: string;
  model?: string;  // Extracted from frontmatter
  tools?: string[] | Record<string, boolean>;
  // ...
}
```

**Recommendation**: Ensure `AgentCommandInfo.model` is passed to SDK `SessionConfig.model` when creating sessions in agent command execution.

---

### 4. `/model` Command Implementation

#### Built-in Command Pattern

**Location**: `src/ui/commands/builtin-commands.ts`

Built-in commands follow this pattern:

```typescript
export const modelCommand: CommandDefinition = {
  name: "model",
  description: "Switch or view the current model",
  category: "builtin",
  aliases: ["m"],
  execute: (args: string, context: CommandContext): CommandResult => {
    // Implementation
  },
};
```

#### Proposed `/model` Command

```typescript
/**
 * /model - Switch or display the current model.
 *
 * Usage:
 *   /model                    - Show current model
 *   /model <alias>            - Switch to model by alias (opus, sonnet, haiku)
 *   /model <full-name>        - Switch to specific model
 *   /model list               - List available models
 */
export const modelCommand: CommandDefinition = {
  name: "model",
  description: "Switch or view the current model",
  category: "builtin",
  aliases: ["m"],
  execute: async (args: string, context: CommandContext): Promise<CommandResult> => {
    const trimmed = args.trim().toLowerCase();

    // Show current model
    if (!trimmed) {
      const currentModel = context.session?.getModelDisplayInfo?.() ?? "No model set";
      return {
        success: true,
        message: `Current model: **${currentModel}**`,
      };
    }

    // List available models
    if (trimmed === "list") {
      const models = [
        { alias: "opus", description: "Claude Opus 4.5 - complex reasoning" },
        { alias: "sonnet", description: "Claude Sonnet 4.5 - daily coding" },
        { alias: "haiku", description: "Claude Haiku - fast, simple tasks" },
      ];
      const lines = models.map(m => `  ${m.alias} - ${m.description}`);
      return {
        success: true,
        message: `**Available Models**\n\n${lines.join("\n")}`,
      };
    }

    // Switch model
    const modelMap: Record<string, string> = {
      opus: "claude-opus-4-5-20250929",
      sonnet: "claude-sonnet-4-5-20250929",
      haiku: "claude-haiku-3-5-20240307",
    };

    const modelId = modelMap[trimmed] ?? trimmed;

    return {
      success: true,
      message: `Model switched to **${trimmed}**`,
      stateUpdate: {
        model: modelId,
      },
    };
  },
};
```

#### Registration

Add to `builtinCommands` array in `builtin-commands.ts`:

```typescript
export const builtinCommands: CommandDefinition[] = [
  helpCommand,
  themeCommand,
  clearCommand,
  compactCommand,
  modelCommand,  // Add here
];
```

#### Claude Code Model Selection Reference

Claude Code provides:
- `/model <alias|name>` - switch mid-session
- `Opt+P` / `Alt+P` - keyboard shortcut for model switching
- Model aliases: `sonnet`, `opus`, `haiku`, `default`, `sonnet[1m]`, `opusplan`

---

### 5. Message Queuing Implementation

#### Current Implementation Status

**useMessageQueue hook** (`src/ui/hooks/use-message-queue.ts:89-136`):
- Fully implemented with `enqueue`, `dequeue`, `clear` operations
- Uses FIFO queue with `QueuedMessage` objects

**ChatApp integration** (`src/ui/chat.tsx`):
- Hook instantiated at line 784
- Messages queued during streaming at line 1693
- Queue processed on stream completion at lines 1633-1638
- 50ms delay between queue processing

**QueueIndicator component** (`src/ui/components/queue-indicator.tsx`):
- Fully implemented with compact and expanded modes
- Exported but **NOT rendered in ChatApp**

#### Gap: Missing UI Integration

The `QueueIndicator` component exists but is not rendered. To add it:

**In ChatApp (`src/ui/chat.tsx`)**, add to render section:

```tsx
{/* Message queue indicator - show when streaming with queued messages */}
{isStreaming && messageQueue.count > 0 && (
  <QueueIndicator
    count={messageQueue.count}
    queue={messageQueue.queue}
    compact={true}
  />
)}
```

#### Claude Code's Approach: Boundary-Aware Queuing

**CORRECTION**: Claude Code DOES use message queuing, not just interrupts. Based on direct observation via tmux-cli:

**Observed Behavior**:
1. **Input placeholder changes**: When messages are queued, input shows "Press up to edit queued messages"
2. **Queue display**: Queued messages appear above the input box with `❯ ` prefix
3. **Queue editing**: Users can press up-arrow to navigate and edit queued messages before they're processed
4. **Sequential processing**: Messages are processed in order after the current response completes

**Key UX Pattern - "Boundary-Aware Queuing"**:
- Messages typed during streaming are queued (not lost)
- User gets visual feedback that messages are queued
- User can edit/reorder queued messages before processing
- Processing happens at response boundaries (after stream completes)

**This differs from pure interrupt model**:
- Interrupts (`Esc`) abort current stream immediately
- Queuing preserves input for sequential processing
- Both patterns coexist in Claude Code

#### Implementation Recommendations for Atomic

1. **Primary: Adopt Claude Code's queuing UX**:
   - Show "Press up to edit queued messages" placeholder when queue is non-empty
   - Display queued messages with `❯ ` prefix above input
   - Allow up-arrow navigation to edit queued messages
   - Process queue sequentially at stream completion

2. **Secondary: Support interrupts alongside queuing**:
   - `Esc` to abort current stream (already exists)
   - Queued messages remain after interrupt
   - User can choose to process queue or clear it

3. **Render QueueIndicator**:
   ```tsx
   {messageQueue.count > 0 && (
     <QueueIndicator
       count={messageQueue.count}
       queue={messageQueue.queue}
       editable={!isStreaming}
       onEdit={(index) => /* edit queued message */}
     />
   )}
   ```

---

### 6. Configuration Schemas (Parsed by Atomic)

**IMPORTANT**: Atomic does NOT define its own custom format for agents, skills, commands, or MCP configuration. Instead, Atomic **parses and registers** configurations from existing `.claude`, `.opencode`, and `.github` directories. The only Atomic-specific configuration is `.atomic/workflows/` for custom workflow definitions.

This approach provides:
- Compatibility with existing coding agent setups
- No migration required for users of Claude Code, OpenCode, or Copilot CLI
- Unified interface across all three agent ecosystems

---

#### 6.1 Claude Code Configuration (`.claude/`)

**Source**: https://code.claude.com/docs/en/features-overview

**Directory Structure**:
```
project-root/
├── .claude/
│   ├── settings.json              # Project-shared settings (committed)
│   ├── settings.local.json        # Personal overrides (gitignored)
│   ├── CLAUDE.md                  # Project memory file
│   ├── CLAUDE.local.md            # Personal memory (gitignored)
│   ├── agents/                    # Subagent definitions
│   │   └── <agent-name>.md
│   ├── commands/                  # Custom slash commands (legacy, still supported)
│   │   └── <command-name>.md
│   ├── skills/                    # Skill definitions
│   │   └── <skill-name>/
│   │       └── SKILL.md
│   └── rules/                     # Modular project rules
│       └── *.md
├── .mcp.json                      # MCP server configuration
├── CLAUDE.md                      # Alternative project memory location
└── CLAUDE.local.md                # Personal project memory (gitignored)
```

**User-Level Structure**:
```
~/.claude/
├── settings.json                  # User-wide settings
├── CLAUDE.md                      # User memory file
├── .claude.json                   # User preferences/OAuth/MCP servers
├── agents/                        # User subagents
├── skills/                        # User skills
└── rules/                         # User-level rules
```

**settings.json Complete Schema**:
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",

  // Model Configuration
  "model": "sonnet|opus|haiku|sonnet[1m]|opusplan",
  "alwaysThinkingEnabled": false,

  // Permissions
  "permissions": {
    "allow": ["Bash(npm run *)"],
    "ask": ["Edit(./**)"],
    "deny": ["Bash(rm -rf *)"],
    "additionalDirectories": ["/path/to/dir"],
    "defaultMode": "acceptEdits|askForAll|bypassPermissions"
  },

  // MCP Configuration
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["serverName"],
  "disabledMcpjsonServers": ["serverName"],
  "allowedMcpServers": [{ "serverName": "github" }],
  "deniedMcpServers": [{ "serverName": "dangerous" }],

  // Hooks
  "hooks": { /* see hooks section */ },
  "disableAllHooks": false,

  // Sandbox
  "sandbox": {
    "enabled": false,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["rm"],
    "network": {
      "allowedDomains": ["*.github.com"],
      "allowLocalBinding": false
    }
  },

  // UI & Display
  "language": "english|japanese|spanish|french",
  "showTurnDuration": true,
  "spinnerTipsEnabled": true,
  "terminalProgressBarEnabled": true,

  // Environment
  "env": { "KEY": "value" },

  // Plugins
  "enabledPlugins": { "plugin-name@marketplace": true }
}
```

**Agent Frontmatter (`.claude/agents/*.md`)**:
```yaml
---
name: agent-name                    # Required: Unique identifier
description: When to delegate       # Required: Delegation criteria
tools: Read, Grep, Glob, Bash       # Optional: Comma-separated allowlist
disallowedTools: Write, Edit        # Optional: Tool denylist
model: sonnet|opus|haiku|inherit    # Optional: Model override (default: inherit)
permissionMode: default|acceptEdits|dontAsk|bypassPermissions|plan
skills:                             # Optional: Skills to preload
  - skill-name-1
hooks:                              # Optional: Agent-scoped hooks
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./validate.sh"
---

System prompt content goes here...
```

**Skill Manifest (`.claude/skills/<name>/SKILL.md`)**:
```yaml
---
name: skill-name                    # Optional: Display name (defaults to dir name)
description: What this skill does   # Recommended: Used for auto-invocation
argument-hint: "[issue-number]"     # Optional: Hint for autocomplete
disable-model-invocation: false     # Optional: Only user can invoke via /name
user-invocable: true                # Optional: Show in / menu
allowed-tools: Read, Grep           # Optional: Auto-approved tools
model: sonnet                       # Optional: Model override
context: fork                       # Optional: Run in forked subagent
agent: Explore|Plan|general-purpose # Optional: Subagent type when context: fork
---

Skill instructions with $ARGUMENTS placeholder...
Dynamic context: !`shell command`
```

**MCP Configuration (`.mcp.json`)**:
```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio|http|sse",
      "command": "/path/to/executable",
      "args": ["--flag", "value"],
      "env": {
        "API_KEY": "${API_KEY}",
        "PATH": "${PATH:-/usr/bin}"
      },
      "cwd": "/working/directory",
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

**Hook Events**:
| Event | Matcher Input | Description |
|-------|---------------|-------------|
| `SessionStart` | `startup\|resume\|clear\|compact` | Session begins |
| `UserPromptSubmit` | N/A | User submits prompt |
| `PreToolUse` | Tool name | Before tool execution |
| `PostToolUse` | Tool name | After tool success |
| `PostToolUseFailure` | Tool name | After tool failure |
| `Stop` | N/A | Claude finishes responding |
| `SubagentStart` | Agent type | Subagent spawned |
| `SubagentStop` | Agent type | Subagent finishes |
| `PreCompact` | `manual\|auto` | Before context compaction |
| `SessionEnd` | Exit reason | Session terminates |

**Model Aliases**:
| Alias | Description |
|-------|-------------|
| `sonnet` | Claude Sonnet 4.5 (latest) |
| `opus` | Claude Opus 4.5 |
| `haiku` | Claude Haiku (fast) |
| `sonnet[1m]` | Sonnet with 1M context window |
| `opusplan` | Opus for planning, Sonnet for execution |
| `inherit` | Use parent conversation's model |

---

#### 6.2 OpenCode Configuration (`.opencode/`)

**Source**: `anomalyco/opencode` repository (DeepWiki)

**Directory Structure**:
```
.opencode/
├── opencode.json              # Main configuration
├── agents/ or agent/          # Agent definitions
│   └── *.md
├── command/ or commands/      # Command definitions
│   └── *.md
├── skills/                    # Skill definitions
│   └── <skill-name>/
│       └── SKILL.md
└── *.local.md                 # Runtime state (gitignored)
```

**Config Precedence** (later overrides earlier):
1. Remote config
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`OPENCODE_CONFIG` env var)
4. Project config (`opencode.json`)
5. `.opencode` directories
6. Inline config (`OPENCODE_CONFIG_CONTENT` env var)

**opencode.json Complete Schema**:
```json
{
  "$schema": "https://opencode.ai/config.json",

  // Model Configuration
  "model": "provider_id/model_id",
  "small_model": "provider_id/model_id",
  "default_agent": "build",

  // Provider Configuration
  "provider": {
    "anthropic": {
      "name": "Anthropic",
      "api": "https://api.anthropic.com",
      "env": ["ANTHROPIC_API_KEY"],
      "options": {
        "apiKey": "string",
        "baseURL": "string",
        "timeout": 300000
      },
      "models": {
        "claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5",
          "cost": { "input": 0.003, "output": 0.015 },
          "limit": { "context": 200000, "output": 8192 },
          "tool_call": true,
          "attachment": true
        }
      }
    }
  },

  // MCP Server Configuration
  "mcp": {
    "server-name": {
      "type": "local|remote",
      "command": ["npx", "-y", "mcp-command"],
      "environment": { "VAR": "value" },
      "url": "https://mcp-server.com",
      "headers": { "Authorization": "Bearer KEY" },
      "oauth": { "clientId": "...", "scope": "..." },
      "enabled": true,
      "timeout": 5000
    }
  },

  // Permission Configuration
  "permission": {
    "*": "ask",
    "read": "allow",
    "edit": "ask",
    "bash": {
      "*": "ask",
      "git *": "allow",
      "rm *": "deny"
    },
    "external_directory": {
      "*": "deny",
      "~/projects/*": "allow"
    }
  },

  // Agent Configuration
  "agent": {
    "build": { /* AgentConfig */ },
    "plan": { /* AgentConfig */ },
    "general": { /* AgentConfig */ },
    "explore": { /* AgentConfig */ }
  },

  // UI Configuration
  "theme": "string",
  "tui": {
    "scroll_speed": 3,
    "diff_style": "auto|stacked"
  },
  "keybinds": {
    "leader": "ctrl+x",
    "app_exit": "ctrl+c,ctrl+d",
    "model_list": "<leader>m"
  },

  // Additional Configuration
  "skills": { "paths": ["./custom-skills"] },
  "watcher": { "ignore": ["node_modules/**"] },
  "formatter": { "prettier": { "command": ["npx", "prettier", "--write", "$FILE"] } },
  "lsp": { "typescript": { "command": ["typescript-language-server", "--stdio"] } },
  "compaction": { "auto": true, "prune": true },
  "share": "manual|auto|disabled",
  "autoupdate": true
}
```

**Agent Frontmatter (`.opencode/agents/*.md`)**:
```yaml
---
model: anthropic/claude-opus-4-5    # Optional: Model override
variant: string                      # Optional: Model variant
temperature: 0.7                     # Optional: 0.0-2.0
top_p: 0.9                           # Optional: 0.0-1.0
prompt: path/to/prompt.md            # Optional: External prompt file
description: Agent description       # Optional: Shown in UI
mode: subagent|primary|all           # Optional: Agent mode
hidden: false                        # Optional: Hide from @ autocomplete
disable: false                       # Optional: Disable agent
color: "#FF5733"                     # Optional: UI color
steps: 50                            # Optional: Max iterations
permission:                          # Optional: Permission overrides
  "*": "ask"
  edit: "allow"
---

System prompt content...
```

**Command Frontmatter (`.opencode/command/*.md`)**:
```yaml
---
description: Command description     # Optional: Shown in UI
agent: build                         # Optional: Agent to execute
model: anthropic/claude-sonnet-4     # Optional: Model override
subtask: false                       # Optional: Force subagent invocation
---

Command template with $ARGUMENTS or $1, $2 placeholders...
Shell output: `!npm test`
File reference: @filename
```

**Skill Manifest (`.opencode/skills/<name>/SKILL.md`)**:
```yaml
---
name: skill-name                     # Required: 1-64 chars, lowercase with hyphens
description: Skill description       # Required: 1-1024 chars
license: MIT                         # Optional
---

Skill content in Markdown...
```

**Model Format**: `provider_id/model_id` (e.g., `anthropic/claude-opus-4-5`, `openai/gpt-5`)

**Permission Actions**: `"allow"`, `"ask"`, `"deny"`

**Available Tools**:
| Tool | Description |
|------|-------------|
| `read` | Reading files |
| `edit` | File modifications |
| `glob` | File globbing |
| `grep` | Content search |
| `list` | Directory listing |
| `bash` | Shell commands |
| `task` | Launching subagents |
| `skill` | Loading skills |
| `webfetch` | Fetching URLs |
| `websearch` | Web search |

---

#### 6.3 GitHub Copilot Configuration (`.github/`)

**Source**: GitHub Docs (Copilot CLI, Hooks, Agent Skills)

**Directory Structure**:
```
.github/
├── copilot-instructions.md          # Repository-wide instructions
├── instructions/                     # Path-specific instructions
│   └── *.instructions.md
├── hooks/                            # Hook configuration
│   └── *.json
├── agents/                           # Custom agent profiles
│   └── CUSTOM-AGENT-NAME.md
└── skills/                           # Agent skills
    └── <skill-name>/
        ├── SKILL.md
        └── [optional resources]
```

**User-Level Configuration**:
```
~/.copilot/
├── config                            # General CLI configuration
├── mcp-config.json                   # MCP server definitions
├── agents/                           # User-level custom agents
└── skills/                           # Personal skills
```

**Note**: `.github/workflows/` and `.github/dependabot.yml` are NOT Copilot config files.

**Agent Frontmatter (`.github/agents/AGENT-NAME.md`)**:
```yaml
---
name: agent-name                      # Optional: Display name
description: Agent purpose            # Required: When to use
target: vscode|github-copilot         # Optional: Environment
tools: ["*"]|["read", "edit"]|[]      # Optional: Tool access
infer: true                           # Optional: Auto-selection
mcp-servers:                          # Optional: MCP config (org/enterprise only)
  server-name:
    type: local
    command: some-command
    tools: ["*"]
    env:
      VAR: $COPILOT_MCP_VAR
metadata:                             # Optional: Custom annotations
  key: value
---

System prompt content (max 30,000 chars)...
```

**Tool Aliases** (case-insensitive):
| Alias | Description |
|-------|-------------|
| `execute` | Shell commands (bash/powershell) |
| `read` | File viewing |
| `edit` | File modifications |
| `search` | File/text searching |
| `agent` | Invoke other custom agents |
| `web` | URL fetching/web search |
| `todo` | Task list creation |
| `server-name/*` | All tools from MCP server |

**Skill Manifest (`.github/skills/<name>/SKILL.md`)**:
```yaml
---
name: skill-name                      # Required: Unique identifier
description: Skill description        # Required: Function and triggers
license: MIT                          # Optional
---

Skill instructions in Markdown...
```

**Hooks Configuration (`.github/hooks/*.json`)**:
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [],
    "sessionEnd": [],
    "userPromptSubmitted": [],
    "preToolUse": [
      {
        "type": "command",
        "bash": "./scripts/validate.sh",
        "powershell": "./scripts/validate.ps1",
        "cwd": "scripts",
        "timeoutSec": 30,
        "env": { "KEY": "value" },
        "comment": "Security validation"
      }
    ],
    "postToolUse": [],
    "errorOccurred": []
  }
}
```

**Hook Events**:
| Event | Input Fields | Output Fields |
|-------|--------------|---------------|
| `sessionStart` | `timestamp`, `cwd`, `source`, `initialPrompt` | - |
| `sessionEnd` | `timestamp`, `cwd`, `reason` | - |
| `userPromptSubmitted` | `timestamp`, `cwd`, `prompt` | - |
| `preToolUse` | `timestamp`, `cwd`, `toolName`, `toolArgs` | `permissionDecision`, `permissionDecisionReason` |
| `postToolUse` | `timestamp`, `cwd`, `toolName`, `toolArgs`, `toolResult` | - |
| `errorOccurred` | `timestamp`, `cwd`, `error` | - |

**MCP Configuration (`~/.copilot/mcp-config.json`)**:
```json
{
  "mcpServers": {
    "server-name": {
      "command": "string",
      "args": ["string"],
      "env": { "KEY": "${VAR_NAME}" },
      "cwd": "string"
    }
  }
}
```

**Model Selection**:
- Interactive: `/model` or `/model claude-sonnet-4`
- Command-line: `copilot --model "claude-sonnet-4"`
- Available models: Claude Sonnet 4.5, Claude Sonnet 4, Claude Haiku 4.5, GPT-5, GPT-5 mini, GPT-4.1

---

#### 6.4 Atomic Configuration (`.atomic/`)

**IMPORTANT**: Atomic only defines `.atomic/workflows/` for custom workflow definitions. All other configurations (agents, skills, commands, MCP) are loaded from the existing `.claude/`, `.opencode/`, and `.github/` directories.

**Directory Structure**:
```
.atomic/
└── workflows/                        # Custom workflow definitions (ONLY Atomic-specific)
    └── *.ts                          # TypeScript workflow files
```

**Workflow File Exports**:
```typescript
export const name: string;                           // Command name
export const description: string;                    // Description
export const aliases: string[];                      // Alternative names
export const defaultConfig: Record<string, unknown>; // Defaults
export default function(config?): CompiledGraph;     // Factory function
```

**Configuration Loading Strategy**:
Atomic loads and registers configurations from all three agent directories:

| Config Type | Source Directories |
|-------------|-------------------|
| Agents | `.claude/agents/`, `.opencode/agents/`, `.github/agents/` |
| Commands | `.claude/commands/`, `.opencode/command/` |
| Skills | `.claude/skills/`, `.opencode/skills/`, `.github/skills/` |
| MCP Servers | `.mcp.json`, `.opencode/opencode.json` (mcp section), `~/.copilot/mcp-config.json` |
| Settings | `.claude/settings.json`, `.opencode/opencode.json` |
| Hooks | `.claude/settings.json` (hooks), `.github/hooks/*.json` |
| Workflows | `.atomic/workflows/` (Atomic-only) |

---

#### 6.5 Configuration Normalization

Atomic normalizes different configuration formats into a unified internal representation:

**Model Format Normalization**:

| Source | Input Format | Normalized Output |
|--------|--------------|-------------------|
| Claude Code | `opus`, `sonnet`, `haiku`, `inherit` | `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-3-5`, `inherit` |
| OpenCode | `anthropic/claude-opus-4-5` | `claude-opus-4-5` |
| Copilot | `claude-opus-4-5`, `gpt-5` | `claude-opus-4-5`, `gpt-5` |

**Tool Format Normalization**:

| Source | Input Format | Normalized Output |
|--------|--------------|-------------------|
| Claude Code | `allowed-tools: Bash, Task, Edit` | `["Bash", "Task", "Edit"]` |
| OpenCode | `tools: { bash: true, edit: false }` | `["bash"]` |
| Copilot | `tools: ["read", "edit", "*"]` | `["read", "edit", "*"]` |

**Permission Format Normalization**:

| Source | Input Format |
|--------|--------------|
| Claude Code | `permissions.allow: ["Bash(npm *)"]` |
| OpenCode | `permission: { bash: { "npm *": "allow" } }` |
| Copilot | Hook-based via `preToolUse` returning `permissionDecision` |

**Current Normalization Code** (`src/ui/commands/agent-commands.ts:1153-1169`):
```typescript
export function normalizeTools(
  tools: string[] | Record<string, boolean> | undefined
): string[] | undefined {
  if (!tools) return undefined;
  if (Array.isArray(tools)) return tools;
  return Object.entries(tools)
    .filter(([_, enabled]) => enabled)
    .map(([name]) => name);
}
```

---

#### 6.6 Implementation: Configuration Loading Architecture

**Proposed Loading Flow**:
```
initializeAsync()
    │
    ├── loadClaudeConfig()
    │   ├── Parse .claude/settings.json
    │   ├── Parse .claude/agents/*.md
    │   ├── Parse .claude/commands/*.md
    │   ├── Parse .claude/skills/*/SKILL.md
    │   └── Parse .mcp.json
    │
    ├── loadOpenCodeConfig()
    │   ├── Parse .opencode/opencode.json
    │   ├── Parse .opencode/agents/*.md
    │   ├── Parse .opencode/command/*.md
    │   └── Parse .opencode/skills/*/SKILL.md
    │
    ├── loadCopilotConfig()
    │   ├── Parse .github/agents/*.md
    │   ├── Parse .github/skills/*/SKILL.md
    │   ├── Parse .github/hooks/*.json
    │   └── Parse ~/.copilot/mcp-config.json
    │
    ├── loadAtomicConfig()
    │   └── Parse .atomic/workflows/*.ts
    │
    └── registerAll()
        ├── Normalize all configurations
        ├── Register agents (dedupe by name, later wins)
        ├── Register commands (dedupe by name)
        ├── Register skills (dedupe by name)
        ├── Register MCP servers (merge)
        ├── Register workflows
        └── Apply settings (merge with precedence)
```

**Precedence Order** (later overrides earlier):
1. `.opencode/` (lowest)
2. `.github/`
3. `.claude/`
4. `.atomic/` (highest, workflows only)
5. CLI flags (highest for model/permissions)

---

## Code References

### Graph System
- `src/graph/types.ts:277-295` - NodeDefinition interface
- `src/graph/types.ts:231-259` - ExecutionContext interface
- `src/graph/types.ts:322-362` - GraphConfig interface
- `src/graph/nodes.ts:57-94` - AgentNodeConfig interface
- `src/graph/nodes.ts:163-262` - AgentNode execution
- `src/graph/compiled.ts:519-531` - ExecutionContext construction

### Workflow System
- `src/workflows/ralph/workflow.ts:185-247` - createRalphWorkflow()
- `src/ui/commands/workflow-commands.ts:369-392` - discoverWorkflowFiles()
- `src/ui/commands/workflow-commands.ts:428-478` - loadWorkflowsFromDisk()

### Configuration
- `src/config/ralph.ts:17-55` - Ralph configuration types
- `src/ui/commands/agent-commands.ts:1003-1104` - parseMarkdownFrontmatter()
- `src/ui/commands/agent-commands.ts:1153-1169` - normalizeTools()

### Commands
- `src/ui/commands/builtin-commands.ts:28-158` - Built-in command definitions
- `src/ui/commands/registry.ts` - Command registry

### SDK Clients
- `src/sdk/types.ts:114-133` - SessionConfig interface
- `src/sdk/claude-client.ts:185-301` - buildSdkOptions()
- `src/sdk/opencode-client.ts` - OpenCode client
- `src/sdk/copilot-client.ts:156-185` - buildSdkOptions()

### Message Queue
- `src/ui/hooks/use-message-queue.ts:89-136` - useMessageQueue hook
- `src/ui/chat.tsx:784` - Hook instantiation
- `src/ui/chat.tsx:1633-1638` - Queue processing
- `src/ui/components/queue-indicator.tsx:89-142` - QueueIndicator component

---

## Architecture Documentation

### Current Model Configuration Flow

```
User Request → ChatApp → SDK Client → createSession(SessionConfig) → Agent
                 ↓
         SessionConfig.model passed through
                 ↓
         SDK handles model selection
```

### Proposed Per-Node Model Flow

```
Workflow Start → GraphExecutor → For each node:
                      ↓
              Resolve model: node.model > parentContext.model > config.defaultModel
                      ↓
              Build ExecutionContext with model
                      ↓
              node.execute(context)
                      ↓
              If agent node: context.model → SessionConfig.model
```

### Custom Workflow Loading Flow

```
initializeCommandsAsync() → loadWorkflowsFromDisk()
         ↓
Discover .ts files in .atomic/workflows and ~/.atomic/workflows
         ↓
Dynamic import each file → Extract exports (default, name, description, aliases)
         ↓
Create WorkflowMetadata → Register in workflow registry
         ↓
Generate CommandDefinition → Register in command registry
```

---

## Historical Context (from research/)

No prior research documents directly address these topics. This is the first comprehensive research on:
- Per-node model configuration
- Custom workflow definition format
- Model command implementation
- Message queue UI integration

---

## Related Research

- No directly related research documents found in `research/` directory
- This research creates the foundation for feature implementation

---

## Open Questions

1. **Model inheritance semantics**: When a node specifies `model: 'inherit'`, should it inherit from:
   - The parent node that spawned it?
   - The graph-level default?
   - The current session model?

2. **Runtime model switching**: Should the `/model` command:
   - Affect only new messages?
   - Attempt to switch mid-session (SDK-dependent)?
   - Clear context and restart with new model?

3. **Queue editing UX**: How should queue editing work when user presses up-arrow?
   - Inline editing in queue display?
   - Move to input box for editing?
   - Modal/popup editor?

4. **Config validation**: Should custom workflow files be validated against a schema at load time?

5. **Model availability**: How to determine which models are available for the current SDK/account?

6. **Configuration precedence**: When the same agent/skill/command name exists in multiple directories, what's the priority?
   - **Proposed**: `.claude/` > `.github/` > `.opencode/` (Claude Code takes precedence as primary target)
   - Alternative: Last-loaded wins (alphabetical by directory name)
   - Alternative: Merge with explicit conflict resolution

7. **Hook system unification**: Claude Code and Copilot have different hook formats. How to handle?
   - **Proposed**: Support both formats, translate internally to unified hook system
   - Claude Code: `settings.json` hooks section
   - Copilot: `.github/hooks/*.json` files

8. **MCP server merging**: Multiple sources define MCP servers. How to merge?
   - **Proposed**: Merge all servers, later sources override on name conflict
   - Sources: `.mcp.json` (Claude), `opencode.json` (OpenCode), `~/.copilot/mcp-config.json` (Copilot)

9. **Permission system unification**: Each agent has different permission formats:
   - Claude Code: `permissions.allow/deny` with tool patterns
   - OpenCode: `permission` object with nested patterns
   - Copilot: Hook-based via `preToolUse` returning `permissionDecision`
   - **Proposed**: Normalize to unified permission model, execute Copilot hooks as permission checks

10. **Skill directory collision**: Same skill name in multiple directories (e.g., `.claude/skills/my-skill/` and `.opencode/skills/my-skill/`):
    - **Proposed**: Higher-precedence directory wins entirely (no merging within skills)

---

## Implementation Recommendations

### Priority Order

1. **High Priority**:
   - ✅ Create example workflow in `.atomic/workflows/` (DONE: `.atomic/workflows/test-workflow.ts`)
   - **Configuration Loading System**: Implement unified config loader that parses:
     - `.claude/` (agents, commands, skills, settings, .mcp.json)
     - `.opencode/` (agents, commands, skills, opencode.json)
     - `.github/` (agents, skills, hooks)
   - Update `QueueIndicator` to match Claude Code's UX pattern
   - Implement `/model` command with alias support
   - Add model normalization utilities for cross-agent compatibility

2. **Medium Priority**:
   - Extend `NodeDefinition` with model field
   - Update `ExecutionContext` with model propagation
   - Ensure agent frontmatter `model` reaches SDK
   - Implement tool normalization (already exists at `agent-commands.ts:1153-1169`)

3. **Lower Priority**:
   - Model validation and availability checking
   - Schema validation for custom workflows
   - Hook system integration (Claude Code + Copilot formats)

### Specific Implementation Tasks

#### Configuration Loading System (NEW)

Create a unified configuration loader that respects all three agent ecosystems:

```typescript
// src/config/loader.ts
export interface UnifiedConfig {
  agents: Map<string, AgentConfig>;      // Merged from all sources
  commands: Map<string, CommandConfig>;  // Merged from all sources
  skills: Map<string, SkillConfig>;      // Merged from all sources
  mcpServers: Map<string, McpConfig>;    // Merged from all sources
  workflows: Map<string, WorkflowConfig>; // Atomic-only
  settings: MergedSettings;              // Merged with precedence
}

export async function loadUnifiedConfig(projectRoot: string): Promise<UnifiedConfig> {
  const [claude, opencode, copilot, atomic] = await Promise.all([
    loadClaudeConfig(projectRoot),
    loadOpenCodeConfig(projectRoot),
    loadCopilotConfig(projectRoot),
    loadAtomicConfig(projectRoot),
  ]);

  return mergeConfigs({ claude, opencode, copilot, atomic });
}

// Loader for each ecosystem
async function loadClaudeConfig(root: string): Promise<ClaudeConfig> {
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const agentsDir = path.join(root, '.claude', 'agents');
  const commandsDir = path.join(root, '.claude', 'commands');
  const skillsDir = path.join(root, '.claude', 'skills');
  const mcpPath = path.join(root, '.mcp.json');
  // ... parse each
}

async function loadOpenCodeConfig(root: string): Promise<OpenCodeConfig> {
  const configPath = path.join(root, '.opencode', 'opencode.json');
  const agentsDir = path.join(root, '.opencode', 'agents');
  // ... parse each
}

async function loadCopilotConfig(root: string): Promise<CopilotConfig> {
  const agentsDir = path.join(root, '.github', 'agents');
  const skillsDir = path.join(root, '.github', 'skills');
  const hooksDir = path.join(root, '.github', 'hooks');
  // ... parse each
}
```

#### Message Queue UI (Following Claude Code Pattern)

1. **Update QueueIndicator component** (`src/ui/components/queue-indicator.tsx`):
   - Add `editable` prop for queue item editing
   - Add `onEdit` callback for item selection
   - Display queued messages with `❯ ` prefix
   - Support up-arrow/down-arrow navigation

2. **Update ChatApp** (`src/ui/chat.tsx`):
   - Render `QueueIndicator` when `messageQueue.count > 0`
   - Change input placeholder during queued state
   - Handle up-arrow key to enter queue editing mode
   - Allow editing/reordering queued messages

3. **Update useMessageQueue hook** (`src/ui/hooks/use-message-queue.ts`):
   - Add `updateAt(index, message)` for in-place editing
   - Add `moveUp(index)` / `moveDown(index)` for reordering
   - Add `currentEditIndex` state for navigation

#### Model Command Implementation

```typescript
// src/ui/commands/builtin-commands.ts
export const modelCommand: CommandDefinition = {
  name: "model",
  aliases: ["m"],
  category: "builtin",
  description: "Switch or view the current model",
  execute: async (args, context) => {
    // Supports all three formats:
    // - Claude aliases: opus, sonnet, haiku
    // - OpenCode format: anthropic/claude-opus-4-5
    // - Direct model ID: claude-opus-4-5
    const modelAliases: Record<string, string> = {
      opus: "claude-opus-4-5-20251101",
      sonnet: "claude-sonnet-4-5-20251101",
      haiku: "claude-haiku-3-5-20240307",
    };
    // ... implementation with normalizeModel()
  },
};
```

#### Per-Node Model Configuration

```typescript
// src/graph/types.ts additions
export interface NodeDefinition<TState extends BaseState = BaseState> {
  // ...existing fields
  model?: string | 'inherit';
}

export interface ExecutionContext<TState extends BaseState = BaseState> {
  // ...existing fields
  model?: string;
}

export interface GraphConfig<TState extends BaseState = BaseState> {
  // ...existing fields
  defaultModel?: string;
}
```

---

## Files Created/Modified

### Created
- `.atomic/workflows/test-workflow.ts` - Example custom workflow demonstrating required exports

### To Be Created
- `src/config/loader.ts` - Unified configuration loader
- `src/config/claude-loader.ts` - Claude Code config parser
- `src/config/opencode-loader.ts` - OpenCode config parser
- `src/config/copilot-loader.ts` - Copilot config parser
- `src/config/normalizers.ts` - Model/tool/permission normalization utilities

### To Be Modified
- `src/graph/types.ts` - Add model fields to NodeDefinition, ExecutionContext, GraphConfig
- `src/ui/components/queue-indicator.tsx` - Add editing support, Claude Code UX pattern
- `src/ui/chat.tsx` - Render QueueIndicator, handle queue editing
- `src/ui/hooks/use-message-queue.ts` - Add editing/reordering methods
- `src/ui/commands/builtin-commands.ts` - Add `/model` command
- `src/ui/commands/agent-commands.ts` - Use unified config loader
