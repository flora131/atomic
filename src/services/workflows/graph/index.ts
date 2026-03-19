/**
 * Graph execution engine public API.
 *
 * Exports are organized by category to keep the SDK surface easy to navigate.
 */

// === Core graph types and utilities ===
export type {
  NodeId,
  NodeType,
  NodeDefinition,
  NodeExecuteFn,
  BaseState,
  ContextWindowUsage,
  Signal,
  SignalData,
  ExecutionError,
  ErrorAction,
  RetryConfig,
  DebugReport,
  NodeResult,
  ExecutionContext,
  ProgressEvent,
  GraphConfig,
  Checkpointer,
  EdgeCondition,
  Edge,
  CompiledGraph,
  ExecutionStatus,
  ExecutionSnapshot,
  StateOf,
  StateUpdate,
  ModelSpec,
  WorkflowToolContext,
  CreateSessionFn,
  SubagentSpawnOptions,
  SubagentStreamResult,
  SubagentToolDetail,
} from "@/services/workflows/graph/types.ts";
export {
  isNodeType,
  isSignal,
  isExecutionStatus,
  isBaseState,
  isNodeResult,
  isDebugReport,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_GRAPH_CONFIG,
  BACKGROUND_COMPACTION_THRESHOLD,
  BUFFER_EXHAUSTION_THRESHOLD,
} from "@/services/workflows/graph/types.ts";

// === State management and annotations ===
export type {
  Reducer,
  Annotation,
  AnnotationRoot,
  ValueOf,
  StateFromAnnotation,
  Feature,
  AtomicWorkflowState,
} from "@/services/workflows/graph/annotation.ts";
export {
  Reducers,
  annotation,
  getDefaultValue,
  applyReducer,
  initializeState,
  applyStateUpdate,
  AtomicStateAnnotation,
  createAtomicState,
  updateAtomicState,
  isFeature,
  isAtomicWorkflowState,
} from "@/services/workflows/graph/annotation.ts";

// === Builder and node factories ===
export type { LoopConfig, MergeStrategy, ParallelConfig, SubAgentConfig, ToolBuilderConfig, IfConfig } from "@/services/workflows/graph/builder.ts";
export {
  GraphBuilder,
  graph,
  createNode,
  createDecisionNode,
  createWaitNode,
} from "@/services/workflows/graph/builder.ts";

// --- Agent nodes ---
export type {
  OutputMapper,
  AgentNodeConfig,
  ClientProvider,
} from "@/services/workflows/graph/nodes/agent.ts";
export {
  AGENT_NODE_RETRY_CONFIG,
  agentNode,
} from "@/services/workflows/graph/nodes/agent.ts";

// --- Tool nodes ---
export type {
  ToolExecuteFn,
  ToolOutputMapper,
  ToolNodeConfig,
  CustomToolNodeConfig,
} from "@/services/workflows/graph/nodes/tool.ts";
export {
  toolNode,
  customToolNode,
} from "@/services/workflows/graph/nodes/tool.ts";

// --- Control nodes ---
export type {
  DecisionRoute,
  DecisionNodeConfig,
  InputMapper,
  WaitNodeConfig,
  ClearContextNodeConfig,
  AskUserOption,
  AskUserOptions,
  AskUserNodeConfig,
  AskUserWaitState,
  AskUserQuestionEventData,
} from "@/services/workflows/graph/nodes/control.ts";
export {
  clearContextNode,
  decisionNode,
  waitNode,
  askUserNode,
} from "@/services/workflows/graph/nodes/control.ts";

// --- Parallel nodes ---
export type {
  ParallelMergeStrategy,
  ParallelMerger,
  ParallelNodeConfig,
  ParallelExecutionContext,
  ParallelSubagentNodeConfig,
} from "@/services/workflows/graph/nodes/parallel.ts";
export {
  parallelNode,
  parallelSubagentNode,
} from "@/services/workflows/graph/nodes/parallel.ts";

// --- Subgraph nodes ---
export type {
  CompiledSubgraph,
  SubgraphRef,
  SubgraphNodeConfig,
  WorkflowResolver,
} from "@/services/workflows/graph/nodes/subgraph.ts";
export {
  subgraphNode,
} from "@/services/workflows/graph/nodes/subgraph.ts";

// --- Context nodes ---
export type {
  ContextCompactionAction,
  ContextMonitoringState,
  ContextMonitorNodeConfig,
  ContextCheckOptions,
} from "@/services/workflows/graph/nodes/context.ts";
export {
  contextMonitorNode,
  getDefaultCompactionAction,
  toContextWindowUsage,
  isContextThresholdExceeded,
  checkContextUsage,
  compactContext,
} from "@/services/workflows/graph/nodes/context.ts";

// --- Subagent nodes ---
export type {
  SubagentNodeConfig,
} from "@/services/workflows/graph/nodes/subagent.ts";
export {
  subagentNode,
} from "@/services/workflows/graph/nodes/subagent.ts";

// === Workflow templates ===
export type { MapReduceOptions, ReviewCycleOptions, TaskLoopOptions } from "@/services/workflows/graph/templates.ts";
export { sequential, mapReduce, reviewCycle, taskLoop } from "@/services/workflows/graph/templates.ts";

// === Execution and streaming ===
export type {
  ExecutionOptions,
  EmittedEvent,
  StepResult,
  ExecutionResult,
} from "@/services/workflows/graph/compiled.ts";
export {
  isLoopNode,
  initializeExecutionState,
  mergeState,
  GraphExecutor,
  createExecutor,
  executeGraph,
  streamGraph,
} from "@/services/workflows/graph/compiled.ts";
export type {
  StreamMode,
  StreamOptions,
  CustomEvent,
  DebugTrace,
  StreamEvent,
} from "@/services/workflows/graph/stream.ts";
export { StreamRouter, routeStream } from "@/services/workflows/graph/stream.ts";

// === Validation and errors ===
export type { StateValidatorConfig } from "@/services/workflows/graph/state-validator.ts";
export { StateValidator } from "@/services/workflows/graph/state-validator.ts";
export type { ErrorFeedback } from "@/services/workflows/graph/errors.ts";
export { SchemaValidationError, NodeExecutionError } from "@/services/workflows/graph/errors.ts";

// === Checkpointing ===
export type { CheckpointerType, CreateCheckpointerOptions } from "@/services/workflows/graph/checkpointer.ts";
export {
  MemorySaver,
  FileSaver,
  ResearchDirSaver,
  SessionDirSaver,
  createCheckpointer,
} from "@/services/workflows/graph/checkpointer.ts";

// === Providers ===
export type { AgentProvider } from "@/services/workflows/graph/provider-registry.ts";
export { ProviderRegistry } from "@/services/workflows/graph/provider-registry.ts";
export type {
  ClaudeAgentProviderOptions,
  OpenCodeAgentProviderOptions,
  CopilotAgentProviderOptions,
  DefaultProviderRegistryOptions,
} from "@/services/workflows/graph/agent-providers.ts";
export {
  ClientBackedAgentProvider,
  createClaudeAgentProvider,
  createOpenCodeAgentProvider,
  createCopilotAgentProvider,
  createDefaultProviderRegistry,
} from "@/services/workflows/graph/agent-providers.ts";

// === Subagent orchestration ===
export type { SubagentEntry } from "@/services/workflows/graph/subagent-registry.ts";
export { SubagentTypeRegistry, populateSubagentRegistry } from "@/services/workflows/graph/subagent-registry.ts";
