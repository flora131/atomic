# Claude Agent SDK v2 TypeScript Research Document

> **Research Date:** January 31, 2026  
> **SDK Version:** v0.1.x with V2 Preview Interface  
> **Package:** `@anthropic-ai/claude-agent-sdk`

---

## Table of Contents

1. [Overview](#overview)
2. [V2 Preview Documentation](#v2-preview-documentation)
3. [Core TypeScript Architecture](#core-typescript-architecture)
4. [Agent Creation & Configuration](#agent-creation--configuration)
5. [Tool Integration](#tool-integration)
6. [Session Management](#session-management)
7. [Event Handling & Hooks](#event-handling--hooks)
8. [MCP Integration](#mcp-integration)
9. [Structured Outputs](#structured-outputs)
10. [Migration Guide (V1 to V2)](#migration-guide-v1-to-v2)
11. [Source Documentation Links](#source-documentation-links)

---

## Overview

The Claude Agent SDK (formerly Claude Code SDK) enables building production AI agents with Claude as the foundation. It provides the same tools, agent loop, and context management that power Claude Code, programmable in both Python and TypeScript.

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Built-in Tools** | Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch |
| **Hooks** | Intercept and customize agent behavior at key execution points |
| **Subagents** | Spawn specialized agents for focused subtasks |
| **MCP Integration** | Connect to external tools via Model Context Protocol |
| **Permissions** | Fine-grained control over tool access |
| **Sessions** | Multi-turn conversations with context persistence |

### Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

---

## V2 Preview Documentation

> **Source:** https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview

### V2 API Overview

The V2 interface is an **unstable preview** that simplifies multi-turn conversations by removing async generators and yield coordination. Instead of managing generator state, each turn is a separate `send()`/`stream()` cycle.

### V2 Core Concepts

1. **`createSession()` / `resumeSession()`** - Start or continue a conversation
2. **`session.send()`** - Send a message
3. **`session.stream()`** - Get the response

### V2 vs V1 Comparison

| Aspect | V1 | V2 |
|--------|----|----|
| **Input/Output** | Single async generator for both | Separate `send()` and `stream()` |
| **Multi-turn** | Requires input generator coordination | Simple sequential calls |
| **Session Control** | Via options in `query()` | Explicit session objects |
| **Resource Cleanup** | Manual or via options | `await using` or `close()` |

### V2 TypeScript Types

```typescript
// V2 Session Interface
interface Session {
  send(message: string): Promise<void>;
  stream(): AsyncGenerator<SDKMessage>;
  close(): void;
}

// V2 Functions
function unstable_v2_createSession(options: {
  model: string;
}): Session;

function unstable_v2_resumeSession(
  sessionId: string,
  options: { model: string; }
): Session;

function unstable_v2_prompt(
  prompt: string,
  options: { model: string; }
): Promise<Result>;
```

### V2 Code Examples

#### One-Shot Prompt (V2)

```typescript
import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk'

const result = await unstable_v2_prompt('What is 2 + 2?', {
  model: 'claude-sonnet-4-5-20250929'
})
console.log(result.result)
```

#### Basic Session (V2)

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

await using session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})

await session.send('Hello!')
for await (const msg of session.stream()) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}
```

#### Multi-Turn Conversation (V2)

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

await using session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})

// Turn 1
await session.send('What is 5 + 3?')
for await (const msg of session.stream()) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}

// Turn 2
await session.send('Multiply that by 2')
for await (const msg of session.stream()) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}
```

#### Session Resume (V2)

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage
} from '@anthropic-ai/claude-agent-sdk'

function getAssistantText(msg: SDKMessage): string | null {
  if (msg.type !== 'assistant') return null
  return msg.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

// Create initial session
const session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})

await session.send('Remember this number: 42')

let sessionId: string | undefined
for await (const msg of session.stream()) {
  sessionId = msg.session_id
  const text = getAssistantText(msg)
  if (text) console.log('Initial response:', text)
}

session.close()

// Resume later
await using resumedSession = unstable_v2_resumeSession(sessionId!, {
  model: 'claude-sonnet-4-5-20250929'
})

await resumedSession.send('What number did I ask you to remember?')
for await (const msg of resumedSession.stream()) {
  const text = getAssistantText(msg)
  if (text) console.log('Resumed response:', text)
}
```

### V2 Feature Availability

Features **only available in V1**:
- Session forking (`forkSession` option)
- Some advanced streaming input patterns

---

## Core TypeScript Architecture

> **Source:** https://platform.claude.com/docs/en/agent-sdk/typescript

### Primary Function: `query()`

```typescript
function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query
```

### Options Type

```typescript
interface Options {
  // Core settings
  model?: string;
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  cwd?: string;
  
  // Tool configuration
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  
  // Permission settings
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowDangerouslySkipPermissions?: boolean;
  canUseTool?: CanUseTool;
  
  // Session management
  resume?: string;
  forkSession?: boolean;
  continue?: boolean;
  
  // MCP servers
  mcpServers?: Record<string, McpServerConfig>;
  
  // Hooks
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  
  // Subagents
  agents?: Record<string, AgentDefinition>;
  
  // Settings sources
  settingSources?: SettingSource[];  // 'user' | 'project' | 'local'
  
  // Budget and limits
  maxBudgetUsd?: number;
  maxTurns?: number;
  maxThinkingTokens?: number;
  
  // Output configuration
  outputFormat?: { type: 'json_schema'; schema: JSONSchema };
  includePartialMessages?: boolean;
  
  // File checkpointing
  enableFileCheckpointing?: boolean;
  
  // Beta features
  betas?: SdkBeta[];  // e.g., ['context-1m-2025-08-07']
  
  // Plugins
  plugins?: SdkPluginConfig[];
}
```

### Query Interface

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  rewindFiles(userMessageUuid: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
}
```

### Message Types

```typescript
type SDKMessage = 
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKResultMessage
  | SDKSystemMessage
  | SDKPartialAssistantMessage
  | SDKCompactBoundaryMessage;

// Assistant message
type SDKAssistantMessage = {
  type: 'assistant';
  uuid: UUID;
  session_id: string;
  message: APIAssistantMessage;
  parent_tool_use_id: string | null;
}

// Result message
type SDKResultMessage =
  | {
      type: 'result';
      subtype: 'success';
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      num_turns: number;
      result: string;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: { [modelName: string]: ModelUsage };
      permission_denials: SDKPermissionDenial[];
      structured_output?: unknown;
    }
  | {
      type: 'result';
      subtype: 'error_max_turns' | 'error_during_execution' | 
               'error_max_budget_usd' | 'error_max_structured_output_retries';
      // ... error fields
    }

// System message
type SDKSystemMessage = {
  type: 'system';
  subtype: 'init';
  uuid: UUID;
  session_id: string;
  apiKeySource: ApiKeySource;
  cwd: string;
  tools: string[];
  mcp_servers: { name: string; status: string; }[];
  model: string;
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
}
```

### Permission Types

```typescript
type PermissionMode =
  | 'default'           // Standard permission behavior
  | 'acceptEdits'       // Auto-accept file edits
  | 'bypassPermissions' // Bypass all permission checks
  | 'plan'              // Planning mode - no execution

type CanUseTool = (
  toolName: string,
  input: ToolInput,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
  }
) => Promise<PermissionResult>;

type PermissionResult = 
  | {
      behavior: 'allow';
      updatedInput: ToolInput;
      updatedPermissions?: PermissionUpdate[];
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
    }
```

---

## Agent Creation & Configuration

> **Source:** https://platform.claude.com/docs/en/agent-sdk/overview

### Basic Agent Example

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: { allowedTools: ["Read", "Edit", "Bash"] }
})) {
  console.log(message);
}
```

### Agent Definition Type

```typescript
type AgentDefinition = {
  description: string;  // Natural language description of when to use
  tools?: string[];     // Array of allowed tool names
  prompt: string;       // The agent's system prompt
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}
```

### Subagent Configuration

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Use the code-reviewer agent to review this codebase",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Task"],
    agents: {
      "code-reviewer": {
        description: "Expert code reviewer for quality and security reviews.",
        prompt: "Analyze code quality and suggest improvements.",
        tools: ["Read", "Glob", "Grep"]
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### System Prompt Configuration

```typescript
// Custom system prompt
options: {
  systemPrompt: "You are a senior Python developer. Always follow PEP 8."
}

// Claude Code preset with append
options: {
  systemPrompt: {
    type: 'preset',
    preset: 'claude_code',
    append: 'Focus on security best practices.'
  }
}
```

### Settings Sources

```typescript
type SettingSource = 'user' | 'project' | 'local';

// Load all settings (legacy behavior)
options: {
  settingSources: ['user', 'project', 'local']
}

// Load only project settings
options: {
  settingSources: ['project']  // Loads CLAUDE.md files
}

// SDK-only (default - no filesystem settings)
options: {
  // settingSources defaults to []
}
```

---

## Tool Integration

> **Source:** https://platform.claude.com/docs/en/agent-sdk/custom-tools

### Built-in Tools

| Tool | Description |
|------|-------------|
| `Read` | Read any file in the working directory |
| `Write` | Create new files |
| `Edit` | Make precise edits to existing files |
| `Bash` | Run terminal commands, scripts, git operations |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents with regex |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch and parse web page content |
| `AskUserQuestion` | Ask the user clarifying questions |
| `Task` | Spawn subagents |

### Tool Input Types

```typescript
// Bash tool
interface BashInput {
  command: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
}

// Edit tool
interface FileEditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

// Read tool
interface FileReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

// Write tool
interface FileWriteInput {
  file_path: string;
  content: string;
}

// Grep tool
interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-i'?: boolean;
  '-n'?: boolean;
  '-B'?: number;
  '-A'?: number;
  '-C'?: number;
}
```

### Creating Custom Tools

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const customServer = createSdkMcpServer({
  name: "my-custom-tools",
  version: "1.0.0",
  tools: [
    tool(
      "get_weather",
      "Get current temperature for a location using coordinates",
      {
        latitude: z.number().describe("Latitude coordinate"),
        longitude: z.number().describe("Longitude coordinate")
      },
      async (args) => {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m`
        );
        const data = await response.json();

        return {
          content: [{
            type: "text",
            text: `Temperature: ${data.current.temperature_2m}°F`
          }]
        };
      }
    )
  ]
});

// Use with streaming input (required for MCP tools)
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "What's the weather in San Francisco?"
    }
  };
}

for await (const message of query({
  prompt: generateMessages(),
  options: {
    mcpServers: {
      "my-custom-tools": customServer
    },
    allowedTools: ["mcp__my-custom-tools__get_weather"],
    maxTurns: 3
  }
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result);
  }
}
```

### Tool Error Handling

```typescript
tool(
  "fetch_data",
  "Fetch data from an API",
  {
    endpoint: z.string().url().describe("API endpoint URL")
  },
  async (args) => {
    try {
      const response = await fetch(args.endpoint);
      
      if (!response.ok) {
        return {
          content: [{
            type: "text",
            text: `API error: ${response.status} ${response.statusText}`
          }]
        };
      }
      
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to fetch data: ${error.message}`
        }]
      };
    }
  }
)
```

---

## Session Management

> **Source:** https://platform.claude.com/docs/en/agent-sdk/sessions

### Getting Session ID

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"

let sessionId: string | undefined

const response = query({
  prompt: "Help me build a web application",
  options: { model: "claude-sonnet-4-5" }
})

for await (const message of response) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id
    console.log(`Session started with ID: ${sessionId}`)
  }
}
```

### Resuming Sessions

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"

const response = query({
  prompt: "Continue implementing the authentication system",
  options: {
    resume: "session-xyz",
    model: "claude-sonnet-4-5",
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"]
  }
})

for await (const message of response) {
  console.log(message)
}
```

### Forking Sessions

| Behavior | `forkSession: false` (default) | `forkSession: true` |
|----------|-------------------------------|---------------------|
| **Session ID** | Same as original | New session ID generated |
| **History** | Appends to original session | Creates new branch |
| **Original Session** | Modified | Preserved unchanged |

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"

let sessionId: string | undefined

// Initial session
const response = query({
  prompt: "Help me design a REST API",
  options: { model: "claude-sonnet-4-5" }
})

for await (const message of response) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id
  }
}

// Fork the session
const forkedResponse = query({
  prompt: "Now let's redesign this as a GraphQL API instead",
  options: {
    resume: sessionId,
    forkSession: true,  // Creates new session ID
    model: "claude-sonnet-4-5"
  }
})

for await (const message of forkedResponse) {
  if (message.type === 'system' && message.subtype === 'init') {
    console.log(`Forked session: ${message.session_id}`)
  }
}
```

---

## Event Handling & Hooks

> **Source:** https://platform.claude.com/docs/en/agent-sdk/hooks

### Available Hook Events

| Hook Event | Description |
|------------|-------------|
| `PreToolUse` | Before tool execution (can block/modify) |
| `PostToolUse` | After tool execution |
| `PostToolUseFailure` | After tool failure (TypeScript only) |
| `UserPromptSubmit` | User prompt submission |
| `Stop` | Agent execution stop |
| `SubagentStart` | Subagent initialization (TypeScript only) |
| `SubagentStop` | Subagent completion |
| `PreCompact` | Before conversation compaction |
| `PermissionRequest` | Permission dialog (TypeScript only) |
| `SessionStart` | Session initialization (TypeScript only) |
| `SessionEnd` | Session termination (TypeScript only) |
| `Notification` | Agent status messages (TypeScript only) |

### Hook Callback Type

```typescript
type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;

interface HookCallbackMatcher {
  matcher?: string;  // Regex pattern for tool names
  hooks: HookCallback[];
  timeout?: number;  // Default: 60 seconds
}
```

### Hook Input Types

```typescript
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
}

type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
}

type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
}
```

### Hook Output Types

```typescript
type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput;

type SyncHookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?:
    | {
        hookEventName: 'PreToolUse';
        permissionDecision?: 'allow' | 'deny' | 'ask';
        permissionDecisionReason?: string;
        updatedInput?: Record<string, unknown>;
      }
    | {
        hookEventName: 'UserPromptSubmit';
        additionalContext?: string;
      }
    | {
        hookEventName: 'SessionStart';
        additionalContext?: string;
      }
    | {
        hookEventName: 'PostToolUse';
        additionalContext?: string;
      };
}
```

### Hook Examples

#### Block Dangerous Operations

```typescript
import { query, HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const protectEnvFiles: HookCallback = async (input, toolUseID, { signal }) => {
  const preInput = input as PreToolUseHookInput;
  const filePath = preInput.tool_input?.file_path as string;
  const fileName = filePath?.split('/').pop();

  if (fileName === '.env') {
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: 'deny',
        permissionDecisionReason: 'Cannot modify .env files'
      }
    };
  }

  return {};
};

for await (const message of query({
  prompt: "Update the database configuration",
  options: {
    hooks: {
      PreToolUse: [{ matcher: 'Write|Edit', hooks: [protectEnvFiles] }]
    }
  }
})) {
  console.log(message);
}
```

#### Audit Logging

```typescript
import { query, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync } from "fs";

const logFileChange: HookCallback = async (input) => {
  const filePath = (input as any).tool_input?.file_path ?? "unknown";
  appendFileSync("./audit.log", `${new Date().toISOString()}: modified ${filePath}\n`);
  return {};
};

for await (const message of query({
  prompt: "Refactor utils.py to improve readability",
  options: {
    permissionMode: "acceptEdits",
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write", hooks: [logFileChange] }]
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

#### Modify Tool Input

```typescript
const redirectToSandbox: HookCallback = async (input, toolUseID, { signal }) => {
  if (input.hook_event_name !== 'PreToolUse') return {};

  const preInput = input as PreToolUseHookInput;
  if (preInput.tool_name === 'Write') {
    const originalPath = preInput.tool_input.file_path as string;
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: 'allow',
        updatedInput: {
          ...preInput.tool_input,
          file_path: `/sandbox${originalPath}`
        }
      }
    };
  }
  return {};
};
```

---

## MCP Integration

> **Source:** https://platform.claude.com/docs/en/agent-sdk/mcp

### MCP Server Config Types

```typescript
type McpServerConfig = 
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfigWithInstance;

type McpStdioServerConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

type McpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

type McpSdkServerConfigWithInstance = {
  type: 'sdk';
  name: string;
  instance: McpServer;
}
```

### MCP Tool Naming Convention

Pattern: `mcp__<server-name>__<tool-name>`

Example: `mcp__github__list_issues`

### MCP Examples

#### HTTP Transport

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Use the docs MCP server to explain what hooks are",
  options: {
    mcpServers: {
      "claude-code-docs": {
        type: "http",
        url: "https://code.claude.com/docs/mcp"
      }
    },
    allowedTools: ["mcp__claude-code-docs__*"]
  }
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result);
  }
}
```

#### Stdio Transport (GitHub)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "List the 3 most recent issues in anthropics/claude-code",
  options: {
    mcpServers: {
      "github": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN
        }
      }
    },
    allowedTools: ["mcp__github__list_issues"]
  }
})) {
  if (message.type === "system" && message.subtype === "init") {
    console.log("MCP servers:", message.mcp_servers);
  }
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result);
  }
}
```

### MCP Tool Search

Tool search dynamically loads tools on-demand when MCP tool descriptions exceed 10% of context window.

```typescript
options: {
  mcpServers: { /* your servers */ },
  env: {
    ENABLE_TOOL_SEARCH: "auto:5"  // Enable at 5% threshold
  }
}
```

| Value | Behavior |
|-------|----------|
| `auto` | Activates at 10% (default) |
| `auto:5` | Activates at 5% |
| `true` | Always enabled |
| `false` | Disabled |

---

## Structured Outputs

> **Source:** https://platform.claude.com/docs/en/agent-sdk/structured-outputs

### JSON Schema Configuration

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const schema = {
  type: 'object',
  properties: {
    company_name: { type: 'string' },
    founded_year: { type: 'number' },
    headquarters: { type: 'string' }
  },
  required: ['company_name']
}

for await (const message of query({
  prompt: 'Research Anthropic and provide key company information',
  options: {
    outputFormat: {
      type: 'json_schema',
      schema: schema
    }
  }
})) {
  if (message.type === 'result' && message.structured_output) {
    console.log(message.structured_output)
  }
}
```

### Type-Safe with Zod

```typescript
import { z } from 'zod'
import { query } from '@anthropic-ai/claude-agent-sdk'

const FeaturePlan = z.object({
  feature_name: z.string(),
  summary: z.string(),
  steps: z.array(z.object({
    step_number: z.number(),
    description: z.string(),
    estimated_complexity: z.enum(['low', 'medium', 'high'])
  })),
  risks: z.array(z.string())
})

type FeaturePlan = z.infer<typeof FeaturePlan>

const schema = z.toJSONSchema(FeaturePlan)

for await (const message of query({
  prompt: 'Plan how to add dark mode support to a React app.',
  options: {
    outputFormat: {
      type: 'json_schema',
      schema: schema
    }
  }
})) {
  if (message.type === 'result' && message.structured_output) {
    const parsed = FeaturePlan.safeParse(message.structured_output)
    if (parsed.success) {
      const plan: FeaturePlan = parsed.data
      console.log(`Feature: ${plan.feature_name}`)
    }
  }
}
```

### Error Handling

| Subtype | Meaning |
|---------|---------|
| `success` | Output validated successfully |
| `error_max_structured_output_retries` | Agent couldn't produce valid output |

```typescript
for await (const msg of query({
  prompt: 'Extract contact info from the document',
  options: {
    outputFormat: { type: 'json_schema', schema: contactSchema }
  }
})) {
  if (msg.type === 'result') {
    if (msg.subtype === 'success' && msg.structured_output) {
      console.log(msg.structured_output)
    } else if (msg.subtype === 'error_max_structured_output_retries') {
      console.error('Could not produce valid output')
    }
  }
}
```

---

## Migration Guide (V1 to V2)

> **Source:** https://platform.claude.com/docs/en/agent-sdk/migration-guide

### Package Rename

| Old | New |
|-----|-----|
| `@anthropic-ai/claude-code` | `@anthropic-ai/claude-agent-sdk` |
| `claude-code-sdk` (Python) | `claude-agent-sdk` |

### Migration Steps

```bash
# Uninstall old package
npm uninstall @anthropic-ai/claude-code

# Install new package
npm install @anthropic-ai/claude-agent-sdk
```

Update imports:

```typescript
// Before
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-code";

// After
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
```

### Breaking Changes

#### 1. System Prompt No Longer Default

```typescript
// Before (v0.0.x) - Used Claude Code's system prompt by default
const result = query({ prompt: "Hello" });

// After (v0.1.0) - Uses minimal system prompt by default
// To get old behavior:
const result = query({
  prompt: "Hello",
  options: {
    systemPrompt: { type: "preset", preset: "claude_code" }
  }
});
```

#### 2. Settings Sources No Longer Loaded

```typescript
// Before (v0.0.x) - Loaded all settings automatically

// After (v0.1.0) - No settings loaded by default
// To get old behavior:
const result = query({
  prompt: "Hello",
  options: {
    settingSources: ["user", "project", "local"]
  }
});
```

---

## Source Documentation Links

### Official Documentation

| Resource | URL |
|----------|-----|
| **V2 Preview** | https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview |
| **TypeScript SDK Reference** | https://platform.claude.com/docs/en/agent-sdk/typescript |
| **Python SDK Reference** | https://platform.claude.com/docs/en/agent-sdk/python |
| **SDK Overview** | https://platform.claude.com/docs/en/agent-sdk/overview |
| **Quickstart** | https://platform.claude.com/docs/en/agent-sdk/quickstart |
| **Hooks Guide** | https://platform.claude.com/docs/en/agent-sdk/hooks |
| **Custom Tools** | https://platform.claude.com/docs/en/agent-sdk/custom-tools |
| **MCP Integration** | https://platform.claude.com/docs/en/agent-sdk/mcp |
| **Sessions** | https://platform.claude.com/docs/en/agent-sdk/sessions |
| **Structured Outputs** | https://platform.claude.com/docs/en/agent-sdk/structured-outputs |
| **Migration Guide** | https://platform.claude.com/docs/en/agent-sdk/migration-guide |
| **Permissions** | https://platform.claude.com/docs/en/agent-sdk/permissions |

### GitHub Resources

| Resource | URL |
|----------|-----|
| **TypeScript SDK Repository** | https://github.com/anthropics/claude-agent-sdk-typescript |
| **Python SDK Repository** | https://github.com/anthropics/claude-agent-sdk-python |
| **Example Agents** | https://github.com/anthropics/claude-agent-sdk-demos |
| **V2 Examples** | https://github.com/anthropics/claude-agent-sdk-demos/tree/main/hello-world-v2 |
| **TypeScript Changelog** | https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md |
| **Python Changelog** | https://github.com/anthropics/claude-agent-sdk-python/blob/main/CHANGELOG.md |
| **MCP Server Directory** | https://github.com/modelcontextprotocol/servers |

### Related Documentation

| Resource | URL |
|----------|-----|
| **MCP Documentation** | https://modelcontextprotocol.io/docs/getting-started/intro |
| **Claude Code Setup** | https://code.claude.com/docs/en/setup |
| **API Beta Headers** | https://platform.claude.com/docs/en/api/beta-headers |
| **JSON Schema** | https://json-schema.org/understanding-json-schema/about |

---

## Summary

The Claude Agent SDK provides a comprehensive framework for building AI agents:

1. **V2 Preview** simplifies multi-turn conversations with explicit `send()`/`stream()` patterns
2. **Core V1 API** remains fully supported with `query()` async generator pattern
3. **Built-in tools** provide immediate file, bash, and web capabilities
4. **Custom tools** extend functionality via MCP servers
5. **Hooks** enable fine-grained control over agent behavior
6. **Sessions** support resumption and forking for complex workflows
7. **Structured outputs** guarantee type-safe JSON responses

The SDK is actively evolving, with the V2 interface in preview and continuous improvements based on community feedback.
