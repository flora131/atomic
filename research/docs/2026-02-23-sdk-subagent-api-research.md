---
title: Sub-Agent/Background Agent API Research
date: 2026-02-23
author: Research Team
tags: [sdk, sub-agent, streaming, api, events]
status: completed
---

# Sub-Agent/Background Agent API Research

## Executive Summary

This document analyzes how three major coding agent SDKs handle sub-agent/background task tool calls and event streaming:

1. **OpenCode** (anomalyco/opencode) - Uses a dedicated `Task` tool with `message.part.updated` events
2. **GitHub Copilot SDK** (github/copilot-sdk) - Emits granular tool execution lifecycle events
3. **Claude Agent SDK** - Uses `parent_tool_use_id` for nesting with hook-based events

Key findings:
- All three SDKs support nested/hierarchical tool execution
- Event streaming approaches vary: OpenCode uses SSE with part updates, Copilot uses lifecycle events, Claude uses hooks
- OpenTUI provides Flexbox-like layout with Yoga for dynamic agent tree visualization

---

## 1. OpenCode SDK (anomalyco/opencode)

**DeepWiki Search**: https://deepwiki.com/search/how-does-opencode-handle-subag_4598ffc8-50f0-4ce5-8563-069c60e03e68

### Sub-Agent/Background Task Handling

OpenCode uses a dedicated **`Task` tool** to orchestrate sub-agent execution and background tasks.

#### Key Components:

**Task Tool Configuration**:
```typescript
interface TaskToolInput {
  prompt: string;
  subagent_type: string;  // e.g., "General", "Explore"
}
```

**Execution Flow**:
1. When `SessionPrompt.loop()` encounters a task of `type === "subtask"`, a `TaskTool` is initialized
2. An `assistant` message and a `tool` part are created to represent the running task
3. The `tool` part's state is set to `"running"` with details about the subtask's prompt, description, and agent type
4. The `TaskTool.execute()` method is called with task arguments and context

**Available Subagent Types**:
- **"General"**: For researching complex questions and executing multi-step tasks autonomously
- **"Explore"**: For fast, read-only exploration of codebases

### Events Emitted During Tool Execution

#### Primary Event: `message.part.updated`

OpenCode streams tool results and status updates through the `message.part.updated` event.

**Event Trigger Points**:
1. **Tool Start**: When `Session.updatePart()` updates the `ToolPart` state to `"running"`
2. **During Execution**: When the `metadata()` function within `Tool.Context` updates the `ToolPart` with new metadata
3. **Tool Completion**: When the `ToolPart` state is updated to `"completed"` (includes output, metadata, attachments)
4. **Tool Error**: When the `ToolPart` state is updated to `"error"` (includes error message)

#### Additional Plugin Events:
- `tool.execute.before` - Triggered before tool execution
- `tool.execute.after` - Triggered after tool execution

### Event Format for Streaming Tool Results

The `message.part.updated` event carries a `MessageV2.ToolPart` object:

```typescript
interface ToolPart {
  id: string;              // Unique identifier for the part
  messageID: string;       // ID of the assistant message this part belongs to
  sessionID: string;       // ID of the session
  type: "tool";           // Always "tool" for tool calls
  callID: string;         // Unique identifier for the tool call
  tool: string;           // Name of the tool being called (e.g., "task")
  state: {
    status: "running" | "completed" | "error";
    input: unknown;       // Arguments provided to the tool
    output?: unknown;     // Result of the tool execution (if completed)
    error?: string;       // Error message (if error)
    metadata?: unknown;   // Additional metadata from the tool provider
    attachments?: Array<unknown>;  // Files or media attached to the tool result
    time: {
      start: string;
      end?: string;
    };
  };
}
```

**Model Message Transformation**:
The `toModelMessages` function transforms `ToolPart` objects into `assistantMessage.parts` with specific types:
- `type`: `"tool-TOOLNAME"` (e.g., `"tool-task"`)
- State values: `"output-available"` or `"output-error"`

### SSE/Streaming API for Tool Calls

**Server-Sent Events (SSE) Architecture**:
```typescript
// Client subscribes via the /event endpoint
const events = sdk.event.subscribe();

// Iterate over the event stream
for await (const event of events.stream) {
  if (event.type === 'message.part.updated') {
    // Handle tool execution update
    const toolPart = event.part;
    console.log(`Tool: ${toolPart.tool}, Status: ${toolPart.state.status}`);
  }
}
```

**Granular Tool Input Events** (from OpenAICompatibleChatLanguageModel):
- `tool-input-start` - Tool input begins
- `tool-input-delta` - Incremental tool input updates
- `tool-input-end` - Tool input complete
- `tool-call` - Overall tool call status

**Direct MCP Tool Invocation**:
```bash
opencode mcp call <tool-name>
```
Useful for testing and debugging tool calls directly.

### References

- **Architecture**: [OpenCode Architecture Wiki](https://deepwiki.com/wiki/anomalyco/opencode#2)
- **MCP Integration**: [MCP (Model Context Protocol) Wiki](https://deepwiki.com/wiki/anomalyco/opencode#13)
- Key Files:
  - `SessionPrompt.loop()` - Main execution loop for subtask handling
  - `TaskTool.execute()` - Task tool execution method
  - `Session.updatePart()` - Updates ToolPart state and emits events
  - `openai-compatible-chat-language-model.ts` - Granular tool input events

---

## 2. GitHub Copilot SDK (github/copilot-sdk)

**DeepWiki Search**: https://deepwiki.com/search/how-does-the-copilot-sdk-handl_35f77c7a-128d-436b-b281-dc7fc72b32a4

### Tool Call Handling During Streaming

The Copilot SDK uses an **event-driven architecture** with granular lifecycle events for tool execution tracking.

### Events Emitted for Tool Execution

#### Tool Execution Lifecycle Events:

1. **`tool.execution_start`** - Emitted when tool execution begins
2. **`tool.execution_progress`** - Ongoing progress updates during execution
3. **`tool.execution_partial_result`** - Partial results from a tool still executing
4. **`tool.execution_complete`** - Tool execution finished (success or failure)

#### Event Subscription:

```typescript
// TypeScript example
session.on('ToolExecutionStartEvent', (event) => {
  console.log(`Tool ${event.data.toolName} started`);
});

session.on('ToolExecutionCompleteEvent', (event) => {
  console.log(`Tool ${event.data.toolCallId} completed: ${event.data.success}`);
});
```

```csharp
// C# example
session.On<ToolExecutionStartEvent>((evt) => {
    Console.WriteLine($"Tool {evt.Data.ToolName} started");
});

session.On<ToolExecutionCompleteEvent>((evt) => {
    Console.WriteLine($"Tool completed: {evt.Data.Success}");
});
```

### Event Format for tool_start and tool_result

#### `ToolExecutionStartEvent` Format:

```typescript
{
  id: string;
  timestamp: string;
  parentId: string | null;
  ephemeral?: boolean;
  type: "tool.execution_start";
  data: {
    toolCallId: string;
    toolName: string;
    arguments?: unknown;
    mcpServerName?: string;      // For MCP tools
    mcpToolName?: string;         // Original MCP tool name
    parentToolCallId?: string;    // For nested tool calls
  };
}
```

**Key Fields**:
- `toolCallId`: Unique identifier for this tool call
- `toolName`: Name of the tool being executed
- `arguments`: Input arguments passed to the tool
- `parentToolCallId`: Links to parent tool for nested/sub-agent calls

#### `ToolExecutionCompleteEvent` Format:

```typescript
{
  id: string;
  timestamp: string;
  parentId: string | null;
  ephemeral?: boolean;
  type: "tool.execution_complete";
  data: {
    toolCallId: string;
    success: boolean;
    isUserRequested?: boolean;
    result?: {
      content: string;
      detailedContent?: string;
      contents?: Array<
        | { type: "text"; text: string; }
        | { type: "terminal"; text: string; exitCode?: number; cwd?: string; }
        | { type: "image"; data: string; mimeType: string; }
        | { type: "audio"; data: string; mimeType: string; }
        | { 
            type: "resource_link";
            uri: string;
            name: string;
            title?: string;
            description?: string;
            mimeType?: string;
            size?: number;
            icons?: Array<{
              src: string;
              mimeType?: string;
              sizes?: string[];
              theme?: "light" | "dark";
            }>;
          }
        | {
            type: "resource";
            resource: {
              uri: string;
              mimeType?: string;
            } & ({ text: string } | { blob: string });
          }
      >;
    };
    error?: {
      message: string;
      code?: string;
    };
    toolTelemetry?: {
      [k: string]: unknown;
    };
    parentToolCallId?: string;  // For nested tool calls
  };
}
```

**Key Fields**:
- `success`: Boolean indicating successful execution
- `result`: Rich content result with multiple content types supported
- `error`: Error details if `success: false`
- `parentToolCallId`: Links to parent tool for nested calls

**Supported Content Types**:
- `text` - Plain text output
- `terminal` - Terminal command output with exit code
- `image` - Base64-encoded image with MIME type
- `audio` - Base64-encoded audio
- `resource_link` - Link to external resources with metadata
- `resource` - Embedded resource with text or binary blob

### Sub-Agent and Background Tasks

#### Sub-Agent Lifecycle Events:

```typescript
// Sub-agent started
{
  type: "subagent.started";
  data: {
    // Sub-agent details
  };
}

// Sub-agent completed
{
  type: "subagent.completed";
  data: {
    // Sub-agent results
  };
}
```

### Tool Execution Hooks

The SDK provides hooks for intercepting tool calls:

**`onPreToolUse`**: 
- Intercept tool calls before execution
- Use cases: Permission control, argument modification

**`onPostToolUse`**:
- Process tool results after execution
- Use cases: Result transformation, logging

### Streaming Configuration

```typescript
const sessionConfig: SessionConfig = {
  streaming: true  // Enable incremental assistant.message_delta events
};
```

### References

- **Event-Driven Architecture**: [Copilot SDK Events Wiki](https://deepwiki.com/wiki/github/copilot-sdk#3.3)
- **TypeScript SDK**: [Node.js/TypeScript SDK Wiki](https://deepwiki.com/wiki/github/copilot-sdk#6.1)
- Key Components:
  - `CopilotClient` - Manages CLI server connection and session management
  - `CopilotSession` - Represents single conversation context, handles event streams and tool execution
  - `SessionConfig.streaming` - Enables incremental message streaming

---

## 3. Claude Agent SDK (TypeScript)

**Source**: `docs/claude-agent-sdk/typescript-sdk.md`

### Sub-Agent/Background Task Handling

Claude Agent SDK uses a **hierarchical parent-child relationship** model with `parent_tool_use_id` for nested tool execution.

### Agent Definition and Configuration

#### Programmatic Agent Definition:

```typescript
import { createClient } from '@claude/agent-sdk';

const client = createClient({
  agents: {
    "research_agent": {
      description: "Specialized agent for researching complex technical topics",
      tools: ["ReadFile", "SearchFiles", "WebSearch"],
      prompt: "You are a research specialist. Focus on gathering and synthesizing information.",
      model: "sonnet"
    },
    "code_agent": {
      description: "Agent specialized in writing and reviewing code",
      tools: ["EditFile", "CreateFile", "RunCommand"],
      prompt: "You are a coding specialist. Focus on implementing clean, well-tested code.",
      model: "opus"
    }
  },
  includePartialMessages: true  // Enable streaming events
});
```

**AgentDefinition Type**:
```typescript
type AgentDefinition = {
  description: string;  // Natural language description of when to use this agent
  tools?: string[];     // Array of allowed tool names (inherits all if omitted)
  prompt: string;       // The agent's system prompt
  model?: "sonnet" | "opus" | "haiku" | "inherit";  // Model override
}
```

### Task Tool for Sub-Agent Execution

#### Task Tool Input:

```typescript
interface TaskInput {
  /**
   * Description of what needs to be done (required)
   */
  prompt: string;
  
  /**
   * The type of specialized agent to use for this task (required)
   */
  subagent_type: string;
}
```

#### Task Tool Output:

```typescript
interface TaskOutput {
  /**
   * Final result message from the subagent
   */
  result: string;
  
  /**
   * Token usage statistics
   */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  
  /**
   * Total cost in USD
   */
  total_cost_usd?: number;
  
  /**
   * Execution duration in milliseconds
   */
  duration_ms?: number;
}
```

### Parent-Child Relationship Model

All messages and events include `parent_tool_use_id` to track nesting:

#### SDKAssistantMessage:
```typescript
type SDKAssistantMessage = {
  type: "assistant";
  uuid: UUID;
  session_id: string;
  message: APIAssistantMessage;  // From Anthropic SDK
  parent_tool_use_id: string | null;  // Links to parent tool
}
```

#### SDKUserMessage:
```typescript
type SDKUserMessage = {
  type: "user";
  uuid?: UUID;
  session_id: string;
  message: APIUserMessage;
  parent_tool_use_id: string | null;  // Links to parent tool
}
```

### Streaming Events with Partial Messages

When `includePartialMessages: true`:

#### SDKPartialAssistantMessage:
```typescript
type SDKPartialAssistantMessage = {
  type: "stream_event";
  event: RawMessageStreamEvent;  // From Anthropic SDK
  parent_tool_use_id: string | null;  // Links to parent tool
  uuid: UUID;
  session_id: string;
}
```

**Key Points**:
- Wraps Anthropic SDK's `RawMessageStreamEvent` 
- Includes `parent_tool_use_id` to maintain nesting context
- Only emitted when `includePartialMessages: true`

### Hook Events for Sub-Agent Lifecycle

#### SubagentStart Hook:

```typescript
type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: "SubagentStart";
  agent_id: string;      // Unique identifier for the sub-agent instance
  agent_type: string;    // Type of agent being started
}
```

**Use Cases**:
- Track sub-agent initialization
- Set up agent-specific monitoring
- Log agent hierarchy

#### SubagentStop Hook:

```typescript
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: "SubagentStop";
  stop_hook_active: boolean;  // Whether stop hook is active
}
```

**Use Cases**:
- Cleanup after sub-agent completion
- Aggregate sub-agent metrics
- Handle errors or timeouts

### Available Hook Events

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
  | "SubagentStart"      // ← Sub-agent lifecycle
  | "SubagentStop"       // ← Sub-agent lifecycle
  | "PreCompact"
  | "PermissionRequest";
```

### Hook Configuration

```typescript
const client = createClient({
  hooks: {
    "SubagentStart": [
      {
        match: (input) => input.agent_type === "research_agent",
        callback: async (input, toolUseID, options) => {
          console.log(`Research agent starting: ${input.agent_id}`);
          return {};
        }
      }
    ],
    "SubagentStop": [
      {
        callback: async (input, toolUseID, options) => {
          console.log(`Sub-agent stopped`);
          return {};
        }
      }
    ],
    "PreToolUse": [
      {
        match: (input) => input.tool_name === "Task",
        callback: async (input, toolUseID, options) => {
          console.log(`Delegating to sub-agent: ${input.input.subagent_type}`);
          return {};
        }
      }
    ],
    "PostToolUse": [
      {
        match: (input) => input.tool_name === "Task",
        callback: async (input, toolUseID, options) => {
          console.log(`Sub-agent completed with result`);
          return {};
        }
      }
    ]
  }
});
```

### Base Hook Input

All hook inputs extend:
```typescript
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
}
```

### Tool Result Type

```typescript
type CallToolResult = {
  content: Array<{
    type: "text" | "image" | "resource";
    // Additional fields vary by type
  }>;
  isError?: boolean;
}
```

From `@modelcontextprotocol/sdk/types.js`

### References

- **Source File**: `docs/claude-agent-sdk/typescript-sdk.md` (2177 lines)
- **Key Sections**:
  - Lines 98: `agents` configuration parameter
  - Lines 166-184: `AgentDefinition` type
  - Lines 424-458: Message types with `parent_tool_use_id`
  - Lines 530-540: `SDKPartialAssistantMessage` for streaming
  - Lines 575-593: `HookEvent` types
  - Lines 730-747: `SubagentStartHookInput` and `SubagentStopHookInput`
  - Lines 1310-1339: `TaskOutput` type

---

## 4. OpenTUI Layout System (anomalyco/opentui)

**DeepWiki Search**: https://deepwiki.com/search/how-does-opentui-handle-layout_4cc79fb4-6938-4825-af47-0701e34b8a89

### Layout Engine

OpenTUI uses the **Yoga layout engine** which provides CSS Flexbox-like capabilities for terminal layouts.

### Available Layout Components

#### Core Components:

1. **`Box`**: Versatile container component
   - Supports borders, backgrounds
   - All Flexbox layout properties
   - Groups other renderables and defines layout relationships

2. **`Scrollbox`**: Scrollable container
   - Manages content larger than visible area
   - Horizontal and vertical scrolling
   - Sticky scroll behavior (for logs/chat interfaces)
   - Keyboard navigation support

3. **`Text`**: Styled text display
   - Nested text modifiers: `<span>`, `<strong>`, `<em>`, `<u>`, `<b>`, `<i>`, `<br>`
   - Rich text display capabilities

#### Additional Components:
- `Input` - User input field
- `Textarea` - Multi-line text input
- `Select` - Selection dropdown
- `Code` - Code block with syntax highlighting
- `LineNumber` - Line number display
- `Diff` - Diff viewer
- `ASCIIFont` - ASCII art text
- `FrameBuffer` - Direct pixel manipulation
- `Markdown` - Markdown renderer
- `Slider` - Slider control

### Dynamic Content and Agent Trees

**Flexbox Properties for Dynamic Content**:
```typescript
// Example: Dynamic agent tree layout
<Box flexDirection="column" flexGrow={1}>
  <Box flexShrink={0} height={3}>
    {/* Header - fixed size */}
  </Box>
  
  <Scrollbox flexGrow={1}>
    {/* Dynamic agent tree - grows to fill space */}
    {agents.map(agent => (
      <Box key={agent.id} marginBottom={1}>
        <Text>{agent.name}: {agent.status}</Text>
        <Code>{agent.output}</Code>
      </Box>
    ))}
  </Scrollbox>
  
  <Box flexShrink={0} height={2}>
    {/* Footer - fixed size */}
  </Box>
</Box>
```

**Dynamic Sizing Properties**:
- `flexGrow`: Component expands to fill available space
- `flexShrink`: Component contracts when space is limited
- `flexDirection`: `"row"` or `"column"`

**Reconciler Pattern**:
- React and SolidJS integrations use reconciler pattern
- Translates framework virtual DOM operations into OpenTUI `Renderable` instances
- Enables declarative UI with dynamic updates

### Footer/Fixed Position Elements

#### Absolute Positioning:

```typescript
<Box position="relative" width="100%" height="100%">
  {/* Main content */}
  <Scrollbox flexGrow={1}>
    {/* Scrollable content */}
  </Scrollbox>
  
  {/* Fixed footer */}
  <Box 
    position="absolute" 
    bottom={0} 
    left={0} 
    right={0}
    height={2}
  >
    <Text>Footer content</Text>
  </Box>
</Box>
```

**Positioning Properties**:
- `position: "absolute"` - Remove from normal flow
- `left`, `top`, `right`, `bottom` - Position relative to parent

#### Flexbox Layout for Headers/Footers:

```typescript
<Box flexDirection="column" height="100%">
  {/* Header - maintains size */}
  <Box flexShrink={0} height={3}>
    <Text>Header</Text>
  </Box>
  
  {/* Main content - takes remaining space */}
  <Scrollbox flexGrow={1}>
    {/* Scrollable agent tree */}
  </Scrollbox>
  
  {/* Footer - maintains size */}
  <Box flexShrink={0} height={2}>
    <Text>Footer</Text>
  </Box>
</Box>
```

**Pattern Benefits**:
- Header/footer maintain size with `flexShrink: 0`
- Main content uses `flexGrow: 1` to fill remaining space
- Scrollbox handles its own scrolling independently

### Framework Integration

**Available Integrations**:
- React (`@opentui/react`)
- SolidJS (`@opentui/solid`)

**Example React Usage**:
```typescript
import { Box, Scrollbox, Text } from '@opentui/react';

function AgentTree({ agents }) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Scrollbox flexGrow={1}>
        {agents.map(agent => (
          <AgentNode key={agent.id} agent={agent} depth={0} />
        ))}
      </Scrollbox>
    </Box>
  );
}

function AgentNode({ agent, depth }) {
  return (
    <Box marginLeft={depth * 2}>
      <Text>{agent.name}</Text>
      {agent.children?.map(child => (
        <AgentNode key={child.id} agent={child} depth={depth + 1} />
      ))}
    </Box>
  );
}
```

### References

- **Framework Integration**: [OpenTUI Framework Integration Wiki](https://deepwiki.com/wiki/anomalyco/opentui#7)
- Key Types:
  - `Renderable` - Base type for all UI elements
  - `BoxRenderable` - Container with Flexbox properties
  - `ScrollBoxRenderable` - Scrollable container
  - `TextRenderable` - Text display

---

## Comparison Matrix

| Feature | OpenCode | Copilot SDK | Claude SDK |
|---------|----------|-------------|------------|
| **Sub-Agent Mechanism** | `Task` tool with `subagent_type` | Tool hierarchy with `parentToolCallId` | `Task` tool + `parent_tool_use_id` |
| **Event Model** | SSE with `message.part.updated` | Lifecycle events (`tool.execution_*`) | Hooks + streaming events |
| **Nesting Support** | ✅ Via Task tool | ✅ Via `parentToolCallId` | ✅ Via `parent_tool_use_id` |
| **Streaming** | SSE endpoint (`/event`) | `streaming: true` in config | `includePartialMessages: true` |
| **Tool State** | `running`, `completed`, `error` | `success` boolean + result/error | Hook-based state tracking |
| **Progress Updates** | `message.part.updated` + metadata | `tool.execution_progress` | Partial messages via Anthropic SDK |
| **Sub-Agent Events** | Implicit via `message.part.updated` | `subagent.started`, `subagent.completed` | `SubagentStart`, `SubagentStop` hooks |
| **Content Types** | Attachments array | Text, terminal, image, audio, resource | Text, image, resource (MCP types) |
| **Hooks/Interceptors** | Plugin system (`tool.execute.before/after`) | `onPreToolUse`, `onPostToolUse` | Comprehensive hook system (12 events) |

---

## Key Insights

### 1. Event Granularity

- **OpenCode**: Single event type (`message.part.updated`) with state transitions
  - Simple but requires parsing state changes
  - Metadata updates enable progress tracking
  
- **Copilot SDK**: Dedicated events for each lifecycle stage
  - More events to handle but clearer intent
  - Separate progress events for long-running tools
  
- **Claude SDK**: Hook-based with optional streaming
  - Most flexible - can intercept at multiple points
  - Streaming is opt-in via `includePartialMessages`

### 2. Parent-Child Relationships

All three SDKs track nesting, but with different mechanisms:

- **OpenCode**: Implicit via message structure and tool hierarchy
- **Copilot SDK**: Explicit `parentToolCallId` field
- **Claude SDK**: Explicit `parent_tool_use_id` on all messages

**Recommendation**: Explicit parent IDs (Copilot/Claude approach) make tree reconstruction easier for UI.

### 3. Result Content Types

- **Copilot SDK** has the richest content type support:
  - Terminal output with exit codes
  - Images and audio
  - Resource links with metadata
  
- **OpenCode** uses generic attachments array
- **Claude SDK** follows MCP protocol types

### 4. OpenTUI Layout for Agent Trees

Key patterns for displaying agent hierarchies:

```typescript
// Fixed header/footer with scrollable agent tree
<Box flexDirection="column" height="100%">
  <Box flexShrink={0}>{/* Header */}</Box>
  <Scrollbox flexGrow={1}>
    {renderAgentTree(agents)}
  </Scrollbox>
  <Box flexShrink={0}>{/* Footer */}</Box>
</Box>

// Indent nested agents
function renderAgentTree(agents, depth = 0) {
  return agents.map(agent => (
    <Box marginLeft={depth * 2}>
      <Text>{agent.name}</Text>
      {agent.children && renderAgentTree(agent.children, depth + 1)}
    </Box>
  ));
}
```

---

## Implementation Recommendations

### For Building Sub-Agent UIs:

1. **Use explicit parent IDs**: Track `parent_tool_use_id` / `parentToolCallId` to build agent trees
2. **Stream events**: Enable streaming for real-time updates (`includePartialMessages` or `streaming: true`)
3. **Handle all states**: Support running, completed, error states with appropriate UI feedback
4. **Flexbox layout**: Use `flexGrow` for dynamic content, `flexShrink: 0` for fixed headers/footers
5. **Scrollable containers**: Wrap dynamic agent lists in Scrollbox with `stickyScroll` for logs

### Event Handling Pattern:

```typescript
// Pseudo-code for tracking agent tree
const agentTree = new Map<string, AgentNode>();

function handleToolStart(event) {
  const node = {
    id: event.toolCallId,
    parentId: event.parentToolCallId || event.parent_tool_use_id,
    status: 'running',
    name: event.toolName,
    children: []
  };
  
  agentTree.set(node.id, node);
  
  if (node.parentId) {
    const parent = agentTree.get(node.parentId);
    parent?.children.push(node);
  }
}

function handleToolComplete(event) {
  const node = agentTree.get(event.toolCallId);
  if (node) {
    node.status = event.success ? 'completed' : 'error';
    node.result = event.result || event.output;
    node.error = event.error;
  }
}
```

### OpenTUI Layout Pattern:

```typescript
import { Box, Scrollbox, Text } from '@opentui/react';

function SubAgentDashboard({ rootAgent }) {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Fixed header */}
      <Box flexShrink={0} height={3} borderBottom>
        <Text bold>Agent Execution Tree</Text>
      </Box>
      
      {/* Scrollable agent tree */}
      <Scrollbox flexGrow={1} stickyScroll="bottom">
        <AgentTreeNode agent={rootAgent} depth={0} />
      </Scrollbox>
      
      {/* Fixed footer */}
      <Box flexShrink={0} height={2} borderTop>
        <Text>Status: {rootAgent.status}</Text>
      </Box>
    </Box>
  );
}

function AgentTreeNode({ agent, depth }) {
  const statusIcon = {
    running: '⏳',
    completed: '✅',
    error: '❌'
  }[agent.status];
  
  return (
    <Box flexDirection="column" marginLeft={depth * 2}>
      <Text>
        {statusIcon} {agent.name}
      </Text>
      {agent.children.map(child => (
        <AgentTreeNode key={child.id} agent={child} depth={depth + 1} />
      ))}
    </Box>
  );
}
```

---

## Related Resources

### DeepWiki Searches:
- [OpenCode Sub-Agent Handling](https://deepwiki.com/search/how-does-opencode-handle-subag_4598ffc8-50f0-4ce5-8563-069c60e03e68)
- [Copilot SDK Tool Calls](https://deepwiki.com/search/how-does-the-copilot-sdk-handl_35f77c7a-128d-436b-b281-dc7fc72b32a4)
- [OpenTUI Layout System](https://deepwiki.com/search/how-does-opentui-handle-layout_4cc79fb4-6938-4825-af47-0701e34b8a89)

### Wiki Pages:
- [OpenCode Architecture](https://deepwiki.com/wiki/anomalyco/opencode#2)
- [OpenCode MCP Integration](https://deepwiki.com/wiki/anomalyco/opencode#13)
- [Copilot SDK Event-Driven Architecture](https://deepwiki.com/wiki/github/copilot-sdk#3.3)
- [Copilot SDK TypeScript API](https://deepwiki.com/wiki/github/copilot-sdk#6.1)
- [OpenTUI Framework Integration](https://deepwiki.com/wiki/anomalyco/opentui#7)

### Local Documentation:
- `docs/claude-agent-sdk/typescript-sdk.md` - Claude Agent SDK TypeScript API
- Claude SDK GitHub: https://github.com/anthropics/anthropic-sdk-typescript

---

## Conclusion

All three SDKs provide robust support for sub-agent/background task execution with streaming events. The choice depends on your needs:

- **OpenCode**: Best for SSE-based streaming with simple event model
- **Copilot SDK**: Best for rich content types and granular lifecycle tracking
- **Claude SDK**: Best for flexible hook-based interception with MCP compatibility

For UI implementation with OpenTUI, use Flexbox patterns with `flexGrow`/`flexShrink` for dynamic agent trees and `Scrollbox` for large hierarchies.
