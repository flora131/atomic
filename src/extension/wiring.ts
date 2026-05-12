/**
 * Runtime wiring helpers — construct StageAdapters from oh-my-pi runtime
 * surfaces.
 *
 * `buildRuntimeAdapters` uses oh-my-pi's in-process SDK (`createAgentSession`)
 * for workflow stages. Workflow authors can pass createAgentSession options
 * directly to `ctx.stage(name, options?)`; the executor strips workflow-only
 * `mcp` before session creation.
 *
 * HIL routing (workflow `ctx.ui.input/confirm/select/editor`) does NOT live
 * here. Background workflows route through the store-backed background UI
 * adapter in `src/extension/background-ui-adapter.ts`; pi.ui dialogs are
 * reserved for chrome (kill confirm, picker overlays, the graph viewer).
 *
 * cross-ref: src/runs/foreground/stage-runner.ts
 *            src/extension/index.ts
 *            oh-my-pi docs/sdk.md createAgentSession
 */

import type { CreateAgentSessionOptions } from "@oh-my-pi/pi-coding-agent";
import type { StageAdapters, StageSessionRuntime } from "../runs/foreground/stage-runner.js";
import type { StageExecutionMeta, StageOptions, SubagentStageOpts } from "../shared/types.js";
import { readWorkflowEnv } from "./subagents.js";

// ---------------------------------------------------------------------------
// Minimal oh-my-pi surface
// ---------------------------------------------------------------------------

/**
 * Minimal oh-my-pi runtime surface needed to build stage adapters.
 * SDK stage creation uses the host-injected pi-coding-agent exports.
 */
export interface PiExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

export interface PiExecOpts {
  signal?: AbortSignal;
  timeout?: number;
}

export interface RuntimeWiringSurface {
  exec?: (command: string, args: string[], opts?: PiExecOpts) => Promise<PiExecResult>;
  createAgentSession?: (options?: CreateAgentSessionOptions) => Promise<{ session: StageSessionRuntime }>;
  pi?: {
    createAgentSession?: (options?: CreateAgentSessionOptions) => Promise<{ session: StageSessionRuntime }>;
  };
  callTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
}

export interface RuntimeAdapterBuildOptions {
  /** Deprecated no-op retained only for callers that still pass it. */
  preferSubprocess?: boolean;
  /** Test-only seam for SDK session creation. */
  createAgentSession?: (options?: CreateAgentSessionOptions) => Promise<{ session: StageSessionRuntime }>;
}


function isNodeTestContext(): boolean {
  return process.env["NODE_TEST_CONTEXT"] !== undefined;
}

async function createTestAgentSession(_options?: CreateAgentSessionOptions): Promise<{ session: StageSessionRuntime }> {
  let lastAssistantText: string | undefined;
  const session: StageSessionRuntime = {
    async prompt(text: string): Promise<string> {
      lastAssistantText = `stub:sdk:${text.slice(0, 120)}`;
      return lastAssistantText;
    },
    async steer(_text: string): Promise<void> {},
    async followUp(_text: string): Promise<void> {},
    subscribe(): () => void {
      return () => {};
    },
    sessionFile: undefined,
    sessionId: `test-session-${crypto.randomUUID()}`,
    async setModel(_model): Promise<void> {},
    setThinkingLevel(_level): void {},
    async cycleModel() {
      return undefined;
    },
    cycleThinkingLevel() {
      return undefined;
    },
    agent: Object.create(null) as StageSessionRuntime["agent"],
    model: undefined,
    thinkingLevel: "off",
    messages: [] as StageSessionRuntime["messages"],
    isStreaming: false as StageSessionRuntime["isStreaming"],
    async navigateTree(): ReturnType<StageSessionRuntime["navigateTree"]> {
      return { cancelled: true };
    },
    async compact(): ReturnType<StageSessionRuntime["compact"]> {
      return { summary: "", firstKeptEntryId: "", tokensBefore: 0 };
    },
    abortCompaction(): void {},
    async abort(): Promise<void> {},
    dispose(): void {},
    getLastAssistantText(): string | undefined {
      return lastAssistantText;
    },
  };
  return { session };
}

export function extractAssistantText(ndjson: string): string {
  const lines = ndjson.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event["type"] !== "message_end") continue;
      const message = event["message"] as Record<string, unknown> | undefined;
      if (message?.["role"] !== "assistant") continue;
      const content = message["content"];
      if (!Array.isArray(content)) continue;
      const text = (content as Array<Record<string, unknown>>)
        .filter((block) => block["type"] === "text")
        .map((block) => String(block["text"] ?? ""))
        .join("");
      if (text) return text;
    } catch {
      // Skip malformed NDJSON lines.
    }
  }
  return "";
}

function stripWorkflowOnlyOptions(options: StageOptions | undefined): CreateAgentSessionOptions | undefined {
  if (!options) return options;
  const { mcp: _mcp, ...sessionOptions } = options;
  return sessionOptions;
}

function workflowEnvRecord(meta?: StageExecutionMeta): Record<string, string> {
  const raw = readWorkflowEnv();
  const out: Record<string, string> = {};
  if (raw.PI_WORKFLOW_RUN_ID) out["PI_WORKFLOW_RUN_ID"] = raw.PI_WORKFLOW_RUN_ID;
  if (raw.PI_WORKFLOW_STAGE_ID) out["PI_WORKFLOW_STAGE_ID"] = raw.PI_WORKFLOW_STAGE_ID;
  if (meta?.runId) out["PI_WORKFLOW_RUN_ID"] = meta.runId;
  if (meta?.stageId) out["PI_WORKFLOW_STAGE_ID"] = meta.stageId;
  return out;
}

/**
 * Build StageAdapters from available oh-my-pi runtime surfaces.
 *
 * The resulting stage adapter creates an in-process oh-my-pi SDK AgentSession
 * for each workflow stage. There is no subprocess and no custom NDJSON parsing
 * path here; stage.prompt() delegates directly to AgentSession.prompt().
 */
export function buildRuntimeAdapters(
  pi: RuntimeWiringSurface,
  options: RuntimeAdapterBuildOptions = {},
): StageAdapters {
  const createSession = options.createAgentSession ?? pi.createAgentSession ?? pi.pi?.createAgentSession ?? (isNodeTestContext() ? createTestAgentSession : undefined);
  const adapters: StageAdapters = {};

  if (createSession !== undefined) {
    adapters.agentSession = {
      async create(stageOptions: StageOptions): Promise<StageSessionRuntime> {
        const result = await createSession(stripWorkflowOnlyOptions(stageOptions));
        return result.session;
      },
    };
  }

  if (typeof pi.callTool === "function") {
    adapters.subagent = {
      subagent(opts: SubagentStageOpts, meta?: StageExecutionMeta): Promise<string> {
        const args: Record<string, unknown> = {
          action: "run",
          agent: opts.agent,
          task: opts.task,
          env: workflowEnvRecord(meta),
        };
        if (opts.context !== undefined) args["context"] = opts.context;
        return pi.callTool!("subagent", args);
      },
    };
  }

  return adapters;
}

// ---------------------------------------------------------------------------
// UI adapter — maps oh-my-pi ctx.ui dialog surface to WorkflowUIAdapter
// ---------------------------------------------------------------------------

/**
 * Subset of oh-my-pi's ExtensionUIDialogOptions consumed by the adapter.
 * Structurally matched against @oh-my-pi/pi-coding-agent
 * ExtensionUIDialogOptions.
 */
export interface PiUIDialogOptions {
  /** AbortSignal to programmatically dismiss the dialog. */
  signal?: AbortSignal;
  /** Timeout in milliseconds. */
  timeout?: number;
}

/**
 * Handle returned by pi.ui.custom() to dismiss the overlay.
 */
export interface PiCustomOverlayHandle {
  close(): void;
}

/**
 * Legacy object-shaped options passed by older mocks to pi.ui.custom().
 * Real pi uses `ctx.ui.custom(factory, { overlay: true, overlayOptions })`.
 */
export interface PiCustomOverlayOpts {
  /** When true, renders as a full-screen overlay rather than an inline widget. */
  overlay: true;
  overlayOptions?: {
    width?: number | string;
    minWidth?: number;
    maxHeight?: number | string;
    anchor?: string;
    margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
  };
  /** Render callback — returns lines to display. width is terminal columns. */
  render?: (width: number) => string[];
  /** Keyboard input handler — returns true when the key was consumed. */
  onInput?: (data: string) => boolean;
  /** Called when the host UI closes the overlay (e.g. user navigates away). */
  onClose?: () => void;
}

export interface PiCustomComponent {
  render(width: number): string[];
  handleInput?: (data: string) => void;
  invalidate?: () => void;
  dispose?: () => void;
}

/**
 * Handle exposed by oh-my-pi's TUI for controlling a live overlay. Mirrors the
 * shape from @oh-my-pi/pi-tui `OverlayHandle` — `setHidden(true)`
 * temporarily hides the overlay (cheap to flip on/off, used for a
 * show/hide toggle), `hide()` permanently dismisses it.
 */
export interface PiOverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;
  unfocus(): void;
  isFocused(): boolean;
}

export interface PiCustomOverlayRealOptions {
  /**
   * `true` mounts a floating popup; `false` mounts a focused full-screen
   * pi-tui pane that takes keyboard focus and renders in place of the
   * chat until the factory's `done()` callback fires.
   */
  overlay: boolean;
  overlayOptions?: PiCustomOverlayOpts["overlayOptions"];
  /**
   * Optional callback invoked with the OverlayHandle once pi-tui mounts
   * the overlay. Use to drive show/hide toggles without re-mounting.
   */
  onHandle?: (handle: PiOverlayHandle) => void;
}

export type PiCustomOverlayFactory = (
  tui: { requestRender?: () => void },
  theme: unknown,
  keybindings: unknown,
  done: (result: undefined) => void,
) => PiCustomComponent | Promise<PiCustomComponent>;

export type PiCustomOverlayFunction =
  | ((opts: PiCustomOverlayOpts) => PiCustomOverlayHandle | undefined)
  | ((
      factory: PiCustomOverlayFactory,
      options: PiCustomOverlayRealOptions,
    ) => Promise<undefined> | undefined);

/**
 * Structural shape of oh-my-pi's custom editor component. Interactive mode
 * currently installs extension editors through `InteractiveMode.setEditorComponent`,
 * which expects the richer `CustomEditor` surface and configures these methods
 * before mounting. Keep the extra methods optional for lightweight tests and
 * non-interactive shims, but real custom editors should implement them.
 *
 * The resize-handler contract (`setTopBorder` / `getTopBorderAvailableWidth`)
 * is invoked unconditionally by `InteractiveMode`'s `process.stdout` "resize"
 * listener — any custom editor mounted via `setEditorComponent` MUST provide
 * them or the host throws `TypeError` on the first terminal resize.
 */
export interface PiEditorComponent {
  focused?: boolean;
  getText(): string;
  setText(text: string): void;
  handleInput(data: string): void;
  render(width: number): string[];
  invalidate?(): void;
  dispose?(): void;
  onSubmit?: (text: string) => void | Promise<void>;
  onChange?: (text: string) => void;
  onAutocompleteCancel?: () => void;
  onAutocompleteUpdate?: () => void;
  setUseTerminalCursor?(useTerminalCursor: boolean): void;
  getUseTerminalCursor?(): boolean;
  setAutocompleteMaxVisible?(maxVisible: number): void;
  getAutocompleteMaxVisible?(): number;
  setMaxHeight?(maxHeight: number | undefined): void;
  setHistoryStorage?(storage: object): void;
  setActionKeys?(action: string, keys: readonly string[]): void;
  setCustomKeyHandler?(key: string, handler: () => void): void;
  removeCustomKeyHandler?(key: string): void;
  clearCustomKeyHandlers?(): void;
  setAutocompleteProvider?(provider: object): void;
  addToHistory?(text: string): void;
  insertTextAtCursor?(text: string): void;
  getExpandedText?(): string;
  setPaddingX?(padding: number): void;
  setTopBorder?(content: unknown): void;
  getTopBorderAvailableWidth?(terminalWidth: number): number;
}

export type PiEditorFactory = (
  tui: { requestRender?: () => void },
  theme: unknown,
  keybindings: unknown,
) => PiEditorComponent;

/**
 * Structural type for the oh-my-pi UI dialog surface.
 * Matches @oh-my-pi/pi-coding-agent ExtensionUIContext dialog methods.
 * All fields optional — presence is checked at runtime before building adapter.
 */
export interface PiUISurface {
  /** Show a text input dialog. Returns undefined when user dismisses. */
  input?: (title: string, placeholder?: string, opts?: PiUIDialogOptions) => Promise<string | undefined>;
  /** Show a confirmation dialog. */
  confirm?: (title: string, message: string, opts?: PiUIDialogOptions) => Promise<boolean>;
  /** Show a selector and return the user's choice. Returns undefined when user dismisses. */
  select?: (title: string, options: string[], opts?: PiUIDialogOptions) => Promise<string | undefined>;
  /** Show a multi-line editor. Returns undefined when user dismisses. */
  editor?: (title: string, prefill?: string) => Promise<string | undefined>;
  /** Set a live widget above or below the editor. */
  setWidget?: (
    key: string,
    factory: ((tui: unknown, theme: unknown) => { render(width: number): string[]; dispose?(): void }) | undefined,
    opts?: { placement?: string },
  ) => void;
  /** Show a custom component or overlay. */
  custom?: PiCustomOverlayFunction;
  /**
   * Install a custom editor (replaces the bottom input bar) until cleared
   * with `setEditorComponent(undefined)`. Used by the inline workflow
   * input form to capture per-field keystrokes.
   * cross-ref: docs/extensions.md §Custom Editor (pi-coding-agent).
   */
  setEditorComponent?: (factory: PiEditorFactory | undefined) => void;
  /** Return the currently-installed editor factory, or undefined for the default. */
  getEditorComponent?: () => PiEditorFactory | undefined;
}

/**
 * Runtime surface that includes the optional UI dialog surface.
 * Used by command/overlay code (slash command kill confirm, graph overlay
 * mount, picker overlays) to interact with `pi.ui.custom`, `pi.ui.confirm`,
 * etc.  HIL routing — `ctx.ui.input/confirm/select/editor` inside a workflow
 * body — no longer flows through this surface; that's the store-backed
 * background adapter's job (`src/extension/background-ui-adapter.ts`).
 */
export interface UIWiringSurface {
  ui?: PiUISurface;
}
