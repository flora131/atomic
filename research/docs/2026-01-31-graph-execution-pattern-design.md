# Graph Execution Pattern Design for Atomic Workflow

**Date:** 2026-01-31  
**Status:** Design Document  
**Author:** Research Agent

## Executive Summary

This document presents a comprehensive TypeScript graph execution pattern for the Atomic workflow system. The design synthesizes best practices from LangGraph.js, XState, Effect-TS, RxJS, and n8n to create an elegant, type-safe, fluent API for orchestrating AI agent workflows.

The Atomic workflow follows the pattern:
```
Research -> Plan (Spec) -> Implement (Ralph) -> (Debug) -> PR
```

With the flywheel:
```
Research -> Specs -> Execution -> Outcomes -> Specs (persistent memory)
```

---

## Table of Contents

1. [Research Findings](#research-findings)
2. [Core Type Definitions](#core-type-definitions)
3. [Node Type Definitions](#node-type-definitions)
4. [Fluent API Design](#fluent-api-design)
5. [State Management](#state-management)
6. [Error Handling](#error-handling)
7. [Example Implementations](#example-implementations)
8. [Integration with Atomic Commands](#integration-with-atomic-commands)
9. [Comparison with Existing Patterns](#comparison-with-existing-patterns)

---

## Research Findings

### LangGraph.js Patterns

LangGraph.js uses a **Pregel-based execution model** with discrete supersteps. Key patterns:

- **StateGraph Builder**: Fluent builder pattern with `addNode()`, `addEdge()`, `addConditionalEdges()`
- **Annotation System**: Type-safe state definition with reducers for merging state updates
- **Checkpointing**: `MemorySaver` and other checkpointer implementations for persistence
- **Command Objects**: Nodes can return `Command` objects with `goto` fields for control flow

```typescript
// LangGraph.js pattern
const StateAnnotation = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  })
});

const graph = new StateGraph(StateAnnotation)
  .addNode("nodeA", nodeAFunction)
  .addNode("nodeB", nodeBFunction)
  .addEdge("nodeA", "nodeB")
  .compile({ checkpointer: new MemorySaver() });
```

### XState Patterns

XState provides robust TypeScript state machine patterns:

- **`setup()` Function**: Enhanced type safety for context, events, actions, and guards
- **Guards**: Predicate functions for conditional transitions
- **Parallel States**: Multiple active regions with independent sub-states
- **Immutable Context Updates**: Using `assign()` action

```typescript
// XState pattern
const machine = setup({
  types: {} as { context: { count: number }; events: { type: "INC" } },
  guards: {
    isAboveZero: ({ context }) => context.count > 0
  }
}).createMachine({
  context: { count: 0 },
  on: { INC: { guard: "isAboveZero", actions: assign({ count: c => c + 1 }) } }
});
```

### RxJS Patterns

RxJS provides the canonical `pipe()` pattern for operator chaining:

- **`pipe()` Method**: Sequential application of operators using `reduce`
- **Heavy Overloading**: Up to 9 operators with full type inference
- **Error Recovery**: `catchError` for graceful error handling
- **Parallel Execution**: `forkJoin` (wait all) and `merge` (emit as available)

```typescript
// RxJS pattern
interval(1000).pipe(
  filter(x => x % 2 === 0),
  map(x => x + x),
  catchError(err => of(defaultValue))
);
```

### Effect-TS Patterns

Effect-TS provides advanced typed error handling and dependency injection:

- **`pipe()` with `flatMap()`**: Sequential effect composition
- **Typed Errors**: `Effect<A, E, R>` tracks success, error, and requirements
- **Fiber System**: Lightweight cooperative threads for parallelism
- **Context Propagation**: FiberRefs for dependency injection

### n8n Patterns

n8n uses stack-based execution for workflow graphs:

- **DirectedGraph Class**: Node/edge management
- **Execution Stack**: Sequential node processing
- **`IRunExecutionData`**: Serializable state container
- **Waiting Execution**: Nodes awaiting input from dependencies

---

## Core Type Definitions

```typescript
// ============================================================================
// Core Types
// ============================================================================

/**
 * Represents a unique identifier for nodes in the graph
 */
export type NodeId = string;

/**
 * The execution status of a node or graph
 */
export type ExecutionStatus = 
  | "pending"
  | "running" 
  | "completed"
  | "failed"
  | "waiting"
  | "skipped";

/**
 * Configuration for the graph runtime
 */
export interface GraphConfig {
  /** Thread ID for checkpointing */
  threadId: string;
  /** Maximum parallel executions */
  maxConcurrency?: number;
  /** Timeout for individual nodes in ms */
  nodeTimeout?: number;
  /** Global timeout for graph execution in ms */
  graphTimeout?: number;
  /** Enable debug mode */
  debug?: boolean;
}

/**
 * Context passed to every node execution
 */
export interface ExecutionContext<TState extends BaseState = BaseState> {
  /** Current state of the graph */
  state: TState;
  /** Configuration */
  config: GraphConfig;
  /** Parent node ID (for sub-graphs) */
  parentNodeId?: NodeId;
  /** Iteration count (for loops) */
  iteration?: number;
  /** Accumulated errors */
  errors: ExecutionError[];
  /** Signal for cancellation */
  abortSignal?: AbortSignal;
  /** Context window usage (0-1) */
  contextWindowUsage?: number;
}

/**
 * Result of a node execution
 */
export interface NodeResult<TState extends BaseState = BaseState> {
  /** Partial state updates */
  stateUpdate?: Partial<TState>;
  /** Next node to execute (for routing) */
  goto?: NodeId | NodeId[];
  /** Signals to emit */
  signals?: Signal[];
  /** Debug information */
  debug?: DebugInfo;
}

/**
 * Signals that nodes can emit for coordination
 */
export type Signal = 
  | { type: "context_window_warning"; usage: number }
  | { type: "checkpoint"; label: string }
  | { type: "human_input_required"; prompt: string }
  | { type: "debug_report_generated"; path: string };

/**
 * Debug information for tracing
 */
export interface DebugInfo {
  duration: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: string[];
}

// ============================================================================
// Base State Definition
// ============================================================================

/**
 * Base state that all graph states must extend
 */
export interface BaseState {
  /** Unique execution ID */
  executionId: string;
  /** Timestamp of last update */
  lastUpdated: Date;
  /** Accumulated outputs */
  outputs: Record<string, unknown>;
}

/**
 * State annotation for defining reducers (inspired by LangGraph)
 */
export interface StateAnnotation<T> {
  /** The type */
  _type: T;
  /** Reducer for merging updates */
  reducer?: (current: T, update: T) => T;
  /** Default value factory */
  default?: () => T;
}

/**
 * Helper to create state annotations
 */
export function Annotation<T>(options?: {
  reducer?: (current: T, update: T) => T;
  default?: () => T;
}): StateAnnotation<T> {
  return {
    _type: undefined as unknown as T,
    reducer: options?.reducer,
    default: options?.default
  };
}

/**
 * Helper to create root state from annotations
 */
export function AnnotationRoot<T extends Record<string, StateAnnotation<unknown>>>(
  annotations: T
): { State: { [K in keyof T]: T[K]["_type"] }; annotations: T } {
  type StateType = { [K in keyof T]: T[K]["_type"] };
  return {
    State: {} as StateType,
    annotations
  };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Structured error for graph execution
 */
export interface ExecutionError {
  nodeId: NodeId;
  type: "timeout" | "runtime" | "validation" | "external";
  message: string;
  cause?: Error;
  timestamp: Date;
  retryable: boolean;
}
```

---

## Node Type Definitions

```typescript
// ============================================================================
// Node Types
// ============================================================================

/**
 * Base interface for all node types
 */
export interface BaseNode<TState extends BaseState = BaseState> {
  id: NodeId;
  type: NodeType;
  /** Node execution function */
  execute: (ctx: ExecutionContext<TState>) => Promise<NodeResult<TState>>;
  /** Optional validation before execution */
  validate?: (ctx: ExecutionContext<TState>) => boolean | Promise<boolean>;
  /** Retry configuration */
  retry?: RetryConfig;
}

export type NodeType = "agent" | "tool" | "decision" | "wait" | "subgraph" | "parallel";

/**
 * Retry configuration for nodes
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number;
  retryOn?: (error: ExecutionError) => boolean;
}

// ============================================================================
// Agent Node - For Sub-Agent Delegation
// ============================================================================

export interface AgentNodeConfig<TState extends BaseState = BaseState> {
  /** Agent type/model to use */
  agentType: "claude" | "opencode" | "copilot" | string;
  /** System prompt for the agent */
  systemPrompt: string | ((ctx: ExecutionContext<TState>) => string);
  /** Tools available to the agent */
  tools?: string[];
  /** Maximum iterations for agent loop */
  maxIterations?: number;
  /** Completion condition */
  completionCondition?: (ctx: ExecutionContext<TState>) => boolean;
  /** Transform output to state */
  outputMapper: (output: AgentOutput, ctx: ExecutionContext<TState>) => Partial<TState>;
}

export interface AgentOutput {
  response: string;
  toolCalls: ToolCall[];
  tokenUsage: { input: number; output: number };
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export function agentNode<TState extends BaseState>(
  id: NodeId,
  config: AgentNodeConfig<TState>
): BaseNode<TState> {
  return {
    id,
    type: "agent",
    retry: { maxAttempts: 3, backoffMs: 1000 },
    async execute(ctx) {
      const prompt = typeof config.systemPrompt === "function"
        ? config.systemPrompt(ctx)
        : config.systemPrompt;
      
      // Execute agent (implementation would call actual agent)
      const output = await executeAgent({
        type: config.agentType,
        prompt,
        tools: config.tools,
        maxIterations: config.maxIterations
      });
      
      return {
        stateUpdate: config.outputMapper(output, ctx),
        signals: output.tokenUsage.output > 50000 
          ? [{ type: "context_window_warning", usage: 0.6 }] 
          : undefined
      };
    }
  };
}

// ============================================================================
// Tool Node - For Direct Tool Execution
// ============================================================================

export interface ToolNodeConfig<TState extends BaseState = BaseState, TResult = unknown> {
  /** Tool name */
  toolName: string;
  /** Arguments from state */
  args: (ctx: ExecutionContext<TState>) => Record<string, unknown>;
  /** Transform result to state */
  outputMapper: (result: TResult, ctx: ExecutionContext<TState>) => Partial<TState>;
  /** Timeout in ms */
  timeout?: number;
}

export function toolNode<TState extends BaseState, TResult = unknown>(
  id: NodeId,
  config: ToolNodeConfig<TState, TResult>
): BaseNode<TState> {
  return {
    id,
    type: "tool",
    retry: { maxAttempts: 2, backoffMs: 500 },
    async execute(ctx) {
      const args = config.args(ctx);
      const result = await executeTool<TResult>(config.toolName, args, config.timeout);
      return { stateUpdate: config.outputMapper(result, ctx) };
    }
  };
}

// ============================================================================
// Decision Node - For Routing Logic
// ============================================================================

export interface DecisionNodeConfig<TState extends BaseState = BaseState> {
  /** Condition function returning target node(s) */
  condition: (ctx: ExecutionContext<TState>) => NodeId | NodeId[] | null;
  /** Fallback node if condition returns null */
  fallback?: NodeId;
}

export function decisionNode<TState extends BaseState>(
  id: NodeId,
  config: DecisionNodeConfig<TState>
): BaseNode<TState> {
  return {
    id,
    type: "decision",
    async execute(ctx) {
      const target = config.condition(ctx) ?? config.fallback;
      return { goto: target ? (Array.isArray(target) ? target : [target]) : undefined };
    }
  };
}

// ============================================================================
// Wait Node - For Human-in-the-Loop Checkpoints
// ============================================================================

export interface WaitNodeConfig<TState extends BaseState = BaseState> {
  /** Prompt to show user */
  prompt: string | ((ctx: ExecutionContext<TState>) => string);
  /** Timeout before auto-continuing (0 = wait forever) */
  timeout?: number;
  /** Auto-approve condition */
  autoApprove?: (ctx: ExecutionContext<TState>) => boolean;
  /** Transform user input to state */
  inputMapper?: (input: UserInput, ctx: ExecutionContext<TState>) => Partial<TState>;
}

export interface UserInput {
  approved: boolean;
  feedback?: string;
  data?: Record<string, unknown>;
}

export function waitNode<TState extends BaseState>(
  id: NodeId,
  config: WaitNodeConfig<TState>
): BaseNode<TState> {
  return {
    id,
    type: "wait",
    async execute(ctx) {
      // Check auto-approve
      if (config.autoApprove?.(ctx)) {
        return { stateUpdate: {} };
      }
      
      const prompt = typeof config.prompt === "function"
        ? config.prompt(ctx)
        : config.prompt;
      
      return {
        signals: [{ type: "human_input_required", prompt }]
      };
    }
  };
}

// ============================================================================
// Parallel Node - For Concurrent Execution
// ============================================================================

export interface ParallelNodeConfig<TState extends BaseState = BaseState> {
  /** Nodes to execute in parallel */
  branches: BaseNode<TState>[];
  /** How to merge results */
  mergeStrategy: "all" | "race" | "allSettled";
  /** Merge function for combining state updates */
  merge: (results: NodeResult<TState>[], ctx: ExecutionContext<TState>) => Partial<TState>;
}

export function parallelNode<TState extends BaseState>(
  id: NodeId,
  config: ParallelNodeConfig<TState>
): BaseNode<TState> {
  return {
    id,
    type: "parallel",
    async execute(ctx) {
      const executeOne = (node: BaseNode<TState>) => node.execute(ctx);
      
      let results: NodeResult<TState>[];
      switch (config.mergeStrategy) {
        case "race":
          results = [await Promise.race(config.branches.map(executeOne))];
          break;
        case "allSettled":
          const settled = await Promise.allSettled(config.branches.map(executeOne));
          results = settled
            .filter((r): r is PromiseFulfilledResult<NodeResult<TState>> => r.status === "fulfilled")
            .map(r => r.value);
          break;
        case "all":
        default:
          results = await Promise.all(config.branches.map(executeOne));
      }
      
      return { stateUpdate: config.merge(results, ctx) };
    }
  };
}
```

---

## Fluent API Design

```typescript
// ============================================================================
// Fluent Graph Builder
// ============================================================================

/**
 * Edge definition in the graph
 */
export interface Edge {
  from: NodeId;
  to: NodeId | NodeId[];
  condition?: (ctx: ExecutionContext) => boolean;
}

/**
 * Compiled graph ready for execution
 */
export interface CompiledGraph<TState extends BaseState = BaseState> {
  nodes: Map<NodeId, BaseNode<TState>>;
  edges: Edge[];
  startNode: NodeId;
  endNodes: Set<NodeId>;
  
  /** Execute the graph */
  invoke(initialState: Partial<TState>, config: GraphConfig): Promise<TState>;
  /** Execute with streaming updates */
  stream(initialState: Partial<TState>, config: GraphConfig): AsyncGenerator<TState>;
}

/**
 * Checkpointer interface for state persistence
 */
export interface Checkpointer<TState extends BaseState = BaseState> {
  save(threadId: string, state: TState): Promise<void>;
  load(threadId: string): Promise<TState | null>;
  delete(threadId: string): Promise<void>;
}

/**
 * In-memory checkpointer implementation
 */
export class MemorySaver<TState extends BaseState = BaseState> implements Checkpointer<TState> {
  private store = new Map<string, TState>();
  
  async save(threadId: string, state: TState): Promise<void> {
    this.store.set(threadId, structuredClone(state));
  }
  
  async load(threadId: string): Promise<TState | null> {
    const state = this.store.get(threadId);
    return state ? structuredClone(state) : null;
  }
  
  async delete(threadId: string): Promise<void> {
    this.store.delete(threadId);
  }
}

/**
 * File-based checkpointer for persistent memory (research/ directory)
 */
export class FileSaver<TState extends BaseState = BaseState> implements Checkpointer<TState> {
  constructor(private basePath: string = "research/checkpoints") {}
  
  private getPath(threadId: string): string {
    return `${this.basePath}/${threadId}.json`;
  }
  
  async save(threadId: string, state: TState): Promise<void> {
    const fs = await import("fs/promises");
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.writeFile(this.getPath(threadId), JSON.stringify(state, null, 2));
  }
  
  async load(threadId: string): Promise<TState | null> {
    const fs = await import("fs/promises");
    try {
      const data = await fs.readFile(this.getPath(threadId), "utf-8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  
  async delete(threadId: string): Promise<void> {
    const fs = await import("fs/promises");
    try {
      await fs.unlink(this.getPath(threadId));
    } catch {
      // Ignore if not exists
    }
  }
}

/**
 * Main graph builder with fluent API
 */
export class GraphBuilder<TState extends BaseState = BaseState> {
  private nodes: Map<NodeId, BaseNode<TState>> = new Map();
  private edges: Edge[] = [];
  private currentNode: NodeId | null = null;
  private startNode: NodeId | null = null;
  private endNodes: Set<NodeId> = new Set();
  private conditionalStack: ConditionalContext[] = [];
  private loopStack: LoopContext[] = [];
  
  constructor(
    private stateAnnotation?: { State: TState; annotations: Record<string, StateAnnotation<unknown>> }
  ) {}
  
  // ========================================================================
  // Basic Building Blocks
  // ========================================================================
  
  /**
   * Add a node to the graph
   */
  addNode(node: BaseNode<TState>): this {
    this.nodes.set(node.id, node);
    return this;
  }
  
  /**
   * Set the starting node
   */
  start(nodeId: NodeId): this {
    this.startNode = nodeId;
    this.currentNode = nodeId;
    return this;
  }
  
  /**
   * Mark nodes as end nodes
   */
  end(...nodeIds: NodeId[]): this {
    nodeIds.forEach(id => this.endNodes.add(id));
    return this;
  }
  
  // ========================================================================
  // Chaining Syntax
  // ========================================================================
  
  /**
   * Sequential execution - chain to next node
   */
  then(node: BaseNode<TState> | NodeId): this {
    const nodeId = typeof node === "string" ? node : node.id;
    
    if (typeof node !== "string") {
      this.addNode(node);
    }
    
    if (this.currentNode) {
      this.edges.push({ from: this.currentNode, to: nodeId });
    }
    
    this.currentNode = nodeId;
    return this;
  }
  
  /**
   * Conditional routing - if condition is true
   */
  if(condition: (ctx: ExecutionContext<TState>) => boolean): ConditionalBuilder<TState> {
    return new ConditionalBuilder(this, condition);
  }
  
  /**
   * Parallel execution of multiple branches
   */
  parallel(nodes: BaseNode<TState>[], config?: Omit<ParallelNodeConfig<TState>, "branches">): this {
    const parallelId = `parallel_${this.nodes.size}`;
    
    const defaultMerge: ParallelNodeConfig<TState>["merge"] = (results) => {
      return results.reduce((acc, r) => ({ ...acc, ...r.stateUpdate }), {} as Partial<TState>);
    };
    
    const pNode = parallelNode<TState>(parallelId, {
      branches: nodes,
      mergeStrategy: config?.mergeStrategy ?? "all",
      merge: config?.merge ?? defaultMerge
    });
    
    return this.then(pNode);
  }
  
  /**
   * Loop execution until condition is met
   */
  loop(
    node: BaseNode<TState>,
    config: { until: (ctx: ExecutionContext<TState>) => boolean; maxIterations?: number }
  ): this {
    const loopId = `loop_${this.nodes.size}`;
    
    // Create a loop wrapper node
    const loopNode: BaseNode<TState> = {
      id: loopId,
      type: "subgraph",
      async execute(ctx) {
        let iteration = 0;
        const maxIter = config.maxIterations ?? 100;
        
        while (iteration < maxIter) {
          const iterCtx = { ...ctx, iteration };
          
          // Check exit condition
          if (config.until(iterCtx)) {
            break;
          }
          
          // Execute inner node
          const result = await node.execute(iterCtx);
          
          // Apply state updates
          if (result.stateUpdate) {
            Object.assign(ctx.state, result.stateUpdate);
          }
          
          iteration++;
        }
        
        return { stateUpdate: {} };
      }
    };
    
    return this.then(loopNode);
  }
  
  /**
   * Error handling - catch and recover
   */
  catch(handler: (error: ExecutionError, ctx: ExecutionContext<TState>) => NodeResult<TState> | Promise<NodeResult<TState>>): this {
    // Store error handler for compilation
    const lastNodeId = this.currentNode;
    if (lastNodeId) {
      const node = this.nodes.get(lastNodeId);
      if (node) {
        const originalExecute = node.execute;
        node.execute = async (ctx) => {
          try {
            return await originalExecute(ctx);
          } catch (err) {
            const execError: ExecutionError = {
              nodeId: lastNodeId,
              type: "runtime",
              message: err instanceof Error ? err.message : String(err),
              cause: err instanceof Error ? err : undefined,
              timestamp: new Date(),
              retryable: false
            };
            return handler(execError, ctx);
          }
        };
      }
    }
    return this;
  }
  
  /**
   * Human-in-the-loop wait point
   */
  wait(prompt: string | ((ctx: ExecutionContext<TState>) => string), config?: Omit<WaitNodeConfig<TState>, "prompt">): this {
    const waitId = `wait_${this.nodes.size}`;
    return this.then(waitNode(waitId, { prompt, ...config }));
  }
  
  // ========================================================================
  // Compilation
  // ========================================================================
  
  /**
   * Compile the graph into an executable form
   */
  compile(config?: { checkpointer?: Checkpointer<TState> }): CompiledGraph<TState> {
    if (!this.startNode) {
      throw new Error("Graph must have a start node");
    }
    
    const checkpointer = config?.checkpointer;
    const nodes = new Map(this.nodes);
    const edges = [...this.edges];
    const startNode = this.startNode;
    const endNodes = new Set(this.endNodes);
    
    return {
      nodes,
      edges,
      startNode,
      endNodes,
      
      async invoke(initialState, graphConfig) {
        // Load checkpoint if available
        let state: TState = {
          executionId: crypto.randomUUID(),
          lastUpdated: new Date(),
          outputs: {},
          ...initialState
        } as TState;
        
        if (checkpointer) {
          const saved = await checkpointer.load(graphConfig.threadId);
          if (saved) {
            state = { ...state, ...saved };
          }
        }
        
        const ctx: ExecutionContext<TState> = {
          state,
          config: graphConfig,
          errors: []
        };
        
        // Execute graph using BFS traversal
        const visited = new Set<NodeId>();
        const queue: NodeId[] = [startNode];
        
        while (queue.length > 0) {
          const nodeId = queue.shift()!;
          if (visited.has(nodeId)) continue;
          visited.add(nodeId);
          
          const node = nodes.get(nodeId);
          if (!node) continue;
          
          // Execute node
          const result = await node.execute(ctx);
          
          // Apply state updates
          if (result.stateUpdate) {
            Object.assign(ctx.state, result.stateUpdate);
            ctx.state.lastUpdated = new Date();
          }
          
          // Save checkpoint
          if (checkpointer) {
            await checkpointer.save(graphConfig.threadId, ctx.state);
          }
          
          // Determine next nodes
          if (result.goto) {
            const targets = Array.isArray(result.goto) ? result.goto : [result.goto];
            queue.push(...targets);
          } else {
            // Follow edges
            const outEdges = edges.filter(e => e.from === nodeId);
            for (const edge of outEdges) {
              if (!edge.condition || edge.condition(ctx)) {
                const targets = Array.isArray(edge.to) ? edge.to : [edge.to];
                queue.push(...targets);
              }
            }
          }
          
          // Check if reached end
          if (endNodes.has(nodeId) && queue.length === 0) {
            break;
          }
        }
        
        return ctx.state;
      },
      
      async *stream(initialState, graphConfig) {
        // Similar to invoke but yields after each node
        let state: TState = {
          executionId: crypto.randomUUID(),
          lastUpdated: new Date(),
          outputs: {},
          ...initialState
        } as TState;
        
        if (checkpointer) {
          const saved = await checkpointer.load(graphConfig.threadId);
          if (saved) {
            state = { ...state, ...saved };
          }
        }
        
        const ctx: ExecutionContext<TState> = {
          state,
          config: graphConfig,
          errors: []
        };
        
        yield ctx.state;
        
        const visited = new Set<NodeId>();
        const queue: NodeId[] = [startNode];
        
        while (queue.length > 0) {
          const nodeId = queue.shift()!;
          if (visited.has(nodeId)) continue;
          visited.add(nodeId);
          
          const node = nodes.get(nodeId);
          if (!node) continue;
          
          const result = await node.execute(ctx);
          
          if (result.stateUpdate) {
            Object.assign(ctx.state, result.stateUpdate);
            ctx.state.lastUpdated = new Date();
          }
          
          yield ctx.state;
          
          if (checkpointer) {
            await checkpointer.save(graphConfig.threadId, ctx.state);
          }
          
          if (result.goto) {
            const targets = Array.isArray(result.goto) ? result.goto : [result.goto];
            queue.push(...targets);
          } else {
            const outEdges = edges.filter(e => e.from === nodeId);
            for (const edge of outEdges) {
              if (!edge.condition || edge.condition(ctx)) {
                const targets = Array.isArray(edge.to) ? edge.to : [edge.to];
                queue.push(...targets);
              }
            }
          }
          
          if (endNodes.has(nodeId) && queue.length === 0) {
            break;
          }
        }
      }
    };
  }
}

// ============================================================================
// Conditional Builder (for .if()/.else() syntax)
// ============================================================================

interface ConditionalContext {
  condition: (ctx: ExecutionContext) => boolean;
  thenBranch: NodeId[];
  elseBranch: NodeId[];
}

export class ConditionalBuilder<TState extends BaseState = BaseState> {
  private thenNodes: NodeId[] = [];
  private elseNodes: NodeId[] = [];
  private inElse = false;
  
  constructor(
    private parent: GraphBuilder<TState>,
    private condition: (ctx: ExecutionContext<TState>) => boolean
  ) {}
  
  then(node: BaseNode<TState> | NodeId): this {
    const nodeId = typeof node === "string" ? node : node.id;
    if (typeof node !== "string") {
      (this.parent as unknown as { addNode(n: BaseNode<TState>): void }).addNode(node);
    }
    
    if (this.inElse) {
      this.elseNodes.push(nodeId);
    } else {
      this.thenNodes.push(nodeId);
    }
    return this;
  }
  
  else(): this {
    this.inElse = true;
    return this;
  }
  
  /**
   * End conditional and return to parent builder
   */
  endif(): GraphBuilder<TState> {
    // Create a decision node that routes based on condition
    const decisionId = `decision_${Date.now()}`;
    const decision = decisionNode<TState>(decisionId, {
      condition: (ctx) => {
        if (this.condition(ctx)) {
          return this.thenNodes[0] ?? null;
        }
        return this.elseNodes[0] ?? null;
      }
    });
    
    // Add decision node and wire up
    this.parent.then(decision);
    
    return this.parent;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a new graph builder
 */
export function graph<TState extends BaseState = BaseState>(
  stateAnnotation?: { State: TState; annotations: Record<string, StateAnnotation<unknown>> }
): GraphBuilder<TState> {
  return new GraphBuilder<TState>(stateAnnotation);
}

/**
 * Special node IDs
 */
export const START = "__start__";
export const END = "__end__";
```

---

## State Management

```typescript
// ============================================================================
// State Management Patterns
// ============================================================================

/**
 * Atomic Workflow State
 */
export interface AtomicWorkflowState extends BaseState {
  // Research phase
  researchDoc?: string;
  researchFindings?: string[];
  
  // Spec phase
  specDoc?: string;
  specApproved?: boolean;
  
  // Implementation phase (Ralph)
  featureList?: FeatureItem[];
  currentFeature?: FeatureItem;
  allFeaturesPassing?: boolean;
  
  // Debug phase
  debugReports?: DebugReport[];
  
  // PR phase
  prUrl?: string;
  prTitle?: string;
  prBody?: string;
  
  // Context management
  contextWindowUsage: number;
  iteration: number;
}

export interface FeatureItem {
  id: string;
  name: string;
  priority: number;
  passes: boolean;
  description?: string;
}

export interface DebugReport {
  timestamp: Date;
  error: string;
  stackTrace?: string;
  suggestedFix?: string;
}

/**
 * State annotation for Atomic workflow
 */
export const AtomicStateAnnotation = AnnotationRoot({
  executionId: Annotation<string>({ default: () => crypto.randomUUID() }),
  lastUpdated: Annotation<Date>({ default: () => new Date() }),
  outputs: Annotation<Record<string, unknown>>({ default: () => ({}) }),
  
  researchDoc: Annotation<string | undefined>(),
  researchFindings: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  specDoc: Annotation<string | undefined>(),
  specApproved: Annotation<boolean | undefined>(),
  
  featureList: Annotation<FeatureItem[]>({
    reducer: (current, update) => {
      // Merge by ID, preferring updates
      const map = new Map(current.map(f => [f.id, f]));
      update.forEach(f => map.set(f.id, f));
      return Array.from(map.values()).sort((a, b) => a.priority - b.priority);
    },
    default: () => []
  }),
  currentFeature: Annotation<FeatureItem | undefined>(),
  allFeaturesPassing: Annotation<boolean>({ default: () => false }),
  
  debugReports: Annotation<DebugReport[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  prUrl: Annotation<string | undefined>(),
  prTitle: Annotation<string | undefined>(),
  prBody: Annotation<string | undefined>(),
  
  contextWindowUsage: Annotation<number>({ default: () => 0 }),
  iteration: Annotation<number>({ default: () => 0 })
});

// ============================================================================
// Persistent Memory Integration
// ============================================================================

/**
 * Research directory saver - integrates with Atomic's research/ directory
 */
export class ResearchDirSaver<TState extends BaseState = BaseState> implements Checkpointer<TState> {
  constructor(private basePath: string = "research") {}
  
  private getStatePath(threadId: string): string {
    return `${this.basePath}/state/${threadId}.json`;
  }
  
  private getProgressPath(): string {
    return `${this.basePath}/progress.txt`;
  }
  
  async save(threadId: string, state: TState): Promise<void> {
    const fs = await import("fs/promises");
    
    // Save state
    await fs.mkdir(`${this.basePath}/state`, { recursive: true });
    await fs.writeFile(
      this.getStatePath(threadId),
      JSON.stringify(state, null, 2)
    );
    
    // Append to progress log
    const progressEntry = `
---
## ${new Date().toISOString()} - Thread: ${threadId}
Execution: ${state.executionId}
Last Updated: ${state.lastUpdated}
---
`;
    await fs.appendFile(this.getProgressPath(), progressEntry);
  }
  
  async load(threadId: string): Promise<TState | null> {
    const fs = await import("fs/promises");
    try {
      const data = await fs.readFile(this.getStatePath(threadId), "utf-8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  
  async delete(threadId: string): Promise<void> {
    const fs = await import("fs/promises");
    try {
      await fs.unlink(this.getStatePath(threadId));
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Context Window Management
// ============================================================================

/**
 * Signals when context window is getting full
 */
export function contextWindowGuard<TState extends AtomicWorkflowState>(
  threshold: number = 0.6
): (ctx: ExecutionContext<TState>) => boolean {
  return (ctx) => ctx.state.contextWindowUsage >= threshold;
}

/**
 * Create a compact node that delegates to /compact command
 */
export function compactNode<TState extends AtomicWorkflowState>(id: NodeId = "compact"): BaseNode<TState> {
  return {
    id,
    type: "agent",
    async execute(ctx) {
      // Execute /compact slash command
      await executeSlashCommand("/compact");
      return {
        stateUpdate: {
          contextWindowUsage: 0.2 // Reset after compaction
        } as Partial<TState>
      };
    }
  };
}
```

---

## Error Handling

```typescript
// ============================================================================
// Error Handling Patterns
// ============================================================================

/**
 * Retry wrapper for nodes
 */
export function withRetry<TState extends BaseState>(
  node: BaseNode<TState>,
  config: RetryConfig
): BaseNode<TState> {
  return {
    ...node,
    async execute(ctx) {
      let lastError: ExecutionError | undefined;
      let attempt = 0;
      let backoff = config.backoffMs;
      
      while (attempt < config.maxAttempts) {
        try {
          return await node.execute(ctx);
        } catch (err) {
          lastError = {
            nodeId: node.id,
            type: "runtime",
            message: err instanceof Error ? err.message : String(err),
            cause: err instanceof Error ? err : undefined,
            timestamp: new Date(),
            retryable: true
          };
          
          // Check if should retry
          if (config.retryOn && !config.retryOn(lastError)) {
            throw err;
          }
          
          attempt++;
          if (attempt < config.maxAttempts) {
            await sleep(backoff);
            backoff *= config.backoffMultiplier ?? 2;
          }
        }
      }
      
      ctx.errors.push(lastError!);
      throw lastError!.cause ?? new Error(lastError!.message);
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Debug report generator node
 */
export function debugReportNode<TState extends AtomicWorkflowState>(
  id: NodeId = "debug_report"
): BaseNode<TState> {
  return {
    id,
    type: "tool",
    async execute(ctx) {
      const errors = ctx.errors;
      if (errors.length === 0) {
        return {};
      }
      
      const report: DebugReport = {
        timestamp: new Date(),
        error: errors.map(e => e.message).join("\n"),
        stackTrace: errors.map(e => e.cause?.stack).filter(Boolean).join("\n---\n"),
        suggestedFix: await generateSuggestedFix(errors)
      };
      
      // Write debug report
      const fs = await import("fs/promises");
      const reportPath = `research/debug/${Date.now()}-debug-report.md`;
      await fs.mkdir("research/debug", { recursive: true });
      await fs.writeFile(reportPath, formatDebugReport(report));
      
      return {
        stateUpdate: {
          debugReports: [report]
        } as Partial<TState>,
        signals: [{ type: "debug_report_generated", path: reportPath }]
      };
    }
  };
}

async function generateSuggestedFix(errors: ExecutionError[]): Promise<string> {
  // Would call an agent to analyze and suggest fixes
  return "Analyze the stack trace and recent git commits to identify the root cause.";
}

function formatDebugReport(report: DebugReport): string {
  return `# Debug Report

**Generated:** ${report.timestamp.toISOString()}

## Error

${report.error}

## Stack Trace

\`\`\`
${report.stackTrace || "No stack trace available"}
\`\`\`

## Suggested Fix

${report.suggestedFix}
`;
}

/**
 * Error recovery node that tries alternative approaches
 */
export function recoveryNode<TState extends BaseState>(
  id: NodeId,
  strategies: Array<{
    condition: (error: ExecutionError) => boolean;
    handler: BaseNode<TState>;
  }>
): BaseNode<TState> {
  return {
    id,
    type: "decision",
    async execute(ctx) {
      const lastError = ctx.errors[ctx.errors.length - 1];
      if (!lastError) {
        return {};
      }
      
      for (const strategy of strategies) {
        if (strategy.condition(lastError)) {
          return { goto: strategy.handler.id };
        }
      }
      
      // No matching strategy - re-throw
      throw lastError.cause ?? new Error(lastError.message);
    }
  };
}
```

---

## Example Implementations

### Complete Atomic Workflow

```typescript
// ============================================================================
// Atomic Workflow Implementation
// ============================================================================

import { 
  graph, 
  agentNode, 
  toolNode, 
  waitNode, 
  decisionNode,
  ResearchDirSaver,
  contextWindowGuard,
  compactNode,
  debugReportNode,
  type AtomicWorkflowState,
  type ExecutionContext
} from "./graph";

// ============================================================================
// Node Definitions
// ============================================================================

const researchCodebase = agentNode<AtomicWorkflowState>("research", {
  agentType: "claude",
  systemPrompt: (ctx) => `Research the codebase to understand: ${ctx.state.outputs.question ?? "the project structure"}`,
  tools: ["read", "glob", "grep", "bash"],
  outputMapper: (output) => ({
    researchDoc: `research/docs/${Date.now()}-research.md`,
    researchFindings: extractFindings(output.response)
  })
});

const createSpec = agentNode<AtomicWorkflowState>("create_spec", {
  agentType: "claude",
  systemPrompt: (ctx) => `Based on research at ${ctx.state.researchDoc}, create a detailed specification.`,
  tools: ["read", "write"],
  outputMapper: (output) => ({
    specDoc: `research/specs/${Date.now()}-spec.md`
  })
});

const reviewSpec = waitNode<AtomicWorkflowState>("review_spec", {
  prompt: (ctx) => `Please review the spec at ${ctx.state.specDoc}. Approve to continue.`,
  autoApprove: (ctx) => ctx.config.debug === true, // Auto-approve in debug mode
  inputMapper: (input) => ({ specApproved: input.approved })
});

const createFeatureList = toolNode<AtomicWorkflowState, { features: FeatureItem[] }>("create_features", {
  toolName: "write_json",
  args: (ctx) => ({
    path: "research/feature-list.json",
    content: ctx.state.specDoc
  }),
  outputMapper: (result) => ({
    featureList: result.features
  })
});

const implementFeature = agentNode<AtomicWorkflowState>("implement_feature", {
  agentType: "claude",
  systemPrompt: `You are Ralph, implementing a single feature from the feature list.
  
1. Read research/feature-list.json
2. Pick the highest priority non-passing feature
3. Implement it with tests
4. Mark as passing when complete
5. Commit your work

STOP when the feature is implemented and tested.`,
  tools: ["read", "write", "edit", "bash", "glob", "grep"],
  maxIterations: 50,
  completionCondition: (ctx) => ctx.state.currentFeature?.passes === true,
  outputMapper: (output, ctx) => {
    // Update feature status
    const updated = ctx.state.featureList?.map(f => 
      f.id === ctx.state.currentFeature?.id ? { ...f, passes: true } : f
    );
    return {
      featureList: updated,
      allFeaturesPassing: updated?.every(f => f.passes) ?? false
    };
  }
});

const selectNextFeature = toolNode<AtomicWorkflowState, FeatureItem | null>("select_feature", {
  toolName: "read_json",
  args: () => ({ path: "research/feature-list.json" }),
  outputMapper: (result, ctx) => {
    const features = ctx.state.featureList ?? [];
    const next = features.find(f => !f.passes);
    return { currentFeature: next };
  }
});

const createPR = agentNode<AtomicWorkflowState>("create_pr", {
  agentType: "claude",
  systemPrompt: `Create a pull request for the implemented features.`,
  tools: ["bash"],
  outputMapper: (output) => ({
    prUrl: extractPRUrl(output.response)
  })
});

const notifyUser = toolNode<AtomicWorkflowState, void>("notify", {
  toolName: "console_log",
  args: (ctx) => ({ message: `Workflow paused: ${ctx.state.outputs.notification}` }),
  outputMapper: () => ({})
});

// ============================================================================
// Build the Workflow Graph
// ============================================================================

const atomicWorkflow = graph<AtomicWorkflowState>()
  // Phase 1: Research
  .start("research")
  .then(researchCodebase)
  
  // Phase 2: Spec
  .then(createSpec)
  .then(reviewSpec)
  
  // Decision: Was spec approved?
  .if(ctx => ctx.state.specApproved === true)
    .then(createFeatureList)
    
    // Phase 3: Implementation (Ralph Loop)
    .then(selectNextFeature)
    .loop(implementFeature, {
      until: ctx => ctx.state.allFeaturesPassing === true,
      maxIterations: 100
    })
    .catch((error, ctx) => {
      // On error, generate debug report and continue
      return {
        stateUpdate: {
          debugReports: [{
            timestamp: new Date(),
            error: error.message,
            stackTrace: error.cause?.stack
          }]
        }
      };
    })
    
    // Phase 4: PR
    .then(createPR)
  .else()
    // Spec not approved - notify and wait
    .then(notifyUser)
    .wait("Waiting for spec revision")
  .endif()
  
  .end("create_pr", "notify")
  .compile({
    checkpointer: new ResearchDirSaver()
  });

// ============================================================================
// Execute the Workflow
// ============================================================================

async function runAtomicWorkflow(question: string) {
  const result = await atomicWorkflow.invoke(
    {
      outputs: { question }
    },
    {
      threadId: `atomic-${Date.now()}`,
      maxConcurrency: 4,
      nodeTimeout: 300000, // 5 minutes per node
      graphTimeout: 3600000, // 1 hour total
      debug: process.env.DEBUG === "true"
    }
  );
  
  console.log("Workflow completed!");
  console.log("PR URL:", result.prUrl);
  console.log("Features implemented:", result.featureList?.filter(f => f.passes).length);
}

// ============================================================================
// Streaming Execution
// ============================================================================

async function runWithStreaming(question: string) {
  const config = {
    threadId: `atomic-stream-${Date.now()}`,
    debug: true
  };
  
  for await (const state of atomicWorkflow.stream({ outputs: { question } }, config)) {
    console.log(`[${state.lastUpdated.toISOString()}] State updated`);
    console.log(`  - Context usage: ${(state.contextWindowUsage * 100).toFixed(1)}%`);
    console.log(`  - Iteration: ${state.iteration}`);
    console.log(`  - Features passing: ${state.featureList?.filter(f => f.passes).length ?? 0}`);
  }
}

// Helper functions
function extractFindings(response: string): string[] {
  // Parse findings from agent response
  return response.split("\n").filter(line => line.startsWith("- "));
}

function extractPRUrl(response: string): string {
  const match = response.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
  return match?.[0] ?? "";
}
```

### Ralph Loop Pattern (Simplified)

```typescript
// ============================================================================
// Ralph Loop - Iterative Feature Implementation
// ============================================================================

import { graph, agentNode, toolNode, type BaseState } from "./graph";

interface RalphState extends BaseState {
  featureListPath: string;
  features: Array<{ id: string; name: string; passes: boolean; priority: number }>;
  currentFeatureId?: string;
  iteration: number;
  maxIterations: number;
  completionPromise?: string;
}

const ralphLoop = graph<RalphState>()
  .start("init")
  .then(toolNode("init", {
    toolName: "read_json",
    args: (ctx) => ({ path: ctx.state.featureListPath }),
    outputMapper: (features) => ({ features, iteration: 1 })
  }))
  
  .loop(
    agentNode("implement", {
      agentType: "claude",
      systemPrompt: `Implement the highest-priority failing feature from the list.
        
1. Read the feature list
2. Pick the highest priority non-passing feature
3. Implement with tests
4. Update passes to true
5. Commit changes`,
      tools: ["read", "write", "edit", "bash"],
      outputMapper: (output, ctx) => {
        const newIteration = ctx.state.iteration + 1;
        // Check for completion promise
        if (ctx.state.completionPromise) {
          const hasPromise = output.response.includes(
            `<promise>${ctx.state.completionPromise}</promise>`
          );
          if (hasPromise) {
            return { iteration: newIteration, features: ctx.state.features.map(f => ({ ...f, passes: true })) };
          }
        }
        return { iteration: newIteration };
      }
    }),
    {
      until: (ctx) => {
        // Exit conditions
        if (ctx.state.maxIterations > 0 && ctx.state.iteration >= ctx.state.maxIterations) {
          return true;
        }
        if (ctx.state.features.every(f => f.passes)) {
          return true;
        }
        return false;
      },
      maxIterations: 1000
    }
  )
  
  .then(toolNode("summary", {
    toolName: "write",
    args: (ctx) => ({
      path: "research/progress.txt",
      content: `Ralph completed after ${ctx.state.iteration} iterations.\n` +
        `Features: ${ctx.state.features.filter(f => f.passes).length}/${ctx.state.features.length} passing`
    }),
    outputMapper: () => ({})
  }))
  
  .end("summary")
  .compile();
```

---

## Integration with Atomic Commands

```typescript
// ============================================================================
// Integration with Existing Atomic CLI
// ============================================================================

import { graph, type GraphBuilder, type CompiledGraph } from "./graph";
import type { RalphSetupOptions } from "../src/commands/ralph";

/**
 * Create a graph from Ralph setup options
 */
export function createRalphGraph(options: RalphSetupOptions): CompiledGraph<RalphState> {
  const { prompt, maxIterations = 0, completionPromise, featureList } = options;
  
  return graph<RalphState>()
    .start("setup")
    .then(toolNode("setup", {
      toolName: "init_state",
      args: () => ({
        featureListPath: featureList ?? "research/feature-list.json",
        maxIterations,
        completionPromise
      }),
      outputMapper: (_, ctx) => ({
        featureListPath: featureList ?? "research/feature-list.json",
        maxIterations: maxIterations,
        completionPromise: completionPromise
      })
    }))
    .loop(
      agentNode("implement", {
        agentType: "claude",
        systemPrompt: prompt.join(" ") || DEFAULT_RALPH_PROMPT,
        tools: ["read", "write", "edit", "bash", "glob", "grep"],
        outputMapper: (output, ctx) => ({ iteration: ctx.state.iteration + 1 })
      }),
      {
        until: (ctx) => {
          if (maxIterations > 0 && ctx.state.iteration >= maxIterations) return true;
          if (ctx.state.features.every(f => f.passes)) return true;
          return false;
        }
      }
    )
    .end("implement")
    .compile({
      checkpointer: new FileSaver("research/state")
    });
}

/**
 * Slash command integration
 */
export const slashCommands = {
  "/research": (question: string) => graph()
    .start("research")
    .then(agentNode("research", {
      agentType: "claude",
      systemPrompt: `Research: ${question}`,
      tools: ["read", "glob", "grep", "webfetch"],
      outputMapper: (output) => ({ researchDoc: output.response })
    }))
    .compile(),
    
  "/spec": (researchPath: string) => graph()
    .start("spec")
    .then(agentNode("spec", {
      agentType: "claude",
      systemPrompt: `Create spec from: ${researchPath}`,
      tools: ["read", "write"],
      outputMapper: (output) => ({ specDoc: output.response })
    }))
    .compile(),
    
  "/implement-feature": () => createRalphGraph({ prompt: [] }),
  
  "/create-pr": () => graph()
    .start("pr")
    .then(agentNode("pr", {
      agentType: "claude",
      systemPrompt: "Create a PR for recent changes",
      tools: ["bash"],
      outputMapper: (output) => ({ prUrl: extractPRUrl(output.response) })
    }))
    .compile()
};

const DEFAULT_RALPH_PROMPT = `You are tasked with implementing features from research/feature-list.json...`;
function extractPRUrl(response: string): string {
  return response.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0] ?? "";
}
```

---

## Comparison with Existing Patterns

| Feature | LangGraph.js | XState | RxJS | Effect-TS | This Design |
|---------|-------------|--------|------|-----------|-------------|
| **Type Safety** | Good | Excellent | Good | Excellent | Excellent |
| **Fluent API** | Builder | setup() | pipe() | pipe() | Builder + Chain |
| **Conditional Routing** | addConditionalEdges | guards | filter/switchMap | flatMap | .if()/.else() |
| **Parallel Execution** | Command with goto[] | parallel states | forkJoin/merge | fiber fork | .parallel() |
| **Error Handling** | try/catch | onError | catchError | catchTags | .catch() |
| **State Persistence** | Checkpointer | persist() | - | Ref | Checkpointer |
| **Human-in-the-loop** | interrupt_before | invoke() | - | - | .wait() |
| **Loops** | Command goto | invoke() | repeat/retry | Effect.loop | .loop() |

### Key Differentiators

1. **Unified Chaining Syntax**: Combines the best of RxJS's pipe() with LangGraph's builder pattern
2. **First-class Loop Support**: Built-in `.loop()` method for Ralph-style iterative workflows
3. **Integrated Context Management**: Context window signals and automatic compaction
4. **Research Directory Integration**: Native support for Atomic's persistent memory pattern
5. **Agent-Centric Design**: AgentNode type optimized for sub-agent delegation

---

## Implementation Roadmap

### Phase 1: Core Types (Week 1)
- [ ] Implement base types and interfaces
- [ ] Create node type definitions
- [ ] Build state annotation system

### Phase 2: Fluent API (Week 2)
- [ ] Implement GraphBuilder class
- [ ] Add chaining methods (then, if, else, parallel, loop)
- [ ] Create ConditionalBuilder

### Phase 3: Execution Engine (Week 3)
- [ ] Implement CompiledGraph invoke/stream
- [ ] Add checkpointer implementations
- [ ] Build retry and error handling

### Phase 4: Atomic Integration (Week 4)
- [ ] Integrate with existing Ralph commands
- [ ] Create slash command wrappers
- [ ] Add research directory persistence

---

## References

- [LangGraph.js Documentation](https://js.langchain.com/docs/langgraph)
- [XState Documentation](https://xstate.js.org/docs/)
- [RxJS Documentation](https://rxjs.dev/)
- [Effect-TS Documentation](https://effect.website/)
- [n8n Workflow Engine](https://docs.n8n.io/)

---

*Document generated by Research Agent for Atomic Workflow*
