/**
 * @bastani/atomic-workflows — Workflow SDK
 *
 * Lightweight SDK for defining multi-agent workflows that run in the
 * Atomic CLI. Install this package in your project and create workflow
 * files in `.atomic/workflows/`.
 *
 * @example
 * ```ts
 * import { defineWorkflow } from "@bastani/atomic-workflows";
 *
 * export default defineWorkflow({
 *     name: "my-workflow",
 *     description: "A workflow that does X",
 *   })
 *   .stage({
 *     name: "planner",
 *     agent: "planner",
 *     description: "Plans the work",
 *     prompt: (ctx) => `Plan this: ${ctx.userPrompt}`,
 *     outputMapper: (response) => ({ plan: response }),
 *   })
 *   .compile();
 * ```
 */

export { defineWorkflow, WorkflowBuilder } from "./define-workflow.ts";
export type { WorkflowBlueprint } from "./define-workflow.ts";

// Zod schemas — runtime-validated, single source of truth
export {
  JsonValueSchema,
  TaskItemSchema,
  StageOutputSchema,
  StageOutputStatusSchema,
  SignalTypeSchema,
  SignalDataSchema,
  ContextPressureLevelSchema,
  ContextPressureSnapshotSchema,
  ContinuationRecordSchema,
  AgentTypeSchema,
  SessionConfigSchema,
  AskUserQuestionConfigSchema,
} from "./schemas.ts";

// Types — inferred from schemas + structural interfaces
export type {
  BaseState,
  InferState,
  JsonValue,
  ExecutionContext,
  ExecutionError,
  ErrorAction,
  GraphConfig,
  ModelSpec,
  NodeExecuteFn,
  NodeId,
  NodeResult,
  RetryConfig,
  StageContext,
  StageOptions,
  ToolOptions,
  AskUserQuestionOptions,
  LoopOptions,
  StateFieldOptions,
  StateFieldOptionsBase,
  BuiltinReducer,
  WorkflowOptions,
  CompiledWorkflow,
  // Schema-derived types (re-exported from schemas.ts via types.ts)
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
  AccumulatedContextPressure,
} from "./types.ts";

// Runtime constants
export { BUILTIN_REDUCERS } from "./types.ts";
