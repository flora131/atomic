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
 * @see specs/2026-03-23-ralph-workflow-redesign.md §5.1 for the full design.
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type { Session, SessionConfig } from "@/services/agents/types.ts";
import type { WorkflowSessionConfig } from "@/services/workflows/dsl/types.ts";
import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";
import type { BusEvent } from "@/services/events/bus-events/types.ts";
import type { PartsTruncationConfig } from "@/state/parts/truncation.ts";

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
// Context Pressure Monitoring
// ---------------------------------------------------------------------------

/**
 * Severity level of context window pressure.
 *
 * - `normal`: Usage is within safe bounds — no action needed.
 * - `elevated`: Usage is approaching the threshold — worth monitoring.
 * - `critical`: Usage exceeds the threshold — continuation recommended.
 */
export type ContextPressureLevel = "normal" | "elevated" | "critical";

/** All valid ContextPressureLevel values (used by guards). */
export const CONTEXT_PRESSURE_LEVELS: readonly ContextPressureLevel[] = [
  "normal",
  "elevated",
  "critical",
] as const;

/**
 * Point-in-time snapshot of context window usage for a session.
 *
 * Captured after each stage's session completes streaming, before
 * the session is destroyed. Stored in `StageOutput.contextUsage`
 * and accumulated across stages in `StageContext.contextPressure`.
 */
export interface ContextPressureSnapshot {
  /** Input tokens consumed in this session. */
  readonly inputTokens: number;

  /** Output tokens produced in this session. */
  readonly outputTokens: number;

  /** Maximum tokens allowed by the model's context window. */
  readonly maxTokens: number;

  /** Percentage of context window consumed (0–100). */
  readonly usagePercentage: number;

  /** Computed pressure level based on configured thresholds. */
  readonly level: ContextPressureLevel;

  /** ISO timestamp when the snapshot was taken. */
  readonly timestamp: string;
}

/**
 * Record of a continuation session created when context pressure
 * exceeded the threshold during a stage's execution.
 *
 * The conductor creates a new session with a summary of prior work
 * and continues the stage. Each `ContinuationRecord` captures the
 * context state at the point of continuation.
 */
export interface ContinuationRecord {
  /** The stage ID where continuation was triggered. */
  readonly stageId: string;

  /** Zero-based index of this continuation within the stage. */
  readonly continuationIndex: number;

  /** Context snapshot that triggered the continuation. */
  readonly triggerSnapshot: ContextPressureSnapshot;

  /** Partial response accumulated before continuation. */
  readonly partialResponse: string;

  /** ISO timestamp when the continuation was created. */
  readonly timestamp: string;
}

/**
 * Accumulated context pressure state across all stages of a workflow.
 *
 * Provided to stages via `StageContext.contextPressure` so that
 * `buildPrompt` and `shouldRun` can make pressure-aware decisions.
 */
export interface AccumulatedContextPressure {
  /** Total input tokens consumed across all completed stages. */
  readonly totalInputTokens: number;

  /** Total output tokens produced across all completed stages. */
  readonly totalOutputTokens: number;

  /** Number of continuation sessions created so far. */
  readonly totalContinuations: number;

  /** Per-stage snapshots, keyed by stage ID. */
  readonly stageSnapshots: ReadonlyMap<string, ContextPressureSnapshot>;

  /** All continuation records across the workflow. */
  readonly continuations: readonly ContinuationRecord[];
}

/**
 * Configuration for context pressure monitoring and continuation sessions.
 *
 * When provided in `ConductorConfig.contextPressure`, the conductor
 * will query `session.getContextUsage()` after each stage completes
 * streaming and take action when thresholds are exceeded.
 */
export interface ContextPressureConfig {
  /**
   * Usage percentage (0–100) at which context pressure is "elevated".
   * Stages receive this information but no automatic action is taken.
   * @default 45
   */
  readonly elevatedThreshold: number;

  /**
   * Usage percentage (0–100) at which context pressure is "critical"
   * and a continuation session is created.
   * @default 60
   */
  readonly criticalThreshold: number;

  /**
   * Maximum number of continuation sessions per stage.
   * Prevents infinite continuation loops.
   * @default 3
   */
  readonly maxContinuationsPerStage: number;

  /**
   * Whether to enable continuation sessions.
   * When `false`, context pressure is still monitored and reported
   * via `onContextPressure`, but continuations are not created.
   * @default true
   */
  readonly enableContinuation: boolean;
}

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
   *
   * Typed as `Record<string, unknown>` for flexibility — downstream
   * consumers narrow with Zod `safeParse` when they need a specific shape.
   */
  readonly parsedOutput?: Record<string, unknown>;

  /** How the stage terminated. */
  readonly status: StageOutputStatus;

  /** Error message when `status === "error"`. */
  readonly error?: string;

  /**
   * Context window usage snapshot captured after this stage's session
   * completed streaming, before the session was destroyed.
   *
   * Present only when `ConductorConfig.contextPressure` is configured
   * and the session's `getContextUsage()` succeeds.
   */
  readonly contextUsage?: ContextPressureSnapshot;

  /**
   * Continuation records for this stage, if any continuation sessions
   * were created due to context pressure.
   *
   * Empty array when no continuations occurred. Each record captures
   * the partial response and trigger snapshot at the continuation point.
   */
  readonly continuations?: readonly ContinuationRecord[];

  /**
   * Original byte length of `rawResponse` before truncation.
   * Present only when inter-stage output size limiting was applied,
   * allowing downstream stages to detect that the output was trimmed.
   */
  readonly originalByteLength?: number;
}

// ---------------------------------------------------------------------------
// StageContext — read-only snapshot passed into stage prompt builders
// ---------------------------------------------------------------------------

/**
 * Read-only context provided to `StageDefinition.buildPrompt` and
 * `StageDefinition.shouldRun`. Contains everything a stage needs to
 * construct its prompt: the user's original request, outputs from prior
 * stages, the current task list, current workflow state, and a
 * cancellation signal.
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

  /**
   * Current workflow state snapshot.
   *
   * Includes all fields from `BaseState` plus any custom fields defined
   * in the workflow's `globalState` schema. Stages, `.if()` conditions,
   * and prompt builders use this to access accumulated state from prior
   * nodes.
   */
  readonly state: BaseState;

  /**
   * Accumulated context pressure state across all previously-completed stages.
   *
   * Present only when `ConductorConfig.contextPressure` is configured.
   * Stages can use this to make pressure-aware decisions in `buildPrompt`
   * (e.g., requesting more concise output) or `shouldRun` (e.g., skipping
   * non-essential stages when pressure is high).
   */
  readonly contextPressure?: AccumulatedContextPressure;
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
  readonly parseOutput?: (response: string) => Record<string, unknown>;

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
   * `model` and `reasoningEffort` are keyed by agent type for SDK-agnostic
   * configuration. At runtime, the conductor resolves the entry for the
   * active agent. Other fields apply regardless of agent type.
   *
   * @example Setting a specific model or additional instructions per stage.
   */
  readonly sessionConfig?: Partial<WorkflowSessionConfig>;

  /**
   * Maximum byte size for this stage's `rawResponse` when forwarded to
   * downstream stages. Overrides the global `ConductorConfig.maxStageOutputBytes`
   * for this stage only. When omitted, the global limit applies.
   *
   * Set to `0` or `Infinity` to disable truncation for this stage.
   */
  readonly maxOutputBytes?: number;
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
   * The active agent type (e.g., "claude", "copilot", "opencode").
   *
   * Used to resolve per-agent `model` and `reasoningEffort` from
   * `WorkflowSessionConfig` at stage session creation time, and to
   * look up default model/reasoning from user settings when a stage
   * does not specify its own.
   */
  readonly agentType?: string;

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
   * Stream a prompt through a session using the full SDK adapter pipeline,
   * returning the captured response text. When provided, the conductor
   * uses this instead of the bare `session.stream()` loop, giving each
   * stage full rendering parity with normal chat (streaming text, thinking
   * blocks, tool calls, etc. all flow through the EventBus → UI pipeline).
   *
   * When omitted, the conductor falls back to iterating `session.stream()`
   * directly (useful for unit tests that don't have a bus/adapter).
   */
  readonly streamSession?: (
    session: Session,
    prompt: string,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<string>;

  /**
   * Called when the conductor transitions between stages.
   * `from` is `null` for the first stage.
   *
   * Used by the UI layer to update stage indicators.
   */
  readonly onStageTransition: (from: string | null, to: string, options?: { isResume?: boolean }) => void;

  /**
   * Called when the task list changes (e.g., after the planner parses
   * tasks, or when the orchestrator updates task statuses).
   *
   * Used by the UI layer to update the `TaskListPanel`.
   */
  readonly onTaskUpdate: (tasks: TaskItem[]) => void;

  /** Cancellation signal for the entire workflow. */
  readonly abortSignal: AbortSignal;

  // -------------------------------------------------------------------------
  // Output Limits
  // -------------------------------------------------------------------------

  /**
   * Default maximum byte size for a stage's `rawResponse` when forwarded
   * to downstream stages. Individual stages can override this via
   * `StageDefinition.maxOutputBytes`.
   *
   * When set, completed stage outputs whose `rawResponse` exceeds this
   * limit are truncated before storage in `stageOutputs`.
   */
  readonly maxStageOutputBytes?: number;

  // -------------------------------------------------------------------------
  // Event Dispatch (optional — enables workflow bus events)
  // -------------------------------------------------------------------------

  /**
   * Dispatcher function for emitting bus events (e.g., `workflow.step.start`,
   * `workflow.step.complete`). When provided alongside `workflowId`,
   * `sessionId`, and `runId`, the conductor emits lifecycle events for
   * each stage transition.
   *
   * When omitted (or when any of the ID fields are missing), event
   * dispatch is silently skipped.
   */
  readonly dispatchEvent?: (event: BusEvent) => void;

  /** Workflow identifier included in emitted bus events. */
  readonly workflowId?: string;

  /** Session identifier included in emitted bus events. */
  readonly sessionId?: string;

  /** Run identifier included in emitted bus events. */
  readonly runId?: number;

  // -------------------------------------------------------------------------
  // Context Pressure Monitoring (optional — enables usage tracking & continuations)
  // -------------------------------------------------------------------------

  /**
   * Configuration for context pressure monitoring and continuation sessions.
   *
   * When provided, the conductor queries `session.getContextUsage()` after
   * each stage's streaming completes, computes a pressure level, and:
   * - Stores the snapshot in `StageOutput.contextUsage`
   * - Accumulates usage across stages in `StageContext.contextPressure`
   * - Triggers continuation sessions when critical threshold is exceeded
   * - Calls `onContextPressure` for UI notification
   *
   * When omitted, context pressure monitoring is disabled (backward compatible).
   */
  readonly contextPressure?: ContextPressureConfig;

  /**
   * Called when context pressure is detected after a stage completes.
   *
   * Receives the stage ID, the pressure snapshot, and whether a continuation
   * session was (or will be) created. Used by the UI layer to show warnings
   * or progress indicators.
   */
  readonly onContextPressure?: (
    stageId: string,
    snapshot: ContextPressureSnapshot,
    continuation: boolean,
  ) => void;

  // -------------------------------------------------------------------------
  // Parts Truncation (optional — reclaims memory on stage completion)
  // -------------------------------------------------------------------------

  /**
   * Configuration for parts truncation on stage completion.
   *
   * When provided, the conductor includes the truncation config in
   * `workflow.step.complete` bus events. The pipeline's
   * `upsertWorkflowStepComplete` handler then truncates verbose parts
   * (tools, reasoning, text) belonging to the completed stage into a
   * single `TruncationPart` summary, reducing memory pressure.
   *
   * When omitted, no parts truncation is performed (backward compatible).
   */
  readonly partsTruncation?: PartsTruncationConfig;

  // -------------------------------------------------------------------------
  // Interrupt & Queue Integration (optional — enables pause/resume on interrupt)
  // -------------------------------------------------------------------------

  /**
   * Called by the conductor to check if a queued message is available.
   * Returns the message content if available, null otherwise.
   * The implementation should dequeue the message (consume it).
   */
  readonly checkQueuedMessage?: () => string | null;

  /**
   * Called by the conductor when a stage is interrupted and no queued message
   * is available. Returns a promise that resolves with the user's follow-up
   * message, or null to skip the stage and advance.
   */
  readonly waitForResumeInput?: () => Promise<string | null>;

  /**
   * Called by the conductor before streaming a queued message within a stage's
   * drain loop. The `stream.session.idle` from the previous stream already
   * stopped the TUI's streaming state; this callback re-enables streaming and
   * creates a new assistant message target so the queued message's text deltas
   * have a destination.
   *
   * When omitted, the conductor does not call back before queued streams
   * (tests that don't use the full TUI pipeline can omit this safely).
   */
  readonly onBeforeQueuedStream?: () => void;

  // -------------------------------------------------------------------------
  // State Initialization (optional — enables globalState defaults)
  // -------------------------------------------------------------------------

  /**
   * Factory for creating workflow state with globalState defaults.
   *
   * When provided, the conductor calls this instead of bare
   * `initializeExecutionState()` so that user-declared `globalState` fields
   * (e.g. `strategy: { default: "balanced" }`) are present from the start.
   *
   * When omitted, only the bare `BaseState` is created.
   */
  readonly createState?: (params: { sessionId: string; prompt: string; sessionDir: string }) => BaseState;
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

  /**
   * Accumulated context pressure state across all stages.
   *
   * Present only when `ConductorConfig.contextPressure` was configured.
   * Includes total token usage, per-stage snapshots, and all continuation records.
   */
  readonly contextPressure?: AccumulatedContextPressure;
}
