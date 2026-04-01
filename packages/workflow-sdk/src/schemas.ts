/**
 * Workflow SDK Zod Schemas
 *
 * Runtime-validated schemas for core workflow data structures.
 * These schemas serve as the single source of truth for data shapes
 * that flow between stages, replacing ad-hoc duck-typing with
 * proper validation.
 *
 * Each schema exports:
 * - A Zod schema object (e.g., `TaskItemSchema`)
 * - An inferred TypeScript type (e.g., `TaskItem`)
 *
 * Usage in workflows:
 * ```ts
 * import { TaskItemSchema } from "@bastani/atomic-workflows";
 *
 * const tasks = TaskItemSchema.array().parse(rawTasks);
 * ```
 */

import { z } from "zod";

import type { JsonValue } from "./types.ts";

// ---------------------------------------------------------------------------
// Recursive JSON value schema
// ---------------------------------------------------------------------------

/**
 * Recursive Zod schema matching the {@link JsonValue} type.
 *
 * Explicitly enumerates permitted JSON primitives and recursive
 * structures instead of using `z.json()` which also accepts
 * `undefined` and other non-JSON-serializable values.
 */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

// ---------------------------------------------------------------------------
// Task Items
// ---------------------------------------------------------------------------

/**
 * Schema for a single task item in the workflow task list.
 * Tasks are populated after the planner stage and updated throughout
 * execution by the conductor.
 */
export const TaskItemSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  status: z.string(),
  summary: z.string(),
  blockedBy: z.array(z.string()).optional(),
});

/** A validated task item. Inferred from {@link TaskItemSchema}. */
export type TaskItem = z.infer<typeof TaskItemSchema>;

// ---------------------------------------------------------------------------
// Stage Output
// ---------------------------------------------------------------------------

/** Valid stage output statuses. */
export const StageOutputStatusSchema = z.enum([
  "completed",
  "interrupted",
  "error",
]);

export type StageOutputStatus = z.infer<typeof StageOutputStatusSchema>;

/**
 * Output produced by a completed workflow stage.
 * Stored per stage and accessible to downstream stages via
 * `StageContext.stageOutputs`.
 */
export const StageOutputSchema = z.object({
  stageId: z.string(),
  rawResponse: z.string(),
  parsedOutput: z.record(z.string(), JsonValueSchema).optional(),
  status: StageOutputStatusSchema,
  error: z.string().optional(),
  originalByteLength: z.number().optional(),
});

export type StageOutput = z.infer<typeof StageOutputSchema>;

// ---------------------------------------------------------------------------
// Signal Data
// ---------------------------------------------------------------------------

/** Known signal types emitted during workflow execution. */
export const SignalTypeSchema = z.enum([
  "checkpoint",
  "human_input_required",
  "debug_report_generated",
]);

export type Signal = z.infer<typeof SignalTypeSchema>;

/**
 * Data attached to a workflow signal emission.
 */
export const SignalDataSchema = z.object({
  type: SignalTypeSchema,
  message: z.string().optional(),
  data: z.record(z.string(), JsonValueSchema).optional(),
});

export type SignalData = z.infer<typeof SignalDataSchema>;

// ---------------------------------------------------------------------------
// Agent Type
// ---------------------------------------------------------------------------

/**
 * Known agent types for per-SDK model and reasoning effort configuration.
 */
export const AgentTypeSchema = z.enum(["claude", "opencode", "copilot"]);

export type AgentType = z.infer<typeof AgentTypeSchema>;

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
 */
export const SessionConfigSchema = z.object({
  model: z.object({
    claude: z.string().optional(),
    opencode: z.string().optional(),
    copilot: z.string().optional(),
  }).partial().optional(),
  sessionId: z.string().optional(),
  systemPrompt: z.string().optional(),
  additionalInstructions: z.string().optional(),
  tools: z.array(z.string()).optional(),
  permissionMode: z.enum(["auto", "prompt", "deny", "bypass"]).optional(),
  maxBudgetUsd: z.number().optional(),
  maxTurns: z.number().optional(),
  reasoningEffort: z.object({
    claude: z.string().optional(),
    opencode: z.string().optional(),
    copilot: z.string().optional(),
  }).partial().optional(),
  maxThinkingTokens: z.number().optional(),
});

export type SessionConfig = z.infer<typeof SessionConfigSchema>;

// ---------------------------------------------------------------------------
// Ask User Question Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a question presented to the user during workflow
 * execution.
 */
export const AskUserQuestionConfigSchema = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    .readonly()
    .optional(),
  multiSelect: z.boolean().optional(),
});

export type AskUserQuestionConfig = z.infer<typeof AskUserQuestionConfigSchema>;
