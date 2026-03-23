/**
 * @bastani/atomic — Workflow SDK
 *
 * Lightweight SDK for defining multi-agent workflows that run in the
 * Atomic CLI. Install this package in your project and create workflow
 * files in `.atomic/workflows/`.
 *
 * @example
 * ```ts
 * import { defineWorkflow } from "@bastani/atomic";
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
export type {
  BaseState,
  ExecutionContext,
  ExecutionError,
  ErrorAction,
  GraphConfig,
  ModelSpec,
  NodeExecuteFn,
  NodeId,
  NodeResult,
  RetryConfig,
  Signal,
  SignalData,
  StageContext,
  StageOutput,
  StageOutputStatus,
  TaskItem,
  ContextPressureSnapshot,
  ContextPressureLevel,
  ContinuationRecord,
  AccumulatedContextPressure,
  SessionConfig,
  StageOptions,
  ToolOptions,
  AskUserQuestionConfig,
  AskUserQuestionOptions,
  LoopOptions,
  StateFieldOptions,
  WorkflowOptions,
  CompiledWorkflow,
} from "./types.ts";
