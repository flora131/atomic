/**
 * Conductor Type Definitions
 *
 * Core types for the WorkflowSessionConductor — a lightweight state machine
 * that sequences isolated context-window stages (PLANNER → ORCHESTRATOR →
 * REVIEWER → DEBUGGER). Each stage runs in a fresh agent session with a
 * targeted prompt, and the orchestrator stage delegates parallel task
 * execution to the agent's native sub-agent capabilities.
 *
 * These types define the contracts between:
 * - Stage authors (who declare prompts, parsers, and run conditions)
 * - The conductor (which creates sessions, captures output, and routes)
 * - The UI layer (which receives stage transition and task update callbacks)
 *
 * @see specs/ralph-workflow-redesign.md §5.1 for the full design.
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type { Session, SessionConfig } from "@/services/agents/types.ts";
import type { TaskItem } from "@/services/workflows/ralph/prompts.ts";

// ---------------------------------------------------------------------------
// Stage Output Status
// ---------------------------------------------------------------------------

/** Terminal status for a completed stage. */
export type StageOutputStatus = "completed" | "interrupted" | "error";

/** All valid StageOutputStatus values (used by guards). */
export const STAGE_OUTPUT_STATUSES: readonly StageOutputStatus[] = [
  "completed",
  "interrupted",
  "error",
] as const;

// ---------------------------------------------------------------------------
// StageOutput — captured result of a single stage execution
// ---------------------------------------------------------------------------

/**
 * Immutable result captured after a stage completes (or fails/interrupts).
 *
 * The conductor stores one `StageOutput` per executed stage, keyed by
 * `stageId`. Downstream stages access prior outputs via
 * `StageContext.stageOutputs`.
 */
export interface StageOutput {
  /** ID of the stage that produced this output. */
  readonly stageId: string;

  /** Raw assistant response text captured from the session. */
  readonly rawResponse: string;

  /**
   * Structured data extracted by the stage's `parseOutput` function.
   * `undefined` when the stage has no parser or parsing failed.
   */
  readonly parsedOutput?: unknown;

  /** How the stage terminated. */
  readonly status: StageOutputStatus;

  /** Error message when `status === "error"`. */
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// StageContext — read-only snapshot passed into stage prompt builders
// ---------------------------------------------------------------------------

/**
 * Read-only context provided to `StageDefinition.buildPrompt` and
 * `StageDefinition.shouldRun`. Contains everything a stage needs to
 * construct its prompt: the user's original request, outputs from prior
 * stages, the current task list, and a cancellation signal.
 */
export interface StageContext {
  /** The user's original prompt that initiated the workflow. */
  readonly userPrompt: string;

  /**
   * Outputs from all previously-completed stages, keyed by stage ID.
   * Stages read prior outputs to chain context forward.
   */
  readonly stageOutputs: ReadonlyMap<string, StageOutput>;

  /** Current task list (populated after the planner stage parses tasks). */
  readonly tasks: readonly TaskItem[];

  /** Cancellation signal — stages should check this for early exit. */
  readonly abortSignal: AbortSignal;
}

// ---------------------------------------------------------------------------
// StageDefinition — declares a single workflow stage
// ---------------------------------------------------------------------------

/**
 * Declares a single workflow stage's prompt builder, output parser,
 * run condition, and UI indicator.
 *
 * Stage definitions are authored via the fluent `GraphBuilder` DSL
 * (`.subagent()` calls) and interpreted by the conductor at execution
 * time. Each `"agent"` node in the compiled graph corresponds to one
 * `StageDefinition`.
 */
export interface StageDefinition {
  /** Unique identifier for this stage (matches the graph node ID). */
  readonly id: string;

  /** Human-readable name (e.g., "Planner", "Orchestrator"). */
  readonly name: string;

  /**
   * UI indicator displayed in the chat during this stage.
   * @example "[PLANNER]", "⚡ ORCHESTRATOR", "🔍 REVIEWER"
   */
  readonly indicator: string;

  /**
   * Builds the prompt sent to the fresh session for this stage.
   * Receives the full `StageContext` so it can reference prior outputs.
   */
  readonly buildPrompt: (context: StageContext) => string;

  /**
   * Extracts structured data from the raw assistant response.
   * Called after the stage session completes. The result is stored
   * as `StageOutput.parsedOutput` for downstream stages to consume.
   *
   * When omitted, `parsedOutput` is left `undefined`.
   */
  readonly parseOutput?: (response: string) => unknown;

  /**
   * Determines whether this stage should execute.
   * When omitted, defaults to `true` (stage always runs).
   *
   * @example A debugger stage that only runs when the reviewer found issues:
   *   `shouldRun: (ctx) => hasActionableFindings(ctx.stageOutputs.get("reviewer"))`
   */
  readonly shouldRun?: (context: StageContext) => boolean;

  /**
   * Optional session configuration overrides for this stage.
   * Merged with the conductor's default session config.
   *
   * @example Setting a specific model or additional instructions per stage.
   */
  readonly sessionConfig?: Partial<SessionConfig>;
}

// ---------------------------------------------------------------------------
// ConductorConfig — configuration for the WorkflowSessionConductor
// ---------------------------------------------------------------------------

/**
 * Configuration for the `WorkflowSessionConductor`.
 *
 * Provides the compiled graph to execute, session lifecycle callbacks,
 * and UI notification hooks. The conductor is stateless with respect to
 * configuration — all mutable state lives in the conductor instance.
 */
export interface ConductorConfig {
  /**
   * The compiled graph that defines the workflow's node sequence and
   * edge routing. The conductor walks this graph, interpreting `"agent"`
   * nodes as stage sessions and `"tool"` / `"decision"` nodes as
   * deterministic operations.
   */
  readonly graph: CompiledGraph<BaseState>;

  /**
   * Factory for creating a fresh agent session for each stage.
   * Called once per `"agent"` node execution. The optional `SessionConfig`
   * is merged from the stage's `sessionConfig` overrides.
   */
  readonly createSession: (config?: SessionConfig) => Promise<Session>;

  /**
   * Destroys a session after a stage completes (or fails/interrupts).
   * Called in the `finally` block of every stage execution to ensure
   * sessions are cleaned up even on error paths.
   */
  readonly destroySession: (session: Session) => Promise<void>;

  /**
   * Called when the conductor transitions between stages.
   * `from` is `null` for the first stage.
   *
   * Used by the UI layer to update stage indicators.
   */
  readonly onStageTransition: (from: string | null, to: string) => void;

  /**
   * Called when the task list changes (e.g., after the planner parses
   * tasks, or when the orchestrator updates task statuses).
   *
   * Used by the UI layer to update the `TaskListPanel`.
   */
  readonly onTaskUpdate: (tasks: TaskItem[]) => void;

  /** Cancellation signal for the entire workflow. */
  readonly abortSignal: AbortSignal;
}

// ---------------------------------------------------------------------------
// WorkflowResult — final output of a conductor execution
// ---------------------------------------------------------------------------

/**
 * Final result returned by `WorkflowSessionConductor.execute()`.
 */
export interface WorkflowResult {
  /** Whether the workflow completed without abort or fatal error. */
  readonly success: boolean;

  /** All stage outputs, keyed by stage ID. */
  readonly stageOutputs: ReadonlyMap<string, StageOutput>;

  /** Final task list state. */
  readonly tasks: readonly TaskItem[];

  /** Final workflow state after all node executions. */
  readonly state: BaseState;
}
