# Agent SDK reference - TypeScript

Complete API reference for the TypeScript Agent SDK, including all functions, types, and interfaces.

---

<script src="/components/typescript-sdk-type-links.js" defer />

<Note>
**Try the new V2 interface (preview):** A simplified interface with `send()` and `stream()` patterns is now available, making multi-turn conversations easier. [Learn more about the TypeScript V2 preview](/docs/en/agent-sdk/typescript-v2-preview)
</Note>

## Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

## Functions

### `query()`

The primary function for interacting with Claude Code. Creates an async generator that streams messages as they arrive.

```typescript
function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query
```

#### Parameters

| Parameter | Type                                                             | Description                                                       |
| :-------- | :--------------------------------------------------------------- | :---------------------------------------------------------------- |
| `prompt`  | `string \| AsyncIterable<`[`SDKUserMessage`](#sdkusermessage)`>` | The input prompt as a string or async iterable for streaming mode |
| `options` | [`Options`](#options)                                            | Optional configuration object (see Options type below)            |

#### Returns

Returns a [`Query`](#query-object) object that extends `AsyncGenerator<`[`SDKMessage`](#sdkmessage)`, void>` with additional methods.

### `tool()`

Creates a type-safe MCP tool definition for use with SDK MCP servers.

```typescript
function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations }
): SdkMcpToolDefinition<Schema>
```

#### Parameters

| Parameter     | Type                                                              | Description                                                                                                |
| :------------ | :---------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                                                          | The name of the tool                                                                                       |
| `description` | `string`                                                          | A description of what the tool does                                                                        |
| `inputSchema` | `Schema extends AnyZodRawShape`                                   | Zod schema defining the tool's input parameters (supports both Zod 3 and Zod 4)                            |
| `handler`     | `(args, extra) => Promise<`[`CallToolResult`](#calltoolresult)`>` | Async function that executes the tool logic                                                                |
| `extras`      | `{ annotations?: ToolAnnotations }`                               | Optional extra configuration including MCP tool annotations (e.g., `readOnly`, `destructive`, `openWorld`) |

### `createSdkMcpServer()`

Creates an MCP server instance that runs in the same process as your application.

```typescript
function createSdkMcpServer(options: {
  name: string;
  version?: string;
  tools?: Array<SdkMcpToolDefinition<any>>;
}): McpSdkServerConfigWithInstance
```

#### Parameters

| Parameter         | Type                          | Description                                              |
| :---------------- | :---------------------------- | :------------------------------------------------------- |
| `options.name`    | `string`                      | The name of the MCP server                               |
| `options.version` | `string`                      | Optional version string                                  |
| `options.tools`   | `Array<SdkMcpToolDefinition>` | Array of tool definitions created with [`tool()`](#tool) |

### `listSessions()`

Discovers and lists past sessions with light metadata. Filter by project directory or list sessions across all projects.

```typescript
function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>
```

#### Parameters

| Parameter       | Type     | Default     | Description                                                                                                                                   |
| :-------------- | :------- | :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `options.dir`   | `string` | `undefined` | Directory to list sessions for. Returns sessions for this project (and its git worktrees). When omitted, returns sessions across all projects |
| `options.limit` | `number` | `undefined` | Maximum number of sessions to return                                                                                                          |

#### Return type: `SDKSessionInfo`

| Property       | Type                  | Description                                                          |
| :------------- | :-------------------- | :------------------------------------------------------------------- |
| `sessionId`    | `string`              | Unique session identifier (UUID)                                     |
| `summary`      | `string`              | Display title: custom title, auto-generated summary, or first prompt |
| `lastModified` | `number`              | Last modified time in milliseconds since epoch                       |
| `fileSize`     | `number`              | Session file size in bytes                                           |
| `customTitle`  | `string \| undefined` | User-set session title (via `/rename`)                               |
| `firstPrompt`  | `string \| undefined` | First meaningful user prompt in the session                          |
| `gitBranch`    | `string \| undefined` | Git branch at the end of the session                                 |
| `cwd`          | `string \| undefined` | Working directory for the session                                    |

#### Example

```typescript
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

// List sessions for a specific project
const sessions = await listSessions({ dir: "/path/to/project" });

for (const session of sessions) {
  console.log(`${session.summary} (${new Date(session.lastModified).toLocaleDateString()})`);
}

// List all sessions across all projects, limited to 10
const recent = await listSessions({ limit: 10 });
```

## Types

### `Options`

Configuration object for the `query()` function.

| Property                          | Type                                                                                              | Default                                     | Description                                                                                                                                                                                                                                               |
| :-------------------------------- | :------------------------------------------------------------------------------------------------ | :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abortController`                 | `AbortController`                                                                                 | `new AbortController()`                     | Controller for cancelling operations                                                                                                                                                                                                                      |
| `additionalDirectories`           | `string[]`                                                                                        | `[]`                                        | Additional directories Claude can access                                                                                                                                                                                                                  |
| `agent`                           | `string`                                                                                          | `undefined`                                 | Agent name for the main thread. The agent must be defined in the `agents` option or in settings                                                                                                                                                           |
| `agents`                          | `Record<string, [`AgentDefinition`](#agentdefinition)>`                                           | `undefined`                                 | Programmatically define subagents                                                                                                                                                                                                                         |
| `allowDangerouslySkipPermissions` | `boolean`                                                                                         | `false`                                     | Enable bypassing permissions. Required when using `permissionMode: 'bypassPermissions'`                                                                                                                                                                   |
| `allowedTools`                    | `string[]`                                                                                        | All tools                                   | List of allowed tool names                                                                                                                                                                                                                                |
| `betas`                           | [`SdkBeta`](#sdkbeta)`[]`                                                                         | `[]`                                        | Enable beta features (e.g., `['context-1m-2025-08-07']`)                                                                                                                                                                                                  |
| `canUseTool`                      | [`CanUseTool`](#canusetool)                                                                       | `undefined`                                 | Custom permission function for tool usage                                                                                                                                                                                                                 |
| `continue`                        | `boolean`                                                                                         | `false`                                     | Continue the most recent conversation                                                                                                                                                                                                                     |
| `cwd`                             | `string`                                                                                          | `process.cwd()`                             | Current working directory                                                                                                                                                                                                                                 |
| `debug`                           | `boolean`                                                                                         | `false`                                     | Enable debug mode for the Claude Code process                                                                                                                                                                                                             |
| `debugFile`                       | `string`                                                                                          | `undefined`                                 | Write debug logs to a specific file path. Implicitly enables debug mode                                                                                                                                                                                   |
| `disallowedTools`                 | `string[]`                                                                                        | `[]`                                        | List of disallowed tool names                                                                                                                                                                                                                             |
| `effort`                          | `'low' \| 'medium' \| 'high' \| 'max'`                                                            | `'high'`                                    | Controls how much effort Claude puts into its response. Works with adaptive thinking to guide thinking depth                                                                                                                                              |
| `enableFileCheckpointing`         | `boolean`                                                                                         | `false`                                     | Enable file change tracking for rewinding. See [File checkpointing](/docs/en/agent-sdk/file-checkpointing)                                                                                                                                                |
| `env`                             | `Record<string, string \| undefined>`                                                             | `process.env`                               | Environment variables. Set `CLAUDE_AGENT_SDK_CLIENT_APP` to identify your app in the User-Agent header                                                                                                                                                    |
| `executable`                      | `'bun' \| 'deno' \| 'node'`                                                                       | Auto-detected                               | JavaScript runtime to use                                                                                                                                                                                                                                 |
| `executableArgs`                  | `string[]`                                                                                        | `[]`                                        | Arguments to pass to the executable                                                                                                                                                                                                                       |
| `extraArgs`                       | `Record<string, string \| null>`                                                                  | `{}`                                        | Additional arguments                                                                                                                                                                                                                                      |
| `fallbackModel`                   | `string`                                                                                          | `undefined`                                 | Model to use if primary fails                                                                                                                                                                                                                             |
| `forkSession`                     | `boolean`                                                                                         | `false`                                     | When resuming with `resume`, fork to a new session ID instead of continuing the original session                                                                                                                                                          |
| `hooks`                           | `Partial<Record<`[`HookEvent`](#hookevent)`, `[`HookCallbackMatcher`](#hookcallbackmatcher)`[]>>` | `{}`                                        | Hook callbacks for events                                                                                                                                                                                                                                 |
| `includePartialMessages`          | `boolean`                                                                                         | `false`                                     | Include partial message events                                                                                                                                                                                                                            |
| `maxBudgetUsd`                    | `number`                                                                                          | `undefined`                                 | Maximum budget in USD for the query                                                                                                                                                                                                                       |
| `maxThinkingTokens`               | `number`                                                                                          | `undefined`                                 | _Deprecated:_ Use `thinking` instead. Maximum tokens for thinking process                                                                                                                                                                                 |
| `maxTurns`                        | `number`                                                                                          | `undefined`                                 | Maximum conversation turns                                                                                                                                                                                                                                |
| `mcpServers`                      | `Record<string, [`McpServerConfig`](#mcpserverconfig)>`                                           | `{}`                                        | MCP server configurations                                                                                                                                                                                                                                 |
| `model`                           | `string`                                                                                          | Default from CLI                            | Claude model to use                                                                                                                                                                                                                                       |
| `outputFormat`                    | `{ type: 'json_schema', schema: JSONSchema }`                                                     | `undefined`                                 | Define output format for agent results. See [Structured outputs](/docs/en/agent-sdk/structured-outputs) for details                                                                                                                                       |
| `pathToClaudeCodeExecutable`      | `string`                                                                                          | Uses built-in executable                    | Path to Claude Code executable                                                                                                                                                                                                                            |
| `permissionMode`                  | [`PermissionMode`](#permissionmode)                                                               | `'default'`                                 | Permission mode for the session                                                                                                                                                                                                                           |
| `permissionPromptToolName`        | `string`                                                                                          | `undefined`                                 | MCP tool name for permission prompts                                                                                                                                                                                                                      |
| `persistSession`                  | `boolean`                                                                                         | `true`                                      | When `false`, disables session persistence to disk. Sessions cannot be resumed later                                                                                                                                                                      |
| `plugins`                         | [`SdkPluginConfig`](#sdkpluginconfig)`[]`                                                         | `[]`                                        | Load custom plugins from local paths. See [Plugins](/docs/en/agent-sdk/plugins) for details                                                                                                                                                               |
| `promptSuggestions`               | `boolean`                                                                                         | `false`                                     | Enable prompt suggestions. Emits a `prompt_suggestion` message after each turn with a predicted next user prompt                                                                                                                                          |
| `resume`                          | `string`                                                                                          | `undefined`                                 | Session ID to resume                                                                                                                                                                                                                                      |
| `resumeSessionAt`                 | `string`                                                                                          | `undefined`                                 | Resume session at a specific message UUID                                                                                                                                                                                                                 |
| `sandbox`                         | [`SandboxSettings`](#sandboxsettings)                                                             | `undefined`                                 | Configure sandbox behavior programmatically. See [Sandbox settings](#sandboxsettings) for details                                                                                                                                                         |
| `sessionId`                       | `string`                                                                                          | Auto-generated                              | Use a specific UUID for the session instead of auto-generating one                                                                                                                                                                                        |
| `settingSources`                  | [`SettingSource`](#setting-source)`[]`                                                            | `[]` (no settings)                          | Control which filesystem settings to load. When omitted, no settings are loaded. **Note:** Must include `'project'` to load CLAUDE.md files                                                                                                               |
| `spawnClaudeCodeProcess`          | `(options: SpawnOptions) => SpawnedProcess`                                                       | `undefined`                                 | Custom function to spawn the Claude Code process. Use to run Claude Code in VMs, containers, or remote environments                                                                                                                                       |
| `stderr`                          | `(data: string) => void`                                                                          | `undefined`                                 | Callback for stderr output                                                                                                                                                                                                                                |
| `strictMcpConfig`                 | `boolean`                                                                                         | `false`                                     | Enforce strict MCP validation                                                                                                                                                                                                                             |
| `systemPrompt`                    | `string \| { type: 'preset'; preset: 'claude_code'; append?: string }`                            | `undefined` (minimal prompt)                | System prompt configuration. Pass a string for custom prompt, or `{ type: 'preset', preset: 'claude_code' }` to use Claude Code's system prompt. When using the preset object form, add `append` to extend the system prompt with additional instructions |
| `thinking`                        | [`ThinkingConfig`](#thinkingconfig)                                                               | `{ type: 'adaptive' }` for supported models | Controls Claude's thinking/reasoning behavior. See [`ThinkingConfig`](#thinkingconfig) for options                                                                                                                                                        |
| `tools`                           | `string[] \| { type: 'preset'; preset: 'claude_code' }`                                           | `undefined`                                 | Tool configuration. Pass an array of tool names or use the preset to get Claude Code's default tools                                                                                                                                                      |

### `Query` object

Interface returned by the `query()` function.

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean }
  ): Promise<RewindFilesResult>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  initializationResult(): Promise<SDKControlInitializeResponse>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
  reconnectMcpServer(serverName: string): Promise<void>;
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  close(): void;
}
```

#### Methods

| Method                                 | Description                                                                                                                                                                                                        |
| :------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interrupt()`                          | Interrupts the query (only available in streaming input mode)                                                                                                                                                      |
| `rewindFiles(userMessageId, options?)` | Restores files to their state at the specified user message. Pass `{ dryRun: true }` to preview changes. Requires `enableFileCheckpointing: true`. See [File checkpointing](/docs/en/agent-sdk/file-checkpointing) |
| `setPermissionMode()`                  | Changes the permission mode (only available in streaming input mode)                                                                                                                                               |
| `setModel()`                           | Changes the model (only available in streaming input mode)                                                                                                                                                         |
| `setMaxThinkingTokens()`               | _Deprecated:_ Use the `thinking` option instead. Changes the maximum thinking tokens                                                                                                                               |
| `initializationResult()`               | Returns the full initialization result including supported commands, models, account info, and output style configuration                                                                                          |
| `supportedCommands()`                  | Returns available slash commands                                                                                                                                                                                   |
| `supportedModels()`                    | Returns available models with display info                                                                                                                                                                         |
| `mcpServerStatus()`                    | Returns status of connected MCP servers                                                                                                                                                                            |
| `accountInfo()`                        | Returns account information                                                                                                                                                                                        |
| `reconnectMcpServer(serverName)`       | Reconnect an MCP server by name                                                                                                                                                                                    |
| `toggleMcpServer(serverName, enabled)` | Enable or disable an MCP server by name                                                                                                                                                                            |
| `setMcpServers(servers)`               | Dynamically replace the set of MCP servers for this session. Returns info about which servers were added, removed, and any errors                                                                                  |
| `streamInput(stream)`                  | Stream input messages to the query for multi-turn conversations                                                                                                                                                    |
| `stopTask(taskId)`                     | Stop a running background task by ID                                                                                                                                                                               |
| `close()`                              | Close the query and terminate the underlying process. Forcefully ends the query and cleans up all resources                                                                                                        |

### `SDKControlInitializeResponse`

Return type of `initializationResult()`. Contains session initialization data.

```typescript
type SDKControlInitializeResponse = {
  commands: SlashCommand[];
  output_style: string;
  available_output_styles: string[];
  models: ModelInfo[];
  account: AccountInfo;
}
```

### `AgentDefinition`

Configuration for a subagent defined programmatically.

```typescript
type AgentDefinition = {
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  prompt: string;
  model?: "sonnet" | "opus" | "haiku" | "inherit";
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];
  maxTurns?: number;
  criticalSystemReminder_EXPERIMENTAL?: string;
}
```

| Field                                 | Required | Description                                                                   |
| :------------------------------------ | :------- | :---------------------------------------------------------------------------- |
| `description`                         | Yes      | Natural language description of when to use this agent                        |
| `tools`                               | No       | Array of allowed tool names. If omitted, inherits all tools from parent       |
| `disallowedTools`                     | No       | Array of tool names to explicitly disallow for this agent                     |
| `prompt`                              | Yes      | The agent's system prompt                                                     |
| `model`                               | No       | Model override for this agent. If omitted or `'inherit'`, uses the main model |
| `mcpServers`                          | No       | MCP server specifications for this agent                                      |
| `skills`                              | No       | Array of skill names to preload into the agent context                        |
| `maxTurns`                            | No       | Maximum number of agentic turns (API round-trips) before stopping             |
| `criticalSystemReminder_EXPERIMENTAL` | No       | Experimental: Critical reminder added to the system prompt                    |

### `AgentMcpServerSpec`

Specifies MCP servers available to a subagent. Can be a server name (string referencing a server from the parent's `mcpServers` config) or an inline server configuration record mapping server names to configs.

```typescript
type AgentMcpServerSpec = string | Record<string, McpServerConfigForProcessTransport>;
```

Where `McpServerConfigForProcessTransport` is `McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig`.

### `SettingSource`

Controls which filesystem-based configuration sources the SDK loads settings from.

```typescript
type SettingSource = "user" | "project" | "local";
```

| Value       | Description                                  | Location                      |
| :---------- | :------------------------------------------- | :---------------------------- |
| `'user'`    | Global user settings                         | `~/.claude/settings.json`     |
| `'project'` | Shared project settings (version controlled) | `.claude/settings.json`       |
| `'local'`   | Local project settings (gitignored)          | `.claude/settings.local.json` |

#### Default behavior

When `settingSources` is **omitted** or **undefined**, the SDK does **not** load any filesystem settings. This provides isolation for SDK applications.

#### Why use settingSources

**Load all filesystem settings (legacy behavior):**
```typescript
// Load all settings like SDK v0.0.x did
const result = query({
  prompt: "Analyze this code",
  options: {
    settingSources: ["user", "project", "local"] // Load all settings
  }
});
```

**Load only specific setting sources:**
```typescript
// Load only project settings, ignore user and local
const result = query({
  prompt: "Run CI checks",
  options: {
    settingSources: ["project"] // Only .claude/settings.json
  }
});
```

**Testing and CI environments:**
```typescript
// Ensure consistent behavior in CI by excluding local settings
const result = query({
  prompt: "Run tests",
  options: {
    settingSources: ["project"], // Only team-shared settings
    permissionMode: "bypassPermissions"
  }
});
```

**SDK-only applications:**
```typescript
// Define everything programmatically (default behavior)
// No filesystem dependencies - settingSources defaults to []
const result = query({
  prompt: "Review this PR",
  options: {
    // settingSources: [] is the default, no need to specify
    agents: { /* ... */ },
    mcpServers: { /* ... */ },
    allowedTools: ["Read", "Grep", "Glob"]
  }
});
```

**Loading CLAUDE.md project instructions:**
```typescript
// Load project settings to include CLAUDE.md files
const result = query({
  prompt: "Add a new feature following project conventions",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code" // Required to use CLAUDE.md
    },
    settingSources: ["project"], // Loads CLAUDE.md from project directory
    allowedTools: ["Read", "Write", "Edit"]
  }
});
```

#### Settings precedence

When multiple sources are loaded, settings are merged with this precedence (highest to lowest):
1. Local settings (`.claude/settings.local.json`)
2. Project settings (`.claude/settings.json`)
3. User settings (`~/.claude/settings.json`)

Programmatic options (like `agents`, `allowedTools`) always override filesystem settings.

### `PermissionMode`

```typescript
type PermissionMode =
  | "default" // Standard permission behavior
  | "acceptEdits" // Auto-accept file edits
  | "bypassPermissions" // Bypass all permission checks
  | "plan" // Planning mode - no execution
  | "dontAsk" // Don't prompt for permissions, deny if not pre-approved
```

### `CanUseTool`

Custom permission function type for controlling tool usage.

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;
```

| Option           | Type                                        | Description                                                                  |
| :--------------- | :------------------------------------------ | :--------------------------------------------------------------------------- |
| `signal`         | `AbortSignal`                               | Signaled if the operation should be aborted                                  |
| `suggestions`    | [`PermissionUpdate`](#permissionupdate)`[]` | Suggested permission updates so the user is not prompted again for this tool |
| `blockedPath`    | `string`                                    | The file path that triggered the permission request, if applicable           |
| `decisionReason` | `string`                                    | Explains why this permission request was triggered                           |
| `toolUseID`      | `string`                                    | Unique identifier for this specific tool call within the assistant message   |
| `agentID`        | `string`                                    | If running within a sub-agent, the sub-agent's ID                            |

### `PermissionResult`

Result of a permission check.

```typescript
type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    }
```

### `McpServerConfig`

Configuration for MCP servers.

```typescript
type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfigWithInstance;
```

#### `McpStdioServerConfig`

```typescript
type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
```

#### `McpSSEServerConfig`

```typescript
type McpSSEServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}
```

#### `McpHttpServerConfig`

```typescript
type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}
```

#### `McpSdkServerConfigWithInstance`

```typescript
type McpSdkServerConfigWithInstance = {
  type: "sdk";
  name: string;
  instance: McpServer;
}
```

#### `McpClaudeAIProxyServerConfig`

```typescript
type McpClaudeAIProxyServerConfig = {
  type: "claudeai-proxy";
  url: string;
  id: string;
}
```

### `SdkPluginConfig`

Configuration for loading plugins in the SDK.

```typescript
type SdkPluginConfig = {
  type: "local";
  path: string;
}
```

| Field  | Type      | Description                                                |
| :----- | :-------- | :--------------------------------------------------------- |
| `type` | `'local'` | Must be `'local'` (only local plugins currently supported) |
| `path` | `string`  | Absolute or relative path to the plugin directory          |

**Example:**
```typescript
plugins: [
  { type: "local", path: "./my-plugin" },
  { type: "local", path: "/absolute/path/to/plugin" }
];
```

For complete information on creating and using plugins, see [Plugins](/docs/en/agent-sdk/plugins).

## Message Types

### `SDKMessage`

Union type of all possible messages returned by the query.

```typescript
type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage
  | SDKStatusMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
  | SDKRateLimitEvent
  | SDKPromptSuggestionMessage;
```

### `SDKAssistantMessage`

Assistant response message.

```typescript
type SDKAssistantMessage = {
  type: "assistant";
  uuid: UUID;
  session_id: string;
  message: BetaMessage; // From Anthropic SDK
  parent_tool_use_id: string | null;
  error?: SDKAssistantMessageError;
};
```

The `message` field is a [`BetaMessage`](/docs/en/api/messages) from the Anthropic SDK. It includes fields like `id`, `content`, `model`, `stop_reason`, and `usage`.

`SDKAssistantMessageError` is one of: `'authentication_failed'`, `'billing_error'`, `'rate_limit'`, `'invalid_request'`, `'server_error'`, or `'unknown'`.

### `SDKUserMessage`

User input message.

```typescript
type SDKUserMessage = {
  type: "user";
  uuid?: UUID;
  session_id: string;
  message: MessageParam; // From Anthropic SDK
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
}
```

### `SDKUserMessageReplay`

Replayed user message with required UUID.

```typescript
type SDKUserMessageReplay = {
  type: "user";
  uuid: UUID;
  session_id: string;
  message: MessageParam;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
  isReplay: true;
}
```

### `SDKResultMessage`

Final result message.

```typescript
type SDKResultMessage =
  | {
      type: "result";
      subtype: "success";
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      result: string;
      stop_reason: string | null;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: { [modelName: string]: ModelUsage };
      permission_denials: SDKPermissionDenial[];
      structured_output?: unknown;
    }
  | {
      type: "result";
      subtype:
        | "error_max_turns"
        | "error_during_execution"
        | "error_max_budget_usd"
        | "error_max_structured_output_retries";
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      stop_reason: string | null;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: { [modelName: string]: ModelUsage };
      permission_denials: SDKPermissionDenial[];
      errors: string[];
    }
```

### `SDKSystemMessage`

System initialization message.

```typescript
type SDKSystemMessage = {
  type: "system";
  subtype: "init";
  uuid: UUID;
  session_id: string;
  agents?: string[];
  apiKeySource: ApiKeySource;
  betas?: string[];
  claude_code_version: string;
  cwd: string;
  tools: string[];
  mcp_servers: {
    name: string;
    status: string;
  }[];
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
  skills: string[];
  plugins: { name: string; path: string }[];
}
```

### `SDKPartialAssistantMessage`

Streaming partial message (only when `includePartialMessages` is true).

```typescript
type SDKPartialAssistantMessage = {
  type: "stream_event";
  event: BetaRawMessageStreamEvent; // From Anthropic SDK
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
}
```

### `SDKCompactBoundaryMessage`

Message indicating a conversation compaction boundary.

```typescript
type SDKCompactBoundaryMessage = {
  type: "system";
  subtype: "compact_boundary";
  uuid: UUID;
  session_id: string;
  compact_metadata: {
    trigger: "manual" | "auto";
    pre_tokens: number;
  };
}
```

### `SDKPermissionDenial`

Information about a denied tool use.

```typescript
type SDKPermissionDenial = {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}
```

## Hook Types

For a comprehensive guide on using hooks with examples and common patterns, see the [Hooks guide](/docs/en/agent-sdk/hooks).

### `HookEvent`

Available hook events.

```typescript
type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Notification"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PermissionRequest"
  | "Setup"
  | "TeammateIdle"
  | "TaskCompleted"
  | "ConfigChange"
  | "WorktreeCreate"
  | "WorktreeRemove";
```

### `HookCallback`

Hook callback function type.

```typescript
type HookCallback = (
  input: HookInput, // Union of all hook input types
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;
```

### `HookCallbackMatcher`

Hook configuration with optional matcher.

```typescript
interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number; // Timeout in seconds for all hooks in this matcher
}
```

### `HookInput`

Union type of all hook input types.

```typescript
type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | NotificationHookInput
  | UserPromptSubmitHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PermissionRequestHookInput
  | SetupHookInput
  | TeammateIdleHookInput
  | TaskCompletedHookInput
  | ConfigChangeHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput;
```

### `BaseHookInput`

Base interface that all hook input types extend.

```typescript
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
}
```

#### `PreToolUseHookInput`

```typescript
type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
}
```

#### `PostToolUseHookInput`

```typescript
type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id: string;
}
```

#### `PostToolUseFailureHookInput`

```typescript
type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
}
```

#### `NotificationHookInput`

```typescript
type NotificationHookInput = BaseHookInput & {
  hook_event_name: "Notification";
  message: string;
  title?: string;
  notification_type: string;
}
```

#### `UserPromptSubmitHookInput`

```typescript
type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}
```

#### `SessionStartHookInput`

```typescript
type SessionStartHookInput = BaseHookInput & {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear" | "compact";
  agent_type?: string;
  model?: string;
}
```

#### `SessionEndHookInput`

```typescript
type SessionEndHookInput = BaseHookInput & {
  hook_event_name: "SessionEnd";
  reason: ExitReason; // String from EXIT_REASONS array
}
```

#### `StopHookInput`

```typescript
type StopHookInput = BaseHookInput & {
  hook_event_name: "Stop";
  stop_hook_active: boolean;
  last_assistant_message?: string;
}
```

#### `SubagentStartHookInput`

```typescript
type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
}
```

#### `SubagentStopHookInput`

```typescript
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: "SubagentStop";
  stop_hook_active: boolean;
  agent_id: string;
  agent_transcript_path: string;
  agent_type: string;
  last_assistant_message?: string;
}
```

#### `PreCompactHookInput`

```typescript
type PreCompactHookInput = BaseHookInput & {
  hook_event_name: "PreCompact";
  trigger: "manual" | "auto";
  custom_instructions: string | null;
}
```

#### `PermissionRequestHookInput`

```typescript
type PermissionRequestHookInput = BaseHookInput & {
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input: unknown;
  permission_suggestions?: PermissionUpdate[];
}
```

#### `SetupHookInput`

```typescript
type SetupHookInput = BaseHookInput & {
  hook_event_name: "Setup";
  trigger: "init" | "maintenance";
}
```

#### `TeammateIdleHookInput`

```typescript
type TeammateIdleHookInput = BaseHookInput & {
  hook_event_name: "TeammateIdle";
  teammate_name: string;
  team_name: string;
}
```

#### `TaskCompletedHookInput`

```typescript
type TaskCompletedHookInput = BaseHookInput & {
  hook_event_name: "TaskCompleted";
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}
```

#### `ConfigChangeHookInput`

```typescript
type ConfigChangeHookInput = BaseHookInput & {
  hook_event_name: "ConfigChange";
  source: "user_settings" | "project_settings" | "local_settings" | "policy_settings" | "skills";
  file_path?: string;
}
```

#### `WorktreeCreateHookInput`

```typescript
type WorktreeCreateHookInput = BaseHookInput & {
  hook_event_name: "WorktreeCreate";
  name: string;
}
```

#### `WorktreeRemoveHookInput`

```typescript
type WorktreeRemoveHookInput = BaseHookInput & {
  hook_event_name: "WorktreeRemove";
  worktree_path: string;
}
```

### `HookJSONOutput`

Hook return value.

```typescript
type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput;
```

#### `AsyncHookJSONOutput`

```typescript
type AsyncHookJSONOutput = {
  async: true;
  asyncTimeout?: number;
}
```

#### `SyncHookJSONOutput`

```typescript
type SyncHookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: "approve" | "block";
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?:
    | {
        hookEventName: "PreToolUse";
        permissionDecision?: "allow" | "deny" | "ask";
        permissionDecisionReason?: string;
        updatedInput?: Record<string, unknown>;
        additionalContext?: string;
      }
    | {
        hookEventName: "UserPromptSubmit";
        additionalContext?: string;
      }
    | {
        hookEventName: "SessionStart";
        additionalContext?: string;
      }
    | {
        hookEventName: "Setup";
        additionalContext?: string;
      }
    | {
        hookEventName: "SubagentStart";
        additionalContext?: string;
      }
    | {
        hookEventName: "PostToolUse";
        additionalContext?: string;
        updatedMCPToolOutput?: unknown;
      }
    | {
        hookEventName: "PostToolUseFailure";
        additionalContext?: string;
      }
    | {
        hookEventName: "Notification";
        additionalContext?: string;
      }
    | {
        hookEventName: "PermissionRequest";
        decision: {
          behavior: "allow";
          updatedInput?: Record<string, unknown>;
          updatedPermissions?: PermissionUpdate[];
        } | {
          behavior: "deny";
          message?: string;
          interrupt?: boolean;
        };
      };
}
```

## Tool Input Types

Documentation of input schemas for all built-in Claude Code tools. These types are exported from `@anthropic-ai/claude-agent-sdk` and can be used for type-safe tool interactions.

### `ToolInputSchemas`

Union of all tool input types, exported from `@anthropic-ai/claude-agent-sdk`.

```typescript
type ToolInputSchemas =
  | AgentInput
  | AskUserQuestionInput
  | BashInput
  | TaskOutputInput
  | ConfigInput
  | EnterWorktreeInput
  | ExitPlanModeInput
  | FileEditInput
  | FileReadInput
  | FileWriteInput
  | GlobInput
  | GrepInput
  | ListMcpResourcesInput
  | McpInput
  | NotebookEditInput
  | ReadMcpResourceInput
  | SubscribeMcpResourceInput
  | SubscribePollingInput
  | TaskStopInput
  | TodoWriteInput
  | UnsubscribeMcpResourceInput
  | UnsubscribePollingInput
  | WebFetchInput
  | WebSearchInput;
```

### Task

**Tool name:** `Task`

```typescript
type AgentInput = {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: "sonnet" | "opus" | "haiku";
  resume?: string;
  run_in_background?: boolean;
  max_turns?: number;
  name?: string;
  team_name?: string;
  mode?: "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan";
  isolation?: "worktree";
}
```

Launches a new agent to handle complex, multi-step tasks autonomously.

### AskUserQuestion

**Tool name:** `AskUserQuestion`

```typescript
type AskUserQuestionInput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}
```

Asks the user clarifying questions during execution. See [Handle approvals and user input](/docs/en/agent-sdk/user-input#handle-clarifying-questions) for usage details.

### Bash

**Tool name:** `Bash`

```typescript
type BashInput = {
  command: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
  dangerouslyDisableSandbox?: boolean;
}
```

Executes bash commands in a persistent shell session with optional timeout and background execution.

### TaskOutput

**Tool name:** `TaskOutput`

```typescript
type TaskOutputInput = {
  task_id: string;
  block: boolean;
  timeout: number;
}
```

Retrieves output from a running or completed background task.

### Edit

**Tool name:** `Edit`

```typescript
type FileEditInput = {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}
```

Performs exact string replacements in files.

### Read

**Tool name:** `Read`

```typescript
type FileReadInput = {
  file_path: string;
  offset?: number;
  limit?: number;
  pages?: string;
}
```

Reads files from the local filesystem, including text, images, PDFs, and Jupyter notebooks. Use `pages` for PDF page ranges (for example, `"1-5"`).

### Write

**Tool name:** `Write`

```typescript
type FileWriteInput = {
  file_path: string;
  content: string;
}
```

Writes a file to the local filesystem, overwriting if it exists.

### Glob

**Tool name:** `Glob`

```typescript
type GlobInput = {
  pattern: string;
  path?: string;
}
```

Fast file pattern matching that works with any codebase size.

### Grep

**Tool name:** `Grep`

```typescript
type GrepInput = {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  "-i"?: boolean;
  "-n"?: boolean;
  "-B"?: number;
  "-A"?: number;
  "-C"?: number;
  context?: number;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
}
```

Powerful search tool built on ripgrep with regex support.

### TaskStop

**Tool name:** `TaskStop`

```typescript
type TaskStopInput = {
  task_id?: string;
  shell_id?: string; // Deprecated: use task_id
}
```

Stops a running background task or shell by ID.

### NotebookEdit

**Tool name:** `NotebookEdit`

```typescript
type NotebookEditInput = {
  notebook_path: string;
  cell_id?: string;
  new_source: string;
  cell_type?: "code" | "markdown";
  edit_mode?: "replace" | "insert" | "delete";
}
```

Edits cells in Jupyter notebook files.

### WebFetch

**Tool name:** `WebFetch`

```typescript
type WebFetchInput = {
  url: string;
  prompt: string;
}
```

Fetches content from a URL and processes it with an AI model.

### WebSearch

**Tool name:** `WebSearch`

```typescript
type WebSearchInput = {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}
```

Searches the web and returns formatted results.

### TodoWrite

**Tool name:** `TodoWrite`

```typescript
type TodoWriteInput = {
  todos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }>;
}
```

Creates and manages a structured task list for tracking progress.

### ExitPlanMode

**Tool name:** `ExitPlanMode`

```typescript
type ExitPlanModeInput = {
  allowedPrompts?: Array<{
    tool: "Bash";
    prompt: string;
  }>;
}
```

Exits planning mode. Optionally specifies prompt-based permissions needed to implement the plan.

### ListMcpResources

**Tool name:** `ListMcpResources`

```typescript
type ListMcpResourcesInput = {
  server?: string;
}
```

Lists available MCP resources from connected servers.

### ReadMcpResource

**Tool name:** `ReadMcpResource`

```typescript
type ReadMcpResourceInput = {
  server: string;
  uri: string;
}
```

Reads a specific MCP resource from a server.

### Config

**Tool name:** `Config`

```typescript
type ConfigInput = {
  setting: string;
  value?: string | boolean | number;
}
```

Gets or sets a configuration value.

### EnterWorktree

**Tool name:** `EnterWorktree`

```typescript
type EnterWorktreeInput = {
  name?: string;
}
```

Creates and enters a temporary git worktree for isolated work.

## Tool Output Types

Documentation of output schemas for all built-in Claude Code tools. These types are exported from `@anthropic-ai/claude-agent-sdk` and represent the actual response data returned by each tool.

### `ToolOutputSchemas`

Union of all tool output types.

```typescript
type ToolOutputSchemas =
  | AgentOutput
  | AskUserQuestionOutput
  | BashOutput
  | ConfigOutput
  | EnterWorktreeOutput
  | ExitPlanModeOutput
  | FileEditOutput
  | FileReadOutput
  | FileWriteOutput
  | GlobOutput
  | GrepOutput
  | ListMcpResourcesOutput
  | NotebookEditOutput
  | ReadMcpResourceOutput
  | TaskStopOutput
  | TodoWriteOutput
  | WebFetchOutput
  | WebSearchOutput;
```

### Task

**Tool name:** `Task`

```typescript
type AgentOutput =
  | {
      status: "completed";
      agentId: string;
      content: Array<{ type: "text"; text: string }>;
      totalToolUseCount: number;
      totalDurationMs: number;
      totalTokens: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number | null;
        cache_read_input_tokens: number | null;
        server_tool_use: {
          web_search_requests: number;
          web_fetch_requests: number;
        } | null;
        service_tier: ("standard" | "priority" | "batch") | null;
        cache_creation: {
          ephemeral_1h_input_tokens: number;
          ephemeral_5m_input_tokens: number;
        } | null;
      };
      prompt: string;
    }
  | {
      status: "async_launched";
      agentId: string;
      description: string;
      prompt: string;
      outputFile: string;
      canReadOutputFile?: boolean;
    }
  | {
      status: "sub_agent_entered";
      description: string;
      message: string;
    };
```

Returns the result from the subagent. Discriminated on the `status` field: `"completed"` for finished tasks, `"async_launched"` for background tasks, and `"sub_agent_entered"` for interactive subagents.

### AskUserQuestion

**Tool name:** `AskUserQuestion`

```typescript
type AskUserQuestionOutput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
  answers: Record<string, string>;
}
```

Returns the questions asked and the user's answers.

### Bash

**Tool name:** `Bash`

```typescript
type BashOutput = {
  stdout: string;
  stderr: string;
  rawOutputPath?: string;
  interrupted: boolean;
  isImage?: boolean;
  backgroundTaskId?: string;
  backgroundedByUser?: boolean;
  dangerouslyDisableSandbox?: boolean;
  returnCodeInterpretation?: string;
  structuredContent?: unknown[];
  persistedOutputPath?: string;
  persistedOutputSize?: number;
}
```

Returns command output with stdout/stderr split. Background commands include a `backgroundTaskId`.

### Edit

**Tool name:** `Edit`

```typescript
type FileEditOutput = {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string;
  structuredPatch: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
  userModified: boolean;
  replaceAll: boolean;
  gitDiff?: {
    filename: string;
    status: "modified" | "added";
    additions: number;
    deletions: number;
    changes: number;
    patch: string;
  };
}
```

Returns the structured diff of the edit operation.

### Read

**Tool name:** `Read`

```typescript
type FileReadOutput =
  | {
      type: "text";
      file: {
        filePath: string;
        content: string;
        numLines: number;
        startLine: number;
        totalLines: number;
      };
    }
  | {
      type: "image";
      file: {
        base64: string;
        type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        originalSize: number;
        dimensions?: {
          originalWidth?: number;
          originalHeight?: number;
          displayWidth?: number;
          displayHeight?: number;
        };
      };
    }
  | {
      type: "notebook";
      file: {
        filePath: string;
        cells: unknown[];
      };
    }
  | {
      type: "pdf";
      file: {
        filePath: string;
        base64: string;
        originalSize: number;
      };
    }
  | {
      type: "parts";
      file: {
        filePath: string;
        originalSize: number;
        count: number;
        outputDir: string;
      };
    };
```

Returns file contents in a format appropriate to the file type. Discriminated on the `type` field.

### Write

**Tool name:** `Write`

```typescript
type FileWriteOutput = {
  type: "create" | "update";
  filePath: string;
  content: string;
  structuredPatch: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
  originalFile: string | null;
  gitDiff?: {
    filename: string;
    status: "modified" | "added";
    additions: number;
    deletions: number;
    changes: number;
    patch: string;
  };
}
```

Returns the write result with structured diff information.

### Glob

**Tool name:** `Glob`

```typescript
type GlobOutput = {
  durationMs: number;
  numFiles: number;
  filenames: string[];
  truncated: boolean;
}
```

Returns file paths matching the glob pattern, sorted by modification time.

### Grep

**Tool name:** `Grep`

```typescript
type GrepOutput = {
  mode?: "content" | "files_with_matches" | "count";
  numFiles: number;
  filenames: string[];
  content?: string;
  numLines?: number;
  numMatches?: number;
  appliedLimit?: number;
  appliedOffset?: number;
}
```

Returns search results. The shape varies by `mode`: file list, content with matches, or match counts.

### TaskStop

**Tool name:** `TaskStop`

```typescript
type TaskStopOutput = {
  message: string;
  task_id: string;
  task_type: string;
  command?: string;
}
```

Returns confirmation after stopping the background task.

### NotebookEdit

**Tool name:** `NotebookEdit`

```typescript
type NotebookEditOutput = {
  new_source: string;
  cell_id?: string;
  cell_type: "code" | "markdown";
  language: string;
  edit_mode: string;
  error?: string;
  notebook_path: string;
  original_file: string;
  updated_file: string;
}
```

Returns the result of the notebook edit with original and updated file contents.

### WebFetch

**Tool name:** `WebFetch`

```typescript
type WebFetchOutput = {
  bytes: number;
  code: number;
  codeText: string;
  result: string;
  durationMs: number;
  url: string;
}
```

Returns the fetched content with HTTP status and metadata.

### WebSearch

**Tool name:** `WebSearch`

```typescript
type WebSearchOutput = {
  query: string;
  results: Array<
    | {
        tool_use_id: string;
        content: Array<{ title: string; url: string }>;
      }
    | string
  >;
  durationSeconds: number;
}
```

Returns search results from the web.

### TodoWrite

**Tool name:** `TodoWrite`

```typescript
type TodoWriteOutput = {
  oldTodos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }>;
  newTodos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }>;
}
```

Returns the previous and updated task lists.

### ExitPlanMode

**Tool name:** `ExitPlanMode`

```typescript
type ExitPlanModeOutput = {
  plan: string | null;
  isAgent: boolean;
  filePath?: string;
  hasTaskTool?: boolean;
  awaitingLeaderApproval?: boolean;
  requestId?: string;
}
```

Returns the plan state after exiting plan mode.

### ListMcpResources

**Tool name:** `ListMcpResources`

```typescript
type ListMcpResourcesOutput = Array<{
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  server: string;
}>;
```

Returns an array of available MCP resources.

### ReadMcpResource

**Tool name:** `ReadMcpResource`

```typescript
type ReadMcpResourceOutput = {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
  }>;
}
```

Returns the contents of the requested MCP resource.

### Config

**Tool name:** `Config`

```typescript
type ConfigOutput = {
  success: boolean;
  operation?: "get" | "set";
  setting?: string;
  value?: unknown;
  previousValue?: unknown;
  newValue?: unknown;
  error?: string;
}
```

Returns the result of a configuration get or set operation.

### EnterWorktree

**Tool name:** `EnterWorktree`

```typescript
type EnterWorktreeOutput = {
  worktreePath: string;
  worktreeBranch?: string;
  message: string;
}
```

Returns information about the created git worktree.

## Permission Types

### `PermissionUpdate`

Operations for updating permissions.

```typescript
type PermissionUpdate =
  | {
      type: "addRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "replaceRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "removeRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "setMode";
      mode: PermissionMode;
      destination: PermissionUpdateDestination;
    }
  | {
      type: "addDirectories";
      directories: string[];
      destination: PermissionUpdateDestination;
    }
  | {
      type: "removeDirectories";
      directories: string[];
      destination: PermissionUpdateDestination;
    }
```

### `PermissionBehavior`

```typescript
type PermissionBehavior = "allow" | "deny" | "ask";
```

### `PermissionUpdateDestination`

```typescript
type PermissionUpdateDestination =
  | "userSettings" // Global user settings
  | "projectSettings" // Per-directory project settings
  | "localSettings" // Gitignored local settings
  | "session" // Current session only
  | "cliArg" // CLI argument
```

### `PermissionRuleValue`

```typescript
type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
}
```

## Other Types

### `ApiKeySource`

```typescript
type ApiKeySource = "user" | "project" | "org" | "temporary" | "oauth";
```

### `SdkBeta`

Available beta features that can be enabled via the `betas` option. See [Beta headers](/docs/en/api/beta-headers) for more information.

```typescript
type SdkBeta = "context-1m-2025-08-07";
```

| Value                     | Description                                                                          | Compatible Models                                   |
| :------------------------ | :----------------------------------------------------------------------------------- | :-------------------------------------------------- |
| `'context-1m-2025-08-07'` | Enables 1 million token [context window](/docs/en/build-with-claude/context-windows) | Claude Opus 4.6, Claude Sonnet 4.5, Claude Sonnet 4 |

### `SlashCommand`

Information about an available slash command.

```typescript
type SlashCommand = {
  name: string;
  description: string;
  argumentHint: string;
}
```

### `ModelInfo`

Information about an available model.

```typescript
type ModelInfo = {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: ("low" | "medium" | "high" | "max")[];
  supportsAdaptiveThinking?: boolean;
}
```

### `McpServerStatus`

Status of a connected MCP server.

```typescript
type McpServerStatus = {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  serverInfo?: {
    name: string;
    version: string;
  };
  error?: string;
  config?: McpServerStatusConfig;
  scope?: string;
  tools?: {
    name: string;
    description?: string;
    annotations?: {
      readOnly?: boolean;
      destructive?: boolean;
      openWorld?: boolean;
    };
  }[];
}
```

### `McpServerStatusConfig`

The configuration of an MCP server as reported by `mcpServerStatus()`. This is the union of all MCP server transport types.

```typescript
type McpServerStatusConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfig
  | McpClaudeAIProxyServerConfig;
```

See [`McpServerConfig`](#mcpserverconfig) for details on each transport type.

### `AccountInfo`

Account information for the authenticated user.

```typescript
type AccountInfo = {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
}
```

### `ModelUsage`

Per-model usage statistics returned in result messages.

```typescript
type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}
```

### `ConfigScope`

```typescript
type ConfigScope = "local" | "user" | "project";
```

### `NonNullableUsage`

A version of [`Usage`](#usage) with all nullable fields made non-nullable.

```typescript
type NonNullableUsage = {
  [K in keyof Usage]: NonNullable<Usage[K]>;
}
```

### `Usage`

Token usage statistics (from `@anthropic-ai/sdk`).

```typescript
type Usage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}
```

### `CallToolResult`

MCP tool result type (from `@modelcontextprotocol/sdk/types.js`).

```typescript
type CallToolResult = {
  content: Array<{
    type: "text" | "image" | "resource";
    // Additional fields vary by type
  }>;
  isError?: boolean;
}
```

### `ThinkingConfig`

Controls Claude's thinking/reasoning behavior. Takes precedence over the deprecated `maxThinkingTokens`.

```typescript
type ThinkingConfig =
  | { type: "adaptive" } // The model determines when and how much to reason (Opus 4.6+)
  | { type: "enabled"; budgetTokens?: number } // Fixed thinking token budget
  | { type: "disabled" } // No extended thinking
```

### `SpawnedProcess`

Interface for custom process spawning (used with `spawnClaudeCodeProcess` option). `ChildProcess` already satisfies this interface.

```typescript
interface SpawnedProcess {
  stdin: Writable;
  stdout: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  off(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
}
```

### `SpawnOptions`

Options passed to the custom spawn function.

```typescript
interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}
```

### `McpSetServersResult`

Result of a `setMcpServers()` operation.

```typescript
type McpSetServersResult = {
  added: string[];
  removed: string[];
  errors: Record<string, string>;
}
```

### `RewindFilesResult`

Result of a `rewindFiles()` operation.

```typescript
type RewindFilesResult = {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}
```

### `SDKStatusMessage`

Status update message (e.g., compacting).

```typescript
type SDKStatusMessage = {
  type: "system";
  subtype: "status";
  status: "compacting" | null;
  permissionMode?: PermissionMode;
  uuid: UUID;
  session_id: string;
}
```

### `SDKTaskNotificationMessage`

Notification when a background task completes, fails, or is stopped.

```typescript
type SDKTaskNotificationMessage = {
  type: "system";
  subtype: "task_notification";
  task_id: string;
  tool_use_id?: string;
  status: "completed" | "failed" | "stopped";
  output_file: string;
  summary: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  uuid: UUID;
  session_id: string;
}
```

### `SDKToolUseSummaryMessage`

Summary of tool usage in a conversation.

```typescript
type SDKToolUseSummaryMessage = {
  type: "tool_use_summary";
  summary: string;
  preceding_tool_use_ids: string[];
  uuid: UUID;
  session_id: string;
}
```

### `SDKHookStartedMessage`

Emitted when a hook begins executing.

```typescript
type SDKHookStartedMessage = {
  type: "system";
  subtype: "hook_started";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  uuid: UUID;
  session_id: string;
}
```

### `SDKHookProgressMessage`

Emitted while a hook is running, with stdout/stderr output.

```typescript
type SDKHookProgressMessage = {
  type: "system";
  subtype: "hook_progress";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  stdout: string;
  stderr: string;
  output: string;
  uuid: UUID;
  session_id: string;
}
```

### `SDKHookResponseMessage`

Emitted when a hook finishes executing.

```typescript
type SDKHookResponseMessage = {
  type: "system";
  subtype: "hook_response";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  output: string;
  stdout: string;
  stderr: string;
  exit_code?: number;
  outcome: "success" | "error" | "cancelled";
  uuid: UUID;
  session_id: string;
}
```

### `SDKToolProgressMessage`

Emitted periodically while a tool is executing to indicate progress.

```typescript
type SDKToolProgressMessage = {
  type: "tool_progress";
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
  task_id?: string;
  uuid: UUID;
  session_id: string;
}
```

### `SDKAuthStatusMessage`

Emitted during authentication flows.

```typescript
type SDKAuthStatusMessage = {
  type: "auth_status";
  isAuthenticating: boolean;
  output: string[];
  error?: string;
  uuid: UUID;
  session_id: string;
}
```

### `SDKTaskStartedMessage`

Emitted when a background task begins.

```typescript
type SDKTaskStartedMessage = {
  type: "system";
  subtype: "task_started";
  task_id: string;
  tool_use_id?: string;
  description: string;
  task_type?: string;
  uuid: UUID;
  session_id: string;
}
```

### `SDKTaskProgressMessage`

Emitted periodically while a background task is running.

```typescript
type SDKTaskProgressMessage = {
  type: "system";
  subtype: "task_progress";
  task_id: string;
  tool_use_id?: string;
  description: string;
  usage: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  last_tool_name?: string;
  uuid: UUID;
  session_id: string;
}
```

### `SDKFilesPersistedEvent`

Emitted when file checkpoints are persisted to disk.

```typescript
type SDKFilesPersistedEvent = {
  type: "system";
  subtype: "files_persisted";
  files: { filename: string; file_id: string }[];
  failed: { filename: string; error: string }[];
  processed_at: string;
  uuid: UUID;
  session_id: string;
}
```

### `SDKRateLimitEvent`

Emitted when the session encounters a rate limit.

```typescript
type SDKRateLimitEvent = {
  type: "rate_limit_event";
  rate_limit_info: {
    status: "allowed" | "allowed_warning" | "rejected";
    resetsAt?: number;
    utilization?: number;
  };
  uuid: UUID;
  session_id: string;
}
```

### `SDKPromptSuggestionMessage`

Emitted after each turn when `promptSuggestions` is enabled. Contains a predicted next user prompt.

```typescript
type SDKPromptSuggestionMessage = {
  type: "prompt_suggestion";
  suggestion: string;
  uuid: UUID;
  session_id: string;
}
```

### `AbortError`

Custom error class for abort operations.

```typescript
class AbortError extends Error {}
```

## Sandbox Configuration

### `SandboxSettings`

Configuration for sandbox behavior. Use this to enable command sandboxing and configure network restrictions programmatically.

```typescript
type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: SandboxNetworkConfig;
  filesystem?: SandboxFilesystemConfig;
  ignoreViolations?: Record<string, string[]>;
  enableWeakerNestedSandbox?: boolean;
  ripgrep?: { command: string; args?: string[] };
}
```

| Property                    | Type                                                  | Default     | Description                                                                                                                                                                                                                             |
| :-------------------------- | :---------------------------------------------------- | :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                   | `boolean`                                             | `false`     | Enable sandbox mode for command execution                                                                                                                                                                                               |
| `autoAllowBashIfSandboxed`  | `boolean`                                             | `true`      | Auto-approve bash commands when sandbox is enabled                                                                                                                                                                                      |
| `excludedCommands`          | `string[]`                                            | `[]`        | Commands that always bypass sandbox restrictions (e.g., `['docker']`). These run unsandboxed automatically without model involvement                                                                                                    |
| `allowUnsandboxedCommands`  | `boolean`                                             | `true`      | Allow the model to request running commands outside the sandbox. When `true`, the model can set `dangerouslyDisableSandbox` in tool input, which falls back to the [permissions system](#permissions-fallback-for-unsandboxed-commands) |
| `network`                   | [`SandboxNetworkConfig`](#sandboxnetworkconfig)       | `undefined` | Network-specific sandbox configuration                                                                                                                                                                                                  |
| `filesystem`                | [`SandboxFilesystemConfig`](#sandboxfilesystemconfig) | `undefined` | Filesystem-specific sandbox configuration for read/write restrictions                                                                                                                                                                   |
| `ignoreViolations`          | `Record<string, string[]>`                            | `undefined` | Map of violation categories to patterns to ignore (e.g., `{ file: ['/tmp/*'], network: ['localhost'] }`)                                                                                                                                |
| `enableWeakerNestedSandbox` | `boolean`                                             | `false`     | Enable a weaker nested sandbox for compatibility                                                                                                                                                                                        |
| `ripgrep`                   | `{ command: string; args?: string[] }`                | `undefined` | Custom ripgrep binary configuration for sandbox environments                                                                                                                                                                            |

#### Example usage

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Build and test my project",
  options: {
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      network: {
        allowLocalBinding: true
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

<Warning>
**Unix socket security**: The `allowUnixSockets` option can grant access to powerful system services. For example, allowing `/var/run/docker.sock` effectively grants full host system access through the Docker API, bypassing sandbox isolation. Only allow Unix sockets that are strictly necessary and understand the security implications of each.
</Warning>

### `SandboxNetworkConfig`

Network-specific configuration for sandbox mode.

```typescript
type SandboxNetworkConfig = {
  allowedDomains?: string[];
  allowManagedDomainsOnly?: boolean;
  allowLocalBinding?: boolean;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  httpProxyPort?: number;
  socksProxyPort?: number;
}
```

| Property                  | Type       | Default     | Description                                                       |
| :------------------------ | :--------- | :---------- | :---------------------------------------------------------------- |
| `allowedDomains`          | `string[]` | `[]`        | Domain names that sandboxed processes can access                  |
| `allowManagedDomainsOnly` | `boolean`  | `false`     | Restrict network access to only the domains in `allowedDomains`   |
| `allowLocalBinding`       | `boolean`  | `false`     | Allow processes to bind to local ports (e.g., for dev servers)    |
| `allowUnixSockets`        | `string[]` | `[]`        | Unix socket paths that processes can access (e.g., Docker socket) |
| `allowAllUnixSockets`     | `boolean`  | `false`     | Allow access to all Unix sockets                                  |
| `httpProxyPort`           | `number`   | `undefined` | HTTP proxy port for network requests                              |
| `socksProxyPort`          | `number`   | `undefined` | SOCKS proxy port for network requests                             |

### `SandboxFilesystemConfig`

Filesystem-specific configuration for sandbox mode.

```typescript
type SandboxFilesystemConfig = {
  allowWrite?: string[];
  denyWrite?: string[];
  denyRead?: string[];
}
```

| Property     | Type       | Default | Description                                 |
| :----------- | :--------- | :------ | :------------------------------------------ |
| `allowWrite` | `string[]` | `[]`    | File path patterns to allow write access to |
| `denyWrite`  | `string[]` | `[]`    | File path patterns to deny write access to  |
| `denyRead`   | `string[]` | `[]`    | File path patterns to deny read access to   |

### Permissions Fallback for Unsandboxed Commands

When `allowUnsandboxedCommands` is enabled, the model can request to run commands outside the sandbox by setting `dangerouslyDisableSandbox: true` in the tool input. These requests fall back to the existing permissions system, meaning your `canUseTool` handler will be invoked, allowing you to implement custom authorization logic.

<Note>
**`excludedCommands` vs `allowUnsandboxedCommands`:**
- `excludedCommands`: A static list of commands that always bypass the sandbox automatically (e.g., `['docker']`). The model has no control over this.
- `allowUnsandboxedCommands`: Lets the model decide at runtime whether to request unsandboxed execution by setting `dangerouslyDisableSandbox: true` in the tool input.
</Note>

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Deploy my application",
  options: {
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: true // Model can request unsandboxed execution
    },
    permissionMode: "default",
    canUseTool: async (tool, input) => {
      // Check if the model is requesting to bypass the sandbox
      if (tool === "Bash" && input.dangerouslyDisableSandbox) {
        // The model is requesting to run this command outside the sandbox
        console.log(`Unsandboxed command requested: ${input.command}`);

        if (isCommandAuthorized(input.command)) {
          return { behavior: "allow" as const, updatedInput: input };
        }
        return { behavior: "deny" as const, message: "Command not authorized for unsandboxed execution" };
      }
      return { behavior: "allow" as const, updatedInput: input };
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

This pattern enables you to:

- **Audit model requests**: Log when the model requests unsandboxed execution
- **Implement allowlists**: Only permit specific commands to run unsandboxed
- **Add approval workflows**: Require explicit authorization for privileged operations

<Warning>
Commands running with `dangerouslyDisableSandbox: true` have full system access. Ensure your `canUseTool` handler validates these requests carefully.

If `permissionMode` is set to `bypassPermissions` and `allowUnsandboxedCommands` is enabled, the model can autonomously execute commands outside the sandbox without any approval prompts. This combination effectively allows the model to escape sandbox isolation silently.
</Warning>

## See also

- [SDK overview](/docs/en/agent-sdk/overview) - General SDK concepts
- [Python SDK reference](/docs/en/agent-sdk/python) - Python SDK documentation
- [CLI reference](https://code.claude.com/docs/en/cli-reference) - Command-line interface
- [Common workflows](https://code.claude.com/docs/en/common-workflows) - Step-by-step guides