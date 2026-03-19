---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 00: Foundation Layer - Shared types, contracts, and dependency rules"
tags: [spec, foundation, types, contracts, dependency-rules, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 00: Foundation Layer

## Current State

### Types Layer (`src/types/`, 287 lines)

The shared types layer contains 4 files:
- `chat.ts` (1 line) - re-exports from `state/chat/shared/types/`
- `command.ts` (125 lines) - CommandContext, CommandDefinition, CommandResult, CommandContextState
- `parallel-agents.ts` (54 lines) - ParallelAgent, AgentStatus, ParallelAgentsTreeProps
- `ui.ts` (110 lines) - FooterState, VerboseProps, EnhancedMessageMeta

**Current issues documented:**
- `types/chat.ts` violates the dependency rule by re-exporting from `state/` (the shared layer should not import from the state layer)
- `types/command.ts` imports from `services/agents/types.ts`, `services/models/`, `services/workflows/graph/types.ts`, `services/workflows/runtime-contracts.ts`, `state/runtime/stream-run-runtime.ts` - mixing layer boundaries
- `CommandContext` (34 properties/methods) is a god interface coupling 7+ concerns: session management, messaging, streaming, workflow state, MCP servers, model operations, and task lists

### Contracts Layer (`src/services/agents/contracts/`, 8 files)

Provider contracts are scattered across the agents service:
- `client.ts` - CodingAgentClient interface (23 lines, 5 optional methods)
- `session.ts` - Session interface (88 lines, 5 optional methods)
- `events.ts` - 25 AgentEvent types + EventDataMap (247 lines)
- `models.ts` - ModelDisplayInfo, OpenCodeAgentMode
- `messages.ts` - AgentMessage types
- `tools.ts` - ToolDefinition
- `mcp.ts` - McpServerConfig, McpRuntimeSnapshot
- `subagent-stream.ts` - Subagent streaming contracts

**Current issues documented:**
- Optional methods (`?`) on CodingAgentClient and Session indicate the abstraction doesn't capture what all providers can actually do
- `BaseEventData` uses `[key: string]: unknown` index signature, making every event data type structurally open and defeating TypeScript's type safety
- Event types like `ToolStartEventData` have redundant fields: `toolUseId`, `toolUseID`, `toolCallId` - reflecting different SDK naming conventions leaking through

### Lib Layer (`src/lib/`, 1,075 lines)

- `markdown.ts` - Markdown utilities
- `merge.ts` - Deep merge utilities
- `path-root-guard.ts` - Path validation
- `lib/ui/` - UI utilities (hitl-response, clipboard, format, navigation, mcp-output, mention-parsing)

**Current issues documented:**
- `lib/ui/` contains domain-specific helpers (MCP output formatting, mention parsing) that arguably belong closer to their consumers
- `lib/ui/mcp-output.ts` exports `McpServerToggleMap` and `McpSnapshotView` types that are imported by `types/command.ts`, creating a transitive dependency from the types layer through lib into service-level concepts

### Boundary Enforcement (`src/scripts/`)

- `check-submodule-boundaries.ts` - Enforces chat state sub-module import rules
- `check-dependency-direction.ts` - Enforces unidirectional layer dependencies

---

## V2 Spec: Foundation Layer

### 1. Single Event Type

**Problem**: The current system has two event hierarchies (`AgentEvent` with 25 types, `BusEvent` with 28 schemas) requiring a translation layer per provider. This doubles the surface area and creates fragility at the translation boundary.

**Spec**: Define a single `StreamEvent` type as the canonical event type throughout the system.

```typescript
// types/events.ts
import { z } from "zod";

// Single event discriminated union - every event has a type, sessionId, runId, timestamp
const StreamEventBase = z.object({
  type: z.string(),
  sessionId: z.string(),
  runId: z.number(),
  timestamp: z.number(),
});

// Text streaming
const TextDelta = StreamEventBase.extend({
  type: z.literal("text.delta"),
  data: z.object({ delta: z.string(), messageId: z.string() }),
});
const TextComplete = StreamEventBase.extend({
  type: z.literal("text.complete"),
  data: z.object({ messageId: z.string(), fullText: z.string() }),
});

// Thinking/reasoning
const ThinkingDelta = StreamEventBase.extend({
  type: z.literal("thinking.delta"),
  data: z.object({ delta: z.string(), sourceKey: z.string(), messageId: z.string() }),
});
const ThinkingComplete = StreamEventBase.extend({
  type: z.literal("thinking.complete"),
  data: z.object({ sourceKey: z.string(), durationMs: z.number() }),
});

// Tool lifecycle
const ToolStart = StreamEventBase.extend({
  type: z.literal("tool.start"),
  data: z.object({ toolId: z.string(), toolName: z.string(), toolInput: z.record(z.unknown()) }),
});
const ToolComplete = StreamEventBase.extend({
  type: z.literal("tool.complete"),
  data: z.object({ toolId: z.string(), toolName: z.string(), success: z.boolean(), toolResult: z.unknown(), error: z.string().optional() }),
});

// Agent/subagent lifecycle
const AgentStart = StreamEventBase.extend({
  type: z.literal("agent.start"),
  data: z.object({ agentId: z.string(), toolCallId: z.string(), agentType: z.string(), task: z.string(), isBackground: z.boolean() }),
});
const AgentUpdate = StreamEventBase.extend({
  type: z.literal("agent.update"),
  data: z.object({ agentId: z.string(), currentTool: z.string().optional(), toolUses: z.number().optional() }),
});
const AgentComplete = StreamEventBase.extend({
  type: z.literal("agent.complete"),
  data: z.object({ agentId: z.string(), success: z.boolean(), result: z.string().optional(), error: z.string().optional() }),
});

// Session lifecycle
const SessionStart = StreamEventBase.extend({ type: z.literal("session.start"), data: z.object({}) });
const SessionIdle = StreamEventBase.extend({ type: z.literal("session.idle"), data: z.object({ reason: z.string().optional() }) });
const SessionError = StreamEventBase.extend({ type: z.literal("session.error"), data: z.object({ error: z.string(), code: z.string().optional() }) });
const SessionRetry = StreamEventBase.extend({ type: z.literal("session.retry"), data: z.object({ attempt: z.number(), delay: z.number(), message: z.string() }) });

// Turn lifecycle
const TurnStart = StreamEventBase.extend({ type: z.literal("turn.start"), data: z.object({ turnId: z.string() }) });
const TurnEnd = StreamEventBase.extend({
  type: z.literal("turn.end"),
  data: z.object({ turnId: z.string(), finishReason: z.enum(["tool-calls", "stop", "max-tokens", "max-turns", "error", "unknown"]).optional() }),
});

// Human interaction
const PermissionRequested = StreamEventBase.extend({
  type: z.literal("permission.requested"),
  data: z.object({
    requestId: z.string(),
    toolName: z.string(),
    question: z.string(),
    options: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
});
const HumanInputRequired = StreamEventBase.extend({
  type: z.literal("human_input.required"),
  data: z.object({ requestId: z.string(), question: z.string(), nodeId: z.string() }),
});

// Usage/telemetry
const Usage = StreamEventBase.extend({
  type: z.literal("usage"),
  data: z.object({ inputTokens: z.number(), outputTokens: z.number(), model: z.string().optional() }),
});

// Session metadata
const TitleChanged = StreamEventBase.extend({ type: z.literal("session.title_changed"), data: z.object({ title: z.string() }) });
const Compaction = StreamEventBase.extend({ type: z.literal("session.compaction"), data: z.object({ phase: z.enum(["start", "complete"]), success: z.boolean().optional() }) });

// Discriminated union of all events
export const StreamEventSchema = z.discriminatedUnion("type", [
  TextDelta, TextComplete,
  ThinkingDelta, ThinkingComplete,
  ToolStart, ToolComplete,
  AgentStart, AgentUpdate, AgentComplete,
  SessionStart, SessionIdle, SessionError, SessionRetry,
  TurnStart, TurnEnd,
  PermissionRequested, HumanInputRequired,
  Usage, TitleChanged, Compaction,
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type StreamEventType = StreamEvent["type"];
```

**Key differences from current**:
- One type hierarchy, not two
- No `[key: string]: unknown` index signatures - every field is typed
- No redundant ID fields (`toolUseId` / `toolUseID` / `toolCallId` collapse to `toolId`)
- Response callbacks (`respond`) are NOT in event data - they're handled by a separate interaction layer (see Spec 01)
- Zod discriminated union provides exhaustive type narrowing
- ~20 event types (down from 25 + 28 = 53 total)

### 2. Capability-Based Provider Interface

**Problem**: The current `CodingAgentClient` and `Session` interfaces have 5 optional methods each, signaling that providers have different capabilities. Optional methods force every consumer to check for capability at every call site.

**Spec**: Replace optional methods with explicit capability detection.

```typescript
// types/provider.ts

/** Core session contract - every provider MUST implement all of these */
interface Session {
  readonly id: string;
  stream(message: string, options: StreamOptions): AsyncIterable<StreamEvent>;
  abort(): Promise<void>;
  destroy(): Promise<void>;
  getContextUsage(): Promise<ContextUsage>;
}

/** Stream options */
interface StreamOptions {
  agent?: string;
  abortSignal?: AbortSignal;
}

/** Optional capabilities that providers MAY support */
interface ResumeCapability {
  resumeSession(sessionId: string): Promise<Session | null>;
  getSessionHistory(sessionId: string): Promise<HistoryMessage[]>;
}

interface CompactionCapability {
  summarize(): Promise<void>;
  getCompactionState(): CompactionState | null;
}

interface McpCapability {
  getMcpSnapshot(): Promise<McpSnapshot>;
}

interface BackgroundAgentCapability {
  abortBackgroundAgents(): Promise<void>;
}

interface CommandCapability {
  command(name: string, args: string, options?: StreamOptions): Promise<void>;
}

/** Provider factory interface */
interface CodingAgentProvider {
  readonly providerType: "claude" | "opencode" | "copilot";
  createSession(config: SessionConfig): Promise<Session>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getModelInfo(hint?: string): Promise<ModelInfo>;
  getSystemTokenCount(): number;

  // Capability queries
  supports<T extends Capability>(cap: T): this is CodingAgentProvider & CapabilityMap[T];
}

type Capability = "resume" | "compaction" | "mcp" | "background-agents" | "commands";
type CapabilityMap = {
  resume: ResumeCapability;
  compaction: CompactionCapability;
  mcp: McpCapability;
  "background-agents": BackgroundAgentCapability;
  commands: CommandCapability;
};
```

**Key differences from current**:
- No optional methods on the core interfaces
- Capabilities are explicit, typed, and queryable at a single point
- Session.stream() returns `AsyncIterable<StreamEvent>` directly (no dual event system needed)
- Every provider emits the same `StreamEvent` type from their adapter

### 3. Narrow Context Interfaces

**Problem**: `CommandContext` has 34 properties/methods coupling 7+ concerns. Every command gets the kitchen sink.

**Spec**: Split into focused interfaces composed by consumers.

```typescript
// types/contexts.ts

/** Minimal context for read-only commands (/help, /status) */
interface ReadContext {
  readonly session: Session | null;
  readonly state: { isStreaming: boolean; messageCount: number };
  readonly agentType: AgentType;
}

/** Context for commands that send messages */
interface MessageContext extends ReadContext {
  sendMessage(content: string): void;
  streamAndWait(prompt: string): Promise<StreamResult>;
}

/** Context for workflow commands */
interface WorkflowContext extends MessageContext {
  readonly eventBus: EventBus;
  spawnSubagent(options: SubagentOptions): Promise<SubagentResult>;
  updateTaskList(tasks: WorkflowTask[]): void;
  waitForUserInput(): Promise<string>;
}

/** Full context - only for commands that truly need everything */
interface FullContext extends WorkflowContext {
  readonly modelOps: ModelOperations;
  readonly mcpOps: McpOperations;
  clearContext(): Promise<void>;
}
```

### 4. Layer Dependency Rules

**Same as current** - the layered architecture is sound. Changes:

```
types/           -> NO imports (pure type definitions)
lib/             -> types/ only
services/        -> types/, lib/
state/           -> types/, lib/, services/
components/      -> types/, lib/, services/, state/
commands/        -> types/, lib/, services/, state/, components/
screens/         -> types/, lib/, services/, state/, components/
```

**New rule**: `types/` must NOT re-export from `state/`. The current `types/chat.ts` that re-exports from `state/chat/shared/types/` violates this. Move shared chat types to `types/chat.ts` directly.

**New rule**: `lib/` must NOT export domain-specific types. `McpServerToggleMap` and `McpSnapshotView` move to `types/mcp.ts`.

### 5. Boundary Enforcement

Retain the lint scripts but expand:
- `check-dependency-direction.ts` - enforce the layer rules above
- `check-submodule-boundaries.ts` - enforce module boundaries within `state/`
- **New**: `check-no-optional-interface-methods.ts` - flag optional methods on core provider interfaces (warning, not error)
- **New**: `check-event-type-coverage.ts` - verify every `StreamEventType` has a handler registered

### 6. File Organization

```
src/
├── types/                    # Pure type definitions (no runtime values)
│   ├── events.ts             # StreamEvent, StreamEventType
│   ├── provider.ts           # Session, CodingAgentProvider, capabilities
│   ├── contexts.ts           # ReadContext, MessageContext, WorkflowContext
│   ├── chat.ts               # ChatMessage, Part, etc.
│   ├── command.ts            # CommandDefinition, CommandResult
│   ├── mcp.ts                # McpServerConfig, McpSnapshot
│   ├── models.ts             # ModelInfo, ModelDisplayInfo
│   ├── parallel-agents.ts    # ParallelAgent, AgentStatus
│   ├── ui.ts                 # FooterState, VerboseProps
│   └── workflow.ts           # WorkflowDefinition, WorkflowTask
├── lib/                      # Domain-agnostic utilities
│   ├── deep-merge.ts
│   ├── path-guard.ts
│   ├── markdown.ts
│   └── clipboard.ts
```

## Code References

- `src/types/chat.ts:1` - Re-exports from state layer (violation)
- `src/types/command.ts:60-94` - CommandContext god interface (34 members)
- `src/services/agents/contracts/client.ts:7-23` - CodingAgentClient (5 optional methods)
- `src/services/agents/contracts/session.ts:66-87` - Session (5 optional methods)
- `src/services/agents/contracts/events.ts:1-247` - 25 AgentEvent types with open index signatures
- `src/services/events/bus-events/schemas.ts:14-165` - 28 BusEvent Zod schemas
- `src/services/events/bus-events/types.ts:1-36` - BusEvent/EnrichedBusEvent types
- `src/scripts/check-submodule-boundaries.ts` - Boundary enforcement
- `src/scripts/check-dependency-direction.ts` - Layer enforcement
