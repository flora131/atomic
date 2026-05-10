/**
 * DaemonWorkflowContext — daemon-resident WorkflowContext implementation.
 *
 * Replaces the stub makeStubContext() in run-manager.ts with a real
 * implementation that:
 *   - Integrates with RunState (addStage / sessionStarted / sessionEnded).
 *   - Spawns agent subprocesses via the typed ISupervisor interface.
 *   - Awaits subprocess exit via the minimal `onExit` promise seam added
 *     to ISupervisor.spawn.
 *   - Reads transcripts and saved messages from the daemon's session
 *     directory layout (~/.atomic/sessions/<runId>/<stageName>/).
 *
 * Shape is compatible with the SDK's WorkflowContext<AgentType> so that
 * existing builtin workflows can call ctx.stage() without hitting a stub.
 * The `run` callback (4th arg to stage) is accepted and invoked with a
 * DaemonSessionContext; provider SDK clients/sessions are initialised by
 * this context for full SDK-style stages.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { AgentType } from "../types.ts";
import type { ISupervisor } from "./ui-protocol/methods.ts";
import { GraphFrontierTracker } from "./graph-inference.ts";
import type { RunState } from "./run-state.ts";
import { AGENT_CONFIG } from "../services/config/definitions.ts";
import { getProviderOverrides } from "../services/config/atomic-config.ts";
import { getCopilotScmDisableFlags } from "../services/config/scm-sync.ts";
import { buildSpawnEnv } from "../lib/terminal-env.ts";
import { getListeningPortForPid } from "./port-discovery.ts";
import { errorMessage } from "../errors.ts";
import {
  type CopilotHILSessionSurface,
  type OpenCodeHILEvent,
  watchCopilotSessionForElicitation,
  watchCopilotSessionForHIL,
  watchOpencodeStreamForHIL,
} from "./hil-watchers.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Resolved stage name + session metadata kept after a stage completes. */
interface CompletedStageRecord {
  sessionId: string;
  sessionDir: string;
}

interface CompletedStageLookup {
  stageName: string;
  record: CompletedStageRecord;
}

/** Subset of SessionRunOptions that the daemon context cares about. */
interface StageNameOptions {
  name: string;
  description?: string;
  headless?: boolean;
}

/** Options accepted by DaemonWorkflowContext.stage() simple 2-arg form. */
export interface DaemonStageOptions {
  /** CLI args forwarded verbatim to the agent subprocess. */
  args?: string[];
  /** Extra environment variables merged into the subprocess environment. */
  env?: Record<string, string>;
  /** Human-readable description (tracked in RunState). */
  description?: string;
}

/** Opaque handle returned by ctx.stage(). Compatible with SessionHandle<T>. */
export interface DaemonSessionHandle<T = void> {
  readonly name: string;
  readonly id: string;
  readonly result: T;
}

/**
 * Minimal SessionContext passed to the stage run callback.
 *
 * Provides daemon-mode identity, inputs, persistence, nested stage helpers,
 * and provider SDK client/session objects for full SDK-style stages.
 */
export interface DaemonSessionContext {
  /** Provider-specific SDK client. */
  client: object;
  /** Provider-specific SDK session. */
  session: object;
  /** Which agent is running this stage. */
  agent: AgentType;
  /** Structured workflow inputs. */
  inputs: Record<string, unknown>;
  /** Session UUID generated at stage spawn time. */
  sessionId: string;
  /** Persist provider output for later transcript/getMessages reads. */
  save(arg: object[] | object | string): Promise<void>;
  /** Absolute path to this stage's storage directory. */
  sessionDir: string;
  /** PTY pane identifier (pid as string in daemon mode). */
  paneId: string;
  /** Spawn a nested sub-stage from within a stage callback. */
  stage: DaemonWorkflowContext["stage"];
  /** Read the rendered transcript of a completed stage. */
  transcript: DaemonWorkflowContext["transcript"];
  /** Read raw saved messages of a completed stage. */
  getMessages: DaemonWorkflowContext["getMessages"];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mergeStringArrays(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function renderSavedRecords(records: object[]): string {
  return records
    .map((record) => {
      const data = (record as { data?: unknown }).data;
      if (typeof data === "string") return data;
      if (data && typeof data === "object") {
        const maybeText = data as { text?: unknown; content?: unknown; message?: unknown };
        if (typeof maybeText.text === "string") return maybeText.text;
        if (typeof maybeText.content === "string") return maybeText.content;
        if (typeof maybeText.message === "string") return maybeText.message;
      }
      return JSON.stringify(data ?? record, null, 2);
    })
    .join("\n\n---\n\n");
}

interface CopilotSendSessionSurface {
  on(eventType: string, handler: (event: { data?: unknown }) => void): () => void;
}

function wrapCopilotSendUntilIdle<O, R>(
  session: CopilotSendSessionSurface,
  nativeSend: (options: O) => Promise<R>,
): (options: O) => Promise<R> {
  return async (options: O): Promise<R> => {
    const idle = new Promise<void>((resolve, reject) => {
      let unsubIdle: (() => void) | undefined;
      let unsubError: (() => void) | undefined;
      const cleanup = () => {
        unsubIdle?.();
        unsubError?.();
      };
      unsubIdle = session.on("session.idle", () => {
        cleanup();
        resolve();
      });
      unsubError = session.on("session.error", (event) => {
        cleanup();
        const data = event.data as { message?: string } | undefined;
        reject(new Error(data?.message ?? "Copilot session error"));
      });
    });
    const result = await nativeSend(options);
    await idle;
    return result;
  };
}

function readChatFlags(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

interface OpenCodeHILClientSurface {
  event?: {
    subscribe?: () => Promise<{ stream: AsyncIterable<OpenCodeHILEvent> }>;
  };
}

/**
 * Bridge provider-specific HIL events into RunState so daemon panel snapshots
 * preserve the pre-daemon graph-node `awaiting_input` behaviour.
 */
export async function attachDaemonHILWatchers(opts: {
  agent: AgentType;
  stageName: string;
  state: Pick<RunState, "sessionAwaitingInput" | "sessionResumed">;
  client: object;
  session: object;
  getSessionId: () => string;
}): Promise<() => void> {
  let active = true;
  const onHIL = (waiting: boolean): void => {
    if (!active) return;
    if (waiting) opts.state.sessionAwaitingInput(opts.stageName);
    else opts.state.sessionResumed(opts.stageName);
  };

  if (opts.agent === "copilot") {
    const session = opts.session as CopilotHILSessionSurface;
    const unsubscribeTool = watchCopilotSessionForHIL(session, onHIL);
    const unsubscribeElicitation = watchCopilotSessionForElicitation(session, onHIL);
    return () => {
      active = false;
      unsubscribeTool();
      unsubscribeElicitation();
    };
  }

  if (opts.agent === "opencode") {
    const client = opts.client as OpenCodeHILClientSurface;
    const subscribe = client.event?.subscribe;
    if (!subscribe) return () => { active = false; };

    const sessionId = opts.getSessionId();
    try {
      const { stream } = await subscribe();
      watchOpencodeStreamForHIL(stream, sessionId, onHIL).catch((err) => {
        console.warn(
          `[opencode] HIL event stream disconnected for session ${sessionId}: ${errorMessage(err)}`,
        );
      });
    } catch (err) {
      console.warn(
        `[opencode] HIL event stream failed to subscribe for session ${sessionId}: ${errorMessage(err)}`,
      );
    }
    return () => { active = false; };
  }

  return () => { active = false; };
}

// ─── Constructor options ──────────────────────────────────────────────────────

export interface DaemonWorkflowContextOptions {
  runId: string;
  agent: AgentType;
  inputs: Record<string, unknown>;
  state: RunState;
  supervisor: ISupervisor;
  /** Initial PTY columns for visible workflow stages. */
  initialCols?: number;
  /** Initial PTY rows for visible workflow stages. */
  initialRows?: number;
  /**
   * Base directory for per-run session data.
   * Defaults to ~/.atomic/sessions.
   */
  sessionsBaseDir?: string;
  /**
   * Called immediately after a stage subprocess is spawned and its PID is
   * known.  RunManager uses this to register the PID for kill-on-stop.
   */
  onStagePidRegistered?: (runId: string, stageName: string, pid: number) => void;
  /**
   * Called when a stage subprocess exits (for any reason, including error).
   * RunManager uses this to remove the PID from its active-PIDs set.
   */
  onStagePidReleased?: (runId: string, stageName: string, pid: number) => void;
}

// ─── DaemonWorkflowContext ────────────────────────────────────────────────────

/**
 * Daemon-resident implementation of WorkflowContext.
 *
 * Designed to be the direct drop-in for makeStubContext() in RunManager.
 * The stage() method signature is intentionally flexible so it accepts
 * both the simplified (name, opts?) daemon form and the full SDK
 * (SessionRunOptions, clientOpts, sessionOpts, runFn) form used by
 * builtin workflows.
 */
export class DaemonWorkflowContext {
  readonly inputs: Record<string, unknown>;
  readonly agent: AgentType;

  private readonly runId: string;
  private readonly state: RunState;
  private readonly supervisor: ISupervisor;
  private readonly sessionsBaseDir: string;
  private readonly initialCols: number | undefined;
  private readonly initialRows: number | undefined;
  private readonly onStagePidRegistered:
    | ((runId: string, stageName: string, pid: number) => void)
    | undefined;
  private readonly onStagePidReleased:
    | ((runId: string, stageName: string, pid: number) => void)
    | undefined;

  /** Completed stage records keyed by stage name. */
  private readonly completedStages = new Map<string, CompletedStageRecord>();
  /** Infers graph parents from stage spawn/settle ordering. */
  private readonly graphTracker = new GraphFrontierTracker("orchestrator");

  constructor(opts: DaemonWorkflowContextOptions) {
    this.runId = opts.runId;
    this.agent = opts.agent;
    this.inputs = opts.inputs;
    this.state = opts.state;
    this.supervisor = opts.supervisor;
    this.sessionsBaseDir =
      opts.sessionsBaseDir ??
      join(homedir(), ".atomic", "sessions");
    this.initialCols = opts.initialCols;
    this.initialRows = opts.initialRows;
    this.onStagePidRegistered = opts.onStagePidRegistered;
    this.onStagePidReleased = opts.onStagePidReleased;
  }

  // ─── stage() ───────────────────────────────────────────────────────────────

  /**
   * Spawn a stage subprocess, register it in RunState, and await its exit.
   *
   * Overloaded to accept:
   *   1. Simple daemon form: `stage(name, opts?)`
   *   2. Full SDK form:      `stage(options, clientOpts, sessionOpts, run)`
   *
   * In both forms the subprocess is spawned via ISupervisor.  When a `run`
   * callback is provided it is invoked with a DaemonSessionContext immediately
   * after spawn succeeds (before subprocess exit) so it can interact with the
   * live subprocess.  The stage only settles after BOTH the callback and the
   * subprocess have completed.
   */
  stage<T = void>(
    nameOrOptions: string | StageNameOptions,
    optsOrClientOpts?: DaemonStageOptions | Record<string, unknown>,
    _sessionOpts?: Record<string, unknown>,
    run?: (ctx: DaemonSessionContext) => Promise<T>,
  ): Promise<DaemonSessionHandle<T>> {
    this.throwIfCancelled();
    // Normalise first arg to a plain name string + description.
    const name =
      typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
    const description =
      typeof nameOrOptions === "string"
        ? (optsOrClientOpts as DaemonStageOptions | undefined)?.description
        : nameOrOptions.description;

    // Full SDK-style workflow stages (the builtin workflows use this form)
    // should not spawn a naked agent CLI and then pass an empty context to the
    // callback. In daemon mode we run those stages through provider SDKs in
    // headless mode until the PTY-backed interactive layer is complete.
    if (run && typeof nameOrOptions !== "string") {
      const sessionId = randomUUID();
      const sessionDir = join(this.sessionsBaseDir, this.runId, name);
      const providerStageOptions = {
        name,
        description,
        clientOpts: optsOrClientOpts as Record<string, unknown> | undefined,
        sessionOpts: _sessionOpts,
        sessionId,
        sessionDir,
        run,
      };

      // Claude's workflow query path still uses Claude Code hook files for
      // turn completion and does not expose a JSON-RPC server that the daemon
      // can drive through the PTY. Keep Claude on the headless SDK path until
      // the provider grows a daemon-native pane transport. Copilot and
      // OpenCode do expose local UI-server ports, so non-headless stages spawn
      // real daemon-owned PTYs and the SDK connects to those live panes.
      if (nameOrOptions.headless === true || this.agent === "claude") {
        return this._runProviderStage<T>(providerStageOptions);
      }
      return this._runVisibleProviderStage<T>(providerStageOptions);
    }

    // Extract subprocess args/env from the daemon-form opts (2-arg call).
    const daemonOpts =
      typeof nameOrOptions === "string"
        ? (optsOrClientOpts as DaemonStageOptions | undefined)
        : undefined;

    const args = daemonOpts?.args ?? [];
    const env = daemonOpts?.env;

    const sessionId = randomUUID();
    const sessionDir = join(this.sessionsBaseDir, this.runId, name);

    return this._runStage<T>({ name, description, args, env, sessionId, sessionDir, run });
  }

  // ─── transcript() ──────────────────────────────────────────────────────────

  /**
   * Return the rendered text transcript of a completed stage.
   *
   * Reads `inbox.md` from the stage session directory (same convention as
   * the executor path).  Accepts a stage name string or a DaemonSessionHandle.
   */
  async transcript(
    ref: string | DaemonSessionHandle<unknown>,
  ): Promise<{ path: string; content: string }> {
    const { record } = this.completedStage(ref, "transcript");
    const filePath = join(record.sessionDir, "inbox.md");
    const content = await readFile(filePath, "utf-8");
    return { path: filePath, content };
  }

  // ─── getMessages() ─────────────────────────────────────────────────────────

  /**
   * Return the raw saved messages of a completed stage.
   *
   * Reads `messages.json` from the stage session directory.  Accepts a
   * stage name string or a DaemonSessionHandle.
   */
  async getMessages(
    ref: string | DaemonSessionHandle<unknown>,
  ): Promise<Record<string, unknown>[]> {
    const { stageName, record } = this.completedStage(ref, "messages");
    const filePath = join(record.sessionDir, "messages.json");
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(
        `Invalid messages file for "${stageName}": expected JSON array`,
      );
    }
    return parsed as Record<string, unknown>[];
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private completedStage(
    ref: string | DaemonSessionHandle<unknown>,
    artifact: "messages" | "transcript",
  ): CompletedStageLookup {
    const stageName = typeof ref === "string" ? ref : ref.name;
    const record = this.completedStages.get(stageName);
    if (!record) {
      throw new Error(
        `No ${artifact} for "${stageName}". Available: ${this.availableStages()}`,
      );
    }
    return { stageName, record };
  }

  private availableStages(): string {
    return [...this.completedStages.keys()].join(", ") || "(none)";
  }

  private throwIfCancelled(): void {
    if (this.state.isCancelled) {
      throw new Error("Workflow run was cancelled.");
    }
  }

  private startTrackedStage(name: string): void {
    const parents = this.graphTracker.onSpawn();
    this.state.addStage({ name, parents });
    this.state.sessionStarted(name);
  }

  private endTrackedStage(name: string, status: "complete" | "error", error?: string): void {
    this.graphTracker.onSettle(name);
    this.state.sessionEnded(name, status, error);
  }

  private async _runProviderStage<T>(opts: {
    name: string;
    description?: string;
    clientOpts?: Record<string, unknown>;
    sessionOpts?: Record<string, unknown>;
    sessionId: string;
    sessionDir: string;
    run: (ctx: DaemonSessionContext) => Promise<T>;
  }): Promise<DaemonSessionHandle<T>> {
    const { name, sessionId, sessionDir, run } = opts;

    this.throwIfCancelled();
    this.startTrackedStage(name);
    await mkdir(sessionDir, { recursive: true });

    let cleanup: (() => void | Promise<void>) | undefined;
    try {
      const provider = await this.createHeadlessProvider(opts.clientOpts ?? {}, opts.sessionOpts ?? {});
      cleanup = provider.cleanup;
      const save = this.createSaveFunction(sessionDir);
      const ctx: DaemonSessionContext = {
        client: provider.client,
        session: provider.session,
        inputs: this.inputs,
        agent: this.agent,
        get sessionId() {
          return provider.getSessionId();
        },
        save,
        sessionDir,
        paneId: `headless-${name}-${sessionId}`,
        stage: this.stage.bind(this),
        transcript: this.transcript.bind(this),
        getMessages: this.getMessages.bind(this),
      };

      const result = await run(ctx);
      this.completedStages.set(name, { sessionId, sessionDir });
      this.endTrackedStage(name, "complete");
      return { name, id: sessionId, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.endTrackedStage(name, "error", message);
      throw err;
    } finally {
      await cleanup?.();
    }
  }

  private async _runVisibleProviderStage<T>(opts: {
    name: string;
    description?: string;
    clientOpts?: Record<string, unknown>;
    sessionOpts?: Record<string, unknown>;
    sessionId: string;
    sessionDir: string;
    run: (ctx: DaemonSessionContext) => Promise<T>;
  }): Promise<DaemonSessionHandle<T>> {
    const { name, sessionId, sessionDir, run } = opts;

    this.throwIfCancelled();
    this.startTrackedStage(name);
    await mkdir(sessionDir, { recursive: true });

    let pid: number | undefined;
    let unsubscribeHIL: (() => void) | undefined;
    let exitInfo: { exitCode: number; signal?: string } | undefined;
    let resolveExit!: (info: { exitCode: number; signal?: string }) => void;
    const exitPromise = new Promise<{ exitCode: number; signal?: string }>((resolve) => {
      resolveExit = resolve;
    });

    let cleanup: (() => void | Promise<void>) | undefined;
    try {
      const spawnConfig = await this.createVisibleSpawnConfig(opts.clientOpts ?? {});
      const spawnResult = await this.supervisor.spawn({
        runId: this.runId,
        stageName: name,
        agent: this.agent,
        args: spawnConfig.args,
        env: spawnConfig.env,
        cwd: this.state.projectRoot,
        cols: this.initialCols,
        rows: this.initialRows,
        onExit: (exitCode, signal) => {
          exitInfo = { exitCode, signal };
          resolveExit(exitInfo);
        },
      });
      pid = spawnResult.pid;
      this.onStagePidRegistered?.(this.runId, name, pid);
      this.throwIfCancelled();

      const port = await Promise.race([
        getListeningPortForPid(pid, { timeoutMs: 60_000 }),
        exitPromise.then((info) => {
          throw new Error(
            `Stage "${name}" exited before opening a UI server ` +
              `(code ${info.exitCode}${info.signal ? `, signal ${info.signal}` : ""})`,
          );
        }),
      ]);
      if (port === null) {
        throw new Error(
          `Timed out after ${Math.round(60_000 / 1000)}s waiting for ${this.agent} ` +
            `stage "${name}" to open a UI server port`,
        );
      }
      this.throwIfCancelled();

      const provider = await this.createVisibleProvider(
        `http://127.0.0.1:${port}`,
        opts.clientOpts ?? {},
        opts.sessionOpts ?? {},
      );
      cleanup = provider.cleanup;
      unsubscribeHIL = await attachDaemonHILWatchers({
        agent: this.agent,
        stageName: name,
        state: this.state,
        client: provider.client,
        session: provider.session,
        getSessionId: provider.getSessionId,
      });

      const save = this.createSaveFunction(sessionDir);
      const ctx: DaemonSessionContext = {
        client: provider.client,
        session: provider.session,
        inputs: this.inputs,
        agent: this.agent,
        get sessionId() {
          return provider.getSessionId();
        },
        save,
        sessionDir,
        paneId: String(pid),
        stage: this.stage.bind(this),
        transcript: this.transcript.bind(this),
        getMessages: this.getMessages.bind(this),
      };

      const result = await run(ctx);
      this.completedStages.set(name, { sessionId, sessionDir });
      this.endTrackedStage(name, "complete");
      return { name, id: sessionId, result };
    } catch (err) {
      const message = errorMessage(err);
      this.endTrackedStage(name, "error", message);
      throw err;
    } finally {
      unsubscribeHIL?.();
      await cleanup?.();
      if (pid !== undefined) {
        this.onStagePidReleased?.(this.runId, name, pid);
        if (exitInfo === undefined) {
          try {
            this.supervisor.kill(pid, "SIGTERM");
          } catch {
            // Process may have already exited between callback completion and cleanup.
          }
          await Promise.race([exitPromise, Bun.sleep(1_000)]).catch(() => {});
        }
      }
    }
  }

  private async createVisibleSpawnConfig(
    clientOpts: Record<string, unknown>,
  ): Promise<{ args: string[]; env: Record<string, string> }> {
    const config = AGENT_CONFIG[this.agent];
    const overrides: { chatFlags?: string[]; envVars?: Record<string, string> } =
      await getProviderOverrides(this.agent, this.state.projectRoot).catch(() => ({}));
    const chatFlags = readChatFlags(clientOpts.chatFlags) ?? overrides.chatFlags ?? config.chat_flags;
    const envVars = {
      ...config.env_vars,
      ...overrides.envVars,
      ATOMIC_AGENT: this.agent,
    };

    if (this.agent === "copilot") {
      const scmFlags = await getCopilotScmDisableFlags(this.state.projectRoot).catch(() => []);
      return {
        args: ["--ui-server", "--port", "0", ...chatFlags, ...scmFlags],
        env: buildSpawnEnv(envVars),
      };
    }

    if (this.agent === "opencode") {
      return {
        args: ["--port", "0", ...chatFlags],
        env: buildSpawnEnv(envVars),
      };
    }

    throw new Error(`Visible daemon workflow stages are not implemented for ${this.agent}.`);
  }

  private async createVisibleProvider(
    serverUrl: string,
    clientOpts: Record<string, unknown>,
    sessionOpts: Record<string, unknown>,
  ): Promise<{
    client: object;
    session: object;
    getSessionId: () => string;
    cleanup?: () => void | Promise<void>;
  }> {
    switch (this.agent) {
      case "copilot": {
        const { CopilotClient, approveAll } = await import("@github/copilot-sdk");
        const { mergeCopilotSystemMessage } = await import("../providers/copilot.ts");
        const { resolveAdditionalInstructionsContent } =
          await import("../services/config/additional-instructions.ts");
        const client = new CopilotClient({
          ...clientOpts,
          cliUrl: serverUrl,
        });
        await client.start();
        const additionalInstructions = await resolveAdditionalInstructionsContent(this.state.projectRoot);
        const sessionConfig = {
          onPermissionRequest: approveAll,
          ...sessionOpts,
          ...(additionalInstructions
            ? {
                systemMessage: mergeCopilotSystemMessage(
                  sessionOpts.systemMessage as Parameters<typeof mergeCopilotSystemMessage>[0],
                  additionalInstructions,
                ),
              }
            : {}),
        };
        const session = await client.createSession(sessionConfig);
        // The daemon attaches to the Copilot CLI through bun-pty and controls
        // foregrounding at the Atomic panel layer. Some Copilot server builds
        // expose `setForegroundSessionId` only when their own React TUI has
        // registered a foreground-change handler; a daemon-owned PTY server can
        // legitimately lack that handler. The newly-created session is already
        // the only session in this per-stage server, so foreground switching is
        // unnecessary and must not fail the workflow.
        await client.setForegroundSessionId(session.sessionId).catch(() => {});
        const nativeSend = session.send.bind(session);
        session.send = wrapCopilotSendUntilIdle(session, nativeSend);
        return {
          client,
          session,
          getSessionId: () => session.sessionId,
          cleanup: async () => {
            await session.disconnect().catch(() => {});
            await client.stop().catch(() => {});
          },
        };
      }
      case "opencode": {
        const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
        const client = createOpencodeClient({
          ...clientOpts,
          baseUrl: serverUrl,
        });
        const sessionResult = await client.session.create(sessionOpts);
        const session = sessionResult.data!;
        await client.tui.selectSession({ sessionID: session.id });
        return {
          client,
          session,
          getSessionId: () => session.id,
        };
      }
      case "claude":
        throw new Error("Visible daemon workflow stages are not implemented for Claude.");
    }
  }

  private async createHeadlessProvider(
    clientOpts: Record<string, unknown>,
    sessionOpts: Record<string, unknown>,
  ): Promise<{
    client: object;
    session: object;
    getSessionId: () => string;
    cleanup?: () => void | Promise<void>;
  }> {
    switch (this.agent) {
      case "claude": {
        const { HeadlessClaudeClientWrapper, HeadlessClaudeSessionWrapper } =
          await import("../providers/claude.ts");
        const client = new HeadlessClaudeClientWrapper();
        await client.start();
        const session = new HeadlessClaudeSessionWrapper(process.cwd());
        return {
          client,
          session,
          getSessionId: () => session.sessionId,
        };
      }
      case "copilot": {
        const { CopilotClient, approveAll } = await import("@github/copilot-sdk");
        const { copilotSdkLaunchOptions, mergeCopilotSystemMessage } =
          await import("../providers/copilot.ts");
        const { resolveAdditionalInstructionsContent } =
          await import("../services/config/additional-instructions.ts");
        const client = new CopilotClient({
          ...copilotSdkLaunchOptions(),
          ...clientOpts,
        });
        await client.start();
        const additionalInstructions = await resolveAdditionalInstructionsContent(process.cwd());
        const sessionConfig = {
          onPermissionRequest: approveAll,
          ...sessionOpts,
          excludedTools: mergeStringArrays(
            readStringArray(sessionOpts.excludedTools),
            ["ask_user"],
          ),
          ...(additionalInstructions
            ? {
                systemMessage: mergeCopilotSystemMessage(
                  sessionOpts.systemMessage as Parameters<typeof mergeCopilotSystemMessage>[0],
                  additionalInstructions,
                ),
              }
            : {}),
        };
        const session = await client.createSession(sessionConfig);
        const nativeSend = session.send.bind(session);
        session.send = wrapCopilotSendUntilIdle(session, nativeSend);
        return {
          client,
          session,
          getSessionId: () => session.sessionId,
          cleanup: async () => {
            await session.disconnect().catch(() => {});
            await client.stop().catch(() => {});
          },
        };
      }
      case "opencode": {
        const { createOpencode } = await import("@opencode-ai/sdk/v2");
        const oc = await createOpencode({ port: 0 });
        const sessionResult = await oc.client.session.create({
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
          ...sessionOpts,
        });
        const session = sessionResult.data!;
        return {
          client: oc.client,
          session,
          getSessionId: () => session.id,
          cleanup: () => oc.server.close(),
        };
      }
    }
  }

  private createSaveFunction(sessionDir: string): (arg: object[] | object | string) => Promise<void> {
    return async (arg) => {
      let records: object[];
      if (typeof arg === "string" && this.agent === "claude") {
        const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
        records = (await getSessionMessages(arg, { dir: process.cwd() })).map((data) => ({
          provider: "claude",
          data,
        }));
      } else if (Array.isArray(arg)) {
        records = arg.map((data) => ({ provider: this.agent, data }));
      } else {
        records = [{ provider: this.agent, data: arg }];
      }
      await Bun.write(join(sessionDir, "messages.json"), JSON.stringify(records, null, 2));
      await Bun.write(join(sessionDir, "inbox.md"), renderSavedRecords(records));
    };
  }

  private async _runStage<T>(opts: {
    name: string;
    description?: string;
    args: string[];
    env?: Record<string, string>;
    sessionId: string;
    sessionDir: string;
    run?: (ctx: DaemonSessionContext) => Promise<T>;
  }): Promise<DaemonSessionHandle<T>> {
    const { name, args, env, sessionId, sessionDir, run } = opts;

    // ── 1. Register in RunState ─────────────────────────────────────────────
    this.startTrackedStage(name);

    // ── 2. Spawn subprocess + build exit promise ────────────────────────────
    let pid: number | undefined;
    const exitPromise = new Promise<number>((resolveExit, rejectExit) => {
      this.supervisor
        .spawn({
          runId: this.runId,
          stageName: name,
          agent: this.agent,
          args,
          env,
          onExit: (exitCode: number) => resolveExit(exitCode),
        })
        .then((result) => {
          pid = result.pid;
          this.onStagePidRegistered?.(this.runId, name, pid);
        })
        .catch((spawnErr: unknown) => {
          rejectExit(spawnErr);
        });
    });

    // ── 3. Invoke run callback (if provided) ────────────────────────────────
    let callbackResult: T | undefined;
    if (run) {
      const sessionCtx = this._makeSessionContext(
        name,
        sessionId,
        sessionDir,
        // pid is set by the time onExit fires; use a getter to avoid
        // capturing before spawn resolves.
        () => pid,
      );
      callbackResult = await run(sessionCtx);
    }

    // ── 4. Await subprocess exit ────────────────────────────────────────────
    let exitCode: number;
    try {
      exitCode = await exitPromise;
    } catch (spawnErr: unknown) {
      const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      // Release PID tracking if spawn had recorded a pid before failing.
      if (pid != null) this.onStagePidReleased?.(this.runId, name, pid);
      this.endTrackedStage(name, "error", msg);
      throw spawnErr;
    }

    // ── 5. Release PID tracking ─────────────────────────────────────────────
    if (pid != null) this.onStagePidReleased?.(this.runId, name, pid);

    // ── 6. Update RunState ──────────────────────────────────────────────────
    if (exitCode === 0) {
      this.endTrackedStage(name, "complete");
    } else {
      this.endTrackedStage(
        name,
        "error",
        `Stage "${name}" subprocess exited with code ${exitCode}`,
      );
    }

    // ── 7. Record completion for transcript / getMessages lookup ────────────
    this.completedStages.set(name, { sessionId, sessionDir });

    if (exitCode !== 0) {
      throw new Error(
        `Stage "${name}" subprocess exited with code ${exitCode}`,
      );
    }

    return {
      name,
      id: sessionId,
      result: callbackResult as T,
    };
  }

  /** Build the minimal DaemonSessionContext forwarded to stage run callbacks. */
  private _makeSessionContext(
    name: string,
    sessionId: string,
    sessionDir: string,
    getPid: () => number | undefined,
  ): DaemonSessionContext {
    const unavailable = () => {
      throw new Error("Provider SDK session is unavailable for daemon simple-stage subprocesses.");
    };
    return {
      client: {},
      session: {},
      agent: this.agent,
      inputs: this.inputs,
      sessionId,
      save: async () => unavailable(),
      sessionDir,
      get paneId() {
        const pid = getPid();
        return pid != null ? String(pid) : "daemon-pending";
      },
      stage: this.stage.bind(this),
      transcript: this.transcript.bind(this),
      getMessages: this.getMessages.bind(this),
    };
  }
}
