# GitHub Copilot SDK Research Document

**Date:** January 31, 2026  
**Repository:** [github/copilot-sdk](https://github.com/github/copilot-sdk)  
**Status:** Technical Preview  
**Research Source:** DeepWiki

---

## Table of Contents

1. [Overview](#overview)
2. [SDK Architecture](#sdk-architecture)
3. [Supported Platforms and Languages](#supported-platforms-and-languages)
4. [Client and Connection Management](#client-and-connection-management)
5. [Session Management](#session-management)
6. [Event System](#event-system)
7. [Tool System](#tool-system)
8. [Permission Handling](#permission-handling)
9. [Skills System](#skills-system)
10. [Agent Integration](#agent-integration)
11. [CLI Integration](#cli-integration)
12. [JSON-RPC Protocol](#json-rpc-protocol)
13. [Cookbook Examples](#cookbook-examples)
14. [References](#references)

---

## Overview

The GitHub Copilot SDK enables developers to embed Copilot's agentic workflows into their applications. It follows a **thin client pattern**, where language-specific SDKs act as lightweight wrappers around the Copilot CLI runtime. The SDK communicates with the Copilot CLI server using a bidirectional JSON-RPC 2.0 protocol.

### Key Features

- Multi-language support (Python, TypeScript/Node.js, Go, .NET)
- Session-based conversation management
- Custom tool registration and execution
- Permission handling for sensitive operations
- Declarative skills system
- Custom agent configuration
- Event-driven architecture

> **Note:** The SDK is currently in Technical Preview. While functional for development and testing, it is not recommended for production deployments due to potential API changes.

---

## SDK Architecture

### Three-Tier Component Model

The SDK architecture is structured around three main components:

```
+-------------------+     JSON-RPC 2.0     +------------------+
|    SDK Client     | <------------------> |   Copilot CLI    |
|   (Thin Wrapper)  |     (bidirectional)  |     Server       |
+-------------------+                      +------------------+
        |
        |-- Client (Lifecycle Management)
        |-- Session (Conversation Context)
        |-- Event System (Reactive Interface)
```

### Core Components

| Component | Description |
|-----------|-------------|
| **Client** | Manages the Copilot CLI server process and JSON-RPC connection. Acts as a factory for sessions. |
| **Session** | Represents an individual conversation context with its own message history, tool handlers, and permission handlers. |
| **Event System** | Provides a reactive interface for handling events dispatched by sessions. |

### Communication Protocol

- **Protocol:** JSON-RPC 2.0 with custom message framing
- **Framing:** `Content-Length` headers followed by JSON payload
- **Direction:** Bidirectional (SDK to CLI and CLI to SDK)

**Source:** [SDK Architecture - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#3)

---

## Supported Platforms and Languages

The Copilot SDK supports four programming languages:

| Language | Package Name | Location | Requirements |
|----------|--------------|----------|--------------|
| **Node.js/TypeScript** | `@github/copilot-sdk` | `nodejs/` | Node.js 18+ |
| **Python** | `github-copilot-sdk` | `python/` | Python 3.8+ |
| **Go** | `github.com/github/copilot-sdk/go` | `go/` | Go 1.21+ |
| **.NET** | `GitHub.Copilot.SDK` | `dotnet/` | .NET 8.0+ |

### Cross-Language Consistency

All SDKs implement identical JSON-RPC methods and event types through:
- Shared protocol definitions
- Parallel test suites
- Code-generated types from canonical JSON Schema

**Source:** [Overview - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#1)

---

## Client and Connection Management

### Connection Modes

The SDK supports three connection modes for interacting with the Copilot CLI server:

#### 1. Spawn with stdio (Default)

The client spawns the CLI process and communicates via standard input/output pipes.

```typescript
// TypeScript
const client = new CopilotClient({ useStdio: true });

// Python
client = CopilotClient(use_stdio=True)

// Go
client := copilot.NewClient(copilot.ClientOptions{UseStdio: true})

// .NET
var client = new CopilotClient(new CopilotClientOptions { UseStdio = true });
```

#### 2. Spawn with TCP

The client spawns the CLI process and communicates over a TCP socket.

```typescript
// TypeScript
const client = new CopilotClient({ port: 3000 });

// Python
client = CopilotClient(port=3000)

// Go
client := copilot.NewClient(copilot.ClientOptions{Port: 3000})

// .NET
var client = new CopilotClient(new CopilotClientOptions { Port = 3000 });
```

#### 3. External Server

Connect to an already running external CLI server.

```typescript
// TypeScript
const client = new CopilotClient({ cliUrl: "localhost:3000" });

// Python
client = CopilotClient(cli_url="localhost:3000")

// Go
client := copilot.NewClient(copilot.ClientOptions{CLIUrl: "localhost:3000"})

// .NET
var client = new CopilotClient(new CopilotClientOptions { CliUrl = "localhost:3000" });
```

### Client Lifecycle

```typescript
// Start the client
await client.start();

// ... use the client ...

// Stop the client
await client.stop();
```

**Source:** [Client and Connection Management - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#4.1)

---

## Session Management

### Session Lifecycle

Sessions go through three main phases:

1. **Creation** - Session is initiated with configuration
2. **Active Use** - Application interacts via prompts and receives events
3. **Destruction** - Session is terminated and resources released

### Creating a Session

```typescript
// TypeScript
const session = await client.createSession({
    model: "gpt-5",
    systemMessages: ["You are a helpful assistant"],
    tools: [myCustomTool],
});

// Python
session = await client.create_session({
    "model": "gpt-5",
    "system_messages": ["You are a helpful assistant"],
    "tools": [my_custom_tool],
})

// Go
session, err := client.CreateSession(copilot.SessionConfig{
    Model: "gpt-5",
    SystemMessages: []string{"You are a helpful assistant"},
    Tools: []copilot.Tool{myCustomTool},
})

// .NET
var session = await client.CreateSessionAsync(new SessionConfig {
    Model = "gpt-5",
    SystemMessages = ["You are a helpful assistant"],
    Tools = [myCustomTool],
});
```

### Sending Messages

```typescript
// Fire-and-forget
await session.send({ prompt: "Hello!" });

// Wait for response
const response = await session.sendAndWait({ prompt: "What is TypeScript?" });

// With attachments
await session.send({
    prompt: "Analyze this file",
    attachments: [{ path: "./file.ts" }]
});
```

### Session Persistence and Resumption

Sessions can be persisted and resumed across application restarts:

```typescript
// Create with custom ID
const session = await client.createSession({
    sessionId: "user-123-conversation",
    model: "gpt-5"
});

// Later, resume the session
const resumed = await client.resumeSession("user-123-conversation");

// List all sessions
const sessions = await client.listSessions();

// Delete a session permanently
await client.deleteSession("user-123-conversation");
```

### Session Termination

```typescript
// Destroy session (clears handlers, releases resources)
await session.destroy();

// Abort in-flight message without destroying
await session.abort();
```

**Source:** [Sessions - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#4.2)

---

## Event System

The Copilot SDK provides a robust event system with 31 event types for handling session activities.

### Event Architecture

- Events are emitted by the Copilot CLI via JSON-RPC notifications
- Each session maintains its own list of event handlers
- Handlers are invoked synchronously in registration order
- Errors within handlers are caught to prevent crashes
- Subscription operations are thread-safe

### Event Base Structure

All events share a common base structure:

```typescript
interface SessionEvent {
    id: string;
    timestamp: string;
    parentId?: string;
    type: string;
    data: object;
}
```

### Event Categories

#### Session Lifecycle Events

| Event Type | Description |
|------------|-------------|
| `session.start` | New session created |
| `session.resume` | Existing session resumed |
| `session.idle` | Session ready for input (ephemeral) |
| `session.error` | Session-level error occurred |
| `session.info` | Informational message about session state |
| `session.model_change` | AI model changed |
| `session.handoff` | Session transferred (remote/local) |
| `session.truncation` | History truncated due to token limits |
| `session.usage_info` | Token usage statistics (ephemeral) |
| `session.compaction_start` | History summarization started |
| `session.compaction_complete` | History summarization completed |

#### Assistant Response Events

| Event Type | Description |
|------------|-------------|
| `assistant.turn_start` | Beginning of assistant turn |
| `assistant.intent` | Interpreted intent (ephemeral) |
| `assistant.reasoning` | Complete reasoning content |
| `assistant.reasoning_delta` | Incremental reasoning streaming (ephemeral) |
| `assistant.message` | Complete assistant message |
| `assistant.message_delta` | Incremental message streaming (ephemeral) |
| `assistant.turn_end` | End of assistant turn |
| `assistant.usage` | Token usage and cost metrics (ephemeral) |

#### Tool Execution Events

| Event Type | Description |
|------------|-------------|
| `tool.user_requested` | User explicitly requested tool |
| `tool.execution_start` | Tool execution started |
| `tool.execution_partial_result` | Streaming partial results (ephemeral) |
| `tool.execution_progress` | Progress updates (ephemeral) |
| `tool.execution_complete` | Tool execution completed |

#### Subagent Events

| Event Type | Description |
|------------|-------------|
| `subagent.selected` | Subagent selected for task |
| `subagent.started` | Subagent execution started |
| `subagent.completed` | Subagent completed successfully |
| `subagent.failed` | Subagent failed with error |

#### Other Events

| Event Type | Description |
|------------|-------------|
| `user.message` | User message sent |
| `pending_messages.modified` | Pending messages queue modified (ephemeral) |
| `hook.start` | Hook execution started |
| `hook.end` | Hook execution completed |
| `system.message` | System message injected |
| `abort` | Operation aborted |

### Subscribing to Events

```typescript
// TypeScript
const unsubscribe = session.on((event) => {
    switch (event.type) {
        case "assistant.message":
            console.log(`Assistant: ${event.data.content}`);
            break;
        case "session.error":
            console.error(`Error: ${event.data.message}`);
            break;
    }
});

// Later, unsubscribe
unsubscribe();
```

```csharp
// .NET
using var subscription = session.On(evt =>
{
    switch (evt)
    {
        case AssistantMessageEvent msg:
            Console.WriteLine($"Assistant: {msg.Data.Content}");
            break;
        case SessionErrorEvent err:
            Console.WriteLine($"Error: {err.Data.Message}");
            break;
    }
});
```

### Streaming Responses

Enable streaming in session configuration:

```typescript
const session = await client.createSession({
    model: "gpt-5",
    streaming: true
});

session.on((event) => {
    if (event.type === "assistant.message_delta") {
        process.stdout.write(event.data.content);
    }
    if (event.type === "assistant.message") {
        console.log("\n[Complete message received]");
    }
});
```

**Source:** [Event System - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#4.3)

---

## Tool System

### Tool Registration

Tools are registered when creating a session. Each tool requires:

| Property | Description |
|----------|-------------|
| `name` | Unique identifier for the tool |
| `description` | Human-readable explanation (used by AI to decide when to invoke) |
| `parameters` | JSON schema defining expected arguments |
| `handler` | Function containing tool logic |

### Defining Tools

#### TypeScript

```typescript
import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { z } from "zod";

const lookupIssueTool = defineTool({
    name: "lookup_issue",
    description: "Fetch issue details from our tracker",
    parameters: z.object({
        id: z.string().describe("Issue identifier")
    }),
    handler: async (params) => {
        const issue = await fetchIssue(params.id);
        return issue.summary;
    }
});

const session = await client.createSession({
    model: "gpt-5",
    tools: [lookupIssueTool]
});
```

#### Python

```python
from pydantic import BaseModel, Field
from copilot import CopilotClient, define_tool

class LookupIssueParams(BaseModel):
    id: str = Field(description="Issue identifier")

@define_tool(description="Fetch issue details from our tracker")
async def lookup_issue(params: LookupIssueParams) -> str:
    issue = await fetch_issue(params.id)
    return issue.summary

session = await client.create_session({
    "model": "gpt-5",
    "tools": [lookup_issue],
})
```

#### Go

```go
lookupIssueTool := copilot.DefineTool(
    "lookup_issue",
    "Fetch issue details from our tracker",
    func(params LookupIssueParams) (string, error) {
        issue, err := fetchIssue(params.ID)
        if err != nil {
            return "", err
        }
        return issue.Summary, nil
    },
)

session, err := client.CreateSession(copilot.SessionConfig{
    Model: "gpt-5",
    Tools: []copilot.Tool{lookupIssueTool},
})
```

#### .NET

```csharp
var lookupIssueTool = new Tool
{
    Name = "lookup_issue",
    Description = "Fetch issue details from our tracker",
    Parameters = new JsonSchema { /* schema definition */ },
    Handler = async (invocation) =>
    {
        var id = invocation.Arguments["id"].ToString();
        var issue = await FetchIssue(id);
        return new ToolResult { TextResultForLLM = issue.Summary };
    }
};

var session = await client.CreateSessionAsync(new SessionConfig
{
    Model = "gpt-5",
    Tools = [lookupIssueTool]
});
```

### Tool Execution Flow

```
1. AI Model Decision
   └── AI determines tool invocation based on prompt and tool description

2. CLI Request
   └── CLI sends `tool.call` JSON-RPC request to SDK
       ├── sessionId
       ├── toolCallId
       ├── toolName
       └── arguments

3. SDK Dispatch
   └── Client receives request and looks up Session

4. Handler Lookup
   └── Session retrieves registered ToolHandler

5. Handler Execution
   └── SDK executes ToolHandler with ToolInvocation object

6. Result Handling
   └── ToolHandler returns ToolResult
       ├── TextResultForLLM (output for AI)
       ├── ResultType (success/failure)
       └── Error (optional debugging info)

7. CLI Response
   └── SDK sends ToolResult back to CLI

8. AI Processing
   └── AI incorporates result into response
```

### Tool Result Structure

```typescript
interface ToolResult {
    textResultForLLM: string;    // Output for the AI model
    resultType: "success" | "failure";
    error?: {
        message: string;
        details?: string;
    };
}
```

### Error Handling

The SDK includes defensive programming with panic recovery to handle exceptions during tool execution:

- Panics/exceptions are caught and converted to failure results
- AI model receives appropriate feedback without exposing sensitive details
- Application stability is maintained

**Source:** [Tools and Tool Invocation - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#4.4)

---

## Permission Handling

Permission handlers allow you to approve or deny requests from the Copilot CLI for sensitive operations.

### Permission Request Flow

```
1. CLI requires permission for sensitive action
   └── Sends `permission.request` JSON-RPC request to SDK

2. SDK receives request
   └── Deserializes into PermissionRequest object

3. Handler invocation
   └── Registered PermissionHandler is called

4. Decision
   └── Handler returns PermissionRequestResult
       ├── "approved"
       ├── "denied-by-rules"
       ├── "denied-no-approval-rule-and-could-not-request-from-user"
       └── "denied-interactively-by-user"
```

### Permission Request Kinds

| Kind | Description |
|------|-------------|
| `shell` | Execute a shell command |
| `write` | Write to a file |
| `read` | Read a file |
| `url` | Access a URL |
| `mcp` | Model Context Protocol operations |

### Implementing Permission Handlers

#### TypeScript

```typescript
const session = await client.createSession({
    model: "gpt-5",
    onPermissionRequest: async (request, invocation) => {
        if (request.kind === "shell") {
            // Prompt user or check policies
            const approved = await promptUser(
                `Allow shell command: ${request.extra?.command}?`
            );
            return { kind: approved ? "approved" : "denied-interactively-by-user" };
        }
        return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
    }
});
```

#### Python

```python
async def permission_handler(request, invocation):
    if request.kind == "shell":
        approved = await prompt_user(f"Allow shell command: {request.extra.get('command')}?")
        return {"kind": "approved" if approved else "denied-interactively-by-user"}
    return {"kind": "denied-no-approval-rule-and-could-not-request-from-user"}

session = await client.create_session({
    "model": "gpt-5",
    "on_permission_request": permission_handler
})
```

#### .NET

```csharp
var session = await client.CreateSessionAsync(new SessionConfig
{
    Model = "gpt-5",
    OnPermissionRequest = async (request, invocation) =>
    {
        if (request.Kind == "shell")
        {
            var approved = await PromptUser($"Allow shell command?");
            return new PermissionRequestResult 
            { 
                Kind = approved ? "approved" : "denied-interactively-by-user" 
            };
        }
        return new PermissionRequestResult 
        { 
            Kind = "denied-no-approval-rule-and-could-not-request-from-user" 
        };
    }
});
```

### Default Behavior

If no permission handler is registered, or if the handler fails, permission requests are automatically denied with `"denied-no-approval-rule-and-could-not-request-from-user"`.

**Source:** [Permission Handling - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#4.5)

---

## Skills System

The Skills System provides a declarative way to extend AI behavior using Markdown-based instruction files.

### Key Characteristics

- **Lazy-loaded:** Skills are only injected when invoked by the AI
- **Token-efficient:** Conserves context window by loading on-demand
- **Declarative:** Defined via `SKILL.md` files with YAML frontmatter

### Skill File Format

Create a `SKILL.md` file:

```markdown
---
name: code-review
description: Expert code review guidance for security and performance
---

# Code Review Guidelines

When reviewing code, focus on:

1. **Security**
   - Check for SQL injection vulnerabilities
   - Validate input sanitization
   - Review authentication/authorization

2. **Performance**
   - Look for N+1 query issues
   - Check for unnecessary re-renders
   - Identify memory leaks

3. **Maintainability**
   - Ensure proper error handling
   - Check for code duplication
   - Verify naming conventions
```

### Registering Skills

```typescript
// TypeScript
const session = await client.createSession({
    skillDirectories: [".skills"],
    disabledSkills: ["deprecated-skill"]
});

// Python
session = await client.create_session({
    "skill_directories": [".skills"],
    "disabled_skills": ["deprecated-skill"]
})

// Go
session, err := client.CreateSession(copilot.SessionConfig{
    SkillDirectories: []string{".skills"},
    DisabledSkills:   []string{"deprecated-skill"},
})

// .NET
var session = await client.CreateSessionAsync(new SessionConfig
{
    SkillDirectories = [".skills"],
    DisabledSkills = ["deprecated-skill"]
});
```

### How Skills Work

1. AI model receives user prompt
2. AI determines skill is needed based on context
3. AI makes `tool_call` to the `skill` tool
4. CLI loads `SKILL.md` content
5. Content is injected within `<skill-context>` XML tags
6. AI processes prompt with skill instructions

### Known Limitations

- Applying skills on session resumption may not work correctly across all SDKs
- Workaround: Configure skills during initial session creation

**Source:** [Skills System - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#4.6)

---

## Agent Integration

Custom agents allow you to define specialized AI personas for specific tasks.

### Agent Configuration Options

| Option | Description |
|--------|-------------|
| `name` | Unique identifier for the agent |
| `displayName` | Optional name for UI purposes |
| `description` | Optional description of agent function |
| `tools` | List of tool names the agent can use (null = all tools) |
| `prompt` | Core prompt defining agent behavior |
| `mcpServers` | Dictionary of MCP servers specific to this agent |
| `infer` | Boolean for model inference availability |

### Creating Custom Agents

#### TypeScript

```typescript
const session = await client.createSession({
    customAgents: [{
        name: "pr-reviewer",
        displayName: "PR Reviewer",
        description: "Reviews pull requests for best practices",
        prompt: `You are an expert code reviewer. Focus on:
            - Security vulnerabilities
            - Performance optimizations
            - Code maintainability
            - Test coverage`,
        tools: ["read_file", "search_code", "get_pr_diff"]
    }, {
        name: "bug-fixer",
        displayName: "Bug Fixer",
        description: "Diagnoses and fixes bugs",
        prompt: "You are a debugging expert. Systematically identify root causes.",
        tools: null  // Can use all tools
    }]
});
```

#### Python

```python
session = await client.create_session({
    "custom_agents": [{
        "name": "pr-reviewer",
        "display_name": "PR Reviewer",
        "description": "Reviews pull requests for best practices",
        "prompt": """You are an expert code reviewer. Focus on:
            - Security vulnerabilities
            - Performance optimizations
            - Code maintainability""",
        "tools": ["read_file", "search_code", "get_pr_diff"]
    }]
})
```

#### Go

```go
session, err := client.CreateSession(copilot.SessionConfig{
    CustomAgents: []copilot.CustomAgentConfig{{
        Name:        "pr-reviewer",
        DisplayName: "PR Reviewer",
        Description: "Reviews pull requests for best practices",
        Prompt:      "You are an expert code reviewer...",
        Tools:       []string{"read_file", "search_code", "get_pr_diff"},
    }},
})
```

### Agent Orchestration

The Copilot CLI handles agent orchestration, planning, and tool execution based on the provided configuration. When the SDK passes `CustomAgents` to the CLI during session creation, the CLI uses this information for:

- Agent selection based on user intent
- Tool availability filtering
- Response generation with agent persona

**Source:** [SDK Architecture - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#3)

---

## CLI Integration

### Integration Pattern

The SDK integrates with the Copilot CLI using a thin client pattern. The `Client` class manages:

- CLI server process lifecycle
- JSON-RPC connection
- Message routing

### CLI Execution

The client executes `copilot --server` with appropriate arguments based on the connection mode:

```bash
# stdio mode
copilot --server

# TCP mode with specific port
copilot --server --port 3000

# TCP mode with random port
copilot --server --port 0
```

### Extending CLI with Custom Commands

The SDK extends CLI capabilities through **Tools** rather than direct command-line extensions:

1. **Define Tool** - Create tool with name, description, and handler
2. **Register Tool** - Pass tools in `SessionConfig` when creating session
3. **CLI Invocation** - CLI sends `tool.call` requests when needed
4. **Result Return** - SDK executes handler and returns result

This pattern allows the Copilot CLI's agent runtime to invoke your custom functions as needed during execution.

**Source:** [SDK Architecture - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#3)

---

## JSON-RPC Protocol

### Message Format

The SDK uses JSON-RPC 2.0 with `Content-Length` header framing.

#### Request

```json
{
    "jsonrpc": "2.0",
    "id": "unique-request-id",
    "method": "session.create",
    "params": {
        "model": "gpt-5",
        "streaming": true
    }
}
```

#### Response

```json
{
    "jsonrpc": "2.0",
    "id": "unique-request-id",
    "result": {
        "sessionId": "session-abc123"
    }
}
```

#### Error Response

```json
{
    "jsonrpc": "2.0",
    "id": "unique-request-id",
    "error": {
        "code": -32600,
        "message": "Invalid Request",
        "data": { "details": "..." }
    }
}
```

#### Notification (no response expected)

```json
{
    "jsonrpc": "2.0",
    "method": "session.event",
    "params": {
        "sessionId": "session-abc123",
        "event": { "type": "assistant.message", "..." }
    }
}
```

### Available Methods

#### SDK to CLI

| Method | Description |
|--------|-------------|
| `session.create` | Create a new session |
| `session.resume` | Resume an existing session |
| `session.send` | Send a user message |
| `session.delete` | Delete a session |
| `session.list` | List all active sessions |
| `session.getLastId` | Get most recent session ID |
| `ping` | Health check and version verification |
| `status.get` | Get CLI status including version |
| `auth.getStatus` | Get authentication status |
| `models.list` | List available AI models |

#### CLI to SDK

| Method | Description |
|--------|-------------|
| `tool.call` | Execute a custom tool |
| `permission.request` | Request permission for sensitive operation |
| `session.event` | Emit session events (notification) |

### Message Framing

Messages are sent with `Content-Length` header:

```
Content-Length: 123

{"jsonrpc":"2.0","id":"1","method":"session.create","params":{...}}
```

**Source:** [SDK Architecture - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#3)

---

## Cookbook Examples

### Error Handling (Go)

```go
package main

import (
    "fmt"
    "log"
    "github.com/github/copilot-sdk/go"
)

func main() {
    client := copilot.NewClient()

    if err := client.Start(); err != nil {
        log.Fatalf("Failed to start client: %v", err)
    }
    defer func() {
        if err := client.Stop(); err != nil {
            log.Printf("Error stopping client: %v", err)
        }
    }()

    session, err := client.CreateSession(copilot.SessionConfig{
        Model: "gpt-5",
    })
    if err != nil {
        log.Fatalf("Failed to create session: %v", err)
    }
    defer session.Destroy()

    responseChan := make(chan string, 1)
    session.On(func(event copilot.Event) {
        if msg, ok := event.(copilot.AssistantMessageEvent); ok {
            responseChan <- msg.Data.Content
        }
    })

    if err := session.Send(copilot.MessageOptions{Prompt: "Hello!"}); err != nil {
        log.Printf("Failed to send message: %v", err)
    }

    response := <-responseChan
    fmt.Println(response)
}
```

### Multiple Sessions (TypeScript)

```typescript
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient();
await client.start();

// Create multiple independent sessions
const session1 = await client.createSession({ model: "gpt-5" });
const session2 = await client.createSession({ model: "gpt-5" });
const session3 = await client.createSession({ model: "claude-sonnet-4.5" });

// Each session maintains its own conversation history
await session1.sendAndWait({ prompt: "You are helping with a Python project" });
await session2.sendAndWait({ prompt: "You are helping with a TypeScript project" });
await session3.sendAndWait({ prompt: "You are helping with a Go project" });

// Follow-up messages stay in their respective contexts
await session1.sendAndWait({ prompt: "How do I create a virtual environment?" });
await session2.sendAndWait({ prompt: "How do I set up tsconfig?" });
await session3.sendAndWait({ prompt: "How do I initialize a module?" });

// Clean up all sessions
await session1.destroy();
await session2.destroy();
await session3.destroy();
await client.stop();
```

### File Organization (Python)

```python
from copilot import CopilotClient
import os

client = CopilotClient()
client.start()

session = client.create_session(model="gpt-5")

def handle_event(event):
    if event["type"] == "assistant.message":
        print(f"\nCopilot: {event['data']['content']}")
    elif event["type"] == "tool.execution_start":
        print(f"  -> Running: {event['data']['toolName']}")
    elif event["type"] == "tool.execution_complete":
        print(f"  Done: {event['data']['toolCallId']}")

session.on(handle_event)

target_folder = os.path.expanduser("~/Downloads")

session.send(prompt=f"""
Analyze the files in "{target_folder}" and organize them into subfolders.

1. First, list all files and their metadata
2. Preview grouping by file extension
3. Create appropriate subfolders (e.g., "images", "documents", "videos")
4. Move each file to its appropriate subfolder

Please confirm before moving any files.
""")

session.wait_for_idle()
client.stop()
```

### Session Persistence (Go)

```go
package main

import (
    "fmt"
    "log"
    "github.com/github/copilot-sdk/go"
)

func main() {
    client := copilot.NewClient()
    if err := client.Start(); err != nil {
        log.Fatal(err)
    }
    defer client.Stop()

    // Create session with memorable ID
    session, err := client.CreateSession(copilot.SessionConfig{
        SessionID: "user-123-conversation",
        Model:     "gpt-5",
    })
    if err != nil {
        log.Fatal(err)
    }

    if err := session.Send(copilot.MessageOptions{Prompt: "Let's discuss TypeScript generics"}); err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Session created: %s\n", session.SessionID)

    // Destroy session but keep data on disk
    if err := session.Destroy(); err != nil {
        log.Fatal(err)
    }
    fmt.Println("Session destroyed (state persisted)")

    // Resume the previous session
    resumed, err := client.ResumeSession("user-123-conversation")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Resumed: %s\n", resumed.SessionID)

    if err := resumed.Send(copilot.MessageOptions{Prompt: "What were we discussing?"}); err != nil {
        log.Fatal(err)
    }

    // List sessions
    sessions, err := client.ListSessions()
    if err != nil {
        log.Fatal(err)
    }
    ids := make([]string, 0, len(sessions))
    for _, s := range sessions {
        ids = append(ids, s.SessionID)
    }
    fmt.Printf("Sessions: %v\n", ids)

    // Delete session permanently
    if err := client.DeleteSession("user-123-conversation"); err != nil {
        log.Fatal(err)
    }
    fmt.Println("Session deleted")
}
```

**Source:** [Examples and Cookbook - DeepWiki](https://deepwiki.com/wiki/github/copilot-sdk#9)

---

## References

### DeepWiki Documentation

| Topic | Link |
|-------|------|
| Overview | https://deepwiki.com/wiki/github/copilot-sdk#1 |
| Getting Started | https://deepwiki.com/wiki/github/copilot-sdk#2 |
| SDK Architecture | https://deepwiki.com/wiki/github/copilot-sdk#3 |
| Client-Server Model | https://deepwiki.com/wiki/github/copilot-sdk#3.1 |
| Multi-Language Design | https://deepwiki.com/wiki/github/copilot-sdk#3.2 |
| Client and Connection Management | https://deepwiki.com/wiki/github/copilot-sdk#4.1 |
| Sessions | https://deepwiki.com/wiki/github/copilot-sdk#4.2 |
| Event System | https://deepwiki.com/wiki/github/copilot-sdk#4.3 |
| Tools and Tool Invocation | https://deepwiki.com/wiki/github/copilot-sdk#4.4 |
| Permission Handling | https://deepwiki.com/wiki/github/copilot-sdk#4.5 |
| Skills System | https://deepwiki.com/wiki/github/copilot-sdk#4.6 |
| TypeScript/Node.js SDK | https://deepwiki.com/wiki/github/copilot-sdk#6.1 |
| Python SDK | https://deepwiki.com/wiki/github/copilot-sdk#6.2 |
| Go SDK | https://deepwiki.com/wiki/github/copilot-sdk#6.3 |
| .NET SDK | https://deepwiki.com/wiki/github/copilot-sdk#6.4 |
| Examples and Cookbook | https://deepwiki.com/wiki/github/copilot-sdk#9 |

### DeepWiki Search Results

| Search Query | Link |
|--------------|------|
| SDK Architecture | https://deepwiki.com/search/what-is-the-architecture-of-th_6ffdddd6-ffb4-4a45-bf31-56f0f421a77e |
| Tool Integration | https://deepwiki.com/search/how-do-i-integrate-tools-with_ac394c68-833c-470d-949b-e4e366eaa8a7 |
| Event System | https://deepwiki.com/search/what-events-are-available-in-t_3cd3b6d3-646b-446d-8fd3-6015c8cc3a62 |
| Session Management | https://deepwiki.com/search/how-do-i-manage-sessions-and-c_c51ca5e1-00c9-407b-8609-aca1ad72b829 |
| CLI Integration | https://deepwiki.com/search/what-is-the-cli-integration-pa_1d07d41c-6b32-4ac8-b681-b8777e01b580 |
| Supported Languages | https://deepwiki.com/search/what-languages-and-platforms-a_8f397e1c-a116-48bf-badf-51d9b4bd4826 |
| Agent Configuration | https://deepwiki.com/search/how-do-i-create-and-configure_77f2ff54-5f68-4f7f-a355-c212d679f259 |
| Permission Handlers | https://deepwiki.com/search/what-are-permission-handlers-i_2fd86cc3-a725-456a-9e70-3763dfef7706 |
| Skills System | https://deepwiki.com/search/what-is-the-skills-system-in-t_c91f8990-8f04-41e1-9fb8-c56378bd5e2a |
| Cookbook Examples | https://deepwiki.com/search/what-examples-and-cookbook-pat_b8db98da-3309-492e-9674-b87b06bb68f6 |
| JSON-RPC Protocol | https://deepwiki.com/search/what-is-the-jsonrpc-protocol-u_6e8f73b4-2741-4bca-bccd-285b1f373112 |

### GitHub Repository

- **Repository:** https://github.com/github/copilot-sdk
- **Status:** Technical Preview

---

*This research document was compiled using DeepWiki on January 31, 2026.*
