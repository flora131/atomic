/**
 * Workflow SDK Type Definitions
 *
 * All user-facing types for defining workflows with the chainable DSL.
 * These types mirror the Atomic CLI runtime types so that user workflow
 * files get full IDE support (autocomplete, type checking) without
 * depending on the full CLI codebase.
 */

import type { z } from "zod";

// ---------------------------------------------------------------------------
// Graph Core
// ---------------------------------------------------------------------------

export type NodeId = string;

export type ModelSpec = string | "inherit";

export type Signal =
  | "context_window_warning"
  | "checkpoint"
  | "human_input_required"
  | "debug_report_generated";

export interface SignalData {
  type: Signal;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Base workflow state. All workflow state extends this shape.
 * The `outputs` record is keyed by node ID and holds each node's output.
 */
export interface BaseState {
  executionId: string;
  lastUpdated: string;
  outputs: Record<NodeId, unknown>;
}

// ---------------------------------------------------------------------------
// State Type Inference
// ---------------------------------------------------------------------------

/**
 * Widen TypeScript literal types to their base types.
 *
 * When TypeScript infers generic type parameters from object literals,
 * it may produce narrow literal types (e.g., `false` instead of `boolean`,
 * `""` instead of `string`). This utility widens them so that inferred
 * state fields have practical types.
 */
type Widen<T> =
  T extends string ? string :
  T extends number ? number :
  T extends boolean ? boolean :
  T extends bigint ? bigint :
  T extends symbol ? symbol :
  T;

/**
 * Extract the value type from a single `StateFieldOptions` definition.
 *
 * - For a static default `{ default: false }`, extracts and widens the type.
 * - For a factory default `{ default: () => [] }`, extracts and widens the return type.
 */
type InferFieldType<F> =
  F extends StateFieldOptions<infer V>
    ? V extends (...args: never[]) => infer R ? Widen<R> : Widen<V>
    : unknown;

/**
 * Infer the full workflow state type from a `globalState` schema.
 *
 * Produces `BaseState & { field1: Type1; field2: Type2; ... }` where
 * each field's type is derived from its `StateFieldOptions.default` value.
 *
 * @example
 * ```ts
 * const schema = {
 *   count: { default: 0, reducer: "sum" as const },
 *   approved: { default: false },
 *   items: { default: [] as string[], reducer: "concat" as const },
 * };
 * type S = InferState<typeof schema>;
 * // S = BaseState & { count: number; approved: boolean; items: string[] }
 * ```
 */
export type InferState<TSchema extends Record<string, StateFieldOptions<any>>> =
  BaseState & { [K in keyof TSchema]: InferFieldType<TSchema[K]> };

export interface ExecutionError {
  nodeId: NodeId;
  error: Error | string;
  timestamp: string;
  attempt: number;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryOn?: (error: Error) => boolean;
}

export type ErrorAction<TState extends BaseState = BaseState> =
  | { action: "retry"; delay?: number }
  | { action: "skip"; fallbackState?: Partial<TState> }
  | { action: "abort"; error?: Error }
  | { action: "goto"; nodeId: NodeId };

// ---------------------------------------------------------------------------
// Graph Runtime
// ---------------------------------------------------------------------------

/**
 * Result returned from a graph node execution.
 */
export interface NodeResult<TState extends BaseState = BaseState> {
  stateUpdate?: Partial<TState>;
  goto?: NodeId | NodeId[];
  signals?: SignalData[];
}

/**
 * Graph configuration for workflow execution.
 */
export interface GraphConfig<TState extends BaseState = BaseState> {
  maxConcurrency?: number;
  timeout?: number;
  contextWindowThreshold?: number;
  autoCheckpoint?: boolean;
  metadata?: Record<string, unknown>;
  defaultModel?: ModelSpec;
  outputSchema?: z.ZodType<TState>;
}

/**
 * Execute function signature for graph nodes.
 */
export type NodeExecuteFn<TState extends BaseState = BaseState> = (
  context: ExecutionContext<TState>,
) => Promise<NodeResult<TState>>;

// ---------------------------------------------------------------------------
// Execution Context (passed to tool execute functions)
// ---------------------------------------------------------------------------

/**
 * Context provided to tool node `execute` functions.
 *
 * The most commonly used field is `state`, which gives access to the
 * current workflow state including outputs from prior nodes.
 */
export interface ExecutionContext<TState extends BaseState = BaseState> {
  state: TState;
  config: GraphConfig<TState>;
  errors: ExecutionError[];
  abortSignal?: AbortSignal;
  emit?: (type: string, data?: Record<string, unknown>) => void;
  getNodeOutput?: (nodeId: NodeId) => unknown;
  model?: string;
}

// ---------------------------------------------------------------------------
// Conductor Types (passed to stage prompt/condition callbacks)
// ---------------------------------------------------------------------------

export type StageOutputStatus = "completed" | "interrupted" | "error";

export type ContextPressureLevel = "normal" | "elevated" | "critical";

export interface ContextPressureSnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly maxTokens: number;
  readonly usagePercentage: number;
  readonly level: ContextPressureLevel;
  readonly timestamp: string;
}

export interface ContinuationRecord {
  readonly stageId: string;
  readonly continuationIndex: number;
  readonly triggerSnapshot: ContextPressureSnapshot;
  readonly partialResponse: string;
  readonly timestamp: string;
}

export interface StageOutput {
  readonly stageId: string;
  readonly rawResponse: string;
  readonly parsedOutput?: unknown;
  readonly status: StageOutputStatus;
  readonly error?: string;
  readonly contextUsage?: ContextPressureSnapshot;
  readonly continuations?: readonly ContinuationRecord[];
  readonly originalByteLength?: number;
}

export interface AccumulatedContextPressure {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalContinuations: number;
  readonly stageSnapshots: ReadonlyMap<string, ContextPressureSnapshot>;
  readonly continuations: readonly ContinuationRecord[];
}

/**
 * Task item in the workflow task list.
 * Populated after the planner stage and updated throughout execution.
 */
export interface TaskItem {
  id?: string;
  description: string;
  status: string;
  summary: string;
  blockedBy?: string[];
}

/**
 * Read-only context provided to stage prompt builders and conditional
 * callbacks (`.if()`, `.elseIf()`).
 *
 * @typeParam TState - The workflow state type (inferred from `globalState`).
 */
export interface StageContext<TState extends BaseState = BaseState> {
  readonly userPrompt: string;
  readonly stageOutputs: ReadonlyMap<string, StageOutput>;
  readonly tasks: readonly TaskItem[];
  readonly abortSignal: AbortSignal;
  readonly contextPressure?: AccumulatedContextPressure;
  readonly state: TState;
}

// ---------------------------------------------------------------------------
// Agent Type
// ---------------------------------------------------------------------------

/**
 * Known agent types. Matches the keys in `settings.schema.json`'s
 * `model` and `reasoningEffort` objects.
 */
export type AgentType = "claude" | "opencode" | "copilot";

// ---------------------------------------------------------------------------
// Session Configuration
// ---------------------------------------------------------------------------

/**
 * Agent session configuration overrides.
 * Used in `StageOptions.sessionConfig` to customize per-stage sessions.
 *
 * `model` and `reasoningEffort` are keyed by agent type so that a single
 * workflow definition can declare per-SDK overrides (SDK-agnostic). At
 * runtime, the conductor resolves the correct entry for the active agent.
 *
 * When a stage omits `model` / `reasoningEffort`, the user's currently
 * selected model and reasoning level (from `~/.atomic/settings.json` or
 * `.atomic/settings.json`) are used as defaults.
 *
 * @example
 * ```ts
 * sessionConfig: {
 *   model: { claude: "claude-opus-4.6-1m", copilot: "claude-sonnet-4" },
 *   reasoningEffort: { claude: "high" },
 * }
 * ```
 */
export interface SessionConfig {
  model?: Partial<Record<AgentType, string>>;
  sessionId?: string;
  systemPrompt?: string;
  additionalInstructions?: string;
  tools?: string[];
  permissionMode?: "auto" | "prompt" | "deny" | "bypass";
  maxBudgetUsd?: number;
  maxTurns?: number;
  reasoningEffort?: Partial<Record<AgentType, string>>;
  maxThinkingTokens?: number;
}

// ---------------------------------------------------------------------------
// DSL Stage Options
// ---------------------------------------------------------------------------

export interface StageOptions<TState extends BaseState = BaseState> {
  readonly name: string;
  readonly agent?: string | null;
  readonly description: string;
  readonly prompt: (context: StageContext<TState>) => string;
  readonly outputMapper: (response: string) => Record<string, unknown>;
  readonly sessionConfig?: Partial<SessionConfig>;
  readonly maxOutputBytes?: number;
  readonly reads?: string[];
  readonly outputs?: string[];
}

// ---------------------------------------------------------------------------
// DSL Tool Options
// ---------------------------------------------------------------------------

export interface ToolOptions<TState extends BaseState = BaseState> {
  readonly name: string;
  readonly execute: (
    context: ExecutionContext<TState>,
  ) => Promise<Record<string, unknown>>;
  readonly description?: string;
  readonly reads?: string[];
  readonly outputs?: string[];
}

// ---------------------------------------------------------------------------
// DSL Ask User Question Options
// ---------------------------------------------------------------------------

export interface AskUserQuestionConfig {
  readonly question: string;
  readonly header?: string;
  readonly options?: ReadonlyArray<{
    readonly label: string;
    readonly description?: string;
  }>;
  readonly multiSelect?: boolean;
}

export interface AskUserQuestionOptions<TState extends BaseState = BaseState> {
  readonly name: string;
  readonly question:
    | AskUserQuestionConfig
    | ((state: TState) => AskUserQuestionConfig);
  readonly description?: string;
  readonly onAnswer?: (answer: string | string[]) => Record<string, unknown>;
  readonly reads?: string[];
  readonly outputs?: string[];
}

// ---------------------------------------------------------------------------
// DSL Loop Options
// ---------------------------------------------------------------------------

export interface LoopOptions {
  readonly maxCycles?: number;
  readonly loopState?: Record<string, StateFieldOptions>;
}

// ---------------------------------------------------------------------------
// State Field Options
// ---------------------------------------------------------------------------

export interface StateFieldOptions<T = unknown> {
  readonly default: T | (() => T);
  readonly reducer?:
    | "replace"
    | "concat"
    | "merge"
    | "mergeById"
    | "max"
    | "min"
    | "sum"
    | "or"
    | "and"
    | ((current: T, update: T) => T);
  readonly key?: string;
}

// ---------------------------------------------------------------------------
// Workflow Options (passed to defineWorkflow)
// ---------------------------------------------------------------------------

export interface WorkflowOptions<
  TGlobalState extends Record<string, StateFieldOptions<any>> = Record<string, StateFieldOptions>,
> {
  readonly name: string;
  readonly description: string;
  readonly globalState?: TGlobalState;
}

// ---------------------------------------------------------------------------
// Compiled Workflow (opaque return type of .compile())
// ---------------------------------------------------------------------------

/**
 * Opaque branded type returned by `.compile()`.
 *
 * Export this value as the default export (or a named export) from your
 * workflow file. The Atomic CLI binary detects the brand and compiles
 * the workflow at load time.
 *
 * ```ts
 * export default defineWorkflow({ ... }).stage({ ... }).compile();
 * ```
 */
export interface CompiledWorkflow {
  readonly __compiledWorkflow: true;
  readonly name: string;
  readonly description: string;
}
