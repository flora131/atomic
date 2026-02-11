# Atomic Current Workflow and SDK Architecture

**Date:** 2026-01-31  
**Purpose:** Document the current implementation of workflow, SDK, command, and configuration systems in Atomic CLI

---

## Overview

Atomic is a CLI tool that manages configurations for coding agents (Claude, OpenCode, Copilot) and provides a graph-based workflow execution engine for autonomous development loops. The architecture comprises:

1. **SDK Layer** - Unified client abstraction for multiple coding agents
2. **Graph Engine** - Declarative workflow execution with nodes, edges, and state management
3. **Workflow Definitions** - Pre-built workflows using the graph engine
4. **Command System** - CLI commands using Commander.js
5. **Configuration Loading** - Environment-based configuration for features like the Ralph loop

---

## 1. SDK Architecture

### 1.1 SDK Entry Point

**File:** `/home/alilavaee/Documents/projects/atomic/src/sdk/index.ts`

The SDK module exports a unified coding agent client interface supporting Claude, OpenCode, and Copilot agents.

**Key Exports (lines 1-161):**
```typescript
// Type exports for unified interface
export type {
  PermissionMode,
  McpServerConfig,
  SessionConfig,
  MessageRole,
  MessageContentType,
  AgentMessage,
  ContextUsage,
  Session,
  EventType,
  CodingAgentClient,
  ToolDefinition,
  // ... more types
} from "./types.ts";

// Client factory exports
export { ClaudeAgentClient, createClaudeAgentClient } from "./claude-client.ts";
export { OpenCodeClient, createOpenCodeClient } from "./opencode-client.ts";
export { CopilotClient, createCopilotClient } from "./copilot-client.ts";

// Hook system exports
export { HookManager, createHookManager } from "./hooks.ts";
```

### 1.2 Core Types

**File:** `/home/alilavaee/Documents/projects/atomic/src/sdk/types.ts`

**CodingAgentClient Interface (lines 326-375):**
```typescript
export interface CodingAgentClient {
  readonly agentType: AgentType;
  
  createSession(config?: SessionConfig): Promise<Session>;
  resumeSession(sessionId: string): Promise<Session | null>;
  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void;
  registerTool(tool: ToolDefinition): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

**Session Interface (lines 116-152):**
```typescript
export interface Session {
  readonly id: string;
  send(message: string): Promise<AgentMessage>;
  stream(message: string): AsyncIterable<AgentMessage>;
  summarize(): Promise<void>;
  getContextUsage(): Promise<ContextUsage>;
  destroy(): Promise<void>;
}
```

**SessionConfig Interface (lines 29-50):**
```typescript
export interface SessionConfig {
  model?: string;
  sessionId?: string;
  systemPrompt?: string;
  tools?: string[];
  mcpServers?: McpServerConfig[];
  permissionMode?: PermissionMode;
  maxBudgetUsd?: number;
  maxTurns?: number;
}
```

### 1.3 Claude Agent Client Implementation

**File:** `/home/alilavaee/Documents/projects/atomic/src/sdk/claude-client.ts`

The `ClaudeAgentClient` class implements `CodingAgentClient` using the `@anthropic-ai/claude-agent-sdk` package.

**Class Structure (lines 142-654):**
```typescript
export class ClaudeAgentClient implements CodingAgentClient {
  readonly agentType = "claude" as const;
  
  private eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  private sessions: Map<string, ClaudeSessionState>;
  private registeredHooks: ClaudeHookConfig;
  private registeredTools: Map<string, McpSdkServerConfigWithInstance>;
  private isRunning = false;
  
  // Creates session using SDK query() function
  async createSession(config: SessionConfig = {}): Promise<Session> {
    const sessionId = config.sessionId ?? `claude-${Date.now()}-...`;
    const options = this.buildSdkOptions({ ...config, sessionId });
    const queryInstance = query({ prompt, options });
    return this.wrapQuery(queryInstance, sessionId, config);
  }
  
  // Session wrapper provides unified interface
  private wrapQuery(queryInstance, sessionId, config): Session {
    return {
      id: sessionId,
      send: async (message) => { /* consume query */ },
      stream: (message) => { /* yield chunks */ },
      summarize: async () => { /* context compaction */ },
      getContextUsage: async () => { /* token tracking */ },
      destroy: async () => { /* cleanup */ },
    };
  }
}
```

**Factory Function (lines 650-654):**
```typescript
export function createClaudeAgentClient(): ClaudeAgentClient {
  return new ClaudeAgentClient();
}
```

---

## 2. Graph Engine Architecture

### 2.1 Graph Engine Entry Point

**File:** `/home/alilavaee/Documents/projects/atomic/src/graph/index.ts`

The graph module exports the complete workflow execution engine.

**Key Exports (lines 1-235):**
- Type exports: `NodeId`, `NodeType`, `NodeDefinition`, `BaseState`, `Signal`, `ExecutionError`, etc.
- Builder: `GraphBuilder`, `graph()` factory function
- Node factories: `agentNode`, `toolNode`, `decisionNode`, `waitNode`, `parallelNode`
- Execution: `GraphExecutor`, `executeGraph`, `streamGraph`
- Checkpointing: `MemorySaver`, `FileSaver`, `ResearchDirSaver`

### 2.2 Core Graph Types

**File:** `/home/alilavaee/Documents/projects/atomic/src/graph/types.ts`

**NodeType (line 76):**
```typescript
export type NodeType = "agent" | "tool" | "decision" | "wait" | "subgraph" | "parallel";
```

**BaseState Interface (lines 86-93):**
```typescript
export interface BaseState {
  executionId: string;
  lastUpdated: string;
  outputs: Record<NodeId, unknown>;
}
```

**Signal Types (lines 121-125):**
```typescript
export type Signal =
  | "context_window_warning"
  | "checkpoint"
  | "human_input_required"
  | "debug_report_generated";
```

**NodeResult (lines 205-222):**
```typescript
export interface NodeResult<TState extends BaseState = BaseState> {
  stateUpdate?: Partial<TState>;
  goto?: NodeId | NodeId[];
  signals?: SignalData[];
}
```

**CompiledGraph (lines 407-418):**
```typescript
export interface CompiledGraph<TState extends BaseState = BaseState> {
  nodes: Map<NodeId, NodeDefinition<TState>>;
  edges: Edge<TState>[];
  startNode: NodeId;
  endNodes: Set<NodeId>;
  config: GraphConfig<TState>;
}
```

### 2.3 Graph Builder

**File:** `/home/alilavaee/Documents/projects/atomic/src/graph/builder.ts`

The `GraphBuilder` class provides a fluent API for workflow construction.

**Builder Class (lines 136-638):**
```typescript
export class GraphBuilder<TState extends BaseState = BaseState> {
  private nodes: Map<NodeId, NodeDefinition<TState>>;
  private edges: Edge<TState>[];
  private startNodeId: NodeId | null;
  private currentNodeId: NodeId | null;
  private conditionalStack: ConditionalBranch<TState>[];

  // Fluent API methods
  start(node: NodeDefinition<TState>): this;     // Set start node
  then(node: NodeDefinition<TState>): this;      // Chain nodes
  if(condition: EdgeCondition<TState>): this;    // Conditional branch
  else(): this;                                   // Else branch
  endif(): this;                                  // Close conditional
  parallel(config: ParallelConfig<TState>): this; // Parallel execution
  loop(bodyNode, config: LoopConfig<TState>): this; // Loop construct
  wait(promptOrNode): this;                       // Human-in-the-loop
  catch(handler: NodeDefinition<TState>): this;   // Error handler
  end(): this;                                    // Mark terminal
  compile(config?: GraphConfig<TState>): CompiledGraph<TState>;
}
```

**Factory Function (lines 658-660):**
```typescript
export function graph<TState extends BaseState = BaseState>(): GraphBuilder<TState> {
  return new GraphBuilder<TState>();
}
```

### 2.4 Node Factory Functions

**File:** `/home/alilavaee/Documents/projects/atomic/src/graph/nodes.ts`

**agentNode (lines 163-261):**
```typescript
export function agentNode<TState extends BaseState>(
  config: AgentNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id: config.id,
    type: "agent",
    execute: async (ctx) => {
      const client = globalClientProvider?.(agentType);
      const session = await client.createSession(fullSessionConfig);
      const messages = [];
      for await (const chunk of session.stream(message)) {
        messages.push(chunk);
      }
      return { stateUpdate: outputMapper(messages, ctx.state) };
    },
  };
}
```

**toolNode (lines 361-429):**
```typescript
export function toolNode<TState, TArgs, TResult>(
  config: ToolNodeConfig<TState, TArgs, TResult>
): NodeDefinition<TState> {
  return {
    id: config.id,
    type: "tool",
    execute: async (ctx) => {
      const result = await execute(resolvedArgs, abortController.signal);
      return { stateUpdate: outputMapper(result, ctx.state) };
    },
  };
}
```

**decisionNode (lines 498-520):**
```typescript
export function decisionNode<TState extends BaseState>(
  config: DecisionNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id: config.id,
    type: "decision",
    execute: async (ctx) => {
      for (const route of routes) {
        if (route.condition(ctx.state)) {
          return { goto: route.target };
        }
      }
      return { goto: fallback };
    },
  };
}
```

**waitNode (lines 588-623):**
```typescript
export function waitNode<TState extends BaseState>(
  config: WaitNodeConfig<TState>
): NodeDefinition<TState> {
  return {
    id: config.id,
    type: "wait",
    execute: async (ctx) => {
      if (autoApprove) {
        return { stateUpdate: inputMapper?.("", ctx.state) };
      }
      return {
        signals: [{
          type: "human_input_required",
          message: resolvedPrompt,
        }],
      };
    },
  };
}
```

### 2.5 Graph Executor

**File:** `/home/alilavaee/Documents/projects/atomic/src/graph/compiled.ts`

The `GraphExecutor` class handles actual execution with BFS traversal, retry logic, and checkpointing.

**GraphExecutor (lines 202-588):**
```typescript
export class GraphExecutor<TState extends BaseState = BaseState> {
  async execute(options: ExecutionOptions<TState>): Promise<ExecutionResult<TState>> {
    let lastResult;
    for await (const stepResult of this.stream(options)) {
      lastResult = stepResult;
      if (terminal state) break;
    }
    return { state, status, snapshot };
  }

  async *stream(options): AsyncGenerator<StepResult<TState>> {
    // Initialize state
    // BFS queue traversal
    while (nodeQueue.length > 0) {
      const node = graph.nodes.get(currentNodeId);
      const result = await executeWithRetry(node, state, errors);
      
      // Update state
      if (result.stateUpdate) state = mergeState(state, result.stateUpdate);
      
      // Handle signals (human_input_required -> pause)
      if (result.signals) { /* handle */ }
      
      // Auto-checkpoint
      if (config.autoCheckpoint) { await saveCheckpoint(...) }
      
      // Get next nodes
      const nextNodes = getNextNodes(currentNodeId, state, result);
      nodeQueue.push(...nextNodes);
      
      yield { nodeId, state, result, status };
    }
  }
}
```

**Factory Functions (lines 613-649):**
```typescript
export function createExecutor<TState>(graph: CompiledGraph<TState>): GraphExecutor<TState>;
export async function executeGraph<TState>(graph, options?): Promise<ExecutionResult<TState>>;
export async function* streamGraph<TState>(graph, options?): AsyncGenerator<StepResult<TState>>;
```

---

## 3. Workflow Definitions

### 3.1 Workflow Module

**File:** `/home/alilavaee/Documents/projects/atomic/src/workflows/index.ts`

Exports the Atomic (Ralph) workflow.

**Exports (lines 1-44):**
```typescript
export {
  createAtomicWorkflow,
  createTestAtomicWorkflow,
  DEFAULT_MAX_ITERATIONS,
  ATOMIC_NODE_IDS,
  type AtomicWorkflowConfig,
  createAtomicState,
  type AtomicWorkflowState,
  type Feature,
  // Node definitions for testing/customization
  researchNode,
  createSpecNode,
  reviewSpecNode,
  waitForApprovalNode,
  createFeatureListNode,
  selectFeatureNode,
  implementFeatureNode,
  checkFeaturesNode,
  createPRNode,
} from "./atomic.ts";
```

### 3.2 Atomic Workflow

**File:** `/home/alilavaee/Documents/projects/atomic/src/workflows/atomic.ts`

Implements the full Ralph loop workflow using the graph engine.

**Node IDs (lines 38-49):**
```typescript
export const ATOMIC_NODE_IDS = {
  RESEARCH: "research",
  CREATE_SPEC: "create-spec",
  REVIEW_SPEC: "review-spec",
  WAIT_FOR_APPROVAL: "wait-for-approval",
  CHECK_APPROVAL: "check-approval",
  CREATE_FEATURE_LIST: "create-feature-list",
  SELECT_FEATURE: "select-feature",
  IMPLEMENT_FEATURE: "implement-feature",
  CHECK_FEATURES: "check-features",
  CREATE_PR: "create-pr",
} as const;
```

**Workflow Configuration (lines 431-442):**
```typescript
export interface AtomicWorkflowConfig {
  maxIterations?: number;       // Default: 100
  checkpointing?: boolean;      // Default: true
  checkpointDir?: string;       // Default: research/checkpoints
  autoApproveSpec?: boolean;    // For testing
  graphConfig?: Partial<GraphConfig<AtomicWorkflowState>>;
}
```

**Workflow Creation (lines 462-516):**
```typescript
export function createAtomicWorkflow(config = {}): CompiledGraph<AtomicWorkflowState> {
  let builder = graph<AtomicWorkflowState>()
    // Phase 1: Research and Specification
    .start(researchNode)
    .then(createSpecNode)
    .then(reviewSpecNode);
  
  if (autoApproveSpec) {
    builder = builder.then(createFeatureListNode);
  } else {
    builder = builder
      .then(waitForApprovalNode)
      .then(checkApprovalNode)
      .then(createFeatureListNode);
  }
  
  // Phase 2: Feature Implementation Loop
  builder = builder.loop(implementFeatureNode, {
    until: (state) => state.allFeaturesPassing || state.iteration >= maxIterations,
    maxIterations,
  });
  
  // Phase 3: Create Pull Request
  builder = builder.then(createPRNode).end();

  return builder.compile(compiledConfig);
}
```

**Node Definitions:**

- **researchNode (lines 108-132):** `agentNode` that analyzes codebase
- **createSpecNode (lines 137-165):** `agentNode` that generates spec from research
- **reviewSpecNode (lines 170-182):** `decisionNode` for spec approval routing
- **waitForApprovalNode (lines 187-204):** `waitNode` for human approval
- **checkApprovalNode (lines 210-222):** `decisionNode` routing after approval
- **createFeatureListNode (lines 227-268):** `agentNode` extracting features from spec
- **selectFeatureNode (lines 273-290):** `decisionNode` for feature selection
- **implementFeatureNode (lines 295-347):** `agentNode` implementing current feature
- **checkFeaturesNode (lines 352-369):** `decisionNode` checking feature status
- **createPRNode (lines 374-422):** `toolNode` creating GitHub PR

---

## 4. Command System

### 4.1 CLI Entry Point

**File:** `/home/alilavaee/Documents/projects/atomic/src/cli.ts`

Uses Commander.js for command parsing.

**Program Creation (lines 48-318):**
```typescript
export function createProgram() {
  const program = new Command()
    .name("atomic")
    .version(VERSION)
    .option("-f, --force", "Overwrite all config files")
    .option("-y, --yes", "Auto-confirm all prompts");

  // Commands registered:
  program.command("init", { isDefault: true });  // Interactive setup
  program.command("run");                         // Run agent
  program.command("chat");                        // Interactive chat
  program.command("config").command("set");       // Configuration
  program.command("update");                      // Self-update
  program.command("uninstall");                   // Remove installation
  program.command("ralph").command("setup");      // Ralph loop setup
  program.command("ralph").command("stop");       // Ralph loop stop
  program.command("upload-telemetry", { hidden: true }); // Internal

  return program;
}
```

### 4.2 Command Implementations

**init command:** `/home/alilavaee/Documents/projects/atomic/src/commands/init.ts`
- Interactive agent selection via `@clack/prompts`
- Copies configuration files from template
- Handles preserved files (CLAUDE.md, AGENTS.md)

**run-agent command:** `/home/alilavaee/Documents/projects/atomic/src/commands/run-agent.ts`
- Validates agent key (lines 75-82)
- Auto-runs init if config missing (lines 87-98)
- Resolves agent command path (lines 101-106)
- Spawns agent process with flags (lines 112-152)

**ralph command:** `/home/alilavaee/Documents/projects/atomic/src/commands/ralph.ts`
- **ralphSetup (lines 733-868):**
  - Checks for graph engine feature flag (line 735)
  - Falls back to hook-based execution if disabled
  - Creates state file with frontmatter for stop hook
  - Outputs loop configuration
- **ralphStop (lines 556-722):**
  - Reads hook input from stdin
  - Checks state file existence
  - Validates iteration limits
  - Checks feature list completion
  - Detects completion promise in transcript
  - Outputs JSON to block/continue loop

**chat command:** `/home/alilavaee/Documents/projects/atomic/src/commands/chat.ts`
- Creates SDK client via `createClientForAgentType` (lines 87-98)
- Standard chat: uses `startChatUI` directly (line 283)
- Workflow chat: wraps session with workflow handling (lines 303-351)
- Streams workflow execution as chat messages (lines 486-613)

### 4.3 Command Registration Pattern

Commands are registered in `cli.ts` using Commander.js:
```typescript
program
  .command("commandName")
  .description("...")
  .option("-x, --option <value>", "...")
  .argument("[args...]", "...")
  .action(async (args, opts) => {
    await commandHandler(args, opts);
  });
```

---

## 5. Configuration Loading

### 5.1 Ralph Configuration

**File:** `/home/alilavaee/Documents/projects/atomic/src/config/ralph.ts`

**RalphConfig Interface (lines 20-45):**
```typescript
export interface RalphConfig {
  useGraphEngine: boolean;     // Feature flag
  maxIterations: number;       // 0 = unlimited
  featureListPath: string;     // Default: "research/feature-list.json"
  completionPromise?: string;  // Exit signal
}
```

**Environment Variables (lines 80-89):**
```typescript
export const RALPH_ENV_VARS = {
  ATOMIC_USE_GRAPH_ENGINE: "ATOMIC_USE_GRAPH_ENGINE",
} as const;
```

**Feature Flag Check (lines 128-130):**
```typescript
export function isGraphEngineEnabled(): boolean {
  return process.env[RALPH_ENV_VARS.ATOMIC_USE_GRAPH_ENGINE] === "true";
}
```

**Configuration Loader (lines 165-182):**
```typescript
export function loadRalphConfig(options: LoadRalphConfigOptions = {}): RalphConfig {
  const useGraphEngine = options.useGraphEngine ?? isGraphEngineEnabled();
  const maxIterations = options.maxIterations ?? RALPH_DEFAULTS.maxIterations;
  const featureListPath = options.featureListPath ?? RALPH_DEFAULTS.featureListPath;
  
  return { useGraphEngine, maxIterations, featureListPath, completionPromise };
}
```

### 5.2 Configuration Module Exports

**File:** `/home/alilavaee/Documents/projects/atomic/src/config/index.ts`

```typescript
export {
  type RalphConfig,
  type LoadRalphConfigOptions,
  RALPH_ENV_VARS,
  RALPH_DEFAULTS,
  isGraphEngineEnabled,
  loadRalphConfig,
  describeRalphConfig,
} from "./ralph.ts";
```

---

## 6. Data Flow

### 6.1 Graph Workflow Execution Flow

1. **Entry:** `ralphSetup()` or `chatCommand()` with workflow flag
2. **Feature Flag Check:** `isGraphEngineEnabled()` at `ralph.ts:735`
3. **Client Creation:** `createClientForAgentType(agentType)` at `ralph.ts:317`
4. **Workflow Creation:** `createAtomicWorkflow(config)` at `ralph.ts:336`
5. **State Initialization:** `createAtomicState()` at `ralph.ts:339`
6. **Stream Execution:** `streamGraph(workflow, { initialState })` at `ralph.ts:346`
7. **Node Execution:** `GraphExecutor.stream()` iterates through nodes
8. **State Updates:** `mergeState()` applies `stateUpdate` from each node
9. **Human Input:** `human_input_required` signal pauses execution
10. **Completion:** Terminal node reached or max steps exceeded

### 6.2 Hook-Based Execution Flow (Legacy)

1. **Entry:** `ralphSetup()` when `ATOMIC_USE_GRAPH_ENGINE !== "true"`
2. **State File Creation:** `.claude/ralph-loop.local.md` with frontmatter
3. **Agent Spawn:** External agent process runs with initial prompt
4. **Stop Hook:** Agent calls `atomic ralph stop -a claude` on exit attempt
5. **Transcript Analysis:** `ralphStop()` reads transcript for completion
6. **Loop Continuation:** JSON output blocks stop, feeds prompt back
7. **Exit Conditions:** Max iterations, all features passing, or completion promise

---

## 7. Key Patterns

### 7.1 Factory Pattern
- **Client factories:** `createClaudeAgentClient()`, `createOpenCodeClient()`, `createCopilotClient()`
- **Node factories:** `agentNode()`, `toolNode()`, `decisionNode()`, `waitNode()`
- **Graph factory:** `graph()` creates `GraphBuilder`
- **Executor factory:** `createExecutor(compiledGraph)`

### 7.2 Builder Pattern
- `GraphBuilder` provides fluent API: `.start().then().if().else().endif().loop().end().compile()`

### 7.3 Adapter Pattern
- `ClaudeAgentClient` adapts `@anthropic-ai/claude-agent-sdk` to unified `CodingAgentClient` interface

### 7.4 State Machine Pattern
- Graph execution is essentially a state machine with nodes as states and edges as transitions

### 7.5 Observer Pattern
- Event handlers registered via `client.on(eventType, handler)`
- Progress callbacks via `config.onProgress`

### 7.6 Dependency Injection
- `setClientProvider(provider)` injects client factory into agent nodes
- Enables testing with mock clients

---

## 8. Configuration

### 8.1 Feature Flags

| Flag | Environment Variable | Default | Description |
|------|---------------------|---------|-------------|
| Graph Engine | `ATOMIC_USE_GRAPH_ENGINE` | `false` | Enable graph-based execution |

### 8.2 Default Values

```typescript
// Ralph defaults (src/config/ralph.ts:94-101)
RALPH_DEFAULTS = {
  useGraphEngine: false,
  maxIterations: 0,  // unlimited
  featureListPath: "research/feature-list.json",
}

// Graph defaults (src/graph/types.ts:588-592)
DEFAULT_GRAPH_CONFIG = {
  maxConcurrency: 1,
  contextWindowThreshold: 60,
  autoCheckpoint: true,
}

// Retry defaults (src/graph/types.ts:579-583)
DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
}
```

---

## 9. File Structure Summary

```
src/
├── cli.ts                    # CLI entry point (Commander.js)
├── commands/
│   ├── init.ts               # Interactive setup
│   ├── run-agent.ts          # Run agent command
│   ├── ralph.ts              # Ralph loop setup/stop
│   ├── chat.ts               # Chat interface
│   ├── config.ts             # Config management
│   ├── update.ts             # Self-update
│   └── uninstall.ts          # Uninstall
├── config/
│   ├── index.ts              # Config exports
│   └── ralph.ts              # Ralph configuration
├── sdk/
│   ├── index.ts              # SDK exports
│   ├── types.ts              # Core types
│   ├── claude-client.ts      # Claude implementation
│   ├── opencode-client.ts    # OpenCode implementation
│   ├── copilot-client.ts     # Copilot implementation
│   ├── hooks.ts              # Hook manager
│   ├── claude-hooks.ts       # Claude-specific hooks
│   ├── opencode-hooks.ts     # OpenCode-specific hooks
│   └── copilot-hooks.ts      # Copilot-specific hooks
├── graph/
│   ├── index.ts              # Graph exports
│   ├── types.ts              # Graph types
│   ├── annotation.ts         # State annotations
│   ├── builder.ts            # GraphBuilder class
│   ├── nodes.ts              # Node factory functions
│   ├── compiled.ts           # GraphExecutor
│   └── checkpointer.ts       # Checkpoint implementations
└── workflows/
    ├── index.ts              # Workflow exports
    └── atomic.ts             # Atomic (Ralph) workflow
```

---

## 10. Summary

The Atomic codebase implements a sophisticated architecture for autonomous coding agent orchestration:

1. **SDK Layer** provides a unified interface (`CodingAgentClient`) abstracting differences between Claude, OpenCode, and Copilot agents

2. **Graph Engine** enables declarative workflow definition using a fluent builder API with support for conditional branching, loops, parallel execution, and human-in-the-loop interactions

3. **Workflows** are defined as compiled graphs with typed state management, automatic checkpointing, and signal-based control flow

4. **Command System** uses Commander.js with clear separation between CLI parsing and command implementation

5. **Configuration** is environment-driven with feature flags for gradual rollout of new capabilities (e.g., graph engine)

The architecture supports both legacy hook-based execution (for compatibility) and the new graph-based engine (for structured workflows), controlled by the `ATOMIC_USE_GRAPH_ENGINE` feature flag.

---

## 11. Command Auto-Complete System (Proposed)

### 11.1 Overview

Add an auto-complete system to the TUI that:
1. Registers workflow names as executable slash commands
2. Displays suggestions in a two-column layout (name | description)
3. Executes workflows with user-provided input: `/workflow-name Do this task`

### 11.2 Command Registry Architecture

**File:** `/home/alilavaee/Documents/projects/atomic/src/ui/commands/registry.ts` (proposed)

**CommandDefinition Interface:**
```typescript
export interface CommandDefinition {
  name: string;              // Command name without slash (e.g., "atomic")
  description: string;       // Short description for autocomplete display
  category: "workflow" | "builtin" | "skill";
  execute: (args: string, context: CommandContext) => Promise<CommandResult>;
  aliases?: string[];        // Alternative names (e.g., ["ralph"])
  hidden?: boolean;          // Hide from autocomplete suggestions
}

export interface CommandContext {
  session: Session;
  state: WorkflowChatState;
  addMessage: (msg: ChatMessage) => void;
  setStreaming: (streaming: boolean) => void;
}

export interface CommandResult {
  success: boolean;
  message?: AgentMessage;
  stateUpdate?: Partial<WorkflowChatState>;
}
```

**CommandRegistry Class:**
```typescript
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private aliases: Map<string, string> = new Map();

  register(command: CommandDefinition): void {
    this.commands.set(command.name.toLowerCase(), command);
    command.aliases?.forEach(alias => {
      this.aliases.set(alias.toLowerCase(), command.name.toLowerCase());
    });
  }

  get(name: string): CommandDefinition | undefined {
    const normalized = name.toLowerCase();
    const resolved = this.aliases.get(normalized) ?? normalized;
    return this.commands.get(resolved);
  }

  // Returns commands matching prefix, sorted by relevance
  search(prefix: string): CommandDefinition[] {
    const normalized = prefix.toLowerCase();
    return Array.from(this.commands.values())
      .filter(cmd => !cmd.hidden && cmd.name.startsWith(normalized))
      .sort((a, b) => {
        // Exact match first, then by category, then alphabetically
        if (a.name === normalized) return -1;
        if (b.name === normalized) return 1;
        if (a.category !== b.category) {
          const order = { workflow: 0, skill: 1, builtin: 2 };
          return order[a.category] - order[b.category];
        }
        return a.name.localeCompare(b.name);
      });
  }

  all(): CommandDefinition[] {
    return Array.from(this.commands.values()).filter(cmd => !cmd.hidden);
  }
}

export const globalRegistry = new CommandRegistry();
```

### 11.3 Workflow Command Registration

**File:** `/home/alilavaee/Documents/projects/atomic/src/ui/commands/workflow-commands.ts` (proposed)

**Auto-Registration from Workflow Definitions:**
```typescript
import { globalRegistry, type CommandDefinition } from "./registry.ts";
import { createAtomicWorkflow, ATOMIC_NODE_IDS } from "../../workflows/atomic.ts";
import type { CompiledGraph, BaseState } from "../../graph/types.ts";

// Workflow metadata for command registration
export interface WorkflowMetadata {
  name: string;
  description: string;
  aliases?: string[];
  createWorkflow: () => CompiledGraph<BaseState>;
}

// Available workflows
export const WORKFLOW_DEFINITIONS: WorkflowMetadata[] = [
  {
    name: "atomic",
    description: "Full autonomous development loop (research → spec → implement → PR)",
    aliases: ["ralph", "loop"],
    createWorkflow: createAtomicWorkflow,
  },
  // Future workflows can be added here
];

// Register all workflows as commands
export function registerWorkflowCommands(): void {
  for (const workflow of WORKFLOW_DEFINITIONS) {
    const command: CommandDefinition = {
      name: workflow.name,
      description: workflow.description,
      category: "workflow",
      aliases: workflow.aliases,
      execute: async (args, ctx) => {
        // Start workflow with user input as initial prompt
        const graph = workflow.createWorkflow();
        ctx.addMessage({
          role: "assistant",
          content: `Starting ${workflow.name} workflow...`,
        });
        // Execution handled by workflow session wrapper
        return {
          success: true,
          stateUpdate: {
            workflowActive: true,
            workflowType: workflow.name,
            initialPrompt: args,
          },
        };
      },
    };
    globalRegistry.register(command);
  }
}
```

### 11.4 Built-in Commands

**File:** `/home/alilavaee/Documents/projects/atomic/src/ui/commands/builtin-commands.ts` (proposed)

```typescript
import { globalRegistry, type CommandDefinition } from "./registry.ts";

export const BUILTIN_COMMANDS: CommandDefinition[] = [
  {
    name: "help",
    description: "Show available commands",
    category: "builtin",
    execute: async (args, ctx) => {
      const commands = globalRegistry.all();
      const helpText = formatCommandHelp(commands);
      return { success: true, message: { role: "assistant", content: helpText } };
    },
  },
  {
    name: "status",
    description: "Show workflow progress",
    category: "builtin",
    execute: async (args, ctx) => {
      if (!ctx.state.workflowActive) {
        return { success: false, message: { role: "assistant", content: "No active workflow" } };
      }
      const status = formatWorkflowStatus(ctx.state);
      return { success: true, message: { role: "assistant", content: status } };
    },
  },
  {
    name: "approve",
    description: "Approve current specification",
    category: "builtin",
    execute: async (args, ctx) => {
      return { success: true, stateUpdate: { pendingApproval: false, specApproved: true } };
    },
  },
  {
    name: "reject",
    description: "Reject and request revisions",
    category: "builtin",
    execute: async (args, ctx) => {
      const feedback = args || "Please revise the specification";
      return { success: true, stateUpdate: { pendingApproval: false, specApproved: false, feedback } };
    },
  },
  {
    name: "theme",
    description: "Switch theme (dark/light)",
    category: "builtin",
    execute: async (args, ctx) => {
      const theme = args === "light" ? "light" : "dark";
      return { success: true, stateUpdate: { theme } };
    },
  },
  {
    name: "clear",
    description: "Clear chat history",
    category: "builtin",
    execute: async (args, ctx) => {
      return { success: true, stateUpdate: { messages: [] } };
    },
  },
];

export function registerBuiltinCommands(): void {
  for (const command of BUILTIN_COMMANDS) {
    globalRegistry.register(command);
  }
}
```

### 11.5 Auto-Complete UI Component

**File:** `/home/alilavaee/Documents/projects/atomic/src/ui/components/autocomplete.tsx` (proposed)

**Suggestion Interface:**
```typescript
export interface Suggestion {
  name: string;
  description: string;
  category: "workflow" | "builtin" | "skill";
}

export interface AutocompleteProps {
  input: string;           // Current input text
  visible: boolean;        // Show/hide dropdown
  onSelect: (command: string) => void;
  maxSuggestions?: number; // Default: 8
}
```

**Two-Column Layout Component:**
```typescript
import { box, text, useKeyboard } from "@anthropic-ai/opentui";
import { globalRegistry } from "../commands/registry.ts";
import { useTheme } from "../theme.tsx";

export function Autocomplete({ input, visible, onSelect, maxSuggestions = 8 }: AutocompleteProps) {
  const { colors } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Get matching suggestions
  const prefix = input.startsWith("/") ? input.slice(1) : "";
  const suggestions = globalRegistry.search(prefix).slice(0, maxSuggestions);

  // Reset selection when suggestions change
  useEffect(() => setSelectedIndex(0), [prefix]);

  // Keyboard navigation
  useKeyboard((key) => {
    if (!visible || suggestions.length === 0) return;

    if (key === "up") {
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key === "down") {
      setSelectedIndex(i => Math.min(suggestions.length - 1, i + 1));
    } else if (key === "tab" || key === "return") {
      onSelect(suggestions[selectedIndex].name);
    } else if (key === "escape") {
      // Close handled by parent
    }
  });

  if (!visible || suggestions.length === 0) return null;

  // Calculate column widths
  const maxNameLen = Math.max(...suggestions.map(s => s.name.length));
  const nameColWidth = Math.min(maxNameLen + 2, 20);

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={colors.border}
      backgroundColor={colors.background}
      position="absolute"
      bottom={3}  // Above input area
      left={1}
      width="90%"
      maxHeight={maxSuggestions + 2}
    >
      {suggestions.map((suggestion, index) => (
        <SuggestionRow
          key={suggestion.name}
          suggestion={suggestion}
          selected={index === selectedIndex}
          nameColWidth={nameColWidth}
          colors={colors}
        />
      ))}
    </box>
  );
}

function SuggestionRow({ suggestion, selected, nameColWidth, colors }) {
  const categoryIcon = {
    workflow: "⚡",
    builtin: "›",
    skill: "✦",
  }[suggestion.category];

  return (
    <box
      flexDirection="row"
      backgroundColor={selected ? colors.inputFocus : undefined}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Left column: Icon + Name */}
      <box width={nameColWidth} flexShrink={0}>
        <text style={{ fg: selected ? colors.accent : colors.foreground }}>
          {categoryIcon} /{suggestion.name}
        </text>
      </box>

      {/* Right column: Description */}
      <box flexGrow={1} marginLeft={2}>
        <text style={{ fg: colors.muted }} wrap="truncate">
          {suggestion.description}
        </text>
      </box>
    </box>
  );
}
```

### 11.6 Integration with Chat Component

**File:** `/home/alilavaee/Documents/projects/atomic/src/ui/chat.tsx` (modifications)

**State Additions:**
```typescript
interface ChatState {
  // ... existing state
  showAutocomplete: boolean;
  autocompleteInput: string;
}
```

**Input Handler Modifications:**
```typescript
// Detect slash command prefix and show autocomplete
const handleInputChange = (value: string) => {
  setAutocompleteInput(value);

  // Show autocomplete when typing "/" at start
  if (value.startsWith("/") && value.length > 0) {
    setShowAutocomplete(true);
  } else {
    setShowAutocomplete(false);
  }
};

// Handle autocomplete selection
const handleAutocompleteSelect = (commandName: string) => {
  // Replace input with selected command, keeping cursor after command
  const currentInput = textareaRef.current?.plainText ?? "";
  const spaceIndex = currentInput.indexOf(" ");
  const args = spaceIndex > 0 ? currentInput.slice(spaceIndex) : " ";

  // Update textarea value to "/<command> <existing args>"
  textareaRef.current?.setValue(`/${commandName}${args}`);
  setShowAutocomplete(false);
};

// Handle command execution on submit
const handleSubmit = async () => {
  const input = textareaRef.current?.plainText?.trim() ?? "";
  if (!input) return;

  if (input.startsWith("/")) {
    const { command, args } = parseSlashCommand(input);
    const cmdDef = globalRegistry.get(command);

    if (cmdDef) {
      const result = await cmdDef.execute(args, commandContext);
      if (result.message) addMessage(result.message);
      if (result.stateUpdate) updateState(result.stateUpdate);
    } else {
      addMessage({ role: "assistant", content: `Unknown command: /${command}` });
    }
  } else {
    // Regular message handling
    await session.send(input);
  }

  textareaRef.current?.clear();
  setShowAutocomplete(false);
};
```

**Render Integration:**
```typescript
return (
  <box flexDirection="column" flexGrow={1}>
    <AtomicHeader ... />

    {/* Message history */}
    <scrollbox ...>{messageContent}</scrollbox>

    {/* Autocomplete dropdown - positioned above input */}
    <Autocomplete
      input={autocompleteInput}
      visible={showAutocomplete}
      onSelect={handleAutocompleteSelect}
    />

    {/* Input area */}
    <box border borderStyle="rounded" ...>
      <text style={{ fg: ATOMIC_PINK }}>› </text>
      <textarea
        ref={textareaRef}
        onChange={handleInputChange}
        onSubmit={handleSubmit}
        ...
      />
    </box>

    <StatusBar ... />
  </box>
);
```

### 11.7 Keyboard Navigation

**Navigation Bindings:**
| Key | Action |
|-----|--------|
| `/` | Start command input, show autocomplete |
| `↑` / `↓` | Navigate suggestions |
| `Tab` | Select highlighted suggestion |
| `Enter` | Execute command (with args) |
| `Escape` | Close autocomplete, clear input |

**Conflict Resolution:**
- When autocomplete is visible, `↑`/`↓` navigate suggestions instead of input history
- `Tab` selects suggestion when autocomplete is visible; otherwise, normal tab behavior
- `Enter` submits input; when autocomplete visible and prefix matches exactly, submits command

### 11.8 Example Usage

```
User types: /at
┌──────────────────────────────────────────────────────────┐
│ ⚡ /atomic     Full autonomous development loop...        │  ← selected
│ › /approve    Approve current specification              │
└──────────────────────────────────────────────────────────┘
› /at█

User presses Tab, then types task:
› /atomic Implement user authentication with OAuth2█

User presses Enter:
> Starting atomic workflow with prompt: "Implement user authentication with OAuth2"
```

### 11.9 Skill Integration

Skills from Claude Code are also registered as commands:

**File:** `/home/alilavaee/Documents/projects/atomic/src/ui/commands/skill-commands.ts` (proposed)

```typescript
import { globalRegistry, type CommandDefinition } from "./registry.ts";

// Skills registered from system-reminder
export const SKILL_COMMANDS: CommandDefinition[] = [
  { name: "commit", description: "Create well-formatted commit", category: "skill" },
  { name: "research-codebase", description: "Document codebase structure", category: "skill" },
  { name: "create-spec", description: "Create execution plan from research", category: "skill" },
  { name: "create-feature-list", description: "Create feature list from spec", category: "skill" },
  { name: "implement-feature", description: "Implement single feature", category: "skill" },
  { name: "create-gh-pr", description: "Commit and submit pull request", category: "skill" },
  { name: "explain-code", description: "Explain code functionality", category: "skill" },
  { name: "ralph:ralph-loop", description: "Start Ralph Loop", category: "skill" },
  { name: "ralph:cancel-ralph", description: "Cancel active Ralph Loop", category: "skill" },
  { name: "ralph:ralph-help", description: "Explain Ralph Loop commands", category: "skill" },
].map(skill => ({
  ...skill,
  execute: async (args, ctx) => {
    // Skills are passed to the agent session for execution
    return ctx.session.send(`/${skill.name} ${args}`);
  },
}));

export function registerSkillCommands(): void {
  for (const command of SKILL_COMMANDS) {
    globalRegistry.register(command);
  }
}
```

### 11.10 Initialization

**File:** `/home/alilavaee/Documents/projects/atomic/src/ui/commands/index.ts` (proposed)

```typescript
export { CommandRegistry, globalRegistry, type CommandDefinition } from "./registry.ts";
export { registerBuiltinCommands } from "./builtin-commands.ts";
export { registerWorkflowCommands, WORKFLOW_DEFINITIONS } from "./workflow-commands.ts";
export { registerSkillCommands, SKILL_COMMANDS } from "./skill-commands.ts";
export { Autocomplete, type AutocompleteProps, type Suggestion } from "../components/autocomplete.tsx";

// Initialize all commands
export function initializeCommands(): void {
  registerBuiltinCommands();
  registerWorkflowCommands();
  registerSkillCommands();
}
```

**Called from chat startup:**
```typescript
// In startChatUI() or chat command initialization
import { initializeCommands } from "./ui/commands/index.ts";

initializeCommands();
```

---

## 12. File Structure Summary (Updated)

```
src/
├── cli.ts                    # CLI entry point (Commander.js)
├── commands/
│   ├── init.ts               # Interactive setup
│   ├── run-agent.ts          # Run agent command
│   ├── ralph.ts              # Ralph loop setup/stop
│   ├── chat.ts               # Chat interface
│   ├── config.ts             # Config management
│   ├── update.ts             # Self-update
│   └── uninstall.ts          # Uninstall
├── config/
│   ├── index.ts              # Config exports
│   └── ralph.ts              # Ralph configuration
├── sdk/
│   ├── index.ts              # SDK exports
│   ├── types.ts              # Core types
│   ├── claude-client.ts      # Claude implementation
│   ├── opencode-client.ts    # OpenCode implementation
│   ├── copilot-client.ts     # Copilot implementation
│   ├── hooks.ts              # Hook manager
│   ├── claude-hooks.ts       # Claude-specific hooks
│   ├── opencode-hooks.ts     # OpenCode-specific hooks
│   └── copilot-hooks.ts      # Copilot-specific hooks
├── graph/
│   ├── index.ts              # Graph exports
│   ├── types.ts              # Graph types
│   ├── annotation.ts         # State annotations
│   ├── builder.ts            # GraphBuilder class
│   ├── nodes.ts              # Node factory functions
│   ├── compiled.ts           # GraphExecutor
│   └── checkpointer.ts       # Checkpoint implementations
├── workflows/
│   ├── index.ts              # Workflow exports
│   └── atomic.ts             # Atomic (Ralph) workflow
└── ui/
    ├── chat.tsx              # Main chat component (with autocomplete integration)
    ├── index.ts              # CLI integration, startChatUI
    ├── theme.tsx             # Theme context
    ├── code-block.tsx        # Syntax highlighting
    ├── components/
    │   └── autocomplete.tsx  # Two-column autocomplete dropdown (NEW)
    └── commands/
        ├── index.ts          # Command system exports (NEW)
        ├── registry.ts       # CommandRegistry class (NEW)
        ├── builtin-commands.ts   # Built-in commands (NEW)
        ├── workflow-commands.ts  # Workflow commands (NEW)
        └── skill-commands.ts     # Skill commands (NEW)
```

---

## 13. Human-in-the-Loop Architecture

This section documents HITL patterns across Claude Agent SDK, OpenCode SDK, and GitHub Copilot SDK.

### 13.1 Overview of HITL Mechanisms

| SDK | Primary HITL Tool | Permission System | Hook System |
|-----|------------------|-------------------|-------------|
| Claude Agent SDK | `AskUserQuestion` | `canUseTool` callback | PreToolUse, PostToolUse, Notification |
| OpenCode SDK | `question` tool | allow/ask/deny rules | tool.execute.before/after |
| Copilot SDK | `OnPermissionRequest` | PermissionHandler | preToolUse/postToolUse hooks |

### 13.2 Claude Agent SDK - AskUserQuestion

**Source:** [Claude Code Settings](https://code.claude.com/docs/en/settings)

The `AskUserQuestion` tool enables Claude to ask clarifying questions during execution.

**Tool Input Structure:**
```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;      // The complete question to ask
    header: string;        // Short label (max 12 chars)
    options: Array<{
      label: string;       // Display text (1-5 words)
      description: string; // Explanation of the option
    }>;
    multiSelect: boolean;  // Allow multiple selections
  }>;
  answers?: Record<string, string>; // User answers populated by permission system
}
```

**canUseTool Callback:**
```typescript
type CanUseTool = (
  toolName: string,
  input: ToolInput,
  options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }
) => Promise<PermissionResult>;

type PermissionResult =
  | { behavior: 'allow'; updatedInput: ToolInput; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };
```

**Example - Handling Clarifying Questions:**
```typescript
async function handleAskUserQuestion(input: AskUserQuestionInput) {
  const answers: Record<string, string> = {};

  for (const q of input.questions) {
    console.log(`\n${q.header}: ${q.question}`);
    q.options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));

    const response = await prompt("Your choice: ");
    const idx = parseInt(response) - 1;
    answers[q.question] = (idx >= 0 && idx < q.options.length)
      ? q.options[idx].label
      : response;
  }

  return {
    behavior: "allow",
    updatedInput: { questions: input.questions, answers },
  };
}
```

**Important:** The `canUseTool` callback must return within 60 seconds.

### 13.3 OpenCode SDK - Permission System

**Source:** [DeepWiki - anomalyco/opencode](https://deepwiki.com/anomalyco/opencode)

OpenCode uses a rule-based permission system configured in `opencode.json`:

**Permission Configuration:**
```json
{
  "permission": {
    "*": "allow",
    "bash": {
      "git *": "allow",
      "rm *": "deny",
      "*": "ask"
    },
    "edit": "ask",
    "external_directory": "ask"
  }
}
```

| Value | Behavior |
|-------|----------|
| `"allow"` | Tool runs without user approval |
| `"ask"` | User is prompted for approval |
| `"deny"` | Tool execution is blocked |

**Approval Options (when "ask" triggers):**
- **once**: Approves only the current request
- **always**: Approves future requests matching patterns for the session
- **reject**: Denies the request

**Question Tool:**
```typescript
interface QuestionInput {
  header: string;
  question: string;
  options: string[];
}
```

### 13.4 Copilot SDK - PermissionHandler

**Source:** [DeepWiki - github/copilot-sdk](https://deepwiki.com/github/copilot-sdk)

Copilot uses a `PermissionHandler` callback in session configuration:

**Permission Request Kinds:**
| Kind | Description |
|------|-------------|
| `shell` | Shell command execution |
| `write` | Write operations |
| `read` | Read operations |
| `url` | URL access |
| `mcp` | Model Context Protocol actions |

**Permission Request Results:**
| Result Kind | Description |
|-------------|-------------|
| `approved` | Request was approved |
| `denied-by-rules` | Denied by predefined rules |
| `denied-no-approval-rule-and-could-not-request-from-user` | No rule, couldn't prompt |
| `denied-interactively-by-user` | User explicitly denied |

**Example:**
```go
session, err := client.CreateSession(&copilot.SessionConfig{
    OnPermissionRequest: func(request PermissionRequest, invocation PermissionInvocation) (PermissionRequestResult, error) {
        if request.Kind == "shell" {
            // Prompt user for confirmation
            return PermissionRequestResult{Kind: "approved"}, nil
        }
        return PermissionRequestResult{Kind: "denied-by-rules"}, nil
    },
})
```

### 13.5 Atomic Graph Engine - waitNode Signal

**File:** `/home/alilavaee/Documents/projects/atomic/src/graph/nodes.ts:588-623`

The `waitNode` factory emits a `human_input_required` signal that pauses execution:

**WaitNodeConfig:**
```typescript
interface WaitNodeConfig<TState extends BaseState> {
  id: NodeId;
  prompt: string | ((state: TState) => string);
  autoApprove?: boolean;
  inputMapper?: (input: string, state: TState) => Partial<TState>;
  name?: string;
  description?: string;
}
```

**Signal Emission:**
```typescript
return {
  signals: [{
    type: "human_input_required",
    message: resolvedPrompt,
    data: { nodeId: id, inputMapper: inputMapper ? true : false },
  }],
};
```

**Signal Handling in GraphExecutor (`compiled.ts:355-367`):**
```typescript
const humanInputSignal = result.signals.find(
  (s) => s.type === "human_input_required"
);
if (humanInputSignal) {
  yield { nodeId: currentNodeId, state, result, status: "paused" };
  return;  // Stops the generator
}
```

**Resume Flow:**
1. Client receives `ExecutionResult.snapshot` with paused state
2. Client modifies state with human input
3. Client calls `execute/stream` with `resumeFrom: modifiedSnapshot`
4. GraphExecutor restores state and continues from wait node

---

## 14. Rich UI Component System (OpenTUI)

This section documents OpenTUI patterns for building terminal interfaces with rich components.

### 14.1 OpenTUI Overview

**Source:** [DeepWiki - anomalyco/opentui](https://deepwiki.com/anomalyco/opentui)

OpenTUI is a React/SolidJS reconciler with Yoga layout engine for terminal UIs.

**Package Structure:**
| Package | Purpose |
|---------|---------|
| `@opentui/core` | Standalone core with imperative API, Yoga layout |
| `@opentui/react` | React reconciler for declarative development |
| `@opentui/solid` | SolidJS reconciler for reactive integration |

**Basic Setup:**
```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

const renderer = await createCliRenderer()
const root = createRoot(renderer)
root.render(<App />)
```

### 14.2 Core Components

**Layout Components:**

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| `<box>` | Container (like `<div>`) | `border`, `borderStyle`, `flexDirection`, `padding` |
| `<text>` | Text display | `fg`, `bg`, `attributes` |
| `<scrollbox>` | Scrollable container | `focused`, `stickyScroll` |
| `<ascii-font>` | ASCII art text | `text`, `font` |

**Input Components:**

| Component | Purpose | Events |
|-----------|---------|--------|
| `<input>` | Single-line text | `onInput`, `onChange`, `onSubmit` |
| `<textarea>` | Multi-line text | `onSubmit`, `onContentChange` |
| `<select>` | Dropdown selection | `onChange`, `onSelect` |
| `<tab-select>` | Tab-based selection | `onChange`, `onSelect` |

### 14.3 Flexbox Layout (Yoga)

OpenTUI uses the Yoga layout engine for CSS Flexbox-like layouts:

```tsx
<box
  flexDirection="column"
  justifyContent="space-between"
  alignItems="center"
  flexGrow={1}
  padding={2}
>
  <text>Flex child 1</text>
  <text>Flex child 2</text>
</box>
```

**Absolute Positioning:**
```tsx
<box position="absolute" left={0} top={0}>
  <text>Top Left</text>
</box>

<box position="absolute" right={0} bottom={0}>
  <text>Bottom Right</text>
</box>
```

### 14.4 Keyboard Event Handling

**useKeyboard Hook:**
```tsx
import { useKeyboard } from "@opentui/react"

function App() {
  useKeyboard((key) => {
    if (key.name === "escape") process.exit(0)
    if (key.ctrl && key.name === "c") { /* Handle Ctrl+C */ }
  })

  return <text>Press ESC to exit</text>
}
```

**KeyEvent Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Key name ("escape", "enter", "a") |
| `ctrl` | boolean | Ctrl modifier pressed |
| `meta` | boolean | Meta/Cmd modifier pressed |
| `shift` | boolean | Shift modifier pressed |
| `sequence` | string | Raw input sequence |

### 14.5 Theming and Styling

**Direct Props Styling:**
```tsx
<box
  backgroundColor="#1a1b26"
  borderColor="#7aa2f7"
  borderStyle="rounded"
>
  <text fg="#c0caf5">Styled content</text>
</box>
```

**RGBA Color Class:**
```tsx
import { RGBA } from "@opentui/core"

const red = RGBA.fromInts(255, 0, 0, 255)
const blue = RGBA.fromHex("#0000FF")
```

**Styled Text Utilities:**
```tsx
import { t, bold, italic, fg, bg, red, green } from "@opentui/core"

const styledText = t`Hello ${fg("red")("World")} with ${bold("bold")} text!`
const coloredText = t`${red("Error")}: ${green("Success")}`
```

### 14.6 Rich Content Components

**Code Display:**
```tsx
<code
  content={`const x = 1;\nconsole.log(x);`}
  filetype="javascript"
  syntaxStyle={syntaxStyle}
/>

<line-number showLineNumbers>
  <code content={codeContent} filetype="typescript" />
</line-number>
```

**Diff Viewer:**
```tsx
<diff unified content={diffContent} />
<diff split content={diffContent} />
```

**Markdown Rendering:**
```tsx
<markdown
  content={`# Hello\n\nThis is **bold**.`}
  syntaxStyle={syntaxStyle}
  conceal={true}
  streaming={true}
/>
```

### 14.7 Animation System

**useTimeline Hook:**
```tsx
import { useTimeline } from "@opentui/react"

function AnimatedBox() {
  const [width, setWidth] = useState(0)

  const timeline = useTimeline({
    duration: 2000,
    loop: false,
    autoplay: true,
  })

  useEffect(() => {
    timeline.add(
      { width },
      {
        width: 50,
        duration: 2000,
        ease: "linear",
        onUpdate: (animation) => setWidth(animation.targets[0].width),
      }
    )
  }, [])

  return <box style={{ width, backgroundColor: "#6a5acd" }} />
}
```

### 14.8 Console/Debugging System

**Console Configuration:**
```tsx
const renderer = await createCliRenderer({
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    sizePercent: 30,
    colorError: "#FF0000",
    startInDebugMode: false,
  },
  openConsoleOnError: true,
})

// All console calls captured
console.log("This appears in the overlay")
console.error("Error message")

// Toggle console visibility
renderer.console.toggle()
```

---

## 15. Tool Result Display Patterns

This section documents patterns for displaying tool execution results across different SDKs.

### 15.1 OpenCode - ToolRegistry Pattern

**Source:** [DeepWiki - anomalyco/opencode](https://deepwiki.com/anomalyco/opencode)

OpenCode uses a registry pattern to map tool names to rendering components:

**BasicTool Component:**
```typescript
interface BasicToolProps {
  icon: ReactComponent;
  title: string;
  subtitle?: string;
  children: ReactNode;
  forceOpen?: boolean;
  locked?: boolean;
}

// Usage
<BasicTool icon={FileIcon} title="Read" subtitle={filePath}>
  <Markdown>{props.output}</Markdown>
</BasicTool>
```

**Tool-Specific Rendering:**
| Tool | Component | Output Format |
|------|-----------|---------------|
| `bash` | `Bash` | Command + stdout/stderr as code block |
| `edit` | `Edit` | Unified diff with syntax highlighting |
| `write` | `Write` | File content with "Created"/"Updated" status |
| `read` | `Read` | File content (truncated if large) |
| `grep` | `Grep` | Matching lines in markdown |
| `task` | `Task` | Nested message history from sub-agent |

### 15.2 MessageV2 Structure

OpenCode uses a discriminated union for message parts:

```typescript
type MessageV2.Part =
  | TextPart        // Text content
  | ReasoningPart   // AI reasoning (thinking)
  | ToolPart        // Tool calls and results
  | FilePart        // File attachments
  | SnapshotPart    // Environment snapshots
  | PatchPart       // Code changes
  | StepStartPart   // Step markers
  | StepFinishPart  // Step completion
  | SubtaskPart     // Subtask delegation
  | RetryPart;      // Retry attempts

interface ToolPart {
  type: "tool";
  id: string;
  callID: string;
  tool: string;  // "bash", "edit", "read", etc.
  state: ToolState;
}

type ToolState =
  | { status: "pending" }
  | { status: "running"; input: unknown }
  | { status: "completed"; input: unknown; output: string; metadata?: unknown }
  | { status: "error"; input: unknown; error: string };
```

### 15.3 Copilot SDK - ToolResult Structure

```typescript
interface ToolResult {
  textResultForLlm: string;
  binaryResultsForLlm?: ToolBinaryResult[];
  resultType: "success" | "failure";
  error?: string;  // NOT exposed to LLM
  sessionLog?: string;
  toolTelemetry?: object;
}

interface ToolBinaryResult {
  data: string;        // Base64-encoded
  mimeType: string;    // e.g., "image/png"
  type: "base64";
  description?: string;
}
```

**Result Normalization:**
| Return Type | Conversion |
|-------------|------------|
| `null`/`undefined` | Empty success `ToolResult` |
| `string` | Used as `textResultForLlm` |
| `ToolResult` | Passed through directly |
| Other types | JSON-serialized as `textResultForLlm` |

### 15.4 Streaming UI Updates

**Copilot SDK Events:**
| Event Type | Use Case |
|------------|----------|
| `assistant.message_delta` | Streaming text (word-by-word) |
| `assistant.message` | Final complete message |
| `tool.execution_start` | Show "tool executing" indicator |
| `tool.execution_progress` | Update progress bar |
| `tool.execution_complete` | Show tool result |

**Example:**
```typescript
session.on((event) => {
  switch (event.type) {
    case "assistant.message_delta":
      process.stdout.write(event.data.deltaContent)
      break
    case "tool.execution_start":
      console.log(`Executing: ${event.data.toolName}...`)
      break
    case "tool.execution_complete":
      console.log(`Done: ${event.data.toolCallId}`)
      break
  }
})
```

### 15.5 Atomic TUI Tool Display

**Current Implementation (`src/ui/chat.tsx`):**

The Atomic TUI uses `MessageBubble` for tool result display:

```tsx
function MessageBubble({ message, syntaxStyle }: MessageBubbleProps) {
  const roleLabel = message.role === "assistant" ? "Atomic" : "You"
  const roleColor = message.role === "assistant" ? ATOMIC_PINK : USER_SKY

  // For streaming content
  const showLoadingAnimation = message.streaming && !message.content

  return (
    <box flexDirection="column" padding={1}>
      <box flexDirection="row">
        <text fg={roleColor} attributes={2}>{roleLabel}</text>
        <text fg={MUTED_LAVENDER} attributes={4}>{timestamp}</text>
      </box>
      {showLoadingAnimation ? (
        <LoadingIndicator />
      ) : message.role === "assistant" ? (
        <markdown content={message.content} syntaxStyle={syntaxStyle} streaming />
      ) : (
        <text wrapMode="word">{message.content}</text>
      )}
    </box>
  )
}
```

---

## 16. Permission and Approval Flows

### 16.1 Claude Code Permission Modes

**Available Modes (cycled via `Shift+Tab`):**
| Mode | Description |
|------|-------------|
| `default` | Standard - prompts for permission on first use |
| `acceptEdits` | Auto-accepts file edit permissions |
| `plan` | Analysis only, no modifications |
| `dontAsk` | Auto-denies unless pre-approved |
| `bypassPermissions` | Skips all prompts (requires safe environment) |

**Permission Rule Structure:**
```json
{
  "permissions": {
    "allow": ["Bash(npm run lint)", "Read(~/.zshrc)"],
    "ask": ["Bash(git push *)"],
    "deny": ["Bash(curl *)", "Read(./.env)"]
  }
}
```

**Evaluation Order:** Deny → Ask → Allow (first matching rule wins)

### 16.2 Copilot CLI Hooks Configuration

**File Structure (`.github/hooks/hooks.json`):**
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [],
    "sessionEnd": [],
    "userPromptSubmitted": [],
    "preToolUse": [],
    "postToolUse": [],
    "errorOccurred": []
  }
}
```

**preToolUse Hook Input:**
```json
{
  "timestamp": 1706745600000,
  "cwd": "/path/to/working/directory",
  "toolName": "bash",
  "toolArgs": "{\"command\": \"rm -rf ./temp\"}"
}
```

**preToolUse Hook Output (Optional):**
```json
{
  "permissionDecision": "allow|deny|ask",
  "permissionDecisionReason": "Explanation for the decision"
}
```

### 16.3 Claude Agent SDK Hooks

**Available Hook Events:**
| Hook Event | Description | Can Block |
|------------|-------------|-----------|
| `PreToolUse` | Before tool execution | Yes |
| `PostToolUse` | After tool execution | No |
| `PermissionRequest` | Permission dialog appears | Yes |
| `Notification` | Agent status messages | No |
| `SessionStart` | Session initializes | No |
| `SessionEnd` | Session terminates | No |
| `Stop` | Agent finishes responding | Yes |

**Hook Configuration:**
```typescript
const options = {
  hooks: {
    PreToolUse: [{
      matcher: 'Write|Edit',
      hooks: [myCallback],
      timeout: 60
    }]
  }
}
```

**Hook Output:**
```typescript
type HookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
}
```

### 16.4 Unified Permission Flow for Atomic

**Proposed Permission Handler Interface:**
```typescript
interface AtomicPermissionHandler {
  // Check if tool should be allowed without prompting
  shouldAutoApprove(toolName: string, input: unknown): boolean;

  // Check if tool should be denied without prompting
  shouldAutoDeny(toolName: string, input: unknown): boolean;

  // Prompt user for permission
  promptForPermission(request: PermissionRequest): Promise<PermissionResult>;

  // Store approved pattern for session
  rememberApproval(pattern: string, scope: 'once' | 'session' | 'always'): void;
}

interface PermissionRequest {
  toolName: string;
  input: unknown;
  suggestedPatterns?: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

type PermissionResult =
  | { decision: 'allow'; remember?: 'once' | 'session' | 'always' }
  | { decision: 'deny'; message?: string };
```

---

## 17. Event System Architecture

### 17.1 OpenCode Bus System

**Dual-Bus Architecture:**
```
┌─────────────────┐         ┌─────────────────┐
│      Bus        │ ──────▶ │   GlobalBus     │
│ (Per-Instance)  │         │ (Aggregated)    │
└─────────────────┘         └─────────────────┘
        │                           │
        ▼                           ▼
   Internal                    SSE Endpoint
   Components                  /global/event
```

**Key Events:**
| Event | Payload | Description |
|-------|---------|-------------|
| `message.updated` | `{ info: Message }` | Message content changed |
| `message.part.updated` | `{ part: Part, delta?: string }` | Part updated (streaming) |
| `session.created` | `{ info: Session.Info }` | New session created |
| `session.error` | `{ sessionID?, error }` | Error in session |
| `permission.asked` | `PermissionRequest` | User approval needed |

**Subscription:**
```typescript
// Direct subscription
Bus.subscribe(MessageV2.Event.PartUpdated, (payload) => {
  console.log("Part updated:", payload.part)
})

// SDK client subscription
client.event.subscribe((event) => {
  switch (event.type) {
    case "message.part.updated":
      handlePartUpdate(event.payload)
      break
  }
})
```

### 17.2 Copilot SDK Events

**Event Flow:**
```typescript
session.on((event) => {
  switch (event.type) {
    case "tool.execution_start":
      console.log(`→ Running: ${event.data.toolName}`)
      break
    case "tool.execution_complete":
      console.log(`✓ Completed: ${event.data.toolCallId}`)
      break
    case "assistant.message_delta":
      process.stdout.write(event.data.deltaContent)
      break
    case "session.idle":
      console.log()
      break
  }
})
```

### 17.3 Claude Agent SDK Events

**Message Types:**
```typescript
type SDKMessage =
  | SDKAssistantMessage      // Claude's response
  | SDKUserMessage           // User input
  | SDKResultMessage         // Final result
  | SDKSystemMessage         // System initialization
  | SDKPartialAssistantMessage // Streaming partial
  | SDKCompactBoundaryMessage; // Conversation compaction
```

**Streaming with Partial Messages:**
```typescript
for await (const message of query({
  prompt: "...",
  options: { includePartialMessages: true }
})) {
  if (message.type === 'stream_event') {
    // Handle real-time streaming updates
    console.log(message.event)
  }
}
```

### 17.4 Atomic Graph Engine Signals

**Signal Types (`src/graph/types.ts:121-125`):**
```typescript
type Signal =
  | "context_window_warning"
  | "checkpoint"
  | "human_input_required"
  | "debug_report_generated";
```

**Signal Flow:**
1. Node emits signal via `NodeResult.signals`
2. GraphExecutor detects signal in `stream()` method
3. For `human_input_required`, execution pauses and yields snapshot
4. For `checkpoint`, state is persisted via checkpointer
5. For `context_window_warning`, callback is triggered

**Progress Events:**
```typescript
interface ProgressEvent<TState extends BaseState = BaseState> {
  nodeId: NodeId;
  state: TState;
  status: ExecutionStatus;
  timestamp: string;
}
```

---

## 18. Integration Recommendations

### 18.1 HITL UI Component for Atomic

**Proposed PermissionDialog Component:**
```tsx
interface PermissionDialogProps {
  request: PermissionRequest;
  onDecision: (result: PermissionResult) => void;
  suggestedPatterns?: string[];
}

function PermissionDialog({ request, onDecision, suggestedPatterns }: PermissionDialogProps) {
  const { colors } = useTheme()
  const [selectedOption, setSelectedOption] = useState(0)

  const options = [
    { label: "Allow Once", value: { decision: 'allow', remember: 'once' } },
    { label: "Allow Always", value: { decision: 'allow', remember: 'always' } },
    { label: "Deny", value: { decision: 'deny' } },
  ]

  useKeyboard((key) => {
    if (key.name === 'up') setSelectedOption(i => Math.max(0, i - 1))
    if (key.name === 'down') setSelectedOption(i => Math.min(options.length - 1, i + 1))
    if (key.name === 'return') onDecision(options[selectedOption].value)
    if (key.name === 'escape') onDecision({ decision: 'deny' })
  })

  return (
    <box
      position="absolute"
      left="10%"
      top="30%"
      width="80%"
      border
      borderStyle="double"
      borderColor={colors.warning}
      backgroundColor={colors.background}
      padding={2}
    >
      <box flexDirection="column">
        <text fg={colors.warning} attributes={2}>Permission Required</text>
        <text fg={colors.foreground}>
          {request.toolName}: {JSON.stringify(request.input)}
        </text>
        <box height={1} />
        {options.map((opt, i) => (
          <text
            key={opt.label}
            fg={i === selectedOption ? colors.accent : colors.foreground}
            attributes={i === selectedOption ? 2 : 0}
          >
            {i === selectedOption ? '▸ ' : '  '}{opt.label}
          </text>
        ))}
      </box>
    </box>
  )
}
```

### 18.2 Tool Result Rendering Components

**Proposed ToolResultRegistry:**
```typescript
interface ToolRenderer {
  icon: string;
  title: (input: unknown) => string;
  render: (props: ToolRenderProps) => React.ReactNode;
}

const TOOL_RENDERERS: Record<string, ToolRenderer> = {
  Read: {
    icon: '📄',
    title: (input) => `Read: ${input.file_path}`,
    render: ({ output, syntaxStyle }) => (
      <box border borderStyle="single" padding={1}>
        <code content={output} syntaxStyle={syntaxStyle} />
      </box>
    ),
  },

  Edit: {
    icon: '✏️',
    title: (input) => `Edit: ${input.file_path}`,
    render: ({ input, syntaxStyle }) => (
      <diff unified content={generateDiff(input.old_string, input.new_string)} />
    ),
  },

  Bash: {
    icon: '💻',
    title: (input) => `Bash: ${input.command?.slice(0, 50)}...`,
    render: ({ output }) => (
      <box border borderStyle="single" padding={1}>
        <code content={output} filetype="bash" />
      </box>
    ),
  },
}
```

### 18.3 Streaming State Management

**Proposed StreamingState Interface:**
```typescript
interface StreamingState {
  isStreaming: boolean;
  streamingMessageId: string | null;
  toolExecutions: Map<string, ToolExecutionState>;
  pendingPermissions: PermissionRequest[];
}

interface ToolExecutionState {
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  input: unknown;
  output?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

// Hook for streaming state
function useStreamingState() {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    streamingMessageId: null,
    toolExecutions: new Map(),
    pendingPermissions: [],
  });

  const handleChunk = useCallback((messageId: string, chunk: string) => {
    setState(prev => ({
      ...prev,
      isStreaming: true,
      streamingMessageId: messageId,
    }));
    // Append chunk to message content
  }, []);

  const handleToolStart = useCallback((callId: string, toolName: string, input: unknown) => {
    setState(prev => ({
      ...prev,
      toolExecutions: new Map(prev.toolExecutions).set(callId, {
        toolName,
        status: 'running',
        input,
        startedAt: Date.now(),
      }),
    }));
  }, []);

  return { state, handleChunk, handleToolStart, /* ... */ };
}
```

---

## 19. Summary of HITL and Rich UI Patterns

### Key Takeaways

1. **Permission Systems**: All three SDKs (Claude, OpenCode, Copilot) implement similar allow/ask/deny patterns with pattern matching for rules.

2. **AskUserQuestion Pattern**: Claude's approach of using a dedicated tool for questions provides the cleanest separation between tool permissions and user queries.

3. **Signal-Based Execution**: Atomic's `human_input_required` signal provides a clean mechanism for pausing graph execution and resuming with user input.

4. **ToolRegistry Pattern**: OpenCode's approach of mapping tool names to rendering components is highly extensible and should be adopted.

5. **Dual Event System**: OpenCode's Bus/GlobalBus pattern enables both local and global event handling, useful for multi-session scenarios.

6. **OpenTUI Components**: The library provides all necessary primitives (box, text, scrollbox, input, select) for building rich permission dialogs and tool result displays.

7. **Streaming Support**: All SDKs support streaming with delta events; UI must handle both streaming and completed states.

### Implementation Priority

1. **High Priority**: Permission dialog component, tool result registry
2. **Medium Priority**: Streaming state management, progress indicators
3. **Lower Priority**: Animation system, console debugging overlay
