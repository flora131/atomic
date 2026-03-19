---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 02: Provider SDK Unification - Claude, OpenCode, Copilot integration"
tags: [spec, sdk, providers, claude, opencode, copilot, unification, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 02: Provider SDK Unification

## Current State

### Provider Architecture Overview

The current system integrates three coding agent SDKs:

| SDK              | Package                          | Version | Streaming Pattern                                                         |
| ---------------- | -------------------------------- | ------- | ------------------------------------------------------------------------- |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` | ^0.2.76 | `session.stream()` → `AsyncIterable<AgentMessage>` + `client.on()` events |
| OpenCode SDK     | `@opencode-ai/sdk`               | ^1.2.26 | `sdk.event.subscribe()` → `AsyncGenerator<TypedEvent>`                    |
| Copilot SDK      | `@github/copilot-sdk`            | 0.1.32  | `session.on()` → EventEmitter callbacks                                   |

### Client Implementations

**Base Client** (`services/agents/base-client.ts`):
- Shared logic for all providers
- Tool registration, event handler management
- Start/stop lifecycle

**Claude Client** (`services/agents/clients/claude/`, 6+ files):
- `event-emitter.ts` - Custom event emission from SDK hooks
- `hook-bridge.ts` - Bridge between Claude SDK hooks and Atomic events
- `hook-bridge/session-resolution.ts` - Resolves sessions from hook context
- `hook-bridge/subagent-resolution.ts` - Tracks subagent relationships
- `hook-bridge/registration.ts` - Registers hooks with the SDK
- `executable-path.ts` - Finds the Claude CLI binary

Claude has the most complex client because the Claude Agent SDK uses a hook-based architecture where you register hook callbacks that fire during execution. Atomic bridges these hooks to its event system.

**OpenCode Client** (`services/agents/clients/opencode/`):
- Wraps the OpenCode SDK which has a clean event-based API
- `sdk.event.subscribe()` provides typed events as an AsyncGenerator

**Copilot Client** (`services/agents/clients/copilot/`):
- Wraps the Copilot SDK which uses an EventEmitter pattern
- Session has `.on()` handlers for events
- Separate buffer management for streaming chunks

### Event Translation Layer (28 files)

Each provider has its own adapter directory translating native events to BusEvents:

**Claude Adapter** (`services/events/adapters/providers/claude/`, 9 files):
```
claude/
├── streaming-runtime.ts       # Main streaming loop
├── stream-chunk-processor.ts  # SDK chunk → BusEvent translation
├── handler-factory.ts         # Creates event handlers
├── subagent-event-handlers.ts # Subagent lifecycle handling
├── aux-event-handlers.ts      # Session lifecycle, usage, info events
├── tool-hook-handlers.ts      # Tool start/complete from hooks
├── tool-state-events.ts       # Tool state tracking via events
├── tool-state.ts              # Mutable tool state tracker
└── adapter-support.ts         # Shared utilities
```

**OpenCode Adapter** (`services/events/adapters/providers/opencode/`, 9 files):
```
opencode/
├── streaming-runtime.ts       # Main streaming loop
├── stream-chunk-processor.ts  # SDK event → BusEvent translation
├── handler-factory.ts         # Creates event handlers
├── subagent-event-handlers.ts # Subagent lifecycle handling
├── aux-event-handlers.ts      # Session lifecycle events
├── tool-event-handlers.ts     # Tool start/complete
├── child-session-sync.ts      # Child session synchronization
├── tool-state.ts              # Mutable tool state tracker
└── adapter-support.ts         # Shared utilities
```

**Copilot Adapter** (`services/events/adapters/providers/copilot/`, 10 files):
```
copilot/
├── runtime.ts                 # Main streaming loop
├── provider-router.ts         # Routes SDK events to handlers
├── message-tool-handlers.ts   # Message and tool event handling
├── session-handlers.ts        # Session lifecycle
├── subagent-handlers.ts       # Subagent lifecycle
├── state.ts                   # Mutable state tracker
├── types.ts                   # Copilot-specific types
├── support.ts                 # Shared utilities
├── buffer.ts                  # Streaming buffer management
└── (copilot.ts entry point)
```

**Shared** (`services/events/adapters/shared/`):
- Cross-provider utilities

### Provider Events (`services/agents/provider-events/`)
- Provider-specific event type definitions

### Tool ID Inconsistency

The three SDKs use different field names for tool call correlation:
- Claude: `toolUseId` (sometimes `toolUseID`)
- OpenCode: `toolCallId`
- Copilot: `toolCallId`

The adapters must normalize these into the BusEvent `toolId` / `sdkCorrelationId` fields. The `EnrichedBusEvent` type adds `resolvedToolId` as yet another layer.

### Session Lifecycle Differences

| Capability              | Claude                     | OpenCode                          | Copilot                 |
| ----------------------- | -------------------------- | --------------------------------- | ----------------------- |
| Create session          | Yes                        | Yes                               | Yes                     |
| Resume session          | Yes                        | Yes                               | No                      |
| Stream                  | AsyncIterable from session | AsyncGenerator from sdk events    | EventEmitter on session |
| Abort stream            | AbortSignal                | AbortSignal                       | session.abort()         |
| Abort background agents | Yes (via hooks)            | Yes (via SDK API)                 | Limited                 |
| Session commands        | No                         | Yes (session.command())           | No                      |
| MCP snapshot            | Yes                        | Yes                               | No                      |
| Compaction              | Yes                        | Yes (auto)                        | No                      |
| History retrieval       | Yes                        | Yes (getSessionMessagesWithParts) | No                      |
| Model switching         | Yes                        | Yes                               | Limited                 |
| Known agent names       | Yes                        | No                                | No                      |

---

## V2 Spec: Provider SDK Unification

### Design Principle: Adapters as Pure Translators

Each provider adapter is a single module that:
1. Takes the native SDK session
2. Returns `AsyncIterable<StreamEvent>` (the unified type from Spec 00)
3. Has zero dependency on the event bus, state layer, or UI

### 1. Provider Module Structure

Each provider is a self-contained module:

```
services/providers/
├── types.ts                    # CodingAgentProvider interface
├── claude/
│   ├── client.ts              # ClaudeProvider implements CodingAgentProvider
│   ├── adapter.ts             # async *stream() → StreamEvent
│   ├── hooks.ts               # Claude SDK hook registration
│   └── binary-resolver.ts     # Find claude binary
├── opencode/
│   ├── client.ts              # OpenCodeProvider implements CodingAgentProvider
│   ├── adapter.ts             # async *stream() → StreamEvent
│   └── session-sync.ts        # Child session handling
├── copilot/
│   ├── client.ts              # CopilotProvider implements CodingAgentProvider
│   ├── adapter.ts             # async *stream() → StreamEvent
│   └── buffer.ts              # Chunk buffering (Copilot-specific)
└── factory.ts                 # createProvider(agentType) factory
```

**Target**: ~3-4 files per provider (down from 9-10). Total ~15 files (down from ~35).

### 2. Unified Adapter Pattern

Every adapter follows the exact same async generator pattern:

```typescript
// services/providers/claude/adapter.ts

export function createClaudeAdapter(): ProviderAdapter {
  return {
    async *stream(session, message, options): AsyncGenerator<StreamEvent> {
      const { runId, messageId, abortSignal, agent } = options;
      const base = { sessionId: session.id, runId, timestamp: Date.now() };

      yield { ...base, type: "session.start", data: {} };

      const toolTracker = new ToolTracker();

      try {
        const sdkStream = session.stream(message, { agent, abortSignal });

        for await (const chunk of sdkStream) {
          yield* this.translateChunk(chunk, base, messageId, toolTracker);
        }

        yield { ...base, type: "session.idle", timestamp: Date.now(), data: { reason: "complete" } };
      } catch (error) {
        if (abortSignal?.aborted) return;
        yield { ...base, type: "session.error", timestamp: Date.now(), data: { error: String(error) } };
      }
    },

    // Private chunk translation - yields 0 or more StreamEvents per SDK chunk
    *translateChunk(chunk, base, messageId, toolTracker): Generator<StreamEvent> {
      switch (chunk.type) {
        case "text":
          yield { ...base, type: "text.delta", timestamp: Date.now(), data: { delta: chunk.content, messageId } };
          break;
        case "tool_use":
          const toolId = toolTracker.register(chunk.id, chunk.name);
          yield { ...base, type: "tool.start", timestamp: Date.now(), data: { toolId, toolName: chunk.name, toolInput: chunk.input } };
          break;
        case "tool_result":
          const info = toolTracker.resolve(chunk.tool_use_id);
          yield { ...base, type: "tool.complete", timestamp: Date.now(), data: { toolId: info.toolId, toolName: info.name, success: !chunk.is_error, toolResult: chunk.content } };
          break;
        // ... other chunk types
      }
    },

    dispose() {},
  };
}
```

### 3. Tool ID Normalization

**Problem**: `toolUseId`, `toolUseID`, `toolCallId` all represent the same concept.

**Spec**: Each adapter uses a `ToolTracker` to assign stable, provider-agnostic `toolId` values:

```typescript
// services/providers/shared/tool-tracker.ts

class ToolTracker {
  private tools = new Map<string, { toolId: string; name: string; startTime: number }>();
  private nextId = 0;

  /** Register a new tool call. Normalizes any SDK-specific ID into a stable toolId. */
  register(sdkId: string, toolName: string): string {
    const toolId = `tool-${this.nextId++}`;
    this.tools.set(sdkId, { toolId, name: toolName, startTime: Date.now() });
    return toolId;
  }

  /** Resolve an SDK-specific ID back to the normalized tool info. */
  resolve(sdkId: string): { toolId: string; name: string; startTime: number } {
    const info = this.tools.get(sdkId);
    if (!info) throw new Error(`Unknown tool SDK ID: ${sdkId}`);
    return info;
  }
}
```

This eliminates:
- `sdkCorrelationId` on BusEvent
- `resolvedToolId` on EnrichedBusEvent
- All `toolUseId` / `toolUseID` / `toolCallId` aliasing

### 4. Copilot EventEmitter → AsyncIterable Bridge

Copilot's EventEmitter pattern doesn't natively support `AsyncIterable`. The adapter bridges it:

```typescript
// services/providers/copilot/adapter.ts

export function createCopilotAdapter(): ProviderAdapter {
  return {
    async *stream(session, message, options) {
      // Bridge EventEmitter to AsyncIterable
      const channel = createEventChannel<CopilotNativeEvent>();

      const handlers = {
        onText: (delta: string) => channel.put({ type: "text", delta }),
        onToolStart: (tool: CopilotToolEvent) => channel.put({ type: "tool_start", ...tool }),
        onToolComplete: (tool: CopilotToolResult) => channel.put({ type: "tool_complete", ...tool }),
        onDone: () => channel.close(),
        onError: (err: Error) => channel.error(err),
      };

      // Register all handlers
      session.on("text", handlers.onText);
      session.on("tool_start", handlers.onToolStart);
      session.on("tool_complete", handlers.onToolComplete);
      session.on("done", handlers.onDone);
      session.on("error", handlers.onError);

      // Start the stream
      session.send(message);

      try {
        for await (const nativeEvent of channel) {
          yield* translateNativeEvent(nativeEvent, options);
        }
      } finally {
        // Cleanup handlers
        session.off("text", handlers.onText);
        session.off("tool_start", handlers.onToolStart);
        session.off("tool_complete", handlers.onToolComplete);
        session.off("done", handlers.onDone);
        session.off("error", handlers.onError);
      }
    },
    dispose() {},
  };
}

/**
 * Bridge from push-based EventEmitter to pull-based AsyncIterable.
 * Uses a queue with backpressure.
 */
function createEventChannel<T>(): {
  put(event: T): void;
  close(): void;
  error(err: Error): void;
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
};
```

### 5. Subagent Event Normalization

**Problem**: Each SDK represents subagents differently. Claude has explicit subagent hooks, OpenCode uses child sessions, Copilot uses task tools.

**Spec**: Adapters normalize all subagent patterns into the same three events:

```
agent.start  → { agentId, toolCallId, agentType, task, isBackground }
agent.update → { agentId, currentTool?, toolUses? }
agent.complete → { agentId, success, result?, error? }
```

The `agentId` is adapter-generated (not from the SDK), ensuring consistent identification across providers. The mapping:

| Claude                     | OpenCode                      | Copilot              | Normalized       |
| -------------------------- | ----------------------------- | -------------------- | ---------------- |
| subagent hook `onStart`    | child session `session.start` | task tool invocation | `agent.start`    |
| subagent hook `onUpdate`   | child session events          | task tool progress   | `agent.update`   |
| subagent hook `onComplete` | child session `session.idle`  | task tool result     | `agent.complete` |

### 6. Capability Detection

From Spec 00, providers declare capabilities explicitly:

```typescript
// services/providers/claude/client.ts

class ClaudeProvider implements CodingAgentProvider {
  readonly providerType = "claude" as const;

  supports<T extends Capability>(cap: T): boolean {
    switch (cap) {
      case "resume": return true;
      case "compaction": return true;
      case "mcp": return true;
      case "background-agents": return true;
      case "commands": return false;
      default: return false;
    }
  }
  // ...
}
```

This replaces the current pattern of optional methods that force `if (session.abort)` checks everywhere.

### 7. Session Config Normalization

**Problem**: `SessionConfig` has provider-specific fields (`agentMode?: OpenCodeAgentMode`, `agents?: Record<string, ClaudeAgentDefinition>`).

**Spec**: Provider-specific config goes in a typed extension:

```typescript
interface SessionConfig {
  model?: string;
  sessionId?: string;
  additionalInstructions?: string;
  tools?: string[];
  mcpServers?: McpServerConfig[];
  maxBudgetUsd?: number;
  maxTurns?: number;
  reasoningEffort?: string;
}

// Provider-specific extensions
interface ClaudeSessionConfig extends SessionConfig {
  agents?: Record<string, ClaudeAgentDefinition>;
  maxThinkingTokens?: number;
}

interface OpenCodeSessionConfig extends SessionConfig {
  agentMode?: OpenCodeAgentMode;
}
```

The `CodingAgentProvider.createSession()` takes the base `SessionConfig`. Providers that need extra config use their typed extension internally.

### 8. Provider Factory

```typescript
// services/providers/factory.ts

type AgentType = "claude" | "opencode" | "copilot";

function createProvider(agentType: AgentType): CodingAgentProvider {
  switch (agentType) {
    case "claude": return new ClaudeProvider();
    case "opencode": return new OpenCodeProvider();
    case "copilot": return new CopilotProvider();
  }
}

function createAdapter(agentType: AgentType): ProviderAdapter {
  switch (agentType) {
    case "claude": return createClaudeAdapter();
    case "opencode": return createOpenCodeAdapter();
    case "copilot": return createCopilotAdapter();
  }
}
```

### 9. Testing Strategy

Each adapter is tested independently by mocking the SDK session:

```typescript
test("claude adapter handles tool_use → tool_result sequence", async () => {
  const session = mockClaudeSession([
    { type: "tool_use", id: "tu_1", name: "Read", input: { path: "/foo" } },
    { type: "tool_result", tool_use_id: "tu_1", content: "file contents" },
  ]);
  const events = await collectEvents(createClaudeAdapter(), session, "read /foo");
  expect(events).toEqual([
    expect.objectContaining({ type: "session.start" }),
    expect.objectContaining({ type: "tool.start", data: expect.objectContaining({ toolName: "Read" }) }),
    expect.objectContaining({ type: "tool.complete", data: expect.objectContaining({ success: true }) }),
    expect.objectContaining({ type: "session.idle" }),
  ]);
});
```

## Code References (Current)

- `src/services/agents/contracts/client.ts:7-28` - CodingAgentClient interface
- `src/services/agents/contracts/session.ts:66-87` - Session interface with optional methods
- `src/services/agents/contracts/events.ts:79-85` - ToolStartEventData with redundant ID fields
- `src/services/agents/base-client.ts` - Base client implementation
- `src/services/agents/clients/claude/` - Claude client (6+ files)
- `src/services/agents/clients/opencode/` - OpenCode client
- `src/services/agents/clients/copilot/` - Copilot client
- `src/services/events/adapters/providers/claude/` - Claude adapter (9 files)
- `src/services/events/adapters/providers/opencode/` - OpenCode adapter (9 files)
- `src/services/events/adapters/providers/copilot/` - Copilot adapter (10 files)

## Related Research

- `research/docs/2026-01-31-claude-agent-sdk-research.md`
- `research/docs/2026-01-31-opencode-sdk-research.md`
- `research/docs/2026-01-31-github-copilot-sdk-research.md`
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md`
- `research/docs/2026-02-19-sdk-v2-first-unified-layer-research.md`
- `research/docs/2026-03-06-claude-agent-sdk-event-schema.md`
- `research/docs/2026-03-06-opencode-sdk-event-schema-reference.md`
- `research/docs/2026-03-06-copilot-sdk-session-events-schema-reference.md`
- `research/docs/2026-03-02-copilot-sdk-ui-alignment.md`
- `research/docs/2026-03-01-opencode-delegation-streaming-parity.md`
