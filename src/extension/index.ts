import { renderCall } from "./render-call.js";
import { renderResult } from "./render-result.js";
import type { WorkflowToolResult, RenderResultOpts } from "./render-result.js";
import { renderInputsSchema } from "../shared/render-inputs-schema.js";
import { renderRunBanner, renderRunSummary } from "./renderers.js";
import type { RunEndPayload, RunStartPayload } from "./renderers.js";
import { store } from "../shared/store.js";
import { restoreOnSessionStart } from "../shared/persistence-restore.js";
import type { SessionManager } from "../shared/persistence-restore.js";
import { installCompactionHook } from "../shared/persistence-compaction-policy.js";
import {
  statusRuns,
  killRun,
  killAllRuns,
  resumeRun,
  inspectRun,
} from "../runs/background/status.js";
import { cancellationRegistry } from "../runs/background/cancellation-registry.js";
import { registerIntercomParentSession } from "../intercom/intercom-bridge.js";
import { subscribeIntercomControl } from "../intercom/result-intercom.js";
import { buildIntercomCallbacks } from "../intercom/intercom-routing.js";
import {
  installStoreWidget,
  installToolExecutionHooks,
} from "../tui/store-widget-installer.js";
import type { WidgetFactory } from "../tui/store-widget-installer.js";
import { buildGraphOverlayAdapter } from "../tui/overlay-adapter.js";
import type { OverlayPiSurface } from "../tui/overlay-adapter.js";
import type { GraphOverlayPort } from "../tui/overlay-adapter.js";
import { renderSessionList } from "../tui/session-list.js";
import { renderRunDetail } from "../tui/run-detail.js";
import { openSessionPicker, openKillConfirm } from "../tui/session-overlays.js";
import {
  openInlineInputsForm,
  registerInlineFormRenderer,
} from "../tui/inline-form-overlay.js";
import { openInputsPicker } from "../tui/inputs-overlay.js";
import { deriveGraphTheme } from "../tui/graph-theme.js";
import { createExtensionRuntime } from "./runtime.js";
import type { ExtensionRuntime } from "./runtime.js";
import {
  discoverWorkflows,
  discoverBundledWorkflows,
  discoverBundledWorkflowsSync,
} from "./discovery.js";
import type { DiscoveryResult } from "./discovery.js";
import { buildDoctorReport } from "./doctor.js";
import type { DoctorSiblingStatus } from "./doctor.js";
import {
  registerWorkflowCliFlags,
  runWorkflowFromCliFlags,
} from "../runs/shared/cli-flags.js";
import {
  loadWorkflowConfig,
  toScopedDiscoveryConfig,
  WORKFLOW_CONFIG_DEFAULTS,
  withWorkflowDefaults,
} from "./config-loader.js";
import type { ConfigLoadResult } from "./config-loader.js";
import type {
  WorkflowPersistencePort,
  WorkflowMcpPort,
  WorkflowRuntimeConfig,
} from "../shared/types.js";
import { buildRuntimeAdapters } from "./wiring.js";
import type { PiUISurface } from "./wiring.js";
import { createStatusWriter } from "./status-writer.js";
import type { StatusWriter } from "./status-writer.js";
import { setMcpScope, clearMcpScope } from "./mcp.js";
import type { PiMcpExtensionAPI, PiEventBus } from "./mcp.js";
import type { StageSessionRuntime } from "../runs/foreground/stage-runner.js";
import type { CreateAgentSessionOptions } from "@oh-my-pi/pi-coding-agent";

// ---------------------------------------------------------------------------
// Minimal ExtensionAPI structural types
// No `any`; all optional fields use explicit union with undefined.
// cross-ref: oh-my-pi docs/skills/authoring-extensions.md (ExtensionAPI shape)
// ---------------------------------------------------------------------------

/** Theme object passed to renderCall/renderResult slots (opaque — not consumed in stubs). */
export type PiTheme = Record<string, string>;

/** Context object passed to renderCall/renderResult slots. */
export interface PiRenderContext {
  state?: {
    runId?: string;
    stages?: unknown[];
  };
  invalidate?: () => void;
}

/** Options bag passed to renderResult. */
export interface PiRenderResultOpts extends RenderResultOpts {}

export interface PiRenderComponent {
  render(width: number): string[];
  invalidate?: () => void;
  includes(searchString: string): boolean;
}

function textRenderComponent(text: string): PiRenderComponent {
  return {
    render(_width: number): string[] {
      return text.split("\n");
    },
    includes(searchString: string): boolean {
      return text.includes(searchString);
    },
  };
}

/**
 * Completion for a slash-command argument. Matches pi-tui's `AutocompleteItem`.
 * `value` is the text inserted on selection; `label` is the menu display; the
 * optional `description` is the secondary line. Without `value`, pi-tui crashes
 * in `getBestAutocompleteMatchIndex` (`value.startsWith(prefix)`).
 * cross-ref: @oh-my-pi/pi-tui autocomplete AutocompleteItem
 */
export interface PiArgumentCompletion {
  value: string;
  label: string;
  description?: string;
}

/**
 * Canonical slash command options for pi.registerCommand(name, options).
 * `handler` maps from the internal `execute` field.
 * cross-ref: research/docs/2026-05-11-pi-coding-agent-reference.md §4.2
 */
export type PiArgumentCompletionResult = PiArgumentCompletion[] | null;

export interface PiCommandOptions {
  description: string;
  handler: (args: string, ctx: PiCommandContext) => Promise<void> | void;
  getArgumentCompletions?: (
    partial: string,
  ) => PiArgumentCompletionResult;
}

/**
 * Internal slash command registration options — used throughout this module
 * to build commands before adapting to the pi API call shape.
 * `execute` is mapped to `handler` by tryRegisterSlashCommand before dispatch.
 */
export interface PiSlashCommandOpts {
  name: string;
  description: string;
  execute: (args: string, ctx: PiCommandContext) => Promise<void> | void;
  getArgumentCompletions?: (
    partial: string,
  ) => PiArgumentCompletionResult;
}

/**
 * Context provided to slash command execute handlers.
 *
 * `ui.notify` is the real pi runtime surface (verified against
 * pi-coding-agent dist `ExtensionUIContext.notify`). `reply`/`print` are
 * retained for test ergonomics — production output flows through
 * `commandPrint()` which prefers `ui.notify` and falls back to the legacy
 * fields only when notify is unavailable.
 */
export interface PiCommandContext {
  ui?: {
    notify?: (message: string, type?: "info" | "warning" | "error") => void;
  } & PiUISurface;
  reply?: (message: string) => void;
  print?: (message: string) => void;
}

/**
 * Resolve the print function for a command handler. Prefers pi's real
 * `ctx.ui.notify("…", "info")` surface; falls back to the legacy
 * `ctx.reply` / `ctx.print` fields used by tests and older pi builds.
 */
function commandPrint(ctx: PiCommandContext): (message: string) => void {
  const notify = ctx.ui?.notify;
  if (typeof notify === "function") {
    return (msg: string) => notify(msg, "info");
  }
  if (typeof ctx.reply === "function") return ctx.reply;
  if (typeof ctx.print === "function") return ctx.print;
  return (_msg: string) => undefined;
}

/** Flag registration options. */
/**
 * Canonical flag registration options (Pi >= 1.x).
 * Name is passed as a separate first argument; not included here.
 */
export interface PiFlagNamedOpts {
  description: string;
  type?: "string" | "boolean";
  default?: unknown;
}

/**
 * Legacy object-shaped flag options (Pi < 1.x compat).
 * Kept for backward-compatibility with older implementations.
 * Prefer PiFlagNamedOpts + registerFlag(name, opts) for new code.
 */
export interface PiFlagOpts extends PiFlagNamedOpts {
  name: string;
}

/**
 * Pi's AgentToolResult shape — returned by `execute` and consumed by
 * `renderResult`. `details` carries the original workflow result for the
 * renderer; `content` is what the model sees on tool completion.
 */
export interface PiAgentToolResult<TDetails> {
  content: Array<
    { type: "text"; text: string } | { type: "image"; [key: string]: unknown }
  >;
  details: TDetails;
  terminate?: boolean;
}

/** Tool registration options aligned with pi's `ToolDefinition`. */
export interface PiToolOpts<TArgs, TDetails> {
  name: string;
  label: string;
  description: string;
  parameters: unknown; // TypeBox TSchema — pi consumes it opaquely
  /**
   * Pi calls execute positionally: `(toolCallId, params, signal, onUpdate, ctx)`.
   * cross-ref: pi-coding-agent dist/core/extensions/types.d.ts ToolDefinition.execute
   */
  execute: (
    toolCallId: string,
    params: TArgs,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: PiAgentToolResult<TDetails>) => void) | undefined,
    ctx: PiExecuteContext,
  ) => Promise<PiAgentToolResult<TDetails>>;
  /** Pi passes args directly as the first positional arg (not wrapped). */
  renderCall?: (
    args: TArgs,
    theme: PiTheme,
    context: PiRenderContext,
  ) => PiRenderComponent | string;
  /** Pi passes the full AgentToolResult as the first positional arg. */
  renderResult?: (
    result: PiAgentToolResult<TDetails>,
    opts: PiRenderResultOpts,
    theme: PiTheme,
    context: PiRenderContext,
  ) => PiRenderComponent | string;
}

/** Execution context provided to tool execute handlers. */
export interface PiExecuteContext {
  sessionId?: string;
  ui?: PiUISurface;
  hasUI?: boolean;
  [key: string]: unknown;
}

/**
 * Minimal structural ExtensionAPI.
 * All registration methods are optional so the extension degrades gracefully
 * when running against older pi runtimes that lack certain features.
 */
export interface ExtensionAPI {
  registerTool?: <TArgs, TResult>(opts: PiToolOpts<TArgs, TResult>) => void;
  /**
   * Canonical registration (pi >= 1.x): registerCommand(name, options).
   * options.handler maps to the internal execute field.
   * cross-ref: research/docs/2026-05-11-pi-coding-agent-reference.md §4.2
   */
  registerCommand?: (name: string, options: PiCommandOptions) => void;
  /**
   * Legacy alias used by older pi builds — accepts full object shape.
   * Kept as explicit compatibility path only; not primary registration path.
   */
  registerSlashCommand?: (opts: PiSlashCommandOpts) => void;
  registerMessageRenderer?: (
    event: string,
    renderer: (payload: unknown) => string,
  ) => void;
  /**
   * Inject a custom message into the chat history. Used by the inline
   * workflow input form to emit a sticky card under `customType:
   * "atomic-workflows:input-form"`. The card stays in scrollback and is
   * re-rendered by the registered renderer on every `tui.requestRender()`.
   */
  sendMessage?: <T = unknown>(
    message: {
      customType: string;
      content?: string;
      display?: boolean;
      details?: T;
    },
    options?: {
      triggerTurn?: boolean;
      deliverAs?: "steer" | "followUp" | "nextTurn";
    },
  ) => void | Promise<void>;
  registerFlag?: (name: string, opts: PiFlagNamedOpts) => void;
  /**
   * Register a keyboard shortcut.
   * Present on pi >= 1.x; absent on older runtimes.
   */
  registerShortcut?: (
    key: string,
    opts: {
      description: string;
      handler: (ctx?: PiCommandContext) => void | Promise<void>;
    },
  ) => void;
  /**
   * Sets the current session name. Present on oh-my-pi's ExtensionAPI.
   */
  setSessionName?: (name: string) => void | Promise<void>;
  /**
   * oh-my-pi exports injected into the extension API. Used instead of bundling
   * the host package at runtime.
   */
  pi?: {
    createAgentSession?: (
      options?: CreateAgentSessionOptions,
    ) => Promise<{ session: StageSessionRuntime }>;
  };
  /**
   * oh-my-pi events bus — used for workflow-scoped MCP events and subagent
   * lifecycle/result routing.
   */
  events?: {
    emit?: (event: string, payload: Record<string, unknown>) => void;
    on?: (event: string, handler: (payload: unknown) => void) => void;
  };
  /**
   * Execute a shell command and return stdout/stderr/exit code.
   * Present on the oh-my-pi ExtensionAPI.
   */
  exec?: (
    command: string,
    args: string[],
    opts?: { signal?: AbortSignal; timeout?: number },
  ) => Promise<{
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
  }>;
  /** Test/degraded-runtime seam: skip host SDK exports and use a supplied session factory. */
  createAgentSession?: (
    options?: CreateAgentSessionOptions,
  ) => Promise<{ session: StageSessionRuntime }>;
  /** Test/degraded-runtime seam: skip project/global discovery work at startup. */
  disableAsyncDiscovery?: boolean;
  // -------------------------------------------------------------------------
  // Persistence API (§5.6)
  // -------------------------------------------------------------------------
  /** Appends a typed entry to the session transcript. Returns the entry ID. */
  appendEntry?: (
    type: string,
    payload: Record<string, unknown>,
  ) => string | undefined;
  /** Labels an entry for /tree bookmark filtering. */
  setLabel?: (entryId: string, label: string) => void;
  /** Appends a synthetic system/assistant message entry. */
  appendCustomMessageEntry?: (
    content: string,
    meta?: Record<string, unknown>,
  ) => string | undefined;
  // -------------------------------------------------------------------------
  // Lifecycle events (§5.6, §8.1 Phase D)
  // -------------------------------------------------------------------------
  /** Register a listener for a pi lifecycle event (e.g. session_start, session_before_compact). */
  on?: (
    event: string,
    handler: (
      event?: unknown,
      ctx?: PiCommandContext & {
        sessionManager?: SessionManager;
        hasUI?: boolean;
      },
    ) => void | Promise<void>,
  ) => void;
  // -------------------------------------------------------------------------
  // Session manager (§5.6 restore)
  // -------------------------------------------------------------------------
  sessionManager?: SessionManager;
  ui?: {
    setWidget?: (
      key: string,
      factory: WidgetFactory | undefined,
      opts?: { placement?: string },
    ) => void;
    /**
     * Spawn a custom TUI component (overlay or inline).
     * When overlay: true, the panel floats over existing content.
     * Returns a handle with close() to dismiss, or undefined when unsupported.
     */
    custom?: PiUISurface["custom"];
  } & PiUISurface;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Workflow tool argument shape
// ---------------------------------------------------------------------------

export interface WorkflowToolArgs {
  name?: string;
  inputs?: Record<string, unknown>;
  action?: "run" | "list" | "status" | "kill" | "resume" | "inputs";
  /**
   * Run identifier for `status` / `kill` / `resume` actions. Accepts a full
   * UUID or a unique short prefix. When `action === "status"` and `id` is
   * set, the result is `statusDetail` (per-run block) instead of the
   * multi-run status list.
   */
  id?: string;
}

// ---------------------------------------------------------------------------
// Tool parameter schema
// ---------------------------------------------------------------------------

const workflowParameters = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Workflow ID (use {action:'list'} to enumerate)",
    },
    inputs: {
      type: "object",
      default: {},
      description: "Key/value inputs passed to the workflow run",
      additionalProperties: true,
    },
    action: {
      anyOf: [
        { const: "run" },
        { const: "list" },
        { const: "status" },
        { const: "kill" },
        { const: "resume" },
        { const: "inputs" },
      ],
    },
    id: {
      type: "string",
      description:
        "Run identifier for status/kill/resume (UUID or unique short prefix)",
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Tool execute — dispatch with real registry for list/inputs/run (Phase E)
//                + real status/kill/resume (Phase D)
// ---------------------------------------------------------------------------

export function makeExecuteWorkflowTool(
  runtime: ExtensionRuntime | ((ctx: PiExecuteContext) => ExtensionRuntime),
  getPersistence: () => WorkflowPersistencePort | undefined,
) {
  return async function executeWorkflowTool(
    args: WorkflowToolArgs,
    ctx: PiExecuteContext,
  ): Promise<WorkflowToolResult> {
    const action = args.action ?? "run";
    const runId = args.name ?? "";
    const activeRuntime =
      typeof runtime === "function" ? runtime(ctx) : runtime;

    switch (action) {
      case "list":
      case "inputs":
      case "run":
        // Delegate to registry-backed dispatcher.
        // Real errors propagate — no broad catch.
        return activeRuntime.dispatch(args);

      case "status": {
        // Detail mode — single-run lookup via id (with a legacy fallback to
        // args.name so older callers that conflated the two fields keep
        // working).
        const target = args.id ?? (args.name && args.name.length > 0 ? args.name : undefined);
        if (target !== undefined) {
          const result = inspectRun(target);
          if (result.ok) {
            return {
              action: "statusDetail",
              runId: result.runId,
              detail: result.detail,
            };
          }
          return {
            action: "statusDetail",
            runId: target,
            error: `run not found: ${target}`,
          };
        }
        // List mode — embed full snapshots so the renderer can produce
        // the rich band-header status block.
        const snapshots = store.runs().filter((r) => r.endedAt === undefined);
        const runs = statusRuns({ all: false });
        return {
          action: "status",
          runs: runs.map((r) => ({
            runId: r.runId,
            name: r.name,
            status: r.status,
          })),
          snapshots: snapshots.map(
            (s) => JSON.parse(JSON.stringify(s)) as typeof s,
          ),
        };
      }

      case "kill": {
        // Support "kill --all" via name sentinel
        if (runId === "--all") {
          const results = killAllRuns({
            cancellation: cancellationRegistry,
            persistence: getPersistence(),
          });
          const killed = results.filter((r) => r.ok).length;
          return {
            action: "kill",
            runId: "--all",
            status: killed > 0 ? "killed" : "noop",
            message:
              killed > 0
                ? `Killed ${killed} run(s).`
                : "No in-flight runs to kill.",
          };
        }
        const result = killRun(runId, {
          cancellation: cancellationRegistry,
          persistence: getPersistence(),
        });
        if (result.ok) {
          return {
            action: "kill",
            runId: result.runId,
            status: "killed",
            message: `Run ${result.runId} killed (was ${result.previousStatus}).`,
          };
        }
        return {
          action: "kill",
          runId,
          status: "noop",
          message:
            result.reason === "not_found"
              ? `Run not found: ${runId}`
              : `Run already ended: ${runId}`,
        };
      }

      case "resume": {
        const result = resumeRun(runId);
        if (result.ok) {
          return {
            action: "resume",
            runId: result.runId,
            status: "ok",
            message: `Snapshot available: run ${result.runId} (${result.snapshot.name}) \u2014 status: ${result.snapshot.status}, stages: ${result.snapshot.stages.length}`,
          };
        }
        return {
          action: "resume",
          runId,
          status: "noop",
          message: `Run not found: ${runId}`,
        };
      }

      default: {
        // Exhaustive — all action variants handled above.
        const _exhaustive: never = action;
        throw new Error(`Workflow extension: unknown action "${_exhaustive}"`);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Slash command helpers
// ---------------------------------------------------------------------------

/** Try canonical then legacy registration. Maps internal execute → handler for canonical call. */
function tryRegisterSlashCommand(
  pi: ExtensionAPI,
  opts: PiSlashCommandOpts,
): void {
  if (typeof pi.registerCommand === "function") {
    // Canonical: registerCommand(name, { description, handler, getArgumentCompletions? })
    const options: PiCommandOptions = {
      description: opts.description,
      handler: opts.execute,
    };
    if (opts.getArgumentCompletions !== undefined) {
      options.getArgumentCompletions = opts.getArgumentCompletions;
    }
    pi.registerCommand(opts.name, options);
  } else if (typeof pi.registerSlashCommand === "function") {
    // Legacy compatibility path — older pi builds only.
    pi.registerSlashCommand(opts);
  }
  // Neither present — silently skip (degraded runtime).
}

/**
 * Build a multi-line success message for a backgrounded workflow run.
 */
function renderBackgroundStartMessage(workflowName: string, runId: string): string {
  const idShort = runId.slice(0, 8);
  return [
    `✓ Workflow "${workflowName}" started   runId ${idShort}`,
    `  attach   /workflow connect ${idShort}`,
    `  monitor  /workflow status`,
  ].join("\n");
}

/**
 * Resolve a user-supplied run identifier (full UUID or unique prefix) to
 * a concrete runId. The widget surfaces an 8-char prefix to keep the
 * status line scannable; users copy that prefix straight into the kill
 * slash command, so prefix matching is the expected affordance.
 */
type RunIdResolution =
  | { kind: "exact"; runId: string }
  | { kind: "ambiguous"; matches: string[] }
  | { kind: "not_found" };

function resolveRunIdPrefix(target: string): RunIdResolution {
  const runs = store.runs();
  const exact = runs.find((r) => r.id === target);
  if (exact) return { kind: "exact", runId: exact.id };

  const prefixed = runs.filter((r) => r.id.startsWith(target));
  if (prefixed.length === 0) return { kind: "not_found" };
  if (prefixed.length === 1) return { kind: "exact", runId: prefixed[0]!.id };
  return { kind: "ambiguous", matches: prefixed.map((r) => r.id) };
}

function overlaySurfaceFromContext(ctx?: {
  ui?: PiUISurface;
}): OverlayPiSurface | undefined {
  return ctx?.ui ? { ui: ctx.ui } : undefined;
}

function printCliWorkflowResult(
  result: Awaited<ReturnType<typeof runWorkflowFromCliFlags>>,
): void {
  if (!result.handled) return;
  if (result.error) {
    console.error(result.error);
    return;
  }
  if (result.message) {
    console.log(result.message);
    return;
  }
  if (result.result) {
    console.log(renderResult(result.result, {}));
  }
}

/**
 * Strip the clack-style `--yes` / `-y` confirmation skip flag from a token
 * list. Used by `/workflow kill` to skip the confirmation overlay.
 */
export function stripYesFlag(tokens: string[]): { tokens: string[]; yes: boolean } {
  const yes = tokens.some((t) => t === "--yes" || t === "-y");
  return { tokens: tokens.filter((t) => t !== "--yes" && t !== "-y"), yes };
}

/**
 * Parse remaining args tokens as key=value pairs.
 * Tokens matching `key=value` are split on the first `=`.
 * Tokens that are standalone valid JSON objects/arrays are merged in.
 * All other tokens are ignored (non-kv positional args not supported).
 */
export function parseWorkflowArgs(tokens: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const token of tokens) {
    // Try JSON object/array merge
    if (
      (token.startsWith("{") && token.endsWith("}")) ||
      (token.startsWith("[") && token.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(token) as unknown;
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          Object.assign(result, parsed as Record<string, unknown>);
        }
        continue;
      } catch {
        // not valid JSON — fall through to kv parse
      }
    }
    // key=value
    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      const key = token.slice(0, eqIdx);
      const raw = token.slice(eqIdx + 1);
      // Try to parse value as JSON for typed values (numbers, booleans, objects)
      let value: unknown = raw;
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        // keep as string
      }
      result[key] = value;
    }
  }
  return result;
}


// ---------------------------------------------------------------------------
// Persistence port builder
// ---------------------------------------------------------------------------

/**
 * Build a WorkflowPersistencePort from the pi ExtensionAPI when persistence
 * is enabled. Returns undefined when:
 *   - persistRuns is false, OR
 *   - pi.appendEntry is absent (older pi runtime without persistence API).
 */
export function makePersistencePort(
  pi: ExtensionAPI,
  persistRuns: boolean,
): WorkflowPersistencePort | undefined {
  if (!persistRuns) return undefined;
  if (typeof pi.appendEntry !== "function") return undefined;

  const port: WorkflowPersistencePort = {
    appendEntry: (type, payload) => pi.appendEntry!(type, payload),
  };
  if (typeof pi.setLabel === "function") {
    port.setLabel = (entryId, label) => pi.setLabel!(entryId, label);
  }
  if (typeof pi.appendCustomMessageEntry === "function") {
    port.appendCustomMessageEntry = (content, meta) =>
      pi.appendCustomMessageEntry!(content, meta);
  }
  return port;
}

// ---------------------------------------------------------------------------
// MCP port builder
// ---------------------------------------------------------------------------

/**
 * Build a WorkflowMcpPort from the pi ExtensionAPI when MCP scope gating is
 * supported. Returns undefined when pi.events?.emit is absent (adapter not
 * installed or older runtime without events bus) — scoping becomes a no-op.
 */
export function makeMcpPort(pi: ExtensionAPI): WorkflowMcpPort | undefined {
  if (typeof pi.events?.emit !== "function") return undefined;

  // Adapt ExtensionAPI to the minimal PiMcpExtensionAPI shape expected by
  // setMcpScope / clearMcpScope. We only forward events.emit (confirmed above).
  const piForMcp: PiMcpExtensionAPI = {
    events: { emit: pi.events.emit as PiEventBus["emit"] },
  };

  return {
    setScope(stageId: string, allow: string[] | null, deny: string[] | null) {
      setMcpScope(piForMcp, {
        stageId,
        allow: allow ?? undefined,
        deny: deny ?? undefined,
      });
    },
    clearScope(stageId: string) {
      clearMcpScope(piForMcp, stageId);
    },
  };
}

// ---------------------------------------------------------------------------
// Factory — the default export consumed by the pi runtime
// ---------------------------------------------------------------------------

function factory(pi: ExtensionAPI): void {
  // -------------------------------------------------------------------------
  // 0. Build StageAdapters from pi runtime surfaces. Stage prompting uses
  //    pi's in-process SDK `createAgentSession()` surface; HIL prompts
  //    flow through the store-backed background adapter built inside
  //    `runDetached()` — they never touch pi.ui.
  // -------------------------------------------------------------------------
  const adapters = buildRuntimeAdapters(pi);

  // Build graph overlay adapter — wraps GraphView + pi.ui.custom.
  // noopOverlay returned when pi.ui?.custom is absent (degraded runtime).
  const overlay: GraphOverlayPort = buildGraphOverlayAdapter(pi, store);

  // -------------------------------------------------------------------------
  // 1. Create ExtensionRuntime — mutable ref seeded from sync bundled discovery,
  //    upgraded to unified async discovery once discoverWorkflows() resolves.
  //
  //    runtimeProxy delegates all calls to runtimeRef.current so every
  //    registration closure automatically uses the most-current registry without
  //    needing to be re-registered.
  // -------------------------------------------------------------------------
  const persistenceRef: { current: WorkflowPersistencePort | undefined } = {
    current: makePersistencePort(pi, WORKFLOW_CONFIG_DEFAULTS.persistRuns),
  };
  const mcpPort: WorkflowMcpPort | undefined = makeMcpPort(pi);

  /**
   * Mutable ref for the resolved runtime config.
   * Seeded with WORKFLOW_CONFIG_DEFAULTS at startup; replaced after async config load.
   * Injected into every createExtensionRuntime() call so the dispatcher, executor,
   * and detached runner all receive the same resolved tunables.
   */
  const runtimeConfigRef: { current: WorkflowRuntimeConfig } = {
    current: {
      maxDepth: WORKFLOW_CONFIG_DEFAULTS.maxDepth,
      defaultConcurrency: WORKFLOW_CONFIG_DEFAULTS.defaultConcurrency,
      persistRuns: WORKFLOW_CONFIG_DEFAULTS.persistRuns,
      statusFile: WORKFLOW_CONFIG_DEFAULTS.statusFile,
      resumeInFlight: WORKFLOW_CONFIG_DEFAULTS.resumeInFlight,
    },
  };

  /**
   * Mutable ref for the status writer instance.
   * Replaced (old unsubscribed) each time runtimeConfigRef is updated after
   * async config resolution. Starts as a no-op (statusFile defaults to false).
   */
  let statusWriterRef: StatusWriter = createStatusWriter(
    store,
    runtimeConfigRef.current,
  );

  const runtimeRef: { current: ExtensionRuntime } = {
    current: createExtensionRuntime({
      registry: discoverBundledWorkflowsSync().registry,
      adapters,
      cancellation: cancellationRegistry,
      persistence: persistenceRef.current,
      mcp: mcpPort,
      config: runtimeConfigRef.current,
    }),
  };
  const discoveryRef: { current: DiscoveryResult | null } = { current: null };
  const configLoadRef: { current: ConfigLoadResult | null } = { current: null };

  /** Stable proxy — all registrations close over this; delegates to runtimeRef.current. */
  const runtimeProxy: ExtensionRuntime = {
    get registry() {
      return runtimeRef.current.registry;
    },
    dispatch(args) {
      return runtimeRef.current.dispatch(args);
    },
  };

  // The runtime no longer depends on a per-command pi.ui adapter — all
  // workflow runs are background-scoped and route HIL through the store.
  // Kept as a function (rather than inlining `runtimeProxy`) so call sites
  // that previously pass a context object keep type-checking.
  function runtimeForContext(_ctx?: { ui?: PiUISurface }): ExtensionRuntime {
    return runtimeProxy;
  }

  const executeWorkflowTool = makeExecuteWorkflowTool(
    (ctx) => runtimeForContext(ctx),
    () => persistenceRef.current,
  );
  let storeWidgetUnsubscribe: (() => void) | null = null;

  // Start unified async discovery immediately.
  // On resolve: swap runtime ref so /workflow completions and dispatch see
  // project-local, user-global, and settings-provided workflows.
  // Load startup config before discovery so workflow paths and tunables are applied.
  const discoveryPromise = pi.disableAsyncDiscovery ? Promise.resolve() : loadWorkflowConfig().then(async (configResult) => {
    configLoadRef.current = configResult;

    // Build scope-aware DiscoveryConfig: global entries → globalWorkflows (resolved
    // under <homeDir>/.omp/agent), project entries → projectWorkflows (resolved under
    // projectRoot). Project keys override global keys. Paths pre-resolved to absolute.
    const { homedir } = await import("node:os");
    const hasGlobal = configResult.globalConfig != null;
    const hasProject = configResult.projectConfig != null;
    const discoveryConfig =
      hasGlobal || hasProject
        ? toScopedDiscoveryConfig(
            configResult.globalConfig ?? null,
            configResult.projectConfig ?? null,
            { projectRoot: process.cwd(), homeDir: homedir() },
          )
        : undefined;

    const result = await discoverWorkflows({ config: discoveryConfig });
    discoveryRef.current = result;

    // Resolve effective config (fills in all defaults) and build WorkflowRuntimeConfig.
    const effectiveConfig = withWorkflowDefaults(configResult.config ?? {});
    runtimeConfigRef.current = {
      maxDepth: effectiveConfig.maxDepth,
      defaultConcurrency: effectiveConfig.defaultConcurrency,
      persistRuns: effectiveConfig.persistRuns,
      statusFile: effectiveConfig.statusFile,
      resumeInFlight: effectiveConfig.resumeInFlight,
    };

    // Replace status writer with one that reflects the resolved config.
    // Unsubscribe the prior (no-op) writer before creating the new one.
    statusWriterRef.unsubscribe();
    statusWriterRef = createStatusWriter(store, runtimeConfigRef.current);

    persistenceRef.current = makePersistencePort(
      pi,
      effectiveConfig.persistRuns,
    );
    runtimeRef.current = createExtensionRuntime({
      registry: result.registry,
      adapters,
      cancellation: cancellationRegistry,
      persistence: persistenceRef.current,
      mcp: mcpPort,
      config: runtimeConfigRef.current,
    });

  });

  // -------------------------------------------------------------------------
  // 1. Register the `workflow` tool
  //    Pi's ToolDefinition.execute is positional: (toolCallId, params, signal,
  //    onUpdate, ctx) → Promise<AgentToolResult<TDetails>>. The internal
  //    `executeWorkflowTool` keeps its (args, ctx) shape for test ergonomics;
  //    we adapt here at the registration boundary only.
  //    cross-ref: pi-coding-agent dist/core/extensions/types.d.ts ToolDefinition
  // -------------------------------------------------------------------------
  if (typeof pi.registerTool === "function") {
    pi.registerTool<WorkflowToolArgs, WorkflowToolResult>({
      name: "workflow",
      label: "workflow",
      description: "Run a defined multi-stage workflow by name.",
      parameters: workflowParameters,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
        // Overlay is opt-in via F2 / ctrl+h; do not auto-open from a
        // tool-call dispatch path.
        const details = await executeWorkflowTool(params, ctx);
        return {
          content: [{ type: "text", text: renderResult(details, {}) }],
          details,
        };
      },
      renderCall: (args, _theme, _context) =>
        textRenderComponent(renderCall(args)),
      renderResult: (result, opts, _theme, _context) =>
        textRenderComponent(renderResult(result.details, opts)),
    });
  }

  // -------------------------------------------------------------------------
  // 2. Register /workflow slash command
  // -------------------------------------------------------------------------
  /**
   * Shared top-level run-control handler.
   *
   *   connect [runId|prefix]         no arg → picker overlay; arg → attach
   *   kill [runId|prefix|--all] [-y] confirmation overlay unless -y
   */
  async function handleRunControlCommand(
    action: "connect" | "kill",
    rest: string[],
    ctx: PiCommandContext,
  ): Promise<boolean> {
    const print = commandPrint(ctx);
    const theme = deriveGraphTheme({});

    if (action === "connect") {
      const target = rest.find((t) => !t.startsWith("--"));
      if (!target) {
        // Picker mode — mount the overlay and route the resolved action.
        const ui = ctx.ui;
        if (!ui || typeof ui.custom !== "function") {
          print(
            `${renderSessionList(store.runs(), { theme, includeAll: false })}\n\nPicker requires a UI surface. Pass a runId: /workflow connect <id>`,
          );
          return true;
        }
        const result = await openSessionPicker(ui, store, theme);
        if (result.kind === "close") return true;
        if (result.kind === "connect") {
          overlay.open(result.runId, overlaySurfaceFromContext(ctx));
          return true;
        }
        if (result.kind === "kill") {
          const run = store.runs().find((r) => r.id === result.runId);
          if (!run) {
            print(`Run not found: ${result.runId}`);
            return true;
          }
          const confirmed = await openKillConfirm(ui, run, theme);
          if (!confirmed) {
            print(`Cancelled. Run ${result.runId.slice(0, 8)} is still active.`);
            return true;
          }
          const killed = killRun(result.runId, {
            cancellation: cancellationRegistry,
            persistence: persistenceRef.current,
          });
          print(
            killed.ok
              ? `Run ${killed.runId.slice(0, 8)} killed.`
              : `Run ${result.runId.slice(0, 8)} already ended.`,
          );
          return true;
        }
        return true;
      }
      const resolved = resolveRunIdPrefix(target);
      if (resolved.kind === "not_found") {
        print(`Run not found: ${target}\n\n${renderSessionList(store.runs(), { theme, includeAll: true })}`);
        return true;
      }
      if (resolved.kind === "ambiguous") {
        print(
          `Ambiguous run prefix "${target}" matches: ${resolved.matches
            .map((id) => id.slice(0, 12))
            .join(", ")}`,
        );
        return true;
      }
      overlay.open(resolved.runId, overlaySurfaceFromContext(ctx));
      print(`Attached to ${resolved.runId.slice(0, 8)}. Press "h" to hide, "q" to kill, esc to close.`);
      return true;
    }

    if (action === "kill") {
      const { tokens: killArgs, yes } = stripYesFlag(rest);
      let target = killArgs.find((t) => !t.startsWith("--"));
      const wantsAll = killArgs.includes("--all");
      if (!target && !wantsAll) {
        target = store.activeRunId() ?? undefined;
        if (!target) {
          print("No in-flight runs to kill.");
          return true;
        }
      }
      if (wantsAll) {
        const inFlight = store.runs().filter((r) => r.endedAt === undefined);
        if (inFlight.length === 0) {
          print("No in-flight runs to kill.");
          return true;
        }
        if (!yes && ctx.ui && typeof ctx.ui.confirm === "function") {
          const ok = await ctx.ui.confirm(
            `Kill all ${inFlight.length} in-flight workflow runs?`,
            `Aborts: ${inFlight.map((r) => `${r.name} (${r.id.slice(0, 8)})`).join(", ")}`,
          );
          if (!ok) {
            print("Cancelled.");
            return true;
          }
        }
        const results = killAllRuns({
          cancellation: cancellationRegistry,
          persistence: persistenceRef.current,
        });
        const killed = results.filter((r) => r.ok).length;
        print(killed > 0 ? `Killed ${killed} run(s).` : "No in-flight runs to kill.");
        return true;
      }
      const resolved = resolveRunIdPrefix(target!);
      if (resolved.kind === "not_found") {
        print(`Run not found: ${target}`);
        return true;
      }
      if (resolved.kind === "ambiguous") {
        print(
          `Ambiguous run prefix "${target}" matches multiple runs: ${resolved.matches
            .map((id) => id.slice(0, 12))
            .join(", ")}`,
        );
        return true;
      }
      const run = store.runs().find((r) => r.id === resolved.runId);
      if (!yes && run && run.endedAt === undefined && ctx.ui) {
        const confirmed = await openKillConfirm(ctx.ui, run, theme);
        if (!confirmed) {
          print(`Cancelled. Run ${resolved.runId.slice(0, 8)} is still active.`);
          return true;
        }
      }
      const result = killRun(resolved.runId, {
        cancellation: cancellationRegistry,
        persistence: persistenceRef.current,
      });
      if (result.ok) {
        print(`Run ${result.runId.slice(0, 8)} killed (was ${result.previousStatus}).`);
      } else {
        print(
          result.reason === "not_found"
            ? `Run not found: ${target}`
            : `Run already ended: ${target}`,
        );
      }
      return true;
    }

    return false;
  }

  tryRegisterSlashCommand(pi, {
    name: "workflow",
    description:
      "Run or inspect pi workflows. Usage: /workflow <name> [key=value…] | /workflow [list|status|connect|kill|resume|inputs] [args]",
    execute: async (args: string, ctx: PiCommandContext) => {
      const print = commandPrint(ctx);
      const rawParts = args.trim().split(/\s+/);
      const parts = rawParts[0] === "" ? [] : rawParts;
      const subcommand = parts[0] ?? "";

      // -----------------------------------------------------------------------
      // connect — attach to a run overlay (picker if no id).
      // -----------------------------------------------------------------------
      if (subcommand === "connect") {
        await handleRunControlCommand("connect", parts.slice(1), ctx);
        return;
      }

      // -----------------------------------------------------------------------
      // list (default when no subcommand) — lists registered workflows.
      // -----------------------------------------------------------------------
      if (!subcommand || subcommand === "list") {
        const names = runtimeProxy.registry.names();
        if (names.length === 0) {
          print("Registered workflows: (none)");
        } else {
          print(`Registered workflows: ${names.join(", ")}`);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // status — band-header rich list, or per-run detail when an id is
      // supplied. `/workflow status` lists everything in-flight (`--all`
      // includes ended runs older than an hour); `/workflow status <id>`
      // drills into a single run via the inspectRun detail block.
      // -----------------------------------------------------------------------
      if (subcommand === "status") {
        const theme = deriveGraphTheme({});
        const target = parts[1];
        if (target && !target.startsWith("--")) {
          const resolved = resolveRunIdPrefix(target);
          if (resolved.kind === "not_found") {
            print(`Run not found: ${target}`);
            return;
          }
          if (resolved.kind === "ambiguous") {
            print(
              `Ambiguous run prefix "${target}" matches: ${resolved.matches
                .map((id) => id.slice(0, 12))
                .join(", ")}`,
            );
            return;
          }
          const inspected = inspectRun(resolved.runId);
          if (!inspected.ok) {
            print(`Run not found: ${target}`);
            return;
          }
          print(renderRunDetail(inspected.detail, { theme }));
          return;
        }
        const includeAll = parts.includes("--all");
        print(renderSessionList(store.runs(), { theme, includeAll }));
        return;
      }

      // -----------------------------------------------------------------------
      // kill — top-level chat fast path (no confirmation overlay).
      // -----------------------------------------------------------------------
      if (subcommand === "kill") {
        // The top-level chat command is the fast kill path surfaced by the
        // widget hint (`/workflow kill <id>`). The user's explicit slash
        // command should abort immediately, even when a confirm surface is
        // unavailable or would steal focus from the running workflow.
        const killArgs = parts.slice(1);
        const hasYes = killArgs.some((t) => t === "--yes" || t === "-y");
        await handleRunControlCommand(
          "kill",
          hasYes ? killArgs : [...killArgs, "-y"],
          ctx,
        );
        return;
      }

      // -----------------------------------------------------------------------
      // resume — unchanged.
      // -----------------------------------------------------------------------
      if (subcommand === "resume") {
        const target = parts[1] ?? "";
        if (!target) {
          print("Usage: /workflow resume <runId>");
          return;
        }
        const result = resumeRun(target);
        if (result.ok) {
          overlay.open(result.runId, overlaySurfaceFromContext(ctx));
          print(
            `Snapshot available: run ${result.runId} (${result.snapshot.name}) \u2014 status: ${result.snapshot.status}, stages: ${result.snapshot.stages.length}`,
          );
        } else {
          print(`Run not found: ${target}`);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // inputs — pretty-printed via theme; falls back to plain in non-TTY tests.
      // -----------------------------------------------------------------------
      if (subcommand === "inputs") {
        const workflowName = parts[1] ?? "";
        if (!workflowName) {
          print("Usage: /workflow inputs <name>");
          return;
        }
        const result = await runtimeForContext(ctx).dispatch({
          name: workflowName,
          inputs: {},
          action: "inputs",
        });
        if (result.action === "inputs" && "inputs" in result) {
          const r = result as Extract<WorkflowToolResult, { action: "inputs" }>;
          if (r.error) {
            const available = runtimeProxy.registry.names();
            print(
              `${r.error}\nAvailable: ${available.length > 0 ? available.join(", ") : "(none)"}`,
            );
          } else {
            print(renderInputsSchema(workflowName, r.inputs, { theme: deriveGraphTheme({}) }));
          }
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Workflow name dispatch — workflows always run as background tasks.
      // The chat editor remains usable; HIL prompts surface through the graph
      // viewer overlay (F2 / `/workflow connect`).
      // -----------------------------------------------------------------------
      const workflowName = subcommand;
      const inputTokens = parts.slice(1);

      if (inputTokens.includes("--help") || inputTokens.includes("-h")) {
        const helpResult = await runtimeForContext(ctx).dispatch({
          name: workflowName,
          inputs: {},
          action: "inputs",
        });
        if (helpResult.action === "inputs" && "inputs" in helpResult) {
          const r = helpResult as Extract<
            WorkflowToolResult,
            { action: "inputs" }
          >;
          if (r.error) {
            const available = runtimeProxy.registry.names();
            print(
              `${r.error}\nAvailable: ${available.length > 0 ? available.join(", ") : "(none)"}`,
            );
          } else {
            print(renderInputsSchema(workflowName, r.inputs, { theme: deriveGraphTheme({}) }));
          }
        }
        return;
      }

      const inputs = parseWorkflowArgs(inputTokens);
      // -----------------------------------------------------------------------
      // Interactive argument picker.
      //
      // Triggers when:
      //   - the workflow has at least one declared input (zero-input
      //     workflows go straight to dispatch — there's nothing to ask),
      //   - the user did not pass `--no-picker`,
      //   - an interactive TUI surface is available,
      //   - AND either no key=value was supplied or one of the required
      //     inputs is still missing after parsing.
      //
      // The picker is seeded with whatever the user *did* type, so a
      // partial invocation like `/workflow gen-spec research_doc=notes.md`
      // pre-fills that field and focuses the next unfilled required one.
      // -----------------------------------------------------------------------
      const wantsPickerSkip = inputTokens.includes("--no-picker");
      let mergedInputs = inputs;
      // Prefer the sticky inline form when the host can install a custom
      // editor. If the host rejects that editor contract at runtime, fall
      // back to the supported overlay picker rather than surfacing the host
      // exception as a workflow command error.
      const canOpenPicker =
        !wantsPickerSkip &&
        (typeof ctx.ui?.setEditorComponent === "function" ||
          typeof ctx.ui?.custom === "function");
      if (canOpenPicker) {
        const schemaResult = await runtimeForContext(ctx).dispatch({
          name: workflowName,
          inputs: {},
          action: "inputs",
        });
        const schema =
          schemaResult.action === "inputs" && "inputs" in schemaResult
            ? (schemaResult as Extract<WorkflowToolResult, { action: "inputs" }>)
            : undefined;
        const fields = schema?.inputs ?? [];
        const hasFields = fields.length > 0;
        const missingRequired = fields.some(
          (f) =>
            f.required === true &&
            (inputs[f.name] === undefined ||
              (typeof inputs[f.name] === "string" &&
                (inputs[f.name] as string).trim() === "")),
        );
        const noTokensAtAll = inputTokens.length === 0;
        if (hasFields && (noTokensAtAll || missingRequired)) {
          const pickerTheme = deriveGraphTheme({});
          let pickerResult =
            typeof ctx.ui?.setEditorComponent === "function"
              ? await openInlineInputsForm(pi, ctx, {
                  workflowName,
                  fields,
                  prefilled: inputs,
                  theme: pickerTheme,
                })
              : { kind: "unsupported" as const };
          if (
            pickerResult.kind === "unsupported" &&
            typeof ctx.ui?.custom === "function"
          ) {
            pickerResult = await openInputsPicker(ctx.ui, {
              workflowName,
              fields,
              prefilled: inputs,
              theme: pickerTheme,
            });
          }
          if (pickerResult.kind === "cancel") {
            print(`Cancelled. /workflow ${workflowName} not started.`);
            return;
          }
          if (pickerResult.kind === "run") {
            mergedInputs = pickerResult.values;
          }
        }
      }

      const result = await runtimeForContext(ctx).dispatch({
        name: workflowName,
        inputs: mergedInputs,
        action: "run",
      });
      if (result.action === "run" && "runId" in result) {
        const r = result as Extract<
          WorkflowToolResult,
          { action: "run"; runId: string }
        >;
        if (r.status === "failed" && r.runId === "") {
          const available = runtimeProxy.registry.names();
          print(
            `Workflow not found: ${workflowName}\nAvailable: ${available.length > 0 ? available.join(", ") : "(none)"}`,
          );
        } else if (r.status === "failed") {
          print(
            `Workflow "${workflowName}" failed: ${r.error ?? "unknown error"}`,
          );
        } else {
          // Always-background — the run is alive, the chat is free.
          print(renderBackgroundStartMessage(workflowName, r.runId));
        }
      }
      return;
    },
    getArgumentCompletions: (
      partial: string,
    ): PiArgumentCompletionResult => {
      const completeToken = (
        argumentText: string,
        candidates: PiArgumentCompletion[],
      ): PiArgumentCompletionResult => {
        const tokenStart = /\s$/.test(argumentText)
          ? argumentText.length
          : Math.max(argumentText.lastIndexOf(" "), argumentText.lastIndexOf("\t")) + 1;
        const head = argumentText.slice(0, tokenStart);
        const token = argumentText.slice(tokenStart);
        const filtered = candidates
          .filter((candidate) => candidate.value.startsWith(token))
          .map((candidate) => ({
            ...candidate,
            value: `${head}${candidate.value}`,
          }));
        return filtered.length > 0 ? filtered : null;
      };

      const workflowNameItems = (): PiArgumentCompletion[] =>
        runtimeProxy.registry.names().map((name) => ({
          value: `${name} `,
          label: name,
          description: `Run workflow: ${name}`,
        }));

      const runIdItems = (): PiArgumentCompletion[] =>
        store.runs().map((run) => ({
          value: `${run.id} `,
          label: run.id.slice(0, 8),
          description: `${run.name} — ${run.status}`,
        }));

      const adminCompletions: PiArgumentCompletion[] = [
        {
          value: "connect ",
          label: "connect",
          description: "Attach to a run (picker if no id)",
        },
        {
          value: "list ",
          label: "list",
          description: "List registered workflows",
        },
        {
          value: "status ",
          label: "status",
          description: "List in-flight runs",
        },
        { value: "kill ", label: "kill", description: "Abort a run" },
        {
          value: "resume ",
          label: "resume",
          description: "Re-open overlay for a run",
        },
        {
          value: "inputs ",
          label: "inputs",
          description: "Show a workflow's input schema",
        },
      ];

      const parts = partial.trim().split(/\s+/).filter(Boolean);
      const subcommand = parts[0] ?? "";
      if (!partial.includes(" ")) {
        return completeToken(partial, [...adminCompletions, ...workflowNameItems()]);
      }

      if (subcommand === "inputs") {
        return completeToken(partial, workflowNameItems());
      }

      if (subcommand === "status") {
        return completeToken(partial, [
          { value: "--all ", label: "--all", description: "Include recently ended runs" },
          ...runIdItems(),
        ]);
      }

      if (subcommand === "connect") {
        return completeToken(partial, runIdItems());
      }

      if (subcommand === "resume") {
        return completeToken(partial, runIdItems());
      }

      if (subcommand === "kill") {
        return completeToken(partial, [
          { value: "--all ", label: "--all", description: "Abort all in-flight runs" },
          { value: "--yes ", label: "--yes", description: "Skip confirmation" },
          { value: "-y ", label: "-y", description: "Skip confirmation" },
          ...runIdItems(),
        ]);
      }

      const workflow = runtimeProxy.registry.get(subcommand);
      if (!workflow) return null;

      const tokenStart = /\s$/.test(partial)
        ? partial.length
        : Math.max(partial.lastIndexOf(" "), partial.lastIndexOf("\t")) + 1;
      const token = partial.slice(tokenStart);
      const equalsIndex = token.indexOf("=");
      if (equalsIndex > 0) {
        const inputName = token.slice(0, equalsIndex);
        const schema = workflow.inputs[inputName];
        if (schema?.type === "select") {
          return completeToken(
            partial,
            schema.choices.map((choice) => ({
              value: `${inputName}=${choice} `,
              label: choice,
              description: inputName,
            })),
          );
        }
        if (schema?.type === "boolean") {
          return completeToken(partial, [
            { value: `${inputName}=true `, label: "true", description: inputName },
            { value: `${inputName}=false `, label: "false", description: inputName },
          ]);
        }
        return null;
      }

      const inputCompletions: PiArgumentCompletion[] = Object.entries(workflow.inputs)
        .map(([name, schema]) => ({
          value: `${name}=`,
          label: name,
          description: schema.description,
        }));
      return completeToken(partial, [
        { value: "--no-picker ", label: "--no-picker", description: "Skip interactive input picker" },
        { value: "--help ", label: "--help", description: "Show this workflow's input schema" },
        ...inputCompletions,
      ]);
    },
  });

  // -------------------------------------------------------------------------
  // 3. Register /workflows-doctor slash command
  // -------------------------------------------------------------------------
  tryRegisterSlashCommand(pi, {
    name: "workflows-doctor",
    description:
      "Diagnostics: loaded workflows, runtime capabilities, config validation.",
    execute: async (_args: string, ctx: PiCommandContext) => {
      const print = commandPrint(ctx);
      // Use already-discovered unified registry when available; fall back to bundled-only.
      const discovery =
        discoveryRef.current ?? (await discoverBundledWorkflows());
      const siblings: DoctorSiblingStatus = {
        taskDelegation: adapters.subagent !== undefined,
        // MCP scope events: pi.events.emit present (used by setMcpScope to emit mcp.scope.set)
        mcpScopeEvents: typeof pi.events?.emit === "function",
        // oh-my-pi exposes setSessionName on the ExtensionAPI.
        sessionNaming: typeof pi.setSessionName === "function",
        // HIL adapter available when command context exposes UI.
        hil: ctx.ui !== undefined,
        // ui.custom overlay available on the live command context.
        uiCustom:
          typeof ctx.ui?.custom === "function" ||
          typeof pi.ui?.custom === "function",
        // F2/shortcut registration available
        shortcut: typeof pi.registerShortcut === "function",
        // persistence appendEntry available
        persistenceAppendEntry: typeof pi.appendEntry === "function",
        // Runtime adapter capabilities mirror buildRuntimeAdapters.
        agentSessionAdapter: adapters.agentSession !== undefined,
        subagentAdapterVia: adapters.subagent !== undefined ? "task tool" : "unavailable",
      };
      print(buildDoctorReport(discovery, siblings, configLoadRef.current));
    },
  });

  // -------------------------------------------------------------------------
  // 4. Register message renderers for lifecycle events (§5.6)
  // -------------------------------------------------------------------------
  // Chat-scroll renderers are deliberately limited to run-level events
  // (start + end). Per-stage chatter is owned by the orchestrator pane —
  // duplicating it into chat scroll just creates visual noise and pushes
  // older chat content out of view every time a stage transitions.
  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("workflow.run.start", (payload) =>
      renderRunBanner(payload as RunStartPayload),
    );
    pi.registerMessageRenderer("workflow.run.end", (payload) =>
      renderRunSummary(payload as RunEndPayload),
    );
    // Inline workflow-input form (Option C in the design conversation):
    // a sticky chat-history card driven by a custom EditorComponent. The
    // renderer reads form state from the module-level store keyed by
    // `details.formId`. Registered once; openInlineInputsForm() emits the
    // card via pi.sendMessage on each invocation.
    registerInlineFormRenderer(pi, deriveGraphTheme({}));
  }

  // -------------------------------------------------------------------------
  // 5. Register CLI flags (§5.13) + wire runWorkflowFromCliFlags
  //    registerWorkflowCliFlags replaces manual pi.registerFlag calls.
  //    runWorkflowFromCliFlags is dispatched on session_start (pi.on available)
  //    or after discovery resolves as a safe fallback.
  // -------------------------------------------------------------------------
  registerWorkflowCliFlags(pi);

  // -------------------------------------------------------------------------
  // 6. Persistence: session_start restore + session_before_compact hook (§5.6, Phase D)
  //    + runWorkflowFromCliFlags startup dispatch (§5.13)
  // -------------------------------------------------------------------------
  if (typeof pi.on === "function") {
    pi.on("session_start", async (_event, ctx) => {
      // Workflow lifecycle is scoped to the originating chat session.
      // A new session inherits a clean store; any leftover runs from a
      // previous session in the same pi process are killed (subprocess
      // aborted) and dropped. `restoreOnSessionStart` below then loads
      // *this* session's persisted runs from disk.
      killAllRuns({
        store,
        cancellation: cancellationRegistry,
        persistence: persistenceRef.current,
      });
      store.clear();

      // pi-intercom session naming lives here so we don't trip the
      // loader's "Action methods cannot be called during extension
      // loading" guard.
      registerIntercomParentSession(pi);

      // Ensure config+discovery are ready before restoring in-flight runs and
      // dispatching CLI workflow flags — tunables must be resolved first.
      await discoveryPromise;
      if (ctx?.ui) {
        storeWidgetUnsubscribe?.();
        storeWidgetUnsubscribe = installStoreWidget({ ui: ctx.ui }, store);
      }

      const cliResult = await runWorkflowFromCliFlags({
        runtime: runtimeForContext(ctx),
      });
      printCliWorkflowResult(cliResult);

      const sessionManager = ctx?.sessionManager ?? pi.sessionManager;
      if (sessionManager) {
        const cfg = configLoadRef.current?.config;
        restoreOnSessionStart(
          sessionManager,
          {
            resumeInFlight: cfg?.resumeInFlight ?? "ask",
            persistRuns: cfg?.persistRuns ?? true,
          },
          store,
        );
      }
    });

    installCompactionHook(pi, store);
    pi.on("session_shutdown", () => {
      // Tie workflow lifecycle to the chat: when the chat ends, every
      // in-flight workflow is killed so we don't leave subprocesses
      // burning tokens with no UI to surface their progress.
      killAllRuns({
        store,
        cancellation: cancellationRegistry,
        persistence: persistenceRef.current,
      });
      storeWidgetUnsubscribe?.();
      storeWidgetUnsubscribe = null;
    });
  } else {
    // Safe fallback when pi.on is unavailable: dispatch CLI flags after discovery.
    void discoveryPromise.then(() => {
      void runWorkflowFromCliFlags({ runtime: runtimeProxy }).then(
        printCliWorkflowResult,
      );
    });
  }

  storeWidgetUnsubscribe = installStoreWidget(pi, store);
  installToolExecutionHooks(pi, store);

  // -------------------------------------------------------------------------
  // 7b. Register F2 keyboard shortcut — open graph overlay for active run.
  //     Falls back to noop when pi.registerShortcut is absent (degraded runtime).
  //     Existing API shape: (key, { description, handler }).
  //
  //     Note: the historical `ctrl+h` toggle was removed when workflow runs
  //     became background-by-default — a global toggle is no longer the
  //     primary way to manage visibility. Inside the pane, press `h` to
  //     hide (calls setHidden(true) on the overlay handle); re-open via
  //     `F2` or `/workflow connect <id>`.
  // -------------------------------------------------------------------------
  if (typeof pi.registerShortcut === "function") {
    // Prefer the in-flight run; if nothing's active, fall back to the
    // most recently observed run so users can still review what just
    // finished without typing `/workflow resume <id>`.
    const openPane = (ctx?: PiCommandContext): void => {
      const activeRunId = store.activeRunId();
      const fallback = activeRunId ?? store.runs().at(-1)?.id ?? null;
      overlay.open(fallback, overlaySurfaceFromContext(ctx));
    };

    pi.registerShortcut("F2", {
      description: "Open workflow orchestrator pane",
      handler: openPane,
    });
  }

  // -------------------------------------------------------------------------
  // 8. Register sibling integrations (Phase G — §5.8, §5.9, §5.10)
  // All registration calls are guarded; no throw when sibling is absent.
  // Note: registerIntercomParentSession (pi-intercom session naming) calls
  // pi.setSessionName which is an action method — see session_start handler
  // above for that registration.
  // -------------------------------------------------------------------------

  // pi-intercom: route subagent:control-intercom events to overlay/store callbacks.
  // buildIntercomCallbacks wires store.recordNotice, pi.ui.confirm (when present),
  // and pi.events.emit (when present) so escalations are never silently dropped.
  subscribeIntercomControl(
    pi,
    buildIntercomCallbacks({
      store,
      emit:
        typeof pi.events?.emit === "function"
          ? (event, payload) => pi.events!.emit!(event, payload)
          : undefined,
      confirm:
        typeof pi.ui?.confirm === "function"
          ? (title, message) => pi.ui!.confirm!(title, message)
          : undefined,
    }),
  );
}

export default factory;
