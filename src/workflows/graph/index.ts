/**
 * Graph execution engine public API.
 *
 * Exports are organized by category to keep the SDK surface easy to navigate.
 */

// === Core SDK ===
export type { WorkflowRegistration, WorkflowSDKConfig } from "./sdk.ts";
export { WorkflowSDK } from "./sdk.ts";

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
} from "./types.ts";
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
} from "./types.ts";

// === State management and annotations ===
export type {
  Reducer,
  Annotation,
  AnnotationRoot,
  ValueOf,
  StateFromAnnotation,
  Feature,
  AtomicWorkflowState,
} from "./annotation.ts";
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
} from "./annotation.ts";

// === Builder and node factories ===
export type { LoopConfig, MergeStrategy, ParallelConfig } from "./builder.ts";
export {
  GraphBuilder,
  graph,
  createNode,
  createDecisionNode,
  createWaitNode,
} from "./builder.ts";
export type {
  OutputMapper,
  AgentNodeConfig,
  ClientProvider,
  ToolExecuteFn,
  ToolOutputMapper,
  ToolNodeConfig,
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
  ParallelMergeStrategy,
  ParallelMerger,
  ParallelNodeConfig,
  ParallelExecutionContext,
  CompiledSubgraph,
  SubgraphRef,
  SubgraphNodeConfig,
  WorkflowResolver,
  ContextCompactionAction,
  ContextMonitoringState,
  ContextMonitorNodeConfig,
  ContextCheckOptions,
  CustomToolNodeConfig,
  SubagentNodeConfig,
  ParallelSubagentNodeConfig,
} from "./nodes.ts";
export {
  AGENT_NODE_RETRY_CONFIG,
  agentNode,
  toolNode,
  clearContextNode,
  decisionNode,
  waitNode,
  askUserNode,
  parallelNode,
  subgraphNode,
  contextMonitorNode,
  getDefaultCompactionAction,
  toContextWindowUsage,
  isContextThresholdExceeded,
  checkContextUsage,
  compactContext,
  customToolNode,
  subagentNode,
  parallelSubagentNode,
} from "./nodes.ts";

// === Workflow templates ===
export type { MapReduceOptions, ReviewCycleOptions, TaskLoopOptions } from "./templates.ts";
export { sequential, mapReduce, reviewCycle, taskLoop } from "./templates.ts";

// === Execution and streaming ===
export type {
  ExecutionOptions,
  EmittedEvent,
  StepResult,
  ExecutionResult,
} from "./compiled.ts";
export {
  isLoopNode,
  initializeExecutionState,
  mergeState,
  GraphExecutor,
  createExecutor,
  executeGraph,
  streamGraph,
} from "./compiled.ts";
export type {
  StreamMode,
  StreamOptions,
  CustomEvent,
  DebugTrace,
  StreamEvent,
} from "./stream.ts";
export { StreamRouter, routeStream } from "./stream.ts";

// === Validation and errors ===
export type { StateValidatorConfig } from "./state-validator.ts";
export { StateValidator } from "./state-validator.ts";
export type { ErrorFeedback } from "./errors.ts";
export { SchemaValidationError, NodeExecutionError } from "./errors.ts";

// === Checkpointing ===
export type { CheckpointerType, CreateCheckpointerOptions } from "./checkpointer.ts";
export {
  MemorySaver,
  FileSaver,
  ResearchDirSaver,
  SessionDirSaver,
  createCheckpointer,
} from "./checkpointer.ts";

// === Providers ===
export type { AgentProvider } from "./provider-registry.ts";
export { ProviderRegistry } from "./provider-registry.ts";
export type {
  ClaudeAgentProviderOptions,
  OpenCodeAgentProviderOptions,
  CopilotAgentProviderOptions,
  DefaultProviderRegistryOptions,
} from "./agent-providers.ts";
export {
  ClientBackedAgentProvider,
  createClaudeAgentProvider,
  createOpenCodeAgentProvider,
  createCopilotAgentProvider,
  createDefaultProviderRegistry,
} from "./agent-providers.ts";

// === Subagent orchestration ===
export type { SubagentEntry } from "./subagent-registry.ts";
export { SubagentTypeRegistry, populateSubagentRegistry } from "./subagent-registry.ts";
export { SubagentGraphBridge } from "./subagent-bridge.ts";
