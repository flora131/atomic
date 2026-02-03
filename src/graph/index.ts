/**
 * Graph Execution Engine
 *
 * This module exports the graph-based workflow execution engine types and utilities.
 * Used for declarative workflow definitions with support for:
 * - Node-based execution (agents, tools, decisions, waits)
 * - State management with typed annotations
 * - Checkpointing and resumption
 * - Human-in-the-loop interactions
 * - Error handling and retry logic
 */

// Type exports from types.ts
export type {
  // Node types
  NodeId,
  NodeType,
  NodeDefinition,
  NodeExecuteFn,

  // State management
  BaseState,
  ContextWindowUsage,

  // Signals
  Signal,
  SignalData,

  // Error handling
  ExecutionError,
  RetryConfig,
  DebugReport,

  // Node execution
  NodeResult,
  ExecutionContext,

  // Graph configuration
  ProgressEvent,
  GraphConfig,
  Checkpointer,

  // Edge definitions
  EdgeCondition,
  Edge,

  // Compiled graph
  CompiledGraph,

  // Execution state
  ExecutionStatus,
  ExecutionSnapshot,

  // Utility types
  StateOf,
  StateUpdate,
} from "./types.ts";

// Value exports from types.ts
export {
  // Type guards
  isNodeType,
  isSignal,
  isExecutionStatus,
  isBaseState,
  isNodeResult,
  isDebugReport,

  // Default configurations
  DEFAULT_RETRY_CONFIG,
  DEFAULT_GRAPH_CONFIG,
} from "./types.ts";

// Type exports from annotation.ts
export type {
  // Annotation types
  Reducer,
  Annotation,
  AnnotationRoot,
  ValueOf,
  StateFromAnnotation,

  // Atomic workflow types
  Feature,
  AtomicWorkflowState,

  // Ralph workflow types
  RalphWorkflowState,
} from "./annotation.ts";

// Value exports from annotation.ts
export {
  // Reducers
  Reducers,

  // Annotation factory
  annotation,
  getDefaultValue,
  applyReducer,

  // State management
  initializeState,
  applyStateUpdate,

  // Atomic workflow
  AtomicStateAnnotation,
  createAtomicState,
  updateAtomicState,

  // Ralph workflow
  RalphStateAnnotation,
  createRalphState,
  updateRalphState,

  // Type guards
  isFeature,
  isAtomicWorkflowState,
  isRalphWorkflowState,
} from "./annotation.ts";

// Type exports from builder.ts
export type {
  // Loop and parallel configuration
  LoopConfig,
  MergeStrategy,
  ParallelConfig,
} from "./builder.ts";

// Value exports from builder.ts
export {
  // GraphBuilder class
  GraphBuilder,

  // Factory function
  graph,

  // Helper functions
  createNode,
  createDecisionNode,
  createWaitNode,
} from "./builder.ts";

// Type exports from nodes.ts
export type {
  // Agent node types
  AgentNodeAgentType,
  OutputMapper,
  AgentNodeConfig,
  ClientProvider,

  // Tool node types
  ToolExecuteFn,
  ToolOutputMapper,
  ToolNodeConfig,

  // Decision node types
  DecisionRoute,
  DecisionNodeConfig,

  // Wait node types
  InputMapper,
  WaitNodeConfig,

  // Clear context node types
  ClearContextNodeConfig,

  // Ask user node types
  AskUserOption,
  AskUserOptions,
  AskUserNodeConfig,
  AskUserWaitState,
  AskUserQuestionEventData,

  // Parallel node types
  ParallelMergeStrategy,
  ParallelMerger,
  ParallelNodeConfig,
  ParallelExecutionContext,

  // Subgraph node types
  CompiledSubgraph,
  SubgraphRef,
  SubgraphNodeConfig,
  WorkflowResolver,

  // Context monitoring types
  ContextCompactionAction,
  ContextMonitoringState,
  ContextMonitorNodeConfig,
  ContextCheckOptions,
} from "./nodes.ts";

// Value exports from nodes.ts
export {
  // Client provider
  setClientProvider,
  getClientProvider,

  // Workflow resolver for subgraph nodes
  setWorkflowResolver,
  getWorkflowResolver,

  // Default configurations
  AGENT_NODE_RETRY_CONFIG,
  DEFAULT_CONTEXT_THRESHOLD,

  // Node factory functions
  agentNode,
  toolNode,
  clearContextNode,
  decisionNode,
  waitNode,
  askUserNode,
  parallelNode,
  subgraphNode,
  contextMonitorNode,

  // Context monitoring helpers
  getDefaultCompactionAction,
  toContextWindowUsage,
  isContextThresholdExceeded,
  checkContextUsage,
  compactContext,
} from "./nodes.ts";

// Type exports from compiled.ts
export type {
  // Execution types
  ExecutionOptions,
  StepResult,
  ExecutionResult,
} from "./compiled.ts";

// Value exports from compiled.ts
export {
  // Helper functions
  isLoopNode,
  initializeExecutionState,
  mergeState,

  // Executor class
  GraphExecutor,

  // Factory functions
  createExecutor,
  executeGraph,
  streamGraph,
} from "./compiled.ts";

// Type exports from checkpointer.ts
export type { CheckpointerType, CreateCheckpointerOptions } from "./checkpointer.ts";

// Value exports from checkpointer.ts
export {
  // Checkpointer implementations
  MemorySaver,
  FileSaver,
  ResearchDirSaver,
  SessionDirSaver,

  // Factory function
  createCheckpointer,
} from "./checkpointer.ts";
