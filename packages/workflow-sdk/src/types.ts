/**
 * Workflow SDK Type Definitions
 *
 * All user-facing types for defining workflows with the chainable DSL.
 * These types mirror the Atomic CLI runtime types so that user workflow
 * files get full IDE support (autocomplete, type checking) without
 * depending on the full CLI codebase.
 *
 * Core data structures (TaskItem, StageOutput, SignalData, SessionConfig,
 * etc.) are defined as Zod schemas in `./schemas.ts` and re-exported here
 * as inferred types. This gives callers both compile-time types and
 * runtime validation from a single source of truth.
 */

import type { z } from "zod";

// ---------------------------------------------------------------------------
// JSON Value — recursive type for all JSON-serializable data
// ---------------------------------------------------------------------------

/**
 * Recursive type covering all JSON-serializable values.
 * Used throughout the SDK instead of `unknown` to express that workflow
 * data flows are always JSON-round-trippable.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// Re-export schema-derived types so they stay in scope for this file
// and for downstream consumers who `import type` from the SDK.
export type {
  TaskItem,
  StageOutput,
  StageOutputStatus,
  Signal,
  SignalData,
  ContextPressureLevel,
  ContextPressureSnapshot,
  ContinuationRecord,
  AgentType,
  SessionConfig,
  AskUserQuestionConfig,
} from "./schemas.ts";

import type {
  SignalData,
  StageOutput,
  ContextPressureSnapshot,
  ContinuationRecord,
  AgentType,
  SessionConfig,
  AskUserQuestionConfig,
  TaskItem,
} from "./schemas.ts";

// ---------------------------------------------------------------------------
// Graph Core
// ---------------------------------------------------------------------------

export type NodeId = string;

export type ModelSpec = string | "inherit";

/**
 * Base workflow state. All workflow state extends this shape.
 * The `outputs` record is keyed by node ID and holds each node's output.
 */
export interface BaseState {
  executionId: string;
  lastUpdated: string;
  outputs: Record<NodeId, Record<string, JsonValue>>;
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
    : never;

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
export type InferState<TSchema extends Record<string, StateFieldOptionsBase>> =
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
  metadata?: Record<string, JsonValue>;
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
  emit?: (type: string, data?: Record<string, JsonValue>) => void;
  getNodeOutput?: (nodeId: NodeId) => Record<string, JsonValue>;
  model?: string;
}

// ---------------------------------------------------------------------------
// Conductor Types (passed to stage prompt/condition callbacks)
// ---------------------------------------------------------------------------

// StageOutputStatus, ContextPressureLevel, ContextPressureSnapshot,
// ContinuationRecord, and StageOutput are defined as Zod schemas in
// ./schemas.ts and re-exported above. See schemas.ts for field docs.

export interface AccumulatedContextPressure {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalContinuations: number;
  readonly stageSnapshots: ReadonlyMap<string, ContextPressureSnapshot>;
  readonly continuations: readonly ContinuationRecord[];
}

// TaskItem is defined as a Zod schema in ./schemas.ts and re-exported above.

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

// AgentType is defined as a Zod schema in ./schemas.ts and re-exported above.

// ---------------------------------------------------------------------------
// Session Configuration
// ---------------------------------------------------------------------------

// SessionConfig is defined as a Zod schema in ./schemas.ts and re-exported above.

// ---------------------------------------------------------------------------
// DSL Stage Options
// ---------------------------------------------------------------------------

export interface StageOptions<TState extends BaseState = BaseState> {
  readonly name: string;
  readonly agent: string | null;
  readonly description: string;
  readonly prompt: (context: StageContext<TState>) => string;
  readonly outputMapper: (response: string) => Record<string, JsonValue>;
  readonly sessionConfig?: Partial<SessionConfig>;
  readonly maxOutputBytes?: number;
}

// ---------------------------------------------------------------------------
// DSL Tool Options
// ---------------------------------------------------------------------------

export interface ToolOptions<TState extends BaseState = BaseState> {
  readonly name: string;
  readonly execute: (
    context: ExecutionContext<TState>,
  ) => Promise<Record<string, JsonValue>>;
  readonly outputMapper?: (result: Record<string, JsonValue>) => Record<string, JsonValue>;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// DSL Ask User Question Options
// ---------------------------------------------------------------------------

// AskUserQuestionConfig is defined as a Zod schema in ./schemas.ts and
// re-exported above.

export interface AskUserQuestionOptions<TState extends BaseState = BaseState> {
  readonly name: string;
  readonly question:
    | AskUserQuestionConfig
    | ((state: TState) => AskUserQuestionConfig);
  readonly description?: string;
  readonly outputMapper?: (answer: string | string[]) => Record<string, JsonValue>;
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

/**
 * Built-in reducer names available for state fields.
 *
 * Defined as a const tuple so the literal union is derived in one place
 * and shared by both `StateFieldOptions<T>` and `StateFieldOptionsBase`.
 */
export const BUILTIN_REDUCERS = [
  "replace",
  "concat",
  "merge",
  "mergeById",
  "max",
  "min",
  "sum",
  "or",
  "and",
] as const;

/** Union of built-in reducer name literals. */
export type BuiltinReducer = (typeof BUILTIN_REDUCERS)[number];

export interface StateFieldOptions<T = JsonValue> {
  readonly default: T | (() => T);
  readonly reducer?: BuiltinReducer | ((current: T, update: T) => T);
  readonly key?: string;
}

/**
 * Non-generic base interface that every concrete `StateFieldOptions<T>`
 * satisfies, regardless of `T`.
 *
 * Used as the generic constraint in `InferState`, `WorkflowOptions`, and
 * `defineWorkflow` so that TypeScript can infer an independent `T` per
 * field in a heterogeneous state schema — without resorting to `any`.
 *
 * ### Why `never` parameters?
 *
 * The reducer callback uses `never` parameters and `JsonValue` return.
 * This works because of **function parameter contravariance**:
 *
 * ```
 *   (current: string[], update: string[]) => string[]
 *   IS assignable to
 *   (current: never, update: never) => JsonValue
 * ```
 *
 * since `never extends string[]` (params) and `string[] extends JsonValue` (return).
 * This lets the base interface accept any concrete `StateFieldOptions<T>`
 * without knowing `T`, enabling heterogeneous state schemas where each
 * field independently infers its own type.
 */
export interface StateFieldOptionsBase {
  readonly default: JsonValue | (() => JsonValue);
  readonly reducer?: BuiltinReducer | ((current: never, update: never) => JsonValue);
  readonly key?: string;
}

// ---------------------------------------------------------------------------
// Workflow Options (passed to defineWorkflow)
// ---------------------------------------------------------------------------

export interface WorkflowOptions<
  TGlobalState extends Record<string, StateFieldOptionsBase> = Record<string, StateFieldOptions>,
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
