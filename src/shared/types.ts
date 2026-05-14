/**
 * Cross-cutting shared types for atomic workflows.
 * cross-ref: pi docs/sdk.md AgentSession
 */

import type {
  AgentSession,
  AgentSessionEvent,
  CompactionResult,
  CreateAgentSessionOptions,
  ModelCycleResult,
  PromptOptions,
} from "@earendil-works/pi-coding-agent";

export type { AgentSessionEvent, CompactionResult, ModelCycleResult, PromptOptions };

// ---------------------------------------------------------------------------
// Workflow input schema
// ---------------------------------------------------------------------------

/** Discriminated union of supported input kinds. */
export type WorkflowInputType = "text" | "string" | "number" | "boolean" | "select";

interface BaseInputSchema {
  description?: string;
  required?: boolean;
}

export interface TextInputSchema extends BaseInputSchema {
  type: "text" | "string";
  default?: string;
}

export interface NumberInputSchema extends BaseInputSchema {
  type: "number";
  default?: number;
}

export interface BooleanInputSchema extends BaseInputSchema {
  type: "boolean";
  default?: boolean;
}

export interface SelectInputSchema extends BaseInputSchema {
  type: "select";
  /** Non-empty array of valid string choices. */
  choices: readonly string[];
  default?: string;
}

/** Union of all concrete input schema shapes. */
export type WorkflowInputSchema =
  | TextInputSchema
  | NumberInputSchema
  | BooleanInputSchema
  | SelectInputSchema;

// ---------------------------------------------------------------------------
// HIL (human-in-the-loop) primitives available inside run functions
// ---------------------------------------------------------------------------

/**
 * HIL surface available on WorkflowRunContext.ui.
 * Each primitive suspends the current stage until the user responds.
 * Mirrors pi ctx.ui.input / confirm / select / editor methods.
 */
export interface WorkflowUIContext {
  /** Ask the user for a free-text value. */
  input(prompt: string): Promise<string>;
  /** Ask the user a yes/no question. */
  confirm(message: string): Promise<boolean>;
  /** Ask the user to pick from a fixed list of options. */
  select<T extends string>(message: string, options: readonly T[]): Promise<T>;
  /** Open a text editor; resolves with the user's final content. */
  editor(initial?: string): Promise<string>;
}

/**
 * Adapter supplied by the pi runtime (or test harness) to back the HIL
 * primitives.  Must implement the same surface as WorkflowUIContext so that
 * the executor can delegate directly.
 */
export type WorkflowUIAdapter = WorkflowUIContext;

// ---------------------------------------------------------------------------
// StageOptions — per-stage configuration + pi SDK session options
// ---------------------------------------------------------------------------

/**
 * MCP server gating options for a single stage.
 * When provided, the executor forwards these to the WorkflowMcpPort
 * before the stage starts and clears them after it settles.
 */
export interface StageMcpOptions {
  /** Allow only these server IDs during this stage (all others implicitly denied). */
  allow?: string[];
  /** Deny these server IDs during this stage (applied after allow when both set). */
  deny?: string[];
}

/**
 * Options accepted by WorkflowRunContext.stage(name, options?).
 * All pi SDK createAgentSession options are forwarded to the stage session;
 * `mcp` remains workflow-owned and is stripped before SDK session creation.
 */
export interface StageOptions extends CreateAgentSessionOptions {
  /** Per-stage MCP server gating. No-op when no WorkflowMcpPort is configured. */
  mcp?: StageMcpOptions;
}

// ---------------------------------------------------------------------------
// Stage execution metadata — threaded from executor into adapter calls
// ---------------------------------------------------------------------------

/**
 * Execution metadata injected by the executor into stage adapter calls.
 * Not exposed to workflow authors — StageContext public API is unchanged.
 */
export interface StageExecutionMeta {
  /** Run ID of the containing workflow execution. */
  runId: string;
  /** Stage ID of the current stage. */
  stageId: string;
  /** Human-readable stage name. */
  stageName: string;
  /** AbortSignal propagated from the executor's own AbortController. */
  signal?: AbortSignal;
}

export interface CompleteStageOpts {
  model?: string;
  maxTokens?: number;
}

/**
 * Options for `ctx.stage(name).subagent({...})` — maps onto the
 * pi-subagents v0.24.2 `subagent` tool execution shape.
 *
 * `context` is the literal union accepted by pi-subagents'
 * `SubagentParams` (`"fresh" | "fork"`). Passing any other value is a
 * type error — pi-subagents silently rejects unknown context values.
 *
 * cross-ref: pi-subagents/src/extension/schemas.ts SubagentParams
 */
export interface SubagentStageOpts {
  agent: string;
  task: string;
  context?: "fresh" | "fork";
}

// ---------------------------------------------------------------------------
// Runtime ports — abstract adapters used by the executor
// ---------------------------------------------------------------------------

/**
 * Abstract MCP scope-gating port.
 * Implemented by the pi runtime or a test stub; no hard dep on integrations/mcp.
 */
export interface WorkflowMcpPort {
  /** Restrict MCP server access for the given stage. Null = unrestricted. */
  setScope(stageId: string, allow: string[] | null, deny: string[] | null): void;
  /** Restore unrestricted MCP access after the stage settles. */
  clearScope(stageId: string): void;
}

/**
 * Abstract persistence port.
 * Mirrors PersistenceAPI from shared/persistence-session-entries — no hard import.
 */
export interface WorkflowPersistencePort {
  appendEntry(type: string, payload: Record<string, unknown>): string | undefined;
  setLabel?(entryId: string, label: string): void;
  appendCustomMessageEntry?(content: string, meta?: Record<string, unknown>): string | undefined;
}

// ---------------------------------------------------------------------------
// Stage context (provided to ctx.stage() calls)
// ---------------------------------------------------------------------------

/**
 * Stage context returned by WorkflowRunContext.stage().
 *
 * This exposes the supported subset of pi's SDK AgentSession. The workflow
 * executor owns disposal and wraps prompt() with stage lifecycle tracking.
 */
export interface StageContext {
  /** Human-readable name for this stage (used in TUI + persistence). */
  readonly name: string;

  /** Send a prompt and wait for completion. */
  prompt(text: string, options?: PromptOptions): Promise<string>;
  complete(text: string, options?: CompleteStageOpts): Promise<string>;
  subagent(options: SubagentStageOpts): Promise<string>;

  /** Queue messages during streaming. */
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;

  /** Subscribe to events (returns unsubscribe function). */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;

  /** Session info. */
  readonly sessionFile: string | undefined;
  readonly sessionId: string;

  /** Model control. */
  setModel(model: Parameters<AgentSession["setModel"]>[0]): Promise<void>;
  setThinkingLevel(level: Parameters<AgentSession["setThinkingLevel"]>[0]): void;
  cycleModel(): Promise<ModelCycleResult | undefined>;
  cycleThinkingLevel(): ReturnType<AgentSession["cycleThinkingLevel"]>;

  /** State access. */
  readonly agent: AgentSession["agent"];
  readonly model: AgentSession["model"];
  readonly thinkingLevel: AgentSession["thinkingLevel"];
  readonly messages: AgentSession["messages"];
  readonly isStreaming: AgentSession["isStreaming"];

  /** In-place tree navigation within the current session file. */
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
  ): Promise<{ editorText?: string; cancelled: boolean }>;

  /** Compaction. */
  compact(customInstructions?: string): Promise<CompactionResult>;
  abortCompaction(): void;

  /** Abort current operation. */
  abort(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workflow run context (top-level ctx passed to the run function)
// ---------------------------------------------------------------------------

export interface WorkflowRunContext<TInputs extends Record<string, unknown> = Record<string, unknown>> {
  /** Typed inputs provided by the caller, validated against the input schema. */
  readonly inputs: TInputs;
  /**
   * Create and register a named stage synchronously. Stage work starts when
   * a stage method such as prompt(), complete(), or subagent() is awaited;
   * the executor infers the DAG automatically from those method calls.
   *
   * @param name   Human-readable stage name (used in TUI + persistence).
   * @param options Optional per-stage configuration (mcp allow/deny, etc.).
   *               Omitting options preserves backward-compatible behaviour.
   */
  stage(name: string, options?: StageOptions): StageContext;
  /** HIL primitives for user interaction during a run. */
  readonly ui: WorkflowUIContext;
}

// ---------------------------------------------------------------------------
// WorkflowRuntimeConfig — resolved runtime tunables injected at composition root
// ---------------------------------------------------------------------------

/**
 * Resolved runtime configuration for workflow execution.
 * Built from WorkflowEffectiveConfig (all optionals filled with defaults) and
 * injected into createExtensionRuntime, dispatch, run, and runDetached option seams.
 *
 * Downstream tasks own: maxDepth enforcement, defaultConcurrency pool,
 * statusFile writer. This type is the port — values flow through but are not
 * acted on until those tasks land.
 */
export interface WorkflowRuntimeConfig {
  /** Maximum workflow recursion/nesting depth. Default: 4. */
  readonly maxDepth: number;
  /** Default stage concurrency limit. Default: 4. */
  readonly defaultConcurrency: number;
  /** Persist runs via pi.appendEntry. Default: true. */
  readonly persistRuns: boolean;
  /** Emit derived status file for CI polling. Default: false. */
  readonly statusFile: boolean;
  /**
   * Filesystem path for the emitted status file.
   * Only meaningful when statusFile is true.
   * Absence means the writer should choose a default path.
   */
  readonly statusFilePath?: string;
  /** Behaviour on session_start for in-flight runs. Default: "ask". */
  readonly resumeInFlight: "ask" | "auto" | "never";
}

// ---------------------------------------------------------------------------
// Workflow run function
// ---------------------------------------------------------------------------

export type WorkflowRunFn<TInputs extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: WorkflowRunContext<TInputs>,
) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Compiled workflow definition
// ---------------------------------------------------------------------------

export interface WorkflowDefinition<TInputs extends Record<string, unknown> = Record<string, unknown>> {
  /** Sentinel consumed by the registry loader to validate the export. */
  readonly __piWorkflow: true;
  readonly name: string;
  /** Normalised name (lowercase, hyphens) used as the registry key. */
  readonly normalizedName: string;
  readonly description: string;
  readonly inputs: Readonly<Record<string, WorkflowInputSchema>>;
  readonly run: WorkflowRunFn<TInputs>;
}
