# SDK Migration and Graph Execution Pattern Technical Design Document

| Document Metadata      | Details         |
| ---------------------- | --------------- |
| Author(s)              | lavaman131      |
| Status                 | Draft (WIP)     |
| Team / Owner           | flora131/atomic |
| Created / Last Updated | 2026-01-31      |

## 1. Executive Summary

This RFC proposes a comprehensive architectural upgrade for the Atomic CLI, introducing two interconnected systems: (1) a **Unified SDK Abstraction Layer** that provides a common interface for Claude Agent SDK, GitHub Copilot SDK, and OpenCode SDK, and (2) a **Graph Execution Engine** implementing a Pregel-based StateGraph pattern with a fluent API for orchestrating agentic workflows.

**Key changes:**
- Create `CodingAgentClient` interface abstracting all three AI agent SDKs (Claude, GitHub Copilot, OpenCode)
- Implement `CopilotClient` using `@github/copilot-sdk` with full 31 event types support
- Implement type-safe graph execution with 6 node types (agent, tool, decision, wait, subgraph, parallel)
- Enable declarative workflow definition via fluent API chaining (`.start()`, `.then()`, `.loop()`, etc.)
- Build OpenTUI-based terminal chat interface with streaming, syntax highlighting, and sticky scroll
- Integrate unified telemetry collection across all SDK clients and graph execution
- Support checkpointing for workflow resumption and progress tracking
- Replace current hook-based Ralph implementation with graph-based orchestration

**Impact:** This enables Atomic to orchestrate complex, multi-step AI workflows with any supported backend, reducing code duplication by ~60% and providing a foundation for advanced features like parallel agent execution, context window management, human-in-the-loop workflows, and a unified terminal UI experience.

**Research References:**
- [research/docs/2026-01-31-claude-agent-sdk-research.md](../research/docs/2026-01-31-claude-agent-sdk-research.md)
- [research/docs/2026-01-31-github-copilot-sdk-research.md](../research/docs/2026-01-31-github-copilot-sdk-research.md)
- [research/docs/2026-01-31-opencode-sdk-research.md](../research/docs/2026-01-31-opencode-sdk-research.md)
- [research/docs/2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md)
- [research/docs/2026-01-31-sdk-migration-and-graph-execution.md](../research/docs/2026-01-31-sdk-migration-and-graph-execution.md)
- [research/docs/2026-01-31-opentui-library-research.md](../research/docs/2026-01-31-opentui-library-research.md)

## 2. Context and Motivation

### 2.1 Current State

The Atomic CLI currently supports three AI coding agents through separate, incompatible implementations:

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CURRENT IMPLEMENTATION                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ .claude/        │  │ .github/        │  │ .opencode/      │     │
│  │                 │  │                 │  │                 │     │
│  │ settings.json   │  │ hooks.json      │  │ opencode.json   │     │
│  │ SessionEnd hook │  │ 3 hook events   │  │ Plugin SDK      │     │
│  │ Marketplace     │  │ Hook scripts    │  │ Full client API │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           ▼                    ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              NO UNIFIED ABSTRACTION                          │   │
│  │                                                              │   │
│  │  • Duplicate telemetry implementations                       │   │
│  │  • Different Ralph loop implementations per agent            │   │
│  │  • No shared workflow orchestration                          │   │
│  │  • Hook-based control flow (limited)                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Current Implementation Details:**

| Directory    | Agent          | Hook System                                                           | Ralph Implementation                    | Context Compaction    |
| ------------ | -------------- | --------------------------------------------------------------------- | --------------------------------------- | --------------------- |
| `.claude/`   | Claude Code    | `SessionEnd` only                                                     | Marketplace plugin                      | Not available         |
| `.github/`   | GitHub Copilot | `sessionStart`, `userPromptSubmitted`, `sessionEnd`                   | Hook scripts + external orchestrator    | Not available         |
| `.opencode/` | OpenCode       | `session.created`, `session.status`, `session.deleted` + plugin hooks | SDK plugin with in-session continuation | `session.summarize()` |

**Research Reference:** [2026-01-31-claude-implementation-analysis.md](../research/docs/2026-01-31-claude-implementation-analysis.md), [2026-01-31-github-implementation-analysis.md](../research/docs/2026-01-31-github-implementation-analysis.md), [2026-01-31-opencode-implementation-analysis.md](../research/docs/2026-01-31-opencode-implementation-analysis.md)

### 2.2 The Problem

**Technical Debt:**
1. **Code Duplication:** Ralph loop logic implemented 3 times (~1,200+ lines total) with slight variations
2. **Inconsistent Capabilities:** Only OpenCode supports context compaction; Claude lacks session start hooks
3. **Limited Orchestration:** Hook-based approach cannot express complex workflows (parallel execution, conditional branching)
4. **No Type Safety:** Each agent uses different configuration schemas with no compile-time validation

**User Impact:**
- Ralph loops on Claude/Copilot risk context overflow without compaction
- Adding new workflow patterns requires modifying all three implementations
- Testing workflow behavior requires testing against each agent separately

**Business Impact:**
- New agent integrations require ~400+ lines of boilerplate
- Feature parity across agents is difficult to maintain
- Advanced workflows (e.g., parallel research + implementation) are impossible with current architecture

## 3. Goals and Non-Goals

### 3.1 Functional Goals

**SDK Abstraction Layer:**
- [ ] Create `CodingAgentClient` interface with common session management operations
- [ ] Implement `ClaudeAgentClient` using `@anthropic-ai/claude-agent-sdk` V1 + V2 (V2 for sessions, V1 for advanced features)
- [ ] Implement `OpenCodeClient` using `@opencode-ai/sdk/v2/client`
- [ ] Implement `CopilotClient` using `@github/copilot-sdk` with full event support
- [ ] Provide unified event subscription pattern across all clients

**Native Hook Migration:**
- [ ] Migrate Claude hooks from `.claude/settings.json` to SDK `options.hooks` configuration
- [ ] Migrate Copilot hooks from `.github/hooks/hooks.json` to SDK `session.on()` event handlers
- [ ] Migrate OpenCode hooks from plugin files to SDK plugin hooks (`tool.execute.before/after`, etc.)
- [ ] Create unified `HookManager` interface for cross-SDK hook registration
- [ ] Support all Claude hook events: `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`
- [ ] Support all Copilot hook events: `sessionStart`, `userPromptSubmitted`, `sessionEnd` + 31 SDK event types
- [ ] Support all OpenCode plugin hooks: `event`, `tool.execute.before/after`, `command.execute.before`, `chat.*`, `permission.ask`

**Graph Execution Engine:**
- [ ] Implement `GraphBuilder<TState>` with fluent API for workflow definition
- [ ] Support 6 node types: `agent`, `tool`, `decision`, `wait`, `subgraph`, `parallel`
- [ ] Implement checkpointing via `Checkpointer` interface with `MemorySaver`, `FileSaver`, `ResearchDirSaver`
- [ ] Support streaming execution via `AsyncGenerator<TState>`
- [ ] Implement retry logic with exponential backoff for node execution

**OpenTUI Chat Interface:**
- [ ] Implement terminal chat UI using `@opentui/core` and `@opentui/react`
- [ ] Support streaming message display with `MarkdownRenderable` and `streaming: true`
- [ ] Implement sticky scroll chat history with `ScrollBoxRenderable`
- [ ] Add syntax-highlighted code blocks via `CodeRenderable`
- [ ] Support keyboard navigation and input handling
- [ ] Implement theme support (dark/light modes)

**Telemetry Integration:**
- [ ] Create unified `TelemetryCollector` interface for cross-SDK event tracking
- [ ] Track workflow execution events (node start/complete, errors, checkpoints)
- [ ] Track SDK session events (create, resume, destroy, message counts)
- [ ] Implement consent-based collection with `DO_NOT_TRACK` support
- [ ] Support JSONL event logging for local analysis
- [ ] Integrate with existing Azure Application Insights backend

**Atomic Workflow Migration:**
- [ ] Migrate Ralph loop to graph-based execution
- [ ] Implement context window monitoring with configurable thresholds
- [ ] Support human-in-the-loop approval for spec review

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT implement real-time collaboration features
- [ ] We will NOT build a web-based UI (terminal only)
- [ ] We will NOT support non-TypeScript plugin implementations

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture Diagram

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'primaryColor':'#f8f9fa','primaryTextColor':'#2c3e50','primaryBorderColor':'#4a5568','lineColor':'#4a90e2','secondaryColor':'#ffffff','tertiaryColor':'#e9ecef','background':'#f5f7fa','mainBkg':'#f8f9fa','nodeBorder':'#4a5568','clusterBkg':'#ffffff','clusterBorder':'#cbd5e0','edgeLabelBackground':'#ffffff'}}}%%

flowchart TB
    classDef entrypoint fill:#5a67d8,stroke:#4c51bf,stroke-width:3px,color:#ffffff,font-weight:600
    classDef abstraction fill:#4a90e2,stroke:#357abd,stroke-width:2.5px,color:#ffffff,font-weight:600
    classDef client fill:#667eea,stroke:#5a67d8,stroke-width:2.5px,color:#ffffff,font-weight:600
    classDef graph fill:#48bb78,stroke:#38a169,stroke-width:2.5px,color:#ffffff,font-weight:600
    classDef ui fill:#ed8936,stroke:#dd6b20,stroke-width:2.5px,color:#ffffff,font-weight:600
    classDef telemetry fill:#9f7aea,stroke:#805ad5,stroke-width:2.5px,color:#ffffff,font-weight:600
    classDef external fill:#718096,stroke:#4a5568,stroke-width:2.5px,color:#ffffff,font-weight:600,stroke-dasharray:6 3

    User(("User")):::entrypoint

    subgraph AtomicCore["Atomic Core"]
        direction TB

        subgraph UILayer["Terminal UI Layer"]
            direction LR
            ChatUI["ChatInterface<br><i>@opentui/react</i>"]:::ui
            MessageList["ScrollBoxRenderable<br><i>Sticky Scroll</i>"]:::ui
            InputArea["InputRenderable<br><i>User Input</i>"]:::ui
            CodeBlock["CodeRenderable<br><i>Syntax Highlight</i>"]:::ui
        end

        CLI["atomic CLI<br><i>Commander.js</i>"]:::entrypoint

        subgraph SDKLayer["SDK Abstraction Layer"]
            direction LR
            Interface["CodingAgentClient<br><i>Interface</i>"]:::abstraction
            ClaudeClient["ClaudeAgentClient<br><i>@anthropic-ai/claude-agent-sdk</i>"]:::client
            OpenCodeClient["OpenCodeClient<br><i>@opencode-ai/sdk</i>"]:::client
            CopilotClient["CopilotClient<br><i>@github/copilot-sdk</i>"]:::client
        end

        subgraph GraphEngine["Graph Execution Engine"]
            direction TB
            Builder["GraphBuilder<br><i>Fluent API</i>"]:::graph
            Compiled["CompiledGraph<br><i>Executable</i>"]:::graph
            Nodes["Node Types<br>agent, tool, decision<br>wait, subgraph, parallel"]:::graph
            Checkpointer["Checkpointer<br>Memory, File, ResearchDir"]:::graph
        end

        subgraph TelemetryLayer["Telemetry Layer"]
            direction LR
            Collector["TelemetryCollector<br><i>Unified Events</i>"]:::telemetry
            LocalLog["JSONL Logger<br><i>Local Storage</i>"]:::telemetry
            AppInsights["Azure App Insights<br><i>Remote Upload</i>"]:::telemetry
        end
    end

    subgraph ExternalAPIs["External APIs"]
        direction LR
        Claude["Anthropic API<br><i>claude-sonnet/opus</i>"]:::external
        OpenCode["OpenCode Server<br><i>HTTP/SSE</i>"]:::external
        Copilot["Copilot CLI<br><i>JSON-RPC</i>"]:::external
    end

    User -->|"atomic run/ralph"| ChatUI
    ChatUI --> CLI
    CLI --> Interface
    Interface --> ClaudeClient
    Interface --> OpenCodeClient
    Interface --> CopilotClient

    ClaudeClient --> Claude
    OpenCodeClient --> OpenCode
    CopilotClient --> Copilot

    CLI --> Builder
    Builder -->|".compile()"| Compiled
    Compiled --> Nodes
    Compiled --> Checkpointer

    Compiled -->|"execute()"| Interface

    Interface -->|"events"| Collector
    Compiled -->|"events"| Collector
    Collector --> LocalLog
    Collector --> AppInsights

    ChatUI --> MessageList
    ChatUI --> InputArea
    MessageList --> CodeBlock

    style UILayer fill:#fff7ed,stroke:#ed8936,stroke-width:2px
    style SDKLayer fill:#f0f4ff,stroke:#4a90e2,stroke-width:2px
    style GraphEngine fill:#f0fff4,stroke:#48bb78,stroke-width:2px
    style TelemetryLayer fill:#faf5ff,stroke:#9f7aea,stroke-width:2px
    style ExternalAPIs fill:#f5f5f5,stroke:#718096,stroke-width:2px,stroke-dasharray:8 4
```

### 4.2 Architectural Pattern

**Two-Layer Architecture:**

1. **SDK Abstraction Layer:** Adapter pattern wrapping each vendor SDK behind a unified `CodingAgentClient` interface. Enables swapping backends without workflow changes.

2. **Graph Execution Engine:** Pregel-based StateGraph pattern (inspired by LangGraph.js) with fluent API for declarative workflow definition. Provides type-safe state management, checkpointing, and streaming execution.

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) Section 4.1

### 4.3 Key Components

| Component            | Responsibility                            | Technology Stack                        | Justification                                                         |
| -------------------- | ----------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `CodingAgentClient`  | Unified interface for AI agent sessions   | TypeScript interface                    | Enables backend-agnostic workflow orchestration                       |
| `ClaudeAgentClient`  | Claude Agent SDK V1+V2 hybrid wrapper     | `@anthropic-ai/claude-agent-sdk`        | V2 for sessions, V1 for forking/async input                           |
| `OpenCodeClient`     | OpenCode SDK V2 wrapper                   | `@opencode-ai/sdk/v2/client`            | Production-ready with best plugin system                              |
| `CopilotClient`      | GitHub Copilot SDK wrapper                | `@github/copilot-sdk`                   | 31 event types, multi-language support, skills system                 |
| `HookManager`        | Cross-SDK hook registration               | TypeScript unified event mapping        | Migrates config-based hooks to native SDK hooks                       |
| `GraphBuilder<T>`    | Fluent API for workflow definition        | TypeScript generics + method chaining   | Type-safe, declarative workflow construction                          |
| `CompiledGraph<T>`   | Executable graph with state management    | BFS traversal + immutable state         | Deterministic execution with streaming support                        |
| `Checkpointer`       | State persistence for workflow resumption | Interface with Memory/File/ResearchDir  | Enables long-running workflows and failure recovery                   |
| `Annotation<T>`      | Type-safe state with custom reducers      | TypeScript + reducer functions          | Enables complex state merging (arrays concatenate, maps merge by key) |
| `ChatInterface`      | Terminal chat UI with streaming           | `@opentui/react` + `@opentui/core`      | Native terminal rendering, flexbox layout, streaming support          |
| `TelemetryCollector` | Unified event collection across SDKs      | TypeScript + JSONL + Azure App Insights | Consent-based, cross-SDK analytics for workflow optimization          |

## 5. Detailed Design

### 5.1 SDK Abstraction Layer

#### 5.1.1 CodingAgentClient Interface

```typescript
// src/sdk/types.ts

export interface SessionConfig {
  /** Model to use (e.g., 'claude-sonnet-4-5-20250929') */
  model: string;
  /** Optional session ID for resumption */
  sessionId?: string;
  /** System prompt or preset */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code' };
  /** Available tools */
  tools?: ToolDefinition[];
  /** MCP server configurations */
  mcpServers?: Record<string, McpServerConfig>;
  /** Permission mode */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  /** Maximum cost budget */
  maxBudgetUsd?: number;
  /** Maximum turns per query */
  maxTurns?: number;
}

export interface Session {
  /** Session identifier */
  readonly id: string;
  /** Send a message to the agent */
  send(message: string): Promise<void>;
  /** Stream responses from the agent */
  stream(): AsyncGenerator<AgentMessage>;
  /** Summarize/compact context (if supported) */
  summarize?(): Promise<void>;
  /** Get current context window usage (0-1) */
  getContextUsage?(): Promise<number>;
  /** Destroy session and cleanup */
  destroy(): Promise<void>;
}

export interface AgentMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}

export type EventType =
  | 'session.start'
  | 'session.idle'
  | 'session.error'
  | 'message.delta'
  | 'message.complete'
  | 'tool.start'
  | 'tool.complete'
  | 'subagent.start'
  | 'subagent.complete';

export interface AgentEvent {
  type: EventType;
  sessionId: string;
  timestamp: Date;
  data?: unknown;
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface CodingAgentClient {
  /** Create a new agent session */
  createSession(config: SessionConfig): Promise<Session>;
  /** Resume an existing session by ID */
  resumeSession(sessionId: string, config?: Partial<SessionConfig>): Promise<Session>;
  /** Subscribe to agent events */
  on(event: EventType | '*', handler: EventHandler): Unsubscribe;
  /** Register a custom tool */
  registerTool(tool: ToolDefinition): void;
  /** Start the client (e.g., spawn CLI for Copilot) */
  start(): Promise<void>;
  /** Stop the client and cleanup */
  stop(): Promise<void>;
}
```

**Research Reference:** [2026-01-31-sdk-migration-and-graph-execution.md](../research/docs/2026-01-31-sdk-migration-and-graph-execution.md) "Unified SDK Abstraction Layer" section

#### 5.1.2 ClaudeAgentClient Implementation (V1 + V2 Hybrid)

The Claude Agent SDK provides two API versions:
- **V2 (Preview):** Simplified `send()`/`stream()` pattern for multi-turn conversations
- **V1:** Full feature set including session forking, advanced streaming patterns, and async generator input

We use V2 for standard session management and V1 for advanced features V2 doesn't support.

```typescript
// src/sdk/claude-client.ts

import {
  // V2 API - Simplified session management
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type Session as ClaudeV2Session,
  // V1 API - Full feature set for advanced use cases
  query,
  type Query,
  type SDKUserMessage,
  // Shared types and utilities
  createSdkMcpServer,
  tool,
  type HookEvent,
} from '@anthropic-ai/claude-agent-sdk';
import type { CodingAgentClient, Session, SessionConfig, EventHandler, AgentMessage, ToolDefinition } from './types';

/** Hook configuration for Claude SDK */
export interface ClaudeHookConfig {
  PreToolUse?: Array<(params: HookEvent) => void | Promise<void>>;
  PostToolUse?: Array<(params: HookEvent) => void | Promise<void>>;
  PostToolUseFailure?: Array<(params: HookEvent) => void | Promise<void>>;
  SessionStart?: Array<(params: HookEvent) => void | Promise<void>>;
  SessionEnd?: Array<(params: HookEvent) => void | Promise<void>>;
  SubagentStart?: Array<(params: HookEvent) => void | Promise<void>>;
  SubagentStop?: Array<(params: HookEvent) => void | Promise<void>>;
  PermissionRequest?: Array<(params: HookEvent) => void | Promise<void>>;
  Notification?: Array<(params: HookEvent) => void | Promise<void>>;
}

export class ClaudeAgentClient implements CodingAgentClient {
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private v2Sessions = new Map<string, ClaudeV2Session>();
  private v1Queries = new Map<string, Query>();
  private hooks: ClaudeHookConfig = {};
  private mcpServers: Record<string, any> = {};

  constructor(private defaultConfig?: Partial<SessionConfig>) {}

  /**
   * Register hooks that will be applied to all sessions
   * Migrates from .claude/settings.json hooks to native SDK hooks
   */
  registerHooks(hooks: ClaudeHookConfig): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  /**
   * Create session using V2 API (simplified multi-turn)
   */
  async createSession(config: SessionConfig): Promise<Session> {
    const sessionId = config.sessionId ?? crypto.randomUUID();

    // Emit session start event
    this.emitHook('SessionStart', { sessionId });

    const claudeSession = unstable_v2_createSession({
      model: config.model,
      systemPrompt: config.systemPrompt,
      permissionMode: config.permissionMode ?? 'default',
      maxTurns: config.maxTurns,
      options: {
        mcpServers: { ...this.mcpServers, ...config.mcpServers },
        hooks: this.buildNativeHooks(sessionId),
      },
    });

    this.v2Sessions.set(sessionId, claudeSession);
    return this.wrapV2Session(sessionId, claudeSession);
  }

  /**
   * Create session using V1 API for advanced features
   * Use when you need: session forking, async generator input, advanced streaming
   */
  async createAdvancedSession(config: SessionConfig & {
    enableForking?: boolean;
    asyncInput?: AsyncIterable<SDKUserMessage>;
  }): Promise<Session & { fork: () => Promise<Session> }> {
    const sessionId = config.sessionId ?? crypto.randomUUID();

    this.emitHook('SessionStart', { sessionId });

    const v1Query = query({
      prompt: config.asyncInput ?? '',
      options: {
        model: config.model,
        systemPrompt: config.systemPrompt,
        permissionMode: config.permissionMode ?? 'default',
        maxTurns: config.maxTurns,
        mcpServers: { ...this.mcpServers, ...config.mcpServers },
        hooks: this.buildNativeHooks(sessionId),
      },
    });

    this.v1Queries.set(sessionId, v1Query);

    const baseSession = this.wrapV1Session(sessionId, v1Query);

    return {
      ...baseSession,
      fork: async () => {
        // V1 supports session forking - V2 does not
        const forkedId = `${sessionId}-fork-${Date.now()}`;
        const forkedQuery = v1Query.fork();
        this.v1Queries.set(forkedId, forkedQuery);
        return this.wrapV1Session(forkedId, forkedQuery);
      },
    };
  }

  async resumeSession(sessionId: string, config?: Partial<SessionConfig>): Promise<Session> {
    const claudeSession = unstable_v2_resumeSession(sessionId, {
      model: config?.model ?? 'claude-sonnet-4-5-20250929',
    });

    this.v2Sessions.set(sessionId, claudeSession);
    return this.wrapV2Session(sessionId, claudeSession);
  }

  private wrapV2Session(sessionId: string, claudeSession: ClaudeV2Session): Session {
    const self = this;
    return {
      id: sessionId,
      send: async (message: string) => {
        await claudeSession.send(message);
      },
      stream: async function* (): AsyncGenerator<AgentMessage> {
        for await (const msg of claudeSession.stream()) {
          yield {
            type: msg.type === 'text' ? 'text' : msg.type,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            metadata: { raw: msg },
          };
        }
      },
      summarize: undefined, // V2 handles context automatically
      getContextUsage: undefined,
      destroy: async () => {
        self.emitHook('SessionEnd', { sessionId });
        self.v2Sessions.delete(sessionId);
      },
    };
  }

  private wrapV1Session(sessionId: string, v1Query: Query): Session {
    const self = this;
    return {
      id: sessionId,
      send: async (message: string) => {
        // V1 uses async generator pattern - push message
        // This requires the asyncInput pattern
        throw new Error('V1 sessions require asyncInput for multi-turn. Use createAdvancedSession with asyncInput.');
      },
      stream: async function* (): AsyncGenerator<AgentMessage> {
        for await (const msg of v1Query) {
          yield {
            type: msg.type,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            metadata: { raw: msg },
          };
        }
      },
      summarize: undefined,
      getContextUsage: undefined,
      destroy: async () => {
        self.emitHook('SessionEnd', { sessionId });
        v1Query.abort();
        self.v1Queries.delete(sessionId);
      },
    };
  }

  /**
   * Build native SDK hooks from registered handlers
   */
  private buildNativeHooks(sessionId: string): Record<string, Array<(params: any) => void>> {
    const nativeHooks: Record<string, Array<(params: any) => void>> = {};

    // Map our hooks to native SDK hooks
    const hookMapping: Record<keyof ClaudeHookConfig, string> = {
      PreToolUse: 'PreToolUse',
      PostToolUse: 'PostToolUse',
      PostToolUseFailure: 'PostToolUseFailure',
      SessionStart: 'SessionStart',
      SessionEnd: 'SessionEnd',
      SubagentStart: 'SubagentStart',
      SubagentStop: 'SubagentStop',
      PermissionRequest: 'PermissionRequest',
      Notification: 'Notification',
    };

    for (const [key, sdkHookName] of Object.entries(hookMapping)) {
      const handlers = this.hooks[key as keyof ClaudeHookConfig];
      if (handlers && handlers.length > 0) {
        nativeHooks[sdkHookName] = handlers.map((handler) => (params: any) => {
          // Emit to unified event system
          this.emit(this.mapHookToEventType(key), { sessionId, ...params });
          // Call the handler
          handler(params);
        });
      }
    }

    // Always add default handlers for event emission
    nativeHooks.PreToolUse = [
      ...(nativeHooks.PreToolUse ?? []),
      (params) => this.emit('tool.start', { sessionId, ...params }),
    ];
    nativeHooks.PostToolUse = [
      ...(nativeHooks.PostToolUse ?? []),
      (params) => this.emit('tool.complete', { sessionId, ...params }),
    ];
    nativeHooks.SubagentStart = [
      ...(nativeHooks.SubagentStart ?? []),
      (params) => this.emit('subagent.start', { sessionId, ...params }),
    ];
    nativeHooks.SubagentStop = [
      ...(nativeHooks.SubagentStop ?? []),
      (params) => this.emit('subagent.complete', { sessionId, ...params }),
    ];

    return nativeHooks;
  }

  private mapHookToEventType(hookName: string): string {
    const mapping: Record<string, string> = {
      PreToolUse: 'tool.start',
      PostToolUse: 'tool.complete',
      SessionStart: 'session.start',
      SessionEnd: 'session.idle',
      SubagentStart: 'subagent.start',
      SubagentStop: 'subagent.complete',
    };
    return mapping[hookName] ?? hookName.toLowerCase();
  }

  private emitHook(hookName: keyof ClaudeHookConfig, params: any): void {
    const handlers = this.hooks[hookName];
    if (handlers) {
      for (const handler of handlers) {
        handler(params);
      }
    }
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(type: string, data: unknown): void {
    const handlers = this.eventHandlers.get(type) ?? new Set();
    const wildcardHandlers = this.eventHandlers.get('*') ?? new Set();
    const event = { type, sessionId: (data as any)?.sessionId ?? '', timestamp: new Date(), data };
    for (const handler of [...handlers, ...wildcardHandlers]) {
      handler(event as any);
    }
  }

  /**
   * Register a custom tool via MCP server
   */
  registerTool(toolDef: ToolDefinition): void {
    // Create an MCP server for custom tools
    const serverName = `custom-tools-${Date.now()}`;
    const server = createSdkMcpServer({
      name: serverName,
      tools: [
        tool(toolDef.name, toolDef.description, toolDef.schema, toolDef.handler),
      ],
    });
    this.mcpServers[serverName] = server;
  }

  async start(): Promise<void> {
    // Claude SDK doesn't require explicit start
  }

  async stop(): Promise<void> {
    // Cleanup all sessions
    for (const [sessionId] of this.v2Sessions) {
      this.emitHook('SessionEnd', { sessionId });
    }
    for (const [sessionId, query] of this.v1Queries) {
      this.emitHook('SessionEnd', { sessionId });
      query.abort();
    }
    this.v2Sessions.clear();
    this.v1Queries.clear();
  }
}
```

**V1 vs V2 Usage Decision Matrix:**

| Feature                  | V2 API              | V1 API                          | Recommendation   |
| ------------------------ | ------------------- | ------------------------------- | ---------------- |
| Multi-turn conversations | `send()`/`stream()` | Async generator                 | Use V2 - simpler |
| Session forking          | Not supported       | `query.fork()`                  | Use V1 if needed |
| Custom tools             | Via MCP servers     | Via MCP servers                 | Same in both     |
| Hooks                    | `options.hooks`     | `options.hooks`                 | Same in both     |
| Streaming                | `session.stream()`  | `for await (of query)`          | Use V2 - cleaner |
| Async input              | Not supported       | `AsyncIterable<SDKUserMessage>` | Use V1 if needed |

**Research Reference:** [2026-01-31-claude-agent-sdk-research.md](../research/docs/2026-01-31-claude-agent-sdk-research.md) "V1 API" and "V2 API" sections

#### 5.1.3 OpenCodeClient Implementation

```typescript
// src/sdk/opencode-client.ts

import { createOpencodeClient, type Client } from '@opencode-ai/sdk/v2/client';
import type { CodingAgentClient, Session, SessionConfig, EventHandler, AgentMessage } from './types';

export class OpenCodeClient implements CodingAgentClient {
  private client: Client;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private eventSubscription?: AsyncIterable<any>;

  constructor(private config: { baseUrl: string; directory: string }) {
    this.client = createOpencodeClient({
      baseUrl: config.baseUrl,
      directory: config.directory,
    });
  }

  async createSession(config: SessionConfig): Promise<Session> {
    const response = await this.client.session.create({
      body: {
        title: config.sessionId ?? `session-${Date.now()}`,
        directory: this.config.directory,
        permission: config.permissionMode === 'bypassPermissions' ? 'allow' : 'ask',
      },
    });

    const sessionId = response.id;
    return this.wrapSession(sessionId);
  }

  async resumeSession(sessionId: string): Promise<Session> {
    // Verify session exists
    await this.client.session.get({ path: { sessionID: sessionId } });
    return this.wrapSession(sessionId);
  }

  private wrapSession(sessionId: string): Session {
    const client = this.client;

    return {
      id: sessionId,
      send: async (message: string) => {
        await client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: 'text', text: message }] },
        });
      },
      stream: async function* (): AsyncGenerator<AgentMessage> {
        const events = await client.event.subscribe();
        for await (const event of events.stream) {
          if (event.properties?.sessionID !== sessionId) continue;

          if (event.type === 'message.part.updated') {
            yield {
              type: 'text',
              content: event.properties.content ?? '',
              metadata: { raw: event },
            };
          } else if (event.type === 'session.status' && event.properties.status === 'idle') {
            break;
          }
        }
      },
      summarize: async () => {
        await client.session.summarize({ path: { id: sessionId } });
      },
      getContextUsage: async () => {
        // OpenCode doesn't expose context usage directly
        // Would need to estimate from message count
        return 0;
      },
      destroy: async () => {
        await client.session.delete({ path: { sessionID: sessionId } });
      },
    };
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  registerTool(tool: ToolDefinition): void {
    // Tools registered via plugin system in opencode.json
    throw new Error('Use plugin configuration for OpenCode tools');
  }

  async start(): Promise<void> {
    // Subscribe to events
    const events = await this.client.event.subscribe();
    this.eventSubscription = events.stream;

    // Process events in background
    (async () => {
      for await (const event of events.stream) {
        this.emit(event.type, event);
      }
    })();
  }

  private emit(type: string, data: unknown): void {
    const handlers = this.eventHandlers.get(type) ?? new Set();
    const wildcardHandlers = this.eventHandlers.get('*') ?? new Set();
    const event = { type, sessionId: '', timestamp: new Date(), data };
    for (const handler of [...handlers, ...wildcardHandlers]) {
      handler(event as any);
    }
  }

  async stop(): Promise<void> {
    // Event subscription cleanup handled by AsyncIterable
  }
}
```

**Research Reference:** [2026-01-31-opencode-sdk-research.md](../research/docs/2026-01-31-opencode-sdk-research.md) "SDK Client API" section

#### 5.1.4 CopilotClient Implementation

```typescript
// src/sdk/copilot-client.ts

import { CopilotClient as GHCopilotClient, defineTool } from '@github/copilot-sdk';
import { z } from 'zod';
import type { CodingAgentClient, Session, SessionConfig, EventHandler, AgentMessage, ToolDefinition } from './types';

export class CopilotClient implements CodingAgentClient {
  private client: GHCopilotClient;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private registeredTools: ToolDefinition[] = [];

  constructor(private config: { useStdio?: boolean; port?: number; cliUrl?: string } = {}) {
    // Connection mode selection per research
    if (config.cliUrl) {
      this.client = new GHCopilotClient({ cliUrl: config.cliUrl });
    } else if (config.port) {
      this.client = new GHCopilotClient({ port: config.port });
    } else {
      this.client = new GHCopilotClient({ useStdio: true });
    }
  }

  async createSession(config: SessionConfig): Promise<Session> {
    const tools = this.registeredTools.map((tool) =>
      defineTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.schema,
        handler: tool.handler,
      })
    );

    const session = await this.client.createSession({
      sessionId: config.sessionId,
      model: config.model ?? 'gpt-5',
      systemMessages: config.systemPrompt ? [config.systemPrompt as string] : undefined,
      tools,
    });

    // Subscribe to all 31 event types
    session.on((event) => {
      this.emit(event.type, event);
    });

    return this.wrapSession(session);
  }

  async resumeSession(sessionId: string, config?: Partial<SessionConfig>): Promise<Session> {
    const session = await this.client.resumeSession(sessionId);
    session.on((event) => this.emit(event.type, event));
    return this.wrapSession(session);
  }

  private wrapSession(copilotSession: any): Session {
    return {
      id: copilotSession.id,
      send: async (message: string) => {
        await copilotSession.send({ prompt: message });
      },
      stream: async function* (): AsyncGenerator<AgentMessage> {
        // Use sendAndWait for streaming via events
        const response = await copilotSession.sendAndWait({ prompt: '' });

        // Events are emitted via session.on() - this returns final result
        yield {
          type: 'text',
          content: response.content ?? '',
          metadata: { raw: response },
        };
      },
      // Copilot doesn't expose summarize API
      summarize: undefined,
      getContextUsage: undefined,
      destroy: async () => {
        await copilotSession.destroy();
      },
    };
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(type: string, data: unknown): void {
    // Map Copilot event types to unified types
    const typeMapping: Record<string, string> = {
      'session.start': 'session.start',
      'session.idle': 'session.idle',
      'session.error': 'session.error',
      'assistant.message': 'message.complete',
      'assistant.message_delta': 'message.delta',
      'tool.execution_start': 'tool.start',
      'tool.execution_complete': 'tool.complete',
      'subagent.started': 'subagent.start',
      'subagent.completed': 'subagent.complete',
    };

    const unifiedType = typeMapping[type] ?? type;
    const handlers = this.eventHandlers.get(unifiedType) ?? new Set();
    const wildcardHandlers = this.eventHandlers.get('*') ?? new Set();
    const event = { type: unifiedType, sessionId: '', timestamp: new Date(), data };

    for (const handler of [...handlers, ...wildcardHandlers]) {
      handler(event as any);
    }
  }

  registerTool(tool: ToolDefinition): void {
    this.registeredTools.push(tool);
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }
}

/**
 * Permission handler for Copilot SDK
 * Maps permission requests to unified approval flow
 */
export function createPermissionHandler(
  approver: (request: { kind: string; details: unknown }) => Promise<boolean>
) {
  return async (request: any, invocation: any) => {
    const approved = await approver({
      kind: request.kind, // 'shell' | 'write' | 'read' | 'url' | 'mcp'
      details: invocation,
    });

    if (approved) {
      return { kind: 'approved' as const };
    }
    return { kind: 'denied-interactively-by-user' as const };
  };
}
```

**Research Reference:** [2026-01-31-github-copilot-sdk-research.md](../research/docs/2026-01-31-github-copilot-sdk-research.md) "Session Lifecycle" and "31 Event Types" sections

#### 5.1.5 Native Hook Migration

This section describes how to migrate existing hook scripts from configuration files to native SDK hook registration.

##### Unified HookManager Interface

```typescript
// src/sdk/hooks.ts

import type { CodingAgentClient } from './types';
import type { ClaudeAgentClient, ClaudeHookConfig } from './claude-client';
import type { CopilotClient } from './copilot-client';
import type { OpenCodeClient } from './opencode-client';

/** Unified hook event types across all SDKs */
export type UnifiedHookEvent =
  // Session lifecycle
  | 'session.start'
  | 'session.end'
  | 'session.error'
  // Tool execution
  | 'tool.before'
  | 'tool.after'
  | 'tool.error'
  // Message handling
  | 'message.before'
  | 'message.after'
  // Permission
  | 'permission.request'
  // Subagent
  | 'subagent.start'
  | 'subagent.end';

export interface HookContext {
  sessionId: string;
  agentType: 'claude' | 'copilot' | 'opencode';
  timestamp: Date;
  data: unknown;
}

export type HookHandler = (ctx: HookContext) => void | Promise<void>;

/**
 * Unified HookManager for cross-SDK hook registration
 * Migrates from config-based hooks to native SDK hooks
 */
export class HookManager {
  private handlers = new Map<UnifiedHookEvent, Set<HookHandler>>();

  /**
   * Register a hook handler for a unified event type
   */
  on(event: UnifiedHookEvent, handler: HookHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  /**
   * Apply hooks to a Claude client
   * Migrates from .claude/settings.json hooks
   */
  applyToClaudeClient(client: ClaudeAgentClient): void {
    const claudeHooks: ClaudeHookConfig = {
      SessionStart: [
        (params) => this.emit('session.start', 'claude', params),
      ],
      SessionEnd: [
        (params) => this.emit('session.end', 'claude', params),
      ],
      PreToolUse: [
        (params) => this.emit('tool.before', 'claude', params),
      ],
      PostToolUse: [
        (params) => this.emit('tool.after', 'claude', params),
      ],
      PostToolUseFailure: [
        (params) => this.emit('tool.error', 'claude', params),
      ],
      PermissionRequest: [
        (params) => this.emit('permission.request', 'claude', params),
      ],
      SubagentStart: [
        (params) => this.emit('subagent.start', 'claude', params),
      ],
      SubagentStop: [
        (params) => this.emit('subagent.end', 'claude', params),
      ],
    };

    client.registerHooks(claudeHooks);
  }

  /**
   * Apply hooks to a Copilot client
   * Migrates from .github/hooks/hooks.json
   */
  applyToCopilotClient(client: CopilotClient): void {
    // Map Copilot's 31 event types to unified events
    const eventMapping: Record<string, UnifiedHookEvent> = {
      'session.start': 'session.start',
      'session.idle': 'session.end',
      'session.error': 'session.error',
      'tool.execution_start': 'tool.before',
      'tool.execution_complete': 'tool.after',
      'subagent.started': 'subagent.start',
      'subagent.completed': 'subagent.end',
    };

    // Subscribe to all mapped events
    for (const [copilotEvent, unifiedEvent] of Object.entries(eventMapping)) {
      client.on(copilotEvent as any, (event) => {
        this.emit(unifiedEvent, 'copilot', event.data);
      });
    }
  }

  /**
   * Apply hooks to an OpenCode client
   * Migrates from .opencode/plugin/*.ts hooks
   */
  applyToOpenCodeClient(client: OpenCodeClient): void {
    // OpenCode uses event subscription
    const eventMapping: Record<string, UnifiedHookEvent> = {
      'session.created': 'session.start',
      'session.deleted': 'session.end',
      'session.status': 'session.end', // when status === 'idle'
    };

    for (const [openCodeEvent, unifiedEvent] of Object.entries(eventMapping)) {
      client.on(openCodeEvent, (event) => {
        this.emit(unifiedEvent, 'opencode', event.data);
      });
    }
  }

  private emit(event: UnifiedHookEvent, agentType: 'claude' | 'copilot' | 'opencode', data: unknown): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    const ctx: HookContext = {
      sessionId: (data as any)?.sessionId ?? '',
      agentType,
      timestamp: new Date(),
      data,
    };

    for (const handler of handlers) {
      try {
        handler(ctx);
      } catch (error) {
        console.error(`Hook handler error for ${event}:`, error);
      }
    }
  }
}
```

##### Migration from Config-Based Hooks

**Claude: From `.claude/settings.json` to SDK hooks**

```typescript
// Before: .claude/settings.json
{
  "hooks": {
    "SessionEnd": [{
      "type": "command",
      "command": "bun run .claude/hooks/telemetry-stop.ts"
    }]
  }
}

// After: Native SDK hooks
const client = new ClaudeAgentClient();
client.registerHooks({
  SessionEnd: [
    async (params) => {
      // Run telemetry collection inline
      await collectTelemetry(params);
    },
  ],
});
```

**Copilot: From `.github/hooks/hooks.json` to SDK events**

```typescript
// Before: .github/hooks/hooks.json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{
      "type": "command",
      "bash": "bun run .github/scripts/start-ralph-session.ts",
      "powershell": "bun run .github/scripts/start-ralph-session.ts"
    }],
    "userPromptSubmitted": [{
      "type": "command",
      "bash": "bun run .github/scripts/telemetry-session.ts"
    }],
    "sessionEnd": [{
      "type": "command",
      "bash": "bun run .github/scripts/telemetry-stop.ts"
    }]
  }
}

// After: Native SDK events
const client = new CopilotClient();
client.on('session.start', async (event) => {
  await startRalphSession(event);
});
client.on('assistant.message', async (event) => {
  await trackTelemetry(event);
});
client.on('session.idle', async (event) => {
  await finalizeTelemetry(event);
});
```

**OpenCode: From `.opencode/plugin/*.ts` to SDK plugin hooks**

```typescript
// Before: .opencode/plugin/ralph.ts (external plugin)
export const RalphPlugin: Plugin = async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type === 'session.status' && event.properties.status === 'idle') {
        await continueRalphLoop(event);
      }
    },
  };
};

// After: Integrated via OpenCodeClient
const client = new OpenCodeClient({ baseUrl, directory });
client.on('session.status', async (event) => {
  if (event.data?.status === 'idle') {
    await continueRalphLoop(event);
  }
});

// Plugin hooks still supported via client methods
client.registerPluginHook('tool.execute.before', async ({ tool, args }) => {
  if (tool === 'bash' && args.command.includes('rm -rf')) {
    throw new Error('Dangerous command blocked');
  }
  return { args };
});
```

##### Full Hook Event Reference

| Unified Event        | Claude SDK           | Copilot SDK               | OpenCode SDK            |
| -------------------- | -------------------- | ------------------------- | ----------------------- |
| `session.start`      | `SessionStart`       | `session.start`           | `session.created`       |
| `session.end`        | `SessionEnd`         | `session.idle`            | `session.status` (idle) |
| `session.error`      | -                    | `session.error`           | -                       |
| `tool.before`        | `PreToolUse`         | `tool.execution_start`    | `tool.execute.before`   |
| `tool.after`         | `PostToolUse`        | `tool.execution_complete` | `tool.execute.after`    |
| `tool.error`         | `PostToolUseFailure` | -                         | -                       |
| `message.before`     | -                    | -                         | `chat.message`          |
| `message.after`      | -                    | `assistant.message`       | `chat.message`          |
| `permission.request` | `PermissionRequest`  | `onPermissionRequest`     | `permission.ask`        |
| `subagent.start`     | `SubagentStart`      | `subagent.started`        | -                       |
| `subagent.end`       | `SubagentStop`       | `subagent.completed`      | -                       |

**Research Reference:** [2026-01-31-claude-implementation-analysis.md](../research/docs/2026-01-31-claude-implementation-analysis.md), [2026-01-31-github-implementation-analysis.md](../research/docs/2026-01-31-github-implementation-analysis.md), [2026-01-31-opencode-implementation-analysis.md](../research/docs/2026-01-31-opencode-implementation-analysis.md)

### 5.2 Graph Execution Engine

#### 5.2.1 Core Types

```typescript
// src/graph/types.ts

/** Base state that all workflow states must extend */
export interface BaseState {
  executionId: string;
  lastUpdated: Date;
  outputs: Record<string, unknown>;
}

/** Execution context passed to all nodes */
export interface ExecutionContext<TState extends BaseState> {
  state: Readonly<TState>;
  config: GraphConfig;
  errors: ExecutionError[];
  abortSignal?: AbortSignal;
  contextWindowUsage?: number;
}

/** Result returned by node execution */
export interface NodeResult<TState extends BaseState> {
  /** Partial state update to merge */
  stateUpdate?: Partial<TState>;
  /** Override next node(s) instead of following edges */
  goto?: NodeId | NodeId[];
  /** Signals for external handling */
  signals?: Signal[];
}

/** Node identifier */
export type NodeId = string;

/** Node types supported by the engine */
export type NodeType = 'agent' | 'tool' | 'decision' | 'wait' | 'subgraph' | 'parallel';

/** Base node definition */
export interface NodeDefinition<TState extends BaseState> {
  id: NodeId;
  type: NodeType;
  execute: (ctx: ExecutionContext<TState>) => Promise<NodeResult<TState>>;
  retry?: RetryConfig;
}

/** Retry configuration for node execution */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number;
  retryOn?: (error: ExecutionError) => boolean;
}

/** Graph configuration */
export interface GraphConfig {
  checkpointer?: Checkpointer;
  maxConcurrency?: number;
  timeout?: number;
  onProgress?: (state: BaseState) => void;
}

/** Signal types for external handling */
export type Signal =
  | { type: 'context_window_warning'; usage: number }
  | { type: 'checkpoint'; label: string }
  | { type: 'human_input_required'; prompt: string }
  | { type: 'debug_report_generated'; report: DebugReport };

/** Execution error with context */
export interface ExecutionError {
  nodeId: NodeId;
  error: Error;
  timestamp: Date;
  attempt: number;
}

/** Debug report for error analysis */
export interface DebugReport {
  errorSummary: string;
  stackTrace: string;
  relevantFiles: string[];
  suggestedFixes: string[];
}
```

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) "Core Types Hierarchy" section

#### 5.2.2 State Annotation System

```typescript
// src/graph/annotation.ts

/** Annotation for type-safe state with custom reducers */
export interface Annotation<T> {
  default: T;
  reducer?: (current: T, update: T) => T;
}

/** Create a typed annotation */
export function annotation<T>(config: Annotation<T>): Annotation<T> {
  return config;
}

/** Root annotation combining multiple annotations */
export type AnnotationRoot<T extends Record<string, Annotation<any>>> = {
  [K in keyof T]: T[K] extends Annotation<infer U> ? U : never;
};

/** Default reducers for common types */
export const Reducers = {
  /** Replace current value with new value */
  replace: <T>(current: T, update: T): T => update,

  /** Concatenate arrays */
  concat: <T>(current: T[], update: T[]): T[] => [...current, ...update],

  /** Merge objects */
  merge: <T extends object>(current: T, update: Partial<T>): T => ({ ...current, ...update }),

  /** Merge arrays by ID field */
  mergeById: <T extends { id: string }>(current: T[], update: T[]): T[] => {
    const map = new Map(current.map((item) => [item.id, item]));
    for (const item of update) {
      map.set(item.id, item);
    }
    return Array.from(map.values());
  },
};

/** Example: Atomic workflow state annotation */
export const AtomicStateAnnotation = {
  executionId: annotation({ default: '' }),
  lastUpdated: annotation({ default: new Date() }),
  outputs: annotation({ default: {}, reducer: Reducers.merge }),

  researchDoc: annotation({ default: undefined as string | undefined }),
  specDoc: annotation({ default: undefined as string | undefined }),
  specApproved: annotation({ default: false }),

  featureList: annotation({
    default: [] as FeatureItem[],
    reducer: Reducers.mergeById,
  }),
  currentFeature: annotation({ default: undefined as FeatureItem | undefined }),
  allFeaturesPassing: annotation({ default: false }),

  debugReports: annotation({
    default: [] as DebugReport[],
    reducer: Reducers.concat,
  }),

  prUrl: annotation({ default: undefined as string | undefined }),
  contextWindowUsage: annotation({ default: 0 }),
  iteration: annotation({ default: 0 }),
};

export type AtomicWorkflowState = AnnotationRoot<typeof AtomicStateAnnotation>;
```

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) "State Annotation System" section

#### 5.2.3 Node Factory Functions

```typescript
// src/graph/nodes.ts

import type { NodeDefinition, ExecutionContext, NodeResult, BaseState } from './types';
import type { CodingAgentClient, SessionConfig } from '../sdk/types';

/** Agent node configuration */
export interface AgentNodeConfig<TState extends BaseState> {
  /** Agent type identifier */
  agentType: string;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Available tools */
  tools?: string[];
  /** Map agent output to state update */
  outputMapper: (output: string, ctx: ExecutionContext<TState>) => Partial<TState>;
  /** Session configuration overrides */
  sessionConfig?: Partial<SessionConfig>;
}

/** Create an agent node */
export function agentNode<TState extends BaseState>(
  id: string,
  config: AgentNodeConfig<TState>,
  client: CodingAgentClient
): NodeDefinition<TState> {
  return {
    id,
    type: 'agent',
    async execute(ctx) {
      const session = await client.createSession({
        model: 'claude-sonnet-4-5-20250929',
        systemPrompt: config.systemPrompt,
        ...config.sessionConfig,
      });

      try {
        await session.send(JSON.stringify(ctx.state));

        let fullOutput = '';
        for await (const msg of session.stream()) {
          if (msg.type === 'text') {
            fullOutput += msg.content;
          }
        }

        return {
          stateUpdate: config.outputMapper(fullOutput, ctx),
        };
      } finally {
        await session.destroy();
      }
    },
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
    },
  };
}

/** Tool node configuration */
export interface ToolNodeConfig<TState extends BaseState> {
  /** Tool name to execute */
  toolName: string;
  /** Arguments builder */
  args: (ctx: ExecutionContext<TState>) => Record<string, unknown>;
  /** Map tool output to state update */
  outputMapper: (output: unknown, ctx: ExecutionContext<TState>) => Partial<TState>;
  /** Execution timeout */
  timeout?: number;
}

/** Create a tool node */
export function toolNode<TState extends BaseState>(
  id: string,
  config: ToolNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id,
    type: 'tool',
    async execute(ctx) {
      // Execute tool via shell or MCP
      const args = config.args(ctx);
      const result = await executeTool(config.toolName, args, config.timeout);
      return {
        stateUpdate: config.outputMapper(result, ctx),
      };
    },
  };
}

/** Decision node configuration */
export interface DecisionNodeConfig<TState extends BaseState> {
  /** Condition to evaluate */
  condition: (ctx: ExecutionContext<TState>) => NodeId | NodeId[];
  /** Fallback node if condition returns undefined */
  fallback?: NodeId;
}

/** Create a decision node */
export function decisionNode<TState extends BaseState>(
  id: string,
  config: DecisionNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id,
    type: 'decision',
    async execute(ctx) {
      const nextNode = config.condition(ctx);
      return {
        goto: nextNode ?? config.fallback,
      };
    },
  };
}

/** Wait node configuration (human-in-the-loop) */
export interface WaitNodeConfig<TState extends BaseState> {
  /** Prompt to display for human input */
  prompt: string | ((ctx: ExecutionContext<TState>) => string);
  /** Auto-approve after timeout (optional) */
  autoApprove?: { after: number };
  /** Map human input to state update */
  inputMapper?: (input: string, ctx: ExecutionContext<TState>) => Partial<TState>;
}

/** Create a wait node */
export function waitNode<TState extends BaseState>(
  id: string,
  config: WaitNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id,
    type: 'wait',
    async execute(ctx) {
      const prompt = typeof config.prompt === 'function' ? config.prompt(ctx) : config.prompt;

      return {
        signals: [{ type: 'human_input_required', prompt }],
      };
    },
  };
}

/** Parallel node configuration */
export interface ParallelNodeConfig<TState extends BaseState> {
  /** Branches to execute in parallel */
  branches: NodeDefinition<TState>[];
  /** How to merge branch results */
  mergeStrategy: 'all' | 'first' | 'any';
  /** Custom merge function */
  merge?: (results: Partial<TState>[]) => Partial<TState>;
}

/** Create a parallel node */
export function parallelNode<TState extends BaseState>(
  id: string,
  config: ParallelNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id,
    type: 'parallel',
    async execute(ctx) {
      const promises = config.branches.map((branch) => branch.execute(ctx));

      let results: NodeResult<TState>[];
      switch (config.mergeStrategy) {
        case 'first':
          results = [await Promise.race(promises)];
          break;
        case 'any':
          results = [await Promise.any(promises)];
          break;
        case 'all':
        default:
          results = await Promise.all(promises);
      }

      const stateUpdates = results.map((r) => r.stateUpdate ?? {});
      const mergedState = config.merge
        ? config.merge(stateUpdates)
        : Object.assign({}, ...stateUpdates);

      return { stateUpdate: mergedState };
    },
  };
}
```

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) "Node Factory Functions" section

#### 5.2.4 GraphBuilder Fluent API

```typescript
// src/graph/builder.ts

import type { NodeDefinition, NodeId, BaseState, GraphConfig } from './types';
import { CompiledGraph } from './compiled';

/** Edge in the graph */
interface Edge {
  from: NodeId;
  to: NodeId;
  condition?: (ctx: ExecutionContext<any>) => boolean;
}

/** Loop configuration */
interface LoopConfig<TState> {
  until: (ctx: ExecutionContext<TState>) => boolean;
  maxIterations?: number;
}

/** Graph builder for fluent API */
export class GraphBuilder<TState extends BaseState> {
  private nodes = new Map<NodeId, NodeDefinition<TState>>();
  private edges: Edge[] = [];
  private startNode?: NodeId;
  private endNodes = new Set<NodeId>();
  private currentNode?: NodeId;
  private conditionalStack: { ifNode: NodeId; elseNode?: NodeId }[] = [];

  /** Set the starting node */
  start(nodeId: NodeId): this {
    this.startNode = nodeId;
    this.currentNode = nodeId;
    return this;
  }

  /** Add a node and connect from current */
  then(node: NodeDefinition<TState>): this {
    this.nodes.set(node.id, node);
    if (this.currentNode && this.currentNode !== node.id) {
      this.edges.push({ from: this.currentNode, to: node.id });
    }
    this.currentNode = node.id;
    return this;
  }

  /** Begin a conditional branch */
  if(condition: (ctx: ExecutionContext<TState>) => boolean): this {
    const decisionNodeId = `decision_${this.nodes.size}`;
    this.conditionalStack.push({ ifNode: decisionNodeId });
    // Actual decision node will be created on .else() or .endif()
    return this;
  }

  /** Alternative branch */
  else(): this {
    const current = this.conditionalStack[this.conditionalStack.length - 1];
    if (current) {
      current.elseNode = this.currentNode;
    }
    return this;
  }

  /** Close conditional block */
  endif(): this {
    this.conditionalStack.pop();
    return this;
  }

  /** Execute nodes in parallel */
  parallel(nodes: NodeDefinition<TState>[], config?: { merge?: (results: Partial<TState>[]) => Partial<TState> }): this {
    const parallelId = `parallel_${this.nodes.size}`;
    const parallelNode: NodeDefinition<TState> = {
      id: parallelId,
      type: 'parallel',
      async execute(ctx) {
        const results = await Promise.all(nodes.map((n) => n.execute(ctx)));
        const stateUpdates = results.map((r) => r.stateUpdate ?? {});
        const merged = config?.merge ? config.merge(stateUpdates) : Object.assign({}, ...stateUpdates);
        return { stateUpdate: merged };
      },
    };
    return this.then(parallelNode);
  }

  /** Create a loop */
  loop(node: NodeDefinition<TState>, config: LoopConfig<TState>): this {
    const loopId = `loop_${node.id}`;
    const loopNode: NodeDefinition<TState> = {
      id: loopId,
      type: 'subgraph', // Loops are implemented as subgraphs
      async execute(ctx) {
        let iteration = 0;
        let currentState = ctx.state;

        while (!config.until({ ...ctx, state: currentState })) {
          if (config.maxIterations && iteration >= config.maxIterations) {
            break;
          }

          const result = await node.execute({ ...ctx, state: currentState });
          currentState = { ...currentState, ...result.stateUpdate, iteration: iteration + 1 } as TState;
          iteration++;

          // Check for signals that should break the loop
          if (result.signals?.some((s) => s.type === 'human_input_required')) {
            return result;
          }
        }

        return { stateUpdate: currentState };
      },
    };
    return this.then(loopNode);
  }

  /** Add a human-in-the-loop wait point */
  wait(prompt: string, config?: { autoApprove?: { after: number } }): this {
    const waitId = `wait_${this.nodes.size}`;
    const waitNode: NodeDefinition<TState> = {
      id: waitId,
      type: 'wait',
      async execute() {
        return {
          signals: [{ type: 'human_input_required', prompt }],
        };
      },
    };
    return this.then(waitNode);
  }

  /** Add error recovery handler */
  catch(handler: (error: Error, ctx: ExecutionContext<TState>) => Promise<NodeResult<TState>>): this {
    // Error handling is applied to the previous node
    if (this.currentNode) {
      const node = this.nodes.get(this.currentNode);
      if (node) {
        const originalExecute = node.execute;
        node.execute = async (ctx) => {
          try {
            return await originalExecute(ctx);
          } catch (error) {
            return handler(error as Error, ctx);
          }
        };
      }
    }
    return this;
  }

  /** Mark node(s) as terminal */
  end(...nodeIds: NodeId[]): this {
    for (const id of nodeIds) {
      this.endNodes.add(id);
    }
    return this;
  }

  /** Compile the graph for execution */
  compile(config?: GraphConfig): CompiledGraph<TState> {
    if (!this.startNode) {
      throw new Error('Graph must have a start node');
    }
    return new CompiledGraph(this.nodes, this.edges, this.startNode, this.endNodes, config);
  }
}

/** Create a new graph builder */
export function graph<TState extends BaseState>(): GraphBuilder<TState> {
  return new GraphBuilder<TState>();
}
```

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) "Fluent API Chain Methods" section

#### 5.2.5 CompiledGraph Execution

```typescript
// src/graph/compiled.ts

import type { NodeDefinition, NodeId, Edge, BaseState, GraphConfig, ExecutionContext, ExecutionError } from './types';
import type { Checkpointer } from './checkpointer';

export class CompiledGraph<TState extends BaseState> {
  constructor(
    private nodes: Map<NodeId, NodeDefinition<TState>>,
    private edges: Edge[],
    private startNode: NodeId,
    private endNodes: Set<NodeId>,
    private config?: GraphConfig
  ) {}

  /** Execute the graph with initial state */
  async execute(initialState: Partial<TState>): Promise<TState> {
    const state = this.initializeState(initialState);

    for await (const currentState of this.stream(state)) {
      // Streaming execution
    }

    return this.getCheckpointedState() ?? state;
  }

  /** Stream execution for incremental state updates */
  async *stream(initialState: TState): AsyncGenerator<TState> {
    let state = initialState;
    const visited = new Set<NodeId>();
    const queue: NodeId[] = [this.startNode];
    const errors: ExecutionError[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (visited.has(currentId) && !this.isLoopNode(currentId)) {
        continue;
      }
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) {
        throw new Error(`Node ${currentId} not found`);
      }

      const ctx: ExecutionContext<TState> = {
        state,
        config: this.config ?? {},
        errors,
        abortSignal: undefined,
      };

      try {
        const result = await this.executeWithRetry(node, ctx);

        // Update state
        if (result.stateUpdate) {
          state = this.mergeState(state, result.stateUpdate);
          state.lastUpdated = new Date();
        }

        // Checkpoint
        if (this.config?.checkpointer) {
          await this.config.checkpointer.save(state);
        }

        // Yield current state
        yield state;

        // Handle signals
        if (result.signals) {
          for (const signal of result.signals) {
            if (signal.type === 'human_input_required') {
              // Pause execution - caller must resume with human input
              return;
            }
          }
        }

        // Determine next nodes
        if (result.goto) {
          const nextNodes = Array.isArray(result.goto) ? result.goto : [result.goto];
          queue.push(...nextNodes);
        } else if (!this.endNodes.has(currentId)) {
          const outgoingEdges = this.edges.filter((e) => e.from === currentId);
          for (const edge of outgoingEdges) {
            if (!edge.condition || edge.condition(ctx)) {
              queue.push(edge.to);
            }
          }
        }
      } catch (error) {
        errors.push({
          nodeId: currentId,
          error: error as Error,
          timestamp: new Date(),
          attempt: 1,
        });
        throw error;
      }
    }
  }

  private async executeWithRetry(node: NodeDefinition<TState>, ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> {
    const retryConfig = node.retry ?? { maxAttempts: 1, backoffMs: 0 };
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        return await node.execute(ctx);
      } catch (error) {
        lastError = error as Error;

        if (retryConfig.retryOn && !retryConfig.retryOn({ nodeId: node.id, error: lastError, timestamp: new Date(), attempt })) {
          throw lastError;
        }

        if (attempt < retryConfig.maxAttempts) {
          const delay = retryConfig.backoffMs * Math.pow(retryConfig.backoffMultiplier ?? 1, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  private initializeState(partial: Partial<TState>): TState {
    return {
      executionId: crypto.randomUUID(),
      lastUpdated: new Date(),
      outputs: {},
      ...partial,
    } as TState;
  }

  private mergeState(current: TState, update: Partial<TState>): TState {
    // Use immutable merge - would use annotation reducers in full implementation
    return { ...current, ...update };
  }

  private isLoopNode(nodeId: NodeId): boolean {
    return nodeId.startsWith('loop_');
  }

  private getCheckpointedState(): TState | undefined {
    // Would retrieve from checkpointer
    return undefined;
  }
}
```

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) "Graph Execution Model" section

#### 5.2.6 Checkpointer Implementations

```typescript
// src/graph/checkpointer.ts

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { BaseState } from './types';

export interface Checkpointer<TState extends BaseState = BaseState> {
  /** Save state checkpoint */
  save(state: TState): Promise<void>;
  /** Load latest checkpoint */
  load(executionId: string): Promise<TState | undefined>;
  /** List all checkpoints */
  list(): Promise<string[]>;
  /** Delete checkpoint */
  delete(executionId: string): Promise<void>;
}

/** In-memory checkpointer for testing */
export class MemorySaver<TState extends BaseState> implements Checkpointer<TState> {
  private checkpoints = new Map<string, TState>();

  async save(state: TState): Promise<void> {
    this.checkpoints.set(state.executionId, structuredClone(state));
  }

  async load(executionId: string): Promise<TState | undefined> {
    const state = this.checkpoints.get(executionId);
    return state ? structuredClone(state) : undefined;
  }

  async list(): Promise<string[]> {
    return Array.from(this.checkpoints.keys());
  }

  async delete(executionId: string): Promise<void> {
    this.checkpoints.delete(executionId);
  }
}

/** File-based checkpointer */
export class FileSaver<TState extends BaseState> implements Checkpointer<TState> {
  constructor(private directory: string) {}

  async save(state: TState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${state.executionId}.json`);
    await writeFile(path, JSON.stringify(state, null, 2));
  }

  async load(executionId: string): Promise<TState | undefined> {
    try {
      const path = join(this.directory, `${executionId}.json`);
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  async list(): Promise<string[]> {
    // Would use readdir and filter .json files
    return [];
  }

  async delete(executionId: string): Promise<void> {
    // Would use unlink
  }
}

/** Research directory checkpointer (Atomic-specific) */
export class ResearchDirSaver<TState extends BaseState> implements Checkpointer<TState> {
  constructor(private projectRoot: string = process.cwd()) {}

  private get checkpointDir(): string {
    return join(this.projectRoot, 'research', 'checkpoints');
  }

  async save(state: TState): Promise<void> {
    await mkdir(this.checkpointDir, { recursive: true });

    // Save as YAML frontmatter + JSON for human readability
    const path = join(this.checkpointDir, `${state.executionId}.md`);
    const content = `---
executionId: ${state.executionId}
lastUpdated: ${state.lastUpdated.toISOString()}
---

\`\`\`json
${JSON.stringify(state, null, 2)}
\`\`\`
`;
    await writeFile(path, content);
  }

  async load(executionId: string): Promise<TState | undefined> {
    try {
      const path = join(this.checkpointDir, `${executionId}.md`);
      const content = await readFile(path, 'utf-8');

      // Extract JSON from code block
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<string[]> {
    // Would use readdir and extract execution IDs
    return [];
  }

  async delete(executionId: string): Promise<void> {
    // Would use unlink
  }
}
```

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) "Checkpointing Strategy" section

### 5.3 Atomic Workflow Graph

```typescript
// src/workflows/atomic.ts

import { graph, agentNode, toolNode, decisionNode, waitNode } from '../graph';
import type { AtomicWorkflowState } from '../graph/annotation';
import type { CodingAgentClient } from '../sdk/types';

export function createAtomicWorkflow(client: CodingAgentClient) {
  // Node definitions
  const research = agentNode<AtomicWorkflowState>('research', {
    agentType: 'codebase-research-analyzer',
    systemPrompt: 'Analyze the codebase and existing research documents...',
    outputMapper: (output) => ({ researchDoc: output }),
  }, client);

  const createSpec = agentNode<AtomicWorkflowState>('createSpec', {
    agentType: 'general',
    systemPrompt: 'Create a technical specification based on research...',
    outputMapper: (output) => ({ specDoc: output }),
  }, client);

  const reviewSpec = decisionNode<AtomicWorkflowState>('reviewSpec', {
    condition: (ctx) => ctx.state.specApproved ? 'createFeatureList' : 'waitForApproval',
    fallback: 'waitForApproval',
  });

  const waitForApproval = waitNode<AtomicWorkflowState>('waitForApproval', {
    prompt: (ctx) => `Please review the spec:\n\n${ctx.state.specDoc}\n\nApprove? (yes/no)`,
  });

  const createFeatureList = agentNode<AtomicWorkflowState>('createFeatureList', {
    agentType: 'codebase-analyzer',
    systemPrompt: 'Create a feature list from the spec...',
    outputMapper: (output) => {
      const features = JSON.parse(output);
      return { featureList: features, allFeaturesPassing: false };
    },
  }, client);

  const selectFeature = decisionNode<AtomicWorkflowState>('selectFeature', {
    condition: (ctx) => {
      const pending = ctx.state.featureList?.find((f) => !f.passes);
      if (pending) {
        return 'implementFeature';
      }
      return 'createPR';
    },
  });

  const implementFeature = agentNode<AtomicWorkflowState>('implementFeature', {
    agentType: 'general',
    systemPrompt: 'Implement the current feature...',
    outputMapper: (output, ctx) => {
      const currentFeature = ctx.state.currentFeature;
      if (currentFeature) {
        return {
          featureList: [{ ...currentFeature, passes: true }],
          iteration: ctx.state.iteration + 1,
        };
      }
      return {};
    },
  }, client);

  const createPR = toolNode<AtomicWorkflowState>('createPR', {
    toolName: 'gh',
    args: (ctx) => ({
      command: 'pr',
      subcommand: 'create',
      title: 'Implement features from spec',
      body: ctx.state.specDoc ?? '',
    }),
    outputMapper: (output) => ({ prUrl: String(output) }),
  });

  // Build the graph
  return graph<AtomicWorkflowState>()
    .start('research')
    .then(research)
    .then(createSpec)
    .then(reviewSpec)
    .then(waitForApproval)
    .then(createFeatureList)
    .loop(implementFeature, {
      until: (ctx) => ctx.state.allFeaturesPassing === true,
      maxIterations: 100,
    })
    .then(createPR)
    .end('createPR')
    .compile({
      checkpointer: new ResearchDirSaver(),
    });
}
```

**Research Reference:** [2026-01-31-graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md) "Ralph Loop Pattern" section

### 5.4 OpenTUI Chat Interface

#### 5.4.1 Core Chat Application

```typescript
// src/ui/chat.tsx

import { render, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { createCliRenderer, BoxRenderable, ScrollBoxRenderable, InputRenderable, MarkdownRenderable, CodeRenderable } from '@opentui/core';
import { useState, useCallback } from 'react';
import type { AgentMessage } from '../sdk/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  streaming?: boolean;
}

interface ChatAppProps {
  onSendMessage: (message: string) => Promise<void>;
  onStreamMessage: () => AsyncGenerator<AgentMessage>;
  onExit: () => void;
}

export function ChatApp({ onSendMessage, onStreamMessage, onExit }: ChatAppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const { width, height } = useTerminalDimensions();

  useKeyboard((event) => {
    if (event.name === 'escape') {
      onExit();
    }
    if (event.ctrl && event.name === 'c') {
      onExit();
    }
  });

  const handleSubmit = useCallback(async (input: string) => {
    if (!input.trim() || isStreaming) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Create placeholder for assistant response
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), streaming: true },
    ]);

    setIsStreaming(true);

    try {
      await onSendMessage(input);

      // Stream response
      for await (const chunk of onStreamMessage()) {
        if (chunk.type === 'text') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk.content } : m
            )
          );
        }
      }
    } finally {
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
      );
    }
  }, [isStreaming, onSendMessage, onStreamMessage]);

  return (
    <box flexDirection="column" flexGrow={1} width={width} height={height}>
      {/* Header */}
      <box border padding={1} title="Atomic Chat">
        <text fg="#4a90e2">Press ESC to exit | Ctrl+C to cancel</text>
      </box>

      {/* Message History with Sticky Scroll */}
      <scrollbox
        stickyScroll
        stickyStart="bottom"
        viewportCulling
        flexGrow={1}
        border
        title="Messages"
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </scrollbox>

      {/* Input Area */}
      <box border padding={1}>
        <input
          placeholder={isStreaming ? 'Waiting for response...' : 'Type your message...'}
          onSubmit={handleSubmit}
          disabled={isStreaming}
        />
      </box>
    </box>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <box
      flexDirection="column"
      padding={1}
      marginBottom={1}
      backgroundColor={isUser ? '#2d3748' : '#1a365d'}
    >
      <text fg={isUser ? '#a0aec0' : '#63b3ed'} bold>
        {isUser ? 'You' : 'Assistant'}
        {message.streaming && ' (typing...)'}
      </text>

      {/* Render markdown with streaming support */}
      <markdown content={message.content} streaming={message.streaming} />
    </box>
  );
}
```

**Research Reference:** [2026-01-31-opentui-library-research.md](../research/docs/2026-01-31-opentui-library-research.md) "Chat Interface Pattern" section

#### 5.4.2 Streaming Code Blocks

```typescript
// src/ui/code-block.tsx

import { CodeRenderable } from '@opentui/core';

interface CodeBlockProps {
  content: string;
  language: string;
  streaming?: boolean;
}

export function CodeBlock({ content, language, streaming = false }: CodeBlockProps) {
  return (
    <code
      content={content}
      filetype={language}
      syntaxStyle="monokai"
      streaming={streaming}
      border
      padding={1}
    />
  );
}

/**
 * Extract and render code blocks from markdown content
 */
export function extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks: Array<{ language: string; code: string }> = [];

  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    });
  }

  return blocks;
}
```

#### 5.4.3 Theme System

```typescript
// src/ui/theme.ts

export interface Theme {
  name: string;
  colors: {
    background: string;
    foreground: string;
    accent: string;
    border: string;
    userMessage: string;
    assistantMessage: string;
    error: string;
    success: string;
    warning: string;
  };
}

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    background: '#1a1a2e',
    foreground: '#edf2f7',
    accent: '#4a90e2',
    border: '#4a5568',
    userMessage: '#2d3748',
    assistantMessage: '#1a365d',
    error: '#fc8181',
    success: '#68d391',
    warning: '#f6e05e',
  },
};

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: '#ffffff',
    foreground: '#1a202c',
    accent: '#3182ce',
    border: '#e2e8f0',
    userMessage: '#edf2f7',
    assistantMessage: '#ebf8ff',
    error: '#c53030',
    success: '#276749',
    warning: '#c05621',
  },
};

// Theme context for OpenTUI
import { createContext, useContext } from 'react';

const ThemeContext = createContext<Theme>(darkTheme);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
```

#### 5.4.4 CLI Integration

```typescript
// src/ui/index.ts

import { render } from '@opentui/react';
import { createCliRenderer } from '@opentui/core';
import { ChatApp } from './chat';
import type { CodingAgentClient, Session } from '../sdk/types';

export async function startChatUI(client: CodingAgentClient, sessionConfig: SessionConfig): Promise<void> {
  const renderer = await createCliRenderer();
  let session: Session | undefined;
  let currentStream: AsyncGenerator<AgentMessage> | undefined;

  const handleSendMessage = async (message: string) => {
    if (!session) {
      session = await client.createSession(sessionConfig);
    }
    await session.send(message);
  };

  const handleStreamMessage = async function* () {
    if (session) {
      currentStream = session.stream();
      yield* currentStream;
    }
  };

  const handleExit = async () => {
    if (session) {
      await session.destroy();
    }
    // IMPORTANT: Unmount before destroying renderer to avoid Yoga crash
    root.unmount();
    await renderer.destroy();
    process.exit(0);
  };

  const root = render(
    <ChatApp
      onSendMessage={handleSendMessage}
      onStreamMessage={handleStreamMessage}
      onExit={handleExit}
    />,
    renderer
  );

  // Handle process signals
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}
```

**Research Reference:** [2026-01-31-opentui-library-research.md](../research/docs/2026-01-31-opentui-library-research.md) "CLI Integration" and "Known Issues" sections

### 5.5 Telemetry Integration

#### 5.5.1 Telemetry Types and Collector

```typescript
// src/telemetry/types.ts

export interface TelemetryEvent {
  eventId: string;
  timestamp: Date;
  eventType: TelemetryEventType;
  sessionId?: string;
  executionId?: string;
  properties: Record<string, unknown>;
}

export type TelemetryEventType =
  // SDK Events
  | 'sdk.session.created'
  | 'sdk.session.resumed'
  | 'sdk.session.destroyed'
  | 'sdk.message.sent'
  | 'sdk.message.received'
  | 'sdk.tool.executed'
  | 'sdk.error'
  // Graph Events
  | 'graph.execution.started'
  | 'graph.execution.completed'
  | 'graph.execution.failed'
  | 'graph.node.started'
  | 'graph.node.completed'
  | 'graph.node.failed'
  | 'graph.checkpoint.saved'
  | 'graph.checkpoint.loaded'
  // Workflow Events
  | 'workflow.ralph.started'
  | 'workflow.ralph.iteration'
  | 'workflow.ralph.completed'
  | 'workflow.feature.started'
  | 'workflow.feature.completed'
  // UI Events
  | 'ui.chat.opened'
  | 'ui.chat.closed'
  | 'ui.message.submitted';

export interface TelemetryCollector {
  /** Track an event */
  track(event: Omit<TelemetryEvent, 'eventId' | 'timestamp'>): void;
  /** Flush pending events */
  flush(): Promise<void>;
  /** Check if telemetry is enabled */
  isEnabled(): boolean;
  /** Shutdown collector */
  shutdown(): Promise<void>;
}

// src/telemetry/collector.ts

import { writeFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { TelemetryEvent, TelemetryCollector, TelemetryEventType } from './types';

export class UnifiedTelemetryCollector implements TelemetryCollector {
  private events: TelemetryEvent[] = [];
  private anonymousId: string;
  private flushInterval: NodeJS.Timeout | undefined;
  private readonly batchSize = 100;
  private readonly flushIntervalMs = 30000; // 30 seconds

  constructor(
    private config: {
      enabled: boolean;
      localLogPath?: string;
      appInsightsKey?: string;
      anonymousId?: string;
    }
  ) {
    this.anonymousId = config.anonymousId ?? this.generateAnonymousId();

    if (config.enabled) {
      this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
    }
  }

  private generateAnonymousId(): string {
    // Generate stable anonymous ID from machine characteristics
    const os = require('os');
    const crypto = require('crypto');
    const machineId = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`;
    return crypto.createHash('sha256').update(machineId).digest('hex').substring(0, 16);
  }

  isEnabled(): boolean {
    // Respect DO_NOT_TRACK environment variable
    if (process.env.DO_NOT_TRACK === '1') return false;
    if (process.env.ATOMIC_TELEMETRY === '0') return false;
    return this.config.enabled;
  }

  track(event: Omit<TelemetryEvent, 'eventId' | 'timestamp'>): void {
    if (!this.isEnabled()) return;

    const fullEvent: TelemetryEvent = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: new Date(),
      properties: {
        ...event.properties,
        anonymousId: this.anonymousId,
        platform: process.platform,
        nodeVersion: process.version,
      },
    };

    this.events.push(fullEvent);

    // Auto-flush if batch size reached
    if (this.events.length >= this.batchSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;

    const eventsToFlush = [...this.events];
    this.events = [];

    // Write to local JSONL log
    if (this.config.localLogPath) {
      await this.writeToLocalLog(eventsToFlush);
    }

    // Send to Azure Application Insights
    if (this.config.appInsightsKey) {
      await this.sendToAppInsights(eventsToFlush);
    }
  }

  private async writeToLocalLog(events: TelemetryEvent[]): Promise<void> {
    const logDir = this.config.localLogPath!;
    await mkdir(logDir, { recursive: true });

    const logFile = join(logDir, `telemetry-${new Date().toISOString().split('T')[0]}.jsonl`);
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';

    await appendFile(logFile, lines);
  }

  private async sendToAppInsights(events: TelemetryEvent[]): Promise<void> {
    // Azure Application Insights ingestion
    const endpoint = 'https://dc.services.visualstudio.com/v2/track';

    const telemetryItems = events.map((event) => ({
      name: 'Microsoft.ApplicationInsights.Event',
      time: event.timestamp.toISOString(),
      iKey: this.config.appInsightsKey,
      data: {
        baseType: 'EventData',
        baseData: {
          ver: 2,
          name: event.eventType,
          properties: {
            eventId: event.eventId,
            sessionId: event.sessionId,
            executionId: event.executionId,
            ...event.properties,
          },
        },
      },
    }));

    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telemetryItems),
      });
    } catch (error) {
      // Fail silently - telemetry should not break the application
      console.debug('Telemetry upload failed:', error);
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
  }
}
```

#### 5.5.2 SDK Telemetry Integration

```typescript
// src/telemetry/sdk-integration.ts

import type { CodingAgentClient, EventHandler, AgentEvent } from '../sdk/types';
import type { TelemetryCollector } from './types';

/**
 * Wrap a CodingAgentClient to automatically track telemetry events
 */
export function withTelemetry(
  client: CodingAgentClient,
  collector: TelemetryCollector
): CodingAgentClient {
  const originalCreateSession = client.createSession.bind(client);
  const originalResumeSession = client.resumeSession.bind(client);

  return {
    ...client,

    async createSession(config) {
      const session = await originalCreateSession(config);

      collector.track({
        eventType: 'sdk.session.created',
        sessionId: session.id,
        properties: {
          model: config.model,
          hasSystemPrompt: !!config.systemPrompt,
          permissionMode: config.permissionMode,
        },
      });

      return wrapSession(session, collector);
    },

    async resumeSession(sessionId, config) {
      const session = await originalResumeSession(sessionId, config);

      collector.track({
        eventType: 'sdk.session.resumed',
        sessionId: session.id,
        properties: {},
      });

      return wrapSession(session, collector);
    },

    on(event, handler) {
      const wrappedHandler: EventHandler = (agentEvent) => {
        // Track all SDK events
        collector.track({
          eventType: mapEventType(agentEvent.type),
          sessionId: agentEvent.sessionId,
          properties: { originalType: agentEvent.type },
        });

        return handler(agentEvent);
      };

      return client.on(event, wrappedHandler);
    },
  };
}

function wrapSession(session: Session, collector: TelemetryCollector): Session {
  const originalSend = session.send.bind(session);
  const originalDestroy = session.destroy.bind(session);

  return {
    ...session,

    async send(message) {
      collector.track({
        eventType: 'sdk.message.sent',
        sessionId: session.id,
        properties: { messageLength: message.length },
      });

      return originalSend(message);
    },

    async destroy() {
      collector.track({
        eventType: 'sdk.session.destroyed',
        sessionId: session.id,
        properties: {},
      });

      return originalDestroy();
    },
  };
}

function mapEventType(sdkEventType: string): TelemetryEventType {
  const mapping: Record<string, TelemetryEventType> = {
    'message.complete': 'sdk.message.received',
    'tool.complete': 'sdk.tool.executed',
    'session.error': 'sdk.error',
  };
  return mapping[sdkEventType] ?? 'sdk.message.received';
}
```

#### 5.5.3 Graph Telemetry Integration

```typescript
// src/telemetry/graph-integration.ts

import type { GraphConfig, BaseState } from '../graph/types';
import type { TelemetryCollector } from './types';

/**
 * Create graph config with telemetry hooks
 */
export function withGraphTelemetry<TState extends BaseState>(
  config: GraphConfig,
  collector: TelemetryCollector
): GraphConfig {
  return {
    ...config,

    onProgress: (state) => {
      collector.track({
        eventType: 'graph.node.completed',
        executionId: state.executionId,
        properties: {
          nodeId: state.outputs.lastNodeId,
          iteration: (state as any).iteration,
        },
      });

      // Call original handler if exists
      config.onProgress?.(state);
    },
  };
}

/**
 * Track graph execution lifecycle
 */
export function trackGraphExecution<TState extends BaseState>(
  collector: TelemetryCollector,
  executionId: string
) {
  return {
    started: () => {
      collector.track({
        eventType: 'graph.execution.started',
        executionId,
        properties: {},
      });
    },

    completed: (state: TState) => {
      collector.track({
        eventType: 'graph.execution.completed',
        executionId,
        properties: {
          totalIterations: (state as any).iteration ?? 0,
          featureCount: (state as any).featureList?.length ?? 0,
        },
      });
    },

    failed: (error: Error, nodeId: string) => {
      collector.track({
        eventType: 'graph.execution.failed',
        executionId,
        properties: {
          nodeId,
          errorMessage: error.message,
          errorName: error.name,
        },
      });
    },

    checkpointSaved: (label: string) => {
      collector.track({
        eventType: 'graph.checkpoint.saved',
        executionId,
        properties: { label },
      });
    },
  };
}
```

#### 5.5.4 Telemetry Configuration

```typescript
// src/telemetry/config.ts

import { join } from 'path';
import { homedir } from 'os';

export interface TelemetryConfig {
  enabled: boolean;
  localLogPath: string;
  appInsightsKey?: string;
}

export function loadTelemetryConfig(): TelemetryConfig {
  // Check environment variables
  const doNotTrack = process.env.DO_NOT_TRACK === '1';
  const telemetryDisabled = process.env.ATOMIC_TELEMETRY === '0';

  // Default paths
  const dataDir =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'atomic')
      : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'atomic');

  return {
    enabled: !doNotTrack && !telemetryDisabled,
    localLogPath: join(dataDir, 'telemetry'),
    appInsightsKey: process.env.ATOMIC_APP_INSIGHTS_KEY,
  };
}
```

**Research Reference:** [2026-01-31-claude-implementation-analysis.md](../research/docs/2026-01-31-claude-implementation-analysis.md) "Telemetry Event Structure" section, [2026-01-31-azure-app-insights-backend-integration.md](../research/docs/2026-01-22-azure-app-insights-backend-integration.md)

## 6. Alternatives Considered

| Option                                | Pros                                             | Cons                                                     | Reason for Rejection                                       |
| ------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| **A: Keep current hook-based**        | No migration effort, already working             | No unified abstraction, limited workflow patterns        | Cannot express complex workflows                           |
| **B: LangGraph.js directly**          | Battle-tested, good documentation                | Heavy dependency (~500KB), opinionated patterns          | Too heavyweight for CLI tool                               |
| **C: Temporal.io workflows**          | Production-grade, built-in durability            | Requires server infrastructure, complex setup            | Overkill for local CLI workflows                           |
| **D: Custom graph engine (Selected)** | Lightweight, tailored to Atomic needs, type-safe | Implementation effort, less battle-tested                | **Selected:** Best balance of features and simplicity      |
| **E: State machine library (XState)** | Well-documented, visual debugging                | State machines less flexible than graphs, learning curve | Graphs better model agentic workflows with dynamic routing |

**Research Reference:** [2026-01-31-sdk-migration-and-graph-execution.md](../research/docs/2026-01-31-sdk-migration-and-graph-execution.md) "Comparative Analysis" section

## 7. Cross-Cutting Concerns

### 7.1 Security and Privacy

- **Authentication:** Each SDK uses its own authentication:
  - Claude: `ANTHROPIC_API_KEY` environment variable
  - OpenCode: Local server connection (no auth for localhost)
  - Copilot: GitHub OAuth via `gh auth login` or `GITHUB_TOKEN` environment variable
- **Permission Modes:** All clients support `permissionMode` configuration to control tool access
- **Telemetry Privacy:**
  - Consent-based collection with `DO_NOT_TRACK` and `ATOMIC_TELEMETRY=0` opt-out
  - Anonymous ID generated from machine hash (no PII)
  - Local JSONL logs stored in user data directory
  - Remote upload to Azure App Insights only with explicit configuration
- **Data Protection:** Checkpoints stored locally in `research/checkpoints/`, never transmitted

### 7.2 Observability Strategy

- **Metrics:**
  - `graph_execution_duration` (Histogram) - Total workflow execution time
  - `node_execution_count` (Counter) - Executions per node type
  - `checkpoint_save_count` (Counter) - Checkpoint saves
  - `context_window_usage` (Gauge) - Current context usage 0-1
- **Tracing:** Execution ID propagated through all nodes for correlation
- **Alerting:** Context window warning signal at 60% usage threshold

### 7.3 Scalability and Capacity Planning

- **Concurrency:** `maxConcurrency` config limits parallel node execution
- **Memory:** Checkpoints stored on disk, not in memory
- **Context Window:** Automatic compaction via `session.summarize()` (OpenCode) or session recreation (Claude)

### 7.4 Error Handling

```typescript
// Error handling patterns

// 1. Node-level retry with exponential backoff
const nodeWithRetry: NodeDefinition<State> = {
  id: 'resilient',
  type: 'agent',
  execute: async (ctx) => { /* ... */ },
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    retryOn: (error) => error.error.message.includes('rate limit'),
  },
};

// 2. Graph-level catch handler
graph<State>()
  .then(riskyNode)
  .catch(async (error, ctx) => {
    // Log error, update state, choose recovery path
    return {
      stateUpdate: { error: error.message },
      goto: 'errorRecovery',
    };
  });

// 3. Debug report generation
const debugNode = agentNode<AtomicWorkflowState>('debug', {
  agentType: 'debugger',
  systemPrompt: 'Analyze the error and suggest fixes...',
  outputMapper: (output) => ({
    debugReports: [JSON.parse(output)],
  }),
}, client);
```

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

| Phase | Duration | Activities                                               |
| ----- | -------- | -------------------------------------------------------- |
| 1     | Week 1   | Core types, interfaces, and `MemorySaver` checkpointer   |
| 2     | Week 2   | `GraphBuilder` class with fluent API methods             |
| 3     | Week 3   | `CompiledGraph` execution engine with streaming          |
| 4     | Week 4   | SDK client implementations (Claude, OpenCode, Copilot)   |
| 5     | Week 5   | OpenTUI chat interface with streaming and themes         |
| 6     | Week 6   | Telemetry integration (local JSONL + Azure App Insights) |
| 7     | Week 7   | Atomic workflow migration and CLI integration            |
| 8     | Week 8   | Testing, documentation, and rollout                      |

### 8.2 Test Plan

**Unit Tests:**
```typescript
// tests/graph/builder.test.ts
describe('GraphBuilder', () => {
  test('builds linear graph', () => {
    const compiled = graph<TestState>()
      .start('a')
      .then(nodeA)
      .then(nodeB)
      .compile();
    expect(compiled.nodes.size).toBe(2);
  });

  test('loop exits on condition', async () => {
    let iterations = 0;
    const loopNode = { id: 'counter', execute: async () => ({ stateUpdate: { count: ++iterations } }) };
    const compiled = graph<{ count: number }>()
      .start('loop')
      .loop(loopNode, { until: (ctx) => ctx.state.count >= 5 })
      .compile();
    const result = await compiled.execute({ count: 0 });
    expect(result.count).toBe(5);
  });
});
```

**Integration Tests:**
```typescript
// tests/sdk/claude-client.test.ts
describe('ClaudeAgentClient', () => {
  test('creates session and streams response', async () => {
    const client = new ClaudeAgentClient();
    const session = await client.createSession({ model: 'claude-sonnet-4-5-20250929' });
    await session.send('Hello');
    const messages = [];
    for await (const msg of session.stream()) {
      messages.push(msg);
    }
    expect(messages.length).toBeGreaterThan(0);
  });
});
```

**End-to-End Tests:**
| Test Case            | Command                               | Expected                                  |
| -------------------- | ------------------------------------- | ----------------------------------------- |
| Graph execution      | `bun test:e2e:graph`                  | Workflow completes with checkpoints       |
| Ralph loop migration | `atomic ralph setup -a claude "test"` | Uses graph engine, creates checkpoints    |
| Context compaction   | Long-running workflow                 | Summarize called at 60% context usage     |
| Error recovery       | Inject failure mid-workflow           | Retries, then falls back to error handler |

### 8.3 Rollback Plan

1. Graph engine is additive - existing hook-based implementations continue to work
2. Feature flag `ATOMIC_USE_GRAPH_ENGINE=1` controls opt-in during rollout
3. If issues arise, disable flag and fall back to hook-based execution

## 9. Open Questions / Unresolved Issues

- [ ] **Claude V2 Stability:** When will `unstable_v2_*` APIs be promoted to stable?
  - *Impact:* May require API changes when V2 stabilizes
  - *Mitigation:* Abstract behind `ClaudeAgentClient` interface

- [ ] **Context Window Estimation:** How to estimate context usage for Claude SDK (no API exposed)?
  - *Options:* Token counting locally, fixed buffer approach
  - *Recommendation:* Use conservative 60% threshold with session recreation

- [ ] **Parallel Execution Limits:** What is the optimal `maxConcurrency` for parallel nodes?
  - *Impact:* Rate limiting, resource consumption
  - *Recommendation:* Default to 3, configurable per graph

- [ ] **OpenTUI Multi-width Characters:** Known issue with Chinese/CJK character highlighting
  - *Impact:* Visual offset issues with non-ASCII text
  - *Mitigation:* Consider ASCII-only for critical UI elements, or await upstream fix

- [ ] **Telemetry Consent Flow:** How to prompt for initial consent on first run?
  - *Options:* Interactive prompt, config file, environment variable only
  - *Recommendation:* Default to enabled with clear opt-out documentation

## 10. Implementation Checklist

### Phase 1: Core Types (Week 1)
- [ ] Create `src/graph/types.ts` with all type definitions
- [ ] Create `src/graph/annotation.ts` with state annotation system
- [ ] Create `src/graph/checkpointer.ts` with `MemorySaver`
- [ ] Add unit tests for types and annotations

### Phase 2: GraphBuilder (Week 2)
- [ ] Create `src/graph/builder.ts` with fluent API
- [ ] Implement `.start()`, `.then()`, `.end()`
- [ ] Implement `.if()`, `.else()`, `.endif()` conditional logic
- [ ] Implement `.loop()` with exit conditions
- [ ] Implement `.parallel()` with merge strategies
- [ ] Implement `.wait()` for human-in-the-loop
- [ ] Implement `.catch()` for error handling
- [ ] Add unit tests for all builder methods

### Phase 3: CompiledGraph (Week 3)
- [ ] Create `src/graph/compiled.ts` with execution engine
- [ ] Implement BFS traversal with visited tracking
- [ ] Implement state merging with annotation reducers
- [ ] Implement streaming via `AsyncGenerator`
- [ ] Implement retry logic with exponential backoff
- [ ] Implement signal handling (context warning, human input)
- [ ] Add integration tests for execution

### Phase 4: SDK Clients and Hook Migration (Week 4)
- [ ] Create `src/sdk/types.ts` with unified interface
- [ ] Create `src/sdk/claude-client.ts` using V1+V2 hybrid approach
- [ ] Implement `ClaudeAgentClient.registerHooks()` for native hook registration
- [ ] Implement `ClaudeAgentClient.createAdvancedSession()` for V1 features (forking, async input)
- [ ] Create `src/sdk/opencode-client.ts` using V2 client
- [ ] Create `src/sdk/copilot-client.ts` using Copilot SDK
- [ ] Implement `createPermissionHandler` for Copilot
- [ ] Create `src/sdk/hooks.ts` with `HookManager` class
- [ ] Implement unified hook event mapping across all SDKs
- [ ] Migrate `.claude/settings.json` hooks to `ClaudeAgentClient.registerHooks()`
- [ ] Migrate `.github/hooks/hooks.json` to `CopilotClient.on()` subscriptions
- [ ] Migrate `.opencode/plugin/*.ts` hooks to `OpenCodeClient` event handlers
- [ ] Add unit tests with mocked SDKs
- [ ] Add integration tests with real SDKs (optional, requires API keys)

### Phase 5: OpenTUI Chat Interface (Week 5)
- [ ] Install `@opentui/core` and `@opentui/react` dependencies
- [ ] Create `src/ui/chat.tsx` with main ChatApp component
- [ ] Implement `MessageBubble` with markdown rendering
- [ ] Create `src/ui/code-block.tsx` with syntax highlighting
- [ ] Create `src/ui/theme.ts` with dark/light themes
- [ ] Create `src/ui/index.ts` with CLI integration
- [ ] Handle renderer lifecycle (unmount before destroy)
- [ ] Add unit tests for UI components
- [ ] Add integration tests for chat flow

### Phase 6: Telemetry Integration (Week 6)
- [ ] Create `src/telemetry/types.ts` with event types
- [ ] Create `src/telemetry/collector.ts` with `UnifiedTelemetryCollector`
- [ ] Implement local JSONL logging
- [ ] Implement Azure Application Insights upload
- [ ] Create `src/telemetry/sdk-integration.ts` with `withTelemetry` wrapper
- [ ] Create `src/telemetry/graph-integration.ts` with graph hooks
- [ ] Create `src/telemetry/config.ts` with configuration loader
- [ ] Implement consent-based collection with opt-out
- [ ] Add unit tests for telemetry collector
- [ ] Add integration tests for event tracking

### Phase 7: Atomic Integration (Week 7)
- [ ] Create `src/workflows/atomic.ts` with workflow definition
- [ ] Create `src/graph/checkpointer.ts` `ResearchDirSaver`
- [ ] Update `atomic ralph setup` to use graph engine
- [ ] Add feature flag `ATOMIC_USE_GRAPH_ENGINE`
- [ ] Integrate OpenTUI chat interface with workflows
- [ ] Update CLI to display graph execution progress
- [ ] Wire up telemetry for workflow events
- [ ] Add end-to-end tests for Ralph workflow

### Phase 8: Rollout (Week 8)
- [ ] Update README with graph engine documentation
- [ ] Document OpenTUI chat interface usage
- [ ] Document telemetry collection and opt-out
- [ ] Create migration guide for existing Ralph users
- [ ] Enable graph engine by default
- [ ] Monitor for issues during rollout
- [ ] Address any reported issues

## 11. File Structure (Post-Implementation)

```
src/
├── sdk/
│   ├── types.ts                  # CodingAgentClient interface
│   ├── claude-client.ts          # Claude Agent SDK V1+V2 hybrid wrapper
│   ├── opencode-client.ts        # OpenCode SDK wrapper
│   ├── copilot-client.ts         # GitHub Copilot SDK wrapper
│   ├── hooks.ts                  # HookManager for cross-SDK hook migration
│   └── index.ts                  # Re-exports
├── graph/
│   ├── types.ts                  # Graph type definitions
│   ├── annotation.ts             # State annotation system
│   ├── nodes.ts                  # Node factory functions
│   ├── builder.ts                # GraphBuilder fluent API
│   ├── compiled.ts               # CompiledGraph execution
│   ├── checkpointer.ts           # Checkpointer implementations
│   └── index.ts                  # Re-exports
├── ui/
│   ├── chat.tsx                  # Main ChatApp component
│   ├── code-block.tsx            # Syntax-highlighted code blocks
│   ├── theme.ts                  # Dark/light theme definitions
│   └── index.ts                  # CLI integration and exports
├── telemetry/
│   ├── types.ts                  # TelemetryEvent types
│   ├── collector.ts              # UnifiedTelemetryCollector
│   ├── sdk-integration.ts        # withTelemetry wrapper
│   ├── graph-integration.ts      # Graph execution tracking
│   ├── config.ts                 # Telemetry configuration
│   └── index.ts                  # Re-exports
├── workflows/
│   ├── atomic.ts                 # Atomic workflow definition
│   └── index.ts                  # Re-exports
└── ...

tests/
├── sdk/
│   ├── claude-client.test.ts
│   ├── opencode-client.test.ts
│   ├── copilot-client.test.ts
│   └── hooks.test.ts             # HookManager and migration tests
├── graph/
│   ├── builder.test.ts
│   ├── compiled.test.ts
│   └── checkpointer.test.ts
├── ui/
│   ├── chat.test.tsx
│   └── theme.test.ts
├── telemetry/
│   ├── collector.test.ts
│   └── integration.test.ts
└── workflows/
    └── atomic.test.ts

research/
├── checkpoints/                  # Workflow checkpoints (gitignored)
│   └── {executionId}.md
└── docs/
    └── 2026-01-31-*.md           # Research documents
```

## 12. Appendix: Research Document Summary

| Document                                                                                                 | Key Findings                                                                     | Relevance             |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------- |
| [claude-agent-sdk-research.md](../research/docs/2026-01-31-claude-agent-sdk-research.md)                 | V2 API with `send()`/`stream()` pattern, hooks system, MCP integration           | High - Primary SDK    |
| [github-copilot-sdk-research.md](../research/docs/2026-01-31-github-copilot-sdk-research.md)             | 31 event types, thin client architecture, skills system, permission handling     | High - Primary SDK    |
| [opencode-sdk-research.md](../research/docs/2026-01-31-opencode-sdk-research.md)                         | Production-ready V2, hierarchical sessions, plugin system                        | High - Primary SDK    |
| [claude-implementation-analysis.md](../research/docs/2026-01-31-claude-implementation-analysis.md)       | SessionEnd hook only, YAML frontmatter agents, marketplace plugins               | High - Current state  |
| [github-implementation-analysis.md](../research/docs/2026-01-31-github-implementation-analysis.md)       | 3 hook events, cross-platform commands, external orchestrator for Ralph          | High - Reference      |
| [opencode-implementation-analysis.md](../research/docs/2026-01-31-opencode-implementation-analysis.md)   | Full plugin SDK, in-session continuation, `session.summarize()`                  | High - Best practices |
| [graph-execution-pattern-design.md](../research/docs/2026-01-31-graph-execution-pattern-design.md)       | Pregel-based StateGraph, fluent API, 6 node types, checkpointing                 | High - Core design    |
| [sdk-migration-and-graph-execution.md](../research/docs/2026-01-31-sdk-migration-and-graph-execution.md) | Unified abstraction layer, migration paths, synthesis                            | High - Strategy       |
| [opentui-library-research.md](../research/docs/2026-01-31-opentui-library-research.md)                   | TypeScript/Zig architecture, flexbox layout, streaming support, React reconciler | High - UI Layer       |
