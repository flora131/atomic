/**
 * Workflow DSL Module
 *
 * Public API for the chainable workflow definition DSL.
 * Provides the builder pattern entry point, compiler, and state compiler
 * for defining multi-stage workflows with conditional branching and
 * bounded loops.
 *
 * @example
 * ```ts
 * import { defineWorkflow } from "@/services/workflows/dsl";
 *
 * const workflow = defineWorkflow({ name: "my-workflow", description: "Does something" })
 *   .version("1.0.0")
 *   .stage({ name: "planner", agent: "planner", ... })
 *   .compile();
 * ```
 */

export { defineWorkflow, WorkflowBuilder } from "./define-workflow.ts";
export { compileWorkflow } from "./compiler.ts";
export { compileStateSchema, createStateFactory } from "./state-compiler.ts";
export {
  buildAgentLookup,
  clearAgentLookupCache,
  inferAgentTypeFromFilePath,
  readAgentBody,
  readAgentFrontmatterModel,
  resolveStageAgentModel,
  resolveStageAgentModelConfig,
  resolveStageSystemPrompt,
  validateStageAgents,
} from "./agent-resolution.ts";
export type {
  Instruction,
  StageOptions,
  ToolOptions,
  AskUserQuestionConfig,
  AskUserQuestionOptions,
  LoopOptions,
  StateFieldOptions,
  CompiledWorkflow,
  WorkflowBuilderInterface,
  WorkflowOptions,
} from "./types.ts";
