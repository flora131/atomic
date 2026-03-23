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
 */
export interface StageContext {
  readonly userPrompt: string;
  readonly stageOutputs: ReadonlyMap<string, StageOutput>;
  readonly tasks: readonly TaskItem[];
  readonly abortSignal: AbortSignal;
  readonly contextPressure?: AccumulatedContextPressure;
}

// ---------------------------------------------------------------------------
// Session Configuration
// ---------------------------------------------------------------------------

/**
 * Agent session configuration overrides.
 * Used in `StageOptions.sessionConfig` to customize per-stage sessions.
 */
export interface SessionConfig {
  model?: string;
  sessionId?: string;
  systemPrompt?: string;
  additionalInstructions?: string;
  tools?: string[];
  permissionMode?: "auto" | "prompt" | "deny" | "bypass";
  maxBudgetUsd?: number;
  maxTurns?: number;
  reasoningEffort?: string;
  maxThinkingTokens?: number;
}

// ---------------------------------------------------------------------------
// DSL Stage Options
// ---------------------------------------------------------------------------

export interface StageOptions {
  readonly name: string;
  readonly agent?: string | null;
  readonly description: string;
  readonly prompt: (context: StageContext) => string;
  readonly outputMapper: (response: string) => Record<string, unknown>;
  readonly sessionConfig?: Partial<SessionConfig>;
  readonly maxOutputBytes?: number;
  readonly reads?: string[];
  readonly outputs?: string[];
}

// ---------------------------------------------------------------------------
// DSL Tool Options
// ---------------------------------------------------------------------------

export interface ToolOptions {
  readonly name: string;
  readonly execute: (
    context: ExecutionContext<BaseState>,
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

export interface AskUserQuestionOptions {
  readonly name: string;
  readonly question:
    | AskUserQuestionConfig
    | ((state: BaseState) => AskUserQuestionConfig);
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

export interface WorkflowOptions {
  readonly name: string;
  readonly description: string;
  readonly globalState?: Record<string, StateFieldOptions>;
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
