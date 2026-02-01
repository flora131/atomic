/**
 * Node Factory Functions for Graph Workflows
 *
 * This module provides factory functions for creating typed graph nodes.
 * Each factory creates a NodeDefinition with appropriate type and execute function.
 *
 * Node types:
 * - agentNode: Executes an AI agent session
 * - toolNode: Executes a specific tool
 * - decisionNode: Routes based on conditions
 * - waitNode: Pauses for human input
 * - parallelNode: Executes branches concurrently
 *
 * Reference: Feature 12 - Implement node factory functions
 */

import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  RetryConfig,
  ExecutionContext,
  SignalData,
  ContextWindowUsage,
} from "./types.ts";
import type { SessionConfig, AgentMessage, CodingAgentClient, Session, ContextUsage } from "../sdk/types.ts";
import { DEFAULT_RETRY_CONFIG } from "./types.ts";

// ============================================================================
// AGENT NODE
// ============================================================================

/**
 * Agent types supported by the agent node factory.
 */
export type AgentNodeAgentType = "claude" | "opencode" | "copilot";

/**
 * Function to map agent output to state updates.
 *
 * @template TState - The state type
 * @param messages - Messages from the agent
 * @param state - Current workflow state
 * @returns Partial state update
 */
export type OutputMapper<TState extends BaseState = BaseState> = (
  messages: AgentMessage[],
  state: TState
) => Partial<TState>;

/**
 * Configuration for creating an agent node.
 *
 * @template TState - The state type for the workflow
 */
export interface AgentNodeConfig<TState extends BaseState = BaseState> {
  /** Unique identifier for the node */
  id: NodeId;

  /** Type of agent to use */
  agentType: AgentNodeAgentType;

  /** System prompt for the agent */
  systemPrompt?: string;

  /** Tools available to the agent */
  tools?: string[];

  /**
   * Function to map agent output to state updates.
   * If not provided, messages are stored in outputs[nodeId].
   */
  outputMapper?: OutputMapper<TState>;

  /** Session configuration passed to the agent client */
  sessionConfig?: Partial<SessionConfig>;

  /** Retry configuration for error handling */
  retry?: RetryConfig;

  /** Human-readable name for the node */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /**
   * Function to build the user message from state.
   * @param state - Current workflow state
   * @returns The message to send to the agent
   */
  buildMessage?: (state: TState) => string;
}

/**
 * Client provider function type for dependency injection.
 * Returns a CodingAgentClient for the specified agent type.
 */
export type ClientProvider = (agentType: AgentNodeAgentType) => CodingAgentClient | null;

/**
 * Global client provider for agent nodes.
 * Set this before executing agent nodes.
 */
let globalClientProvider: ClientProvider | null = null;

/**
 * Set the global client provider for agent nodes.
 *
 * @param provider - Function that returns a client for a given agent type
 */
export function setClientProvider(provider: ClientProvider): void {
  globalClientProvider = provider;
}

/**
 * Get the current global client provider.
 *
 * @returns The current client provider or null
 */
export function getClientProvider(): ClientProvider | null {
  return globalClientProvider;
}

/**
 * Default retry configuration for agent nodes.
 * Uses 3 attempts with 1 second initial backoff and 2x multiplier.
 * This results in delays of: 1s (first retry), 2s (second retry).
 */
export const AGENT_NODE_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

/**
 * Create an agent node that executes an AI agent session.
 *
 * The agent node:
 * 1. Creates or resumes an agent session
 * 2. Sends a message built from the current state
 * 3. Collects the response and maps it to state updates
 * 4. Tracks context window usage
 *
 * @template TState - The state type for the workflow
 * @param config - Agent node configuration
 * @returns A NodeDefinition that executes the agent
 *
 * @example
 * ```typescript
 * const researchNode = agentNode<MyState>({
 *   id: "research",
 *   agentType: "claude",
 *   systemPrompt: "You are a research assistant...",
 *   buildMessage: (state) => `Research: ${state.topic}`,
 *   outputMapper: (messages, state) => ({
 *     researchDoc: messages.map(m => m.content).join("\n"),
 *   }),
 * });
 * ```
 */
export function agentNode<TState extends BaseState = BaseState>(
  config: AgentNodeConfig<TState>
): NodeDefinition<TState> {
  const {
    id,
    agentType,
    systemPrompt,
    tools,
    outputMapper,
    sessionConfig,
    retry = AGENT_NODE_RETRY_CONFIG,
    name,
    description,
    buildMessage,
  } = config;

  return {
    id,
    type: "agent",
    name: name ?? `${agentType} agent`,
    description,
    retry,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const client = globalClientProvider?.(agentType);

      if (!client) {
        throw new Error(
          `No client provider set for agent type "${agentType}". ` +
            "Call setClientProvider() before executing agent nodes."
        );
      }

      // Build session configuration
      const fullSessionConfig: SessionConfig = {
        ...sessionConfig,
        systemPrompt: systemPrompt ?? sessionConfig?.systemPrompt,
        tools: tools ?? sessionConfig?.tools,
      };

      // Create or resume session
      const session = await client.createSession(fullSessionConfig);

      try {
        // Build message from state
        const message = buildMessage ? buildMessage(ctx.state) : "";

        // Send message and collect response
        const messages: AgentMessage[] = [];
        for await (const chunk of session.stream(message)) {
          messages.push(chunk);
        }

        // Get context usage
        const contextUsage = await session.getContextUsage();

        // Build state update
        let stateUpdate: Partial<TState>;

        if (outputMapper) {
          stateUpdate = outputMapper(messages, ctx.state);
        } else {
          // Default: store messages in outputs
          stateUpdate = {
            outputs: {
              ...ctx.state.outputs,
              [id]: messages,
            },
          } as Partial<TState>;
        }

        // Build signals
        const signals: SignalData[] = [];

        // Check context window usage
        if (contextUsage && ctx.config.contextWindowThreshold) {
          const usagePercent =
            ((contextUsage.inputTokens + contextUsage.outputTokens) /
              (contextUsage.maxTokens || 100000)) *
            100;

          if (usagePercent >= ctx.config.contextWindowThreshold) {
            signals.push({
              type: "context_window_warning",
              message: `Context usage at ${usagePercent.toFixed(1)}%`,
              data: { usagePercent, contextUsage },
            });
          }
        }

        return {
          stateUpdate,
          signals: signals.length > 0 ? signals : undefined,
        };
      } finally {
        // Always cleanup session
        await session.destroy();
      }
    },
  };
}

// ============================================================================
// TOOL NODE
// ============================================================================

/**
 * Function type for tool execution.
 *
 * @template TArgs - The type of arguments the tool accepts
 * @template TResult - The type of result the tool returns
 */
export type ToolExecuteFn<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
  abortSignal?: AbortSignal
) => Promise<TResult>;

/**
 * Function to map tool result to state updates.
 *
 * @template TState - The state type
 * @template TResult - The tool result type
 */
export type ToolOutputMapper<TState extends BaseState = BaseState, TResult = unknown> = (
  result: TResult,
  state: TState
) => Partial<TState>;

/**
 * Configuration for creating a tool node.
 *
 * @template TState - The state type for the workflow
 * @template TArgs - The type of arguments the tool accepts
 * @template TResult - The type of result the tool returns
 */
export interface ToolNodeConfig<
  TState extends BaseState = BaseState,
  TArgs = unknown,
  TResult = unknown,
> {
  /** Unique identifier for the node */
  id: NodeId;

  /** Name of the tool being executed */
  toolName: string;

  /**
   * The tool execution function.
   * If not provided, args must include a function.
   */
  execute?: ToolExecuteFn<TArgs, TResult>;

  /**
   * Arguments to pass to the tool.
   * Can be a static object or a function that builds args from state.
   */
  args?: TArgs | ((state: TState) => TArgs);

  /**
   * Function to map tool result to state updates.
   * If not provided, result is stored in outputs[nodeId].
   */
  outputMapper?: ToolOutputMapper<TState, TResult>;

  /** Timeout in milliseconds for tool execution */
  timeout?: number;

  /** Retry configuration */
  retry?: RetryConfig;

  /** Human-readable name */
  name?: string;

  /** Description of the tool */
  description?: string;
}

/**
 * Create a tool node that executes a specific tool function.
 *
 * @template TState - The state type for the workflow
 * @template TArgs - The type of arguments the tool accepts
 * @template TResult - The type of result the tool returns
 * @param config - Tool node configuration
 * @returns A NodeDefinition that executes the tool
 *
 * @example
 * ```typescript
 * const fetchDataNode = toolNode<MyState, { url: string }, Response>({
 *   id: "fetch-data",
 *   toolName: "http_fetch",
 *   execute: async (args) => fetch(args.url),
 *   args: (state) => ({ url: state.targetUrl }),
 *   outputMapper: (result, state) => ({
 *     fetchedData: result,
 *   }),
 * });
 * ```
 */
export function toolNode<
  TState extends BaseState = BaseState,
  TArgs = unknown,
  TResult = unknown,
>(config: ToolNodeConfig<TState, TArgs, TResult>): NodeDefinition<TState> {
  const {
    id,
    toolName,
    execute,
    args,
    outputMapper,
    timeout,
    retry = DEFAULT_RETRY_CONFIG,
    name,
    description,
  } = config;

  if (!execute) {
    throw new Error(`Tool node "${id}" requires an execute function`);
  }

  return {
    id,
    type: "tool",
    name: name ?? toolName,
    description,
    retry,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      // Build arguments
      const resolvedArgs = typeof args === "function" ? (args as (state: TState) => TArgs)(ctx.state) : args;

      // Create abort controller for timeout
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const abortController = new AbortController();

      if (timeout) {
        timeoutId = setTimeout(() => {
          abortController.abort(new Error(`Tool "${toolName}" timed out after ${timeout}ms`));
        }, timeout);
      }

      try {
        // Execute the tool
        const result = await execute(resolvedArgs as TArgs, abortController.signal);

        // Build state update
        let stateUpdate: Partial<TState>;

        if (outputMapper) {
          stateUpdate = outputMapper(result, ctx.state);
        } else {
          // Default: store result in outputs
          stateUpdate = {
            outputs: {
              ...ctx.state.outputs,
              [id]: result,
            },
          } as Partial<TState>;
        }

        return { stateUpdate };
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    },
  };
}

// ============================================================================
// CLEAR CONTEXT NODE
// ============================================================================

/**
 * Configuration for creating a clear context node.
 *
 * @template TState - The state type for the workflow
 */
export interface ClearContextNodeConfig<TState extends BaseState = BaseState> {
  /** Unique identifier for the node */
  id: NodeId;

  /** Optional name for display */
  name?: string;

  /** Optional description */
  description?: string;

  /**
   * Optional message to display when clearing context.
   * Can be a string or function that receives current state.
   */
  message?: string | ((state: TState) => string);
}

/**
 * Creates a node that clears the context window by calling session.summarize().
 *
 * This is used to reset the context between major workflow steps (e.g., after
 * research and after spec creation) to ensure clean state for the next phase.
 *
 * The node:
 * 1. Calls session.summarize() to compact context (if session exists)
 * 2. Emits a context_window_warning signal with action "summarize"
 * 3. Returns no state update
 *
 * @param config - Node configuration
 * @returns Node definition for clearing context
 *
 * @example
 * ```typescript
 * const clearAfterResearch = clearContextNode<MyState>({
 *   id: "clear-after-research",
 *   message: "Research complete. Clearing context for spec creation.",
 * });
 *
 * // Use in workflow
 * graph<MyState>()
 *   .start(researchNode)
 *   .then(clearAfterResearch)
 *   .then(specNode)
 *   .compile();
 * ```
 */
export function clearContextNode<TState extends BaseState = BaseState>(
  config: ClearContextNodeConfig<TState>
): NodeDefinition<TState> {
  const { id, name, description, message } = config;

  return {
    id,
    type: "tool",
    name: name ?? "clear-context",
    description: description ?? "Clears the context window",
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const resolvedMessage = typeof message === "function" ? message(ctx.state) : message;

      // Emit context_window_warning signal to trigger summarization
      return {
        signals: [
          {
            type: "context_window_warning",
            message: resolvedMessage ?? "Clearing context window",
            data: {
              usage: 100, // Force summarization
              threshold: ctx.contextWindowThreshold ?? 60,
              nodeId: id,
              action: "summarize",
            },
          },
        ],
      };
    },
  };
}

// ============================================================================
// DECISION NODE
// ============================================================================

/**
 * A single route in a decision node.
 *
 * @template TState - The state type
 */
export interface DecisionRoute<TState extends BaseState = BaseState> {
  /** Condition function that returns true if this route should be taken */
  condition: (state: TState) => boolean;

  /** Target node ID to route to */
  target: NodeId;

  /** Optional label for the route (for visualization) */
  label?: string;
}

/**
 * Configuration for creating a decision node.
 *
 * @template TState - The state type for the workflow
 */
export interface DecisionNodeConfig<TState extends BaseState = BaseState> {
  /** Unique identifier for the node */
  id: NodeId;

  /**
   * Routes to evaluate in order.
   * First matching route is taken.
   */
  routes: DecisionRoute<TState>[];

  /** Fallback node ID if no route matches */
  fallback: NodeId;

  /** Human-readable name */
  name?: string;

  /** Description of the decision logic */
  description?: string;
}

/**
 * Create a decision node that routes based on conditions.
 *
 * Routes are evaluated in order. The first route whose condition
 * returns true is taken. If no route matches, the fallback is used.
 *
 * @template TState - The state type for the workflow
 * @param config - Decision node configuration
 * @returns A NodeDefinition that routes to the appropriate target
 *
 * @example
 * ```typescript
 * const router = decisionNode<MyState>({
 *   id: "approval-check",
 *   routes: [
 *     { condition: (s) => s.score >= 90, target: "fast-track" },
 *     { condition: (s) => s.score >= 70, target: "standard-review" },
 *   ],
 *   fallback: "manual-review",
 * });
 * ```
 */
export function decisionNode<TState extends BaseState = BaseState>(
  config: DecisionNodeConfig<TState>
): NodeDefinition<TState> {
  const { id, routes, fallback, name, description } = config;

  return {
    id,
    type: "decision",
    name: name ?? "decision",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      // Evaluate routes in order
      for (const route of routes) {
        if (route.condition(ctx.state)) {
          return { goto: route.target };
        }
      }

      // No route matched, use fallback
      return { goto: fallback };
    },
  };
}

// ============================================================================
// WAIT NODE
// ============================================================================

/**
 * Function to map human input to state updates.
 *
 * @template TState - The state type
 */
export type InputMapper<TState extends BaseState = BaseState> = (
  input: string,
  state: TState
) => Partial<TState>;

/**
 * Configuration for creating a wait node.
 *
 * @template TState - The state type for the workflow
 */
export interface WaitNodeConfig<TState extends BaseState = BaseState> {
  /** Unique identifier for the node */
  id: NodeId;

  /** Prompt to display to the user */
  prompt: string | ((state: TState) => string);

  /**
   * If true, automatically approves and continues.
   * Useful for testing or automated flows.
   */
  autoApprove?: boolean;

  /**
   * Function to map human input to state updates.
   * Called when the user provides input.
   */
  inputMapper?: InputMapper<TState>;

  /** Human-readable name */
  name?: string;

  /** Description */
  description?: string;
}

/**
 * Create a wait node that pauses for human input.
 *
 * The wait node emits a `human_input_required` signal and pauses
 * execution until input is received.
 *
 * @template TState - The state type for the workflow
 * @param config - Wait node configuration
 * @returns A NodeDefinition that waits for human input
 *
 * @example
 * ```typescript
 * const approvalNode = waitNode<MyState>({
 *   id: "approval",
 *   prompt: (state) => `Please review the spec:\n${state.specDoc}`,
 *   inputMapper: (input, state) => ({
 *     specApproved: input.toLowerCase() === "approved",
 *   }),
 * });
 * ```
 */
export function waitNode<TState extends BaseState = BaseState>(
  config: WaitNodeConfig<TState>
): NodeDefinition<TState> {
  const { id, prompt, autoApprove = false, inputMapper, name, description } = config;

  return {
    id,
    type: "wait",
    name: name ?? "wait",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      // Build prompt
      const resolvedPrompt = typeof prompt === "function" ? prompt(ctx.state) : prompt;

      if (autoApprove) {
        // Auto-approve: apply input mapper with empty string and continue
        const stateUpdate = inputMapper ? inputMapper("", ctx.state) : undefined;
        return { stateUpdate };
      }

      // Emit human input required signal
      return {
        signals: [
          {
            type: "human_input_required",
            message: resolvedPrompt,
            data: {
              nodeId: id,
              inputMapper: inputMapper ? true : false,
            },
          },
        ],
      };
    },
  };
}

// ============================================================================
// PARALLEL NODE
// ============================================================================

/**
 * Merge strategies for parallel node results.
 */
export type ParallelMergeStrategy = "all" | "race" | "any";

/**
 * Function to merge parallel branch results.
 *
 * @template TState - The state type
 */
export type ParallelMerger<TState extends BaseState = BaseState> = (
  results: Map<NodeId, unknown>,
  state: TState
) => Partial<TState>;

/**
 * Configuration for creating a parallel node.
 *
 * @template TState - The state type for the workflow
 */
export interface ParallelNodeConfig<TState extends BaseState = BaseState> {
  /** Unique identifier for the node */
  id: NodeId;

  /**
   * Branch node IDs to execute in parallel.
   * These nodes must be defined in the graph.
   */
  branches: NodeId[];

  /**
   * Merge strategy for handling branch completion:
   * - "all": Wait for all branches (Promise.all)
   * - "race": Wait for first branch (Promise.race)
   * - "any": Wait for first success (Promise.any)
   * Default: "all"
   */
  strategy?: ParallelMergeStrategy;

  /**
   * Function to merge branch results into state.
   * If not provided, results are stored in outputs[nodeId].
   */
  merge?: ParallelMerger<TState>;

  /** Human-readable name */
  name?: string;

  /** Description */
  description?: string;
}

/**
 * Context for parallel branch execution.
 * Passed to the execution engine to handle parallel nodes.
 */
export interface ParallelExecutionContext<TState extends BaseState = BaseState> {
  /** Branch node IDs to execute */
  branches: NodeId[];

  /** Strategy for handling completion */
  strategy: ParallelMergeStrategy;

  /** Optional merge function */
  merge?: ParallelMerger<TState>;
}

/**
 * Create a parallel node that executes branches concurrently.
 *
 * The actual parallel execution is handled by the graph execution engine.
 * This node factory creates the node definition with parallel configuration.
 *
 * @template TState - The state type for the workflow
 * @param config - Parallel node configuration
 * @returns A NodeDefinition configured for parallel execution
 *
 * @example
 * ```typescript
 * const gatherNode = parallelNode<MyState>({
 *   id: "gather-data",
 *   branches: ["fetch-api-1", "fetch-api-2", "fetch-api-3"],
 *   strategy: "all",
 *   merge: (results, state) => ({
 *     allData: Array.from(results.values()),
 *   }),
 * });
 * ```
 */
export function parallelNode<TState extends BaseState = BaseState>(
  config: ParallelNodeConfig<TState>
): NodeDefinition<TState> {
  const { id, branches, strategy = "all", merge, name, description } = config;

  if (branches.length === 0) {
    throw new Error(`Parallel node "${id}" requires at least one branch`);
  }

  return {
    id,
    type: "parallel",
    name: name ?? "parallel",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      // Store parallel execution context for the execution engine
      const parallelContext: ParallelExecutionContext<TState> = {
        branches,
        strategy,
        merge,
      };

      // The execution engine will handle actual parallel execution
      // This node just marks the parallel point and stores configuration
      return {
        stateUpdate: {
          outputs: {
            ...ctx.state.outputs,
            [id]: {
              _parallel: true,
              ...parallelContext,
            },
          },
        } as Partial<TState>,
        // Return goto to all branches for the execution engine
        goto: branches,
      };
    },
  };
}

// ============================================================================
// SUBGRAPH NODE
// ============================================================================

/**
 * Configuration for creating a subgraph node.
 *
 * @template TState - The state type for the workflow
 * @template TSubState - The state type for the subgraph
 */
export interface SubgraphNodeConfig<
  TState extends BaseState = BaseState,
  TSubState extends BaseState = BaseState,
> {
  /** Unique identifier for the node */
  id: NodeId;

  /**
   * The compiled subgraph to execute.
   * This should be a CompiledGraph instance.
   */
  subgraph: {
    execute: (state: TSubState) => Promise<TSubState>;
  };

  /**
   * Map parent state to subgraph initial state.
   */
  inputMapper?: (state: TState) => TSubState;

  /**
   * Map subgraph final state to parent state update.
   */
  outputMapper?: (subState: TSubState, parentState: TState) => Partial<TState>;

  /** Human-readable name */
  name?: string;

  /** Description */
  description?: string;
}

/**
 * Create a subgraph node that executes a nested graph.
 *
 * @template TState - The state type for the workflow
 * @template TSubState - The state type for the subgraph
 * @param config - Subgraph node configuration
 * @returns A NodeDefinition that executes the subgraph
 *
 * @example
 * ```typescript
 * const analysisNode = subgraphNode<MainState, AnalysisState>({
 *   id: "deep-analysis",
 *   subgraph: compiledAnalysisGraph,
 *   inputMapper: (state) => ({ doc: state.document }),
 *   outputMapper: (subState, parentState) => ({
 *     analysisResults: subState.results,
 *   }),
 * });
 * ```
 */
export function subgraphNode<
  TState extends BaseState = BaseState,
  TSubState extends BaseState = BaseState,
>(config: SubgraphNodeConfig<TState, TSubState>): NodeDefinition<TState> {
  const { id, subgraph, inputMapper, outputMapper, name, description } = config;

  return {
    id,
    type: "subgraph",
    name: name ?? "subgraph",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      // Map input state
      const subState = inputMapper
        ? inputMapper(ctx.state)
        : (ctx.state as unknown as TSubState);

      // Execute subgraph
      const finalSubState = await subgraph.execute(subState);

      // Map output state
      const stateUpdate = outputMapper
        ? outputMapper(finalSubState, ctx.state)
        : ({
            outputs: {
              ...ctx.state.outputs,
              [id]: finalSubState,
            },
          } as Partial<TState>);

      return { stateUpdate };
    },
  };
}

// ============================================================================
// CONTEXT MONITORING NODE
// ============================================================================

/**
 * Action to take when context window threshold is exceeded.
 */
export type ContextCompactionAction = "summarize" | "recreate" | "warn" | "none";

/**
 * State interface extension for context monitoring.
 * Workflows using context monitoring should include these fields.
 */
export interface ContextMonitoringState extends BaseState {
  /** Current context window usage */
  contextWindowUsage: ContextWindowUsage | null;
}

/**
 * Configuration for creating a context monitoring node.
 *
 * @template TState - The state type for the workflow
 */
export interface ContextMonitorNodeConfig<TState extends BaseState = BaseState> {
  /** Unique identifier for the node */
  id: NodeId;

  /**
   * Agent type to determine compaction strategy.
   * - "opencode": Calls session.summarize()
   * - "claude": Signals need to recreate session
   * - "copilot": Signals only (no native compaction)
   */
  agentType: AgentNodeAgentType;

  /**
   * Context usage threshold percentage (0-100) that triggers action.
   * Defaults to 60 (60%).
   */
  threshold?: number;

  /**
   * Action to take when threshold is exceeded:
   * - "summarize": Call session.summarize() (OpenCode only)
   * - "recreate": Signal that session should be recreated (Claude)
   * - "warn": Emit warning signal only
   * - "none": Do nothing
   * Defaults to auto-detect based on agentType.
   */
  action?: ContextCompactionAction;

  /**
   * Session to monitor and potentially compact.
   * Can be a function that retrieves the session from state.
   */
  getSession?: (state: TState) => Session | null;

  /**
   * Function to get the current context usage.
   * If not provided, uses getSession().getContextUsage().
   */
  getContextUsage?: (state: TState) => Promise<ContextUsage | null>;

  /**
   * Callback when compaction is performed.
   * @param usage - Context usage before compaction
   * @param action - Action that was taken
   */
  onCompaction?: (usage: ContextUsage, action: ContextCompactionAction) => void;

  /** Human-readable name */
  name?: string;

  /** Description */
  description?: string;
}

/**
 * Default context window threshold percentage.
 */
export const DEFAULT_CONTEXT_THRESHOLD = 60;

/**
 * Get the default compaction action for an agent type.
 *
 * @param agentType - The agent type
 * @returns The default compaction action
 */
export function getDefaultCompactionAction(agentType: AgentNodeAgentType): ContextCompactionAction {
  switch (agentType) {
    case "opencode":
      return "summarize";
    case "claude":
      return "recreate";
    case "copilot":
      return "warn";
    default:
      return "warn";
  }
}

/**
 * Convert SDK ContextUsage to graph ContextWindowUsage.
 *
 * @param usage - SDK context usage
 * @returns Graph context window usage
 */
export function toContextWindowUsage(usage: ContextUsage): ContextWindowUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    maxTokens: usage.maxTokens,
    usagePercentage: usage.usagePercentage,
  };
}

/**
 * Check if context usage exceeds threshold.
 *
 * @param usage - Context usage to check
 * @param threshold - Threshold percentage (0-100)
 * @returns True if usage exceeds threshold
 */
export function isContextThresholdExceeded(
  usage: ContextUsage | ContextWindowUsage | null,
  threshold: number
): boolean {
  if (!usage) return false;
  return usage.usagePercentage >= threshold;
}

/**
 * Create a context monitoring node that checks and manages context window usage.
 *
 * This node:
 * 1. Gets the current context window usage
 * 2. Checks if usage exceeds the configured threshold
 * 3. Takes appropriate action (summarize, recreate signal, or warn)
 * 4. Updates state with current usage
 *
 * @template TState - The state type for the workflow (must extend ContextMonitoringState)
 * @param config - Context monitoring node configuration
 * @returns A NodeDefinition that monitors context usage
 *
 * @example
 * ```typescript
 * const monitorNode = contextMonitorNode<MyState>({
 *   id: "context-check",
 *   agentType: "opencode",
 *   threshold: 70,
 *   getSession: (state) => state.activeSession,
 * });
 * ```
 */
export function contextMonitorNode<TState extends ContextMonitoringState = ContextMonitoringState>(
  config: ContextMonitorNodeConfig<TState>
): NodeDefinition<TState> {
  const {
    id,
    agentType,
    threshold = DEFAULT_CONTEXT_THRESHOLD,
    action = getDefaultCompactionAction(agentType),
    getSession,
    getContextUsage: customGetContextUsage,
    onCompaction,
    name,
    description,
  } = config;

  return {
    id,
    type: "tool",
    name: name ?? "context-monitor",
    description: description ?? `Monitor context window usage (threshold: ${threshold}%)`,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      // Get context usage
      let usage: ContextUsage | null = null;

      if (customGetContextUsage) {
        usage = await customGetContextUsage(ctx.state);
      } else if (getSession) {
        const session = getSession(ctx.state);
        if (session) {
          usage = await session.getContextUsage();
        }
      } else {
        // Try to use contextWindowUsage from execution context
        if (ctx.contextWindowUsage) {
          usage = {
            inputTokens: ctx.contextWindowUsage.inputTokens,
            outputTokens: ctx.contextWindowUsage.outputTokens,
            maxTokens: ctx.contextWindowUsage.maxTokens,
            usagePercentage: ctx.contextWindowUsage.usagePercentage,
          };
        }
      }

      // Build state update with current usage
      const stateUpdate: Partial<TState> = {
        contextWindowUsage: usage ? toContextWindowUsage(usage) : null,
      } as Partial<TState>;

      // Check if threshold is exceeded
      if (!isContextThresholdExceeded(usage, threshold)) {
        // Under threshold, no action needed
        return { stateUpdate };
      }

      // Threshold exceeded - take action
      const signals: SignalData[] = [];

      switch (action) {
        case "summarize": {
          // OpenCode: call session.summarize()
          const session = getSession?.(ctx.state);
          if (session) {
            try {
              await session.summarize();
              onCompaction?.(usage!, action);
              
              // Get updated usage after summarization
              const newUsage = await session.getContextUsage();
              stateUpdate.contextWindowUsage = newUsage ? toContextWindowUsage(newUsage) : null;
            } catch (error) {
              // If summarize fails, emit warning instead
              signals.push({
                type: "context_window_warning",
                message: `Context compaction failed: ${error instanceof Error ? error.message : String(error)}`,
                data: {
                  usagePercentage: usage!.usagePercentage,
                  threshold,
                  action: "summarize",
                  error: true,
                },
              });
            }
          } else {
            // No session available, emit warning
            signals.push({
              type: "context_window_warning",
              message: `Context usage at ${usage!.usagePercentage.toFixed(1)}% (no session for summarization)`,
              data: {
                usagePercentage: usage!.usagePercentage,
                threshold,
                action: "warn",
              },
            });
          }
          break;
        }

        case "recreate": {
          // Claude: signal that session should be recreated
          onCompaction?.(usage!, action);
          signals.push({
            type: "context_window_warning",
            message: `Context usage at ${usage!.usagePercentage.toFixed(1)}% - session recreation recommended`,
            data: {
              usagePercentage: usage!.usagePercentage,
              threshold,
              action: "recreate",
              shouldRecreateSession: true,
            },
          });
          break;
        }

        case "warn": {
          // Emit warning signal only
          signals.push({
            type: "context_window_warning",
            message: `Context usage at ${usage!.usagePercentage.toFixed(1)}%`,
            data: {
              usagePercentage: usage!.usagePercentage,
              threshold,
              action: "warn",
            },
          });
          break;
        }

        case "none":
          // Do nothing
          break;
      }

      return {
        stateUpdate,
        signals: signals.length > 0 ? signals : undefined,
      };
    },
  };
}

/**
 * Options for creating a simple context check.
 */
export interface ContextCheckOptions {
  /** Threshold percentage (default: 60) */
  threshold?: number;
  /** Whether to emit a signal when threshold is exceeded (default: true) */
  emitSignal?: boolean;
}

/**
 * Simple helper to check context usage against a threshold.
 * Returns true if usage exceeds threshold.
 *
 * @param session - Session to check
 * @param options - Check options
 * @returns Object with exceeded flag and current usage
 */
export async function checkContextUsage(
  session: Session,
  options: ContextCheckOptions = {}
): Promise<{ exceeded: boolean; usage: ContextUsage }> {
  const { threshold = DEFAULT_CONTEXT_THRESHOLD } = options;
  const usage = await session.getContextUsage();
  const exceeded = isContextThresholdExceeded(usage, threshold);
  return { exceeded, usage };
}

/**
 * Perform context compaction on a session based on agent type.
 *
 * @param session - Session to compact
 * @param agentType - Type of agent
 * @returns True if compaction was performed
 */
export async function compactContext(
  session: Session,
  agentType: AgentNodeAgentType
): Promise<boolean> {
  const action = getDefaultCompactionAction(agentType);
  
  if (action === "summarize") {
    await session.summarize();
    return true;
  }
  
  // "recreate" and "warn" don't perform automatic compaction
  return false;
}
