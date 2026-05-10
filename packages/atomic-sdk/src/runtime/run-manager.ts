/**
 * RunManager — implements IRunManager for the atomic daemon.
 *
 * Manages workflow run lifecycle: start, stop, list, get, getState,
 * getTranscript, subscribe, unsubscribe.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { MessageConnection } from "vscode-jsonrpc";
import type { AgentType } from "../types.ts";
import { RunState } from "./run-state.ts";
import { extractWorkflowDefinitions } from "./registry.ts";
import type { IRunManager, ISupervisor, RunInfo } from "./ui-protocol/methods.ts";
import { DaemonWorkflowContext } from "./daemon-workflow-context.ts";

// ─── RunManager ───────────────────────────────────────────────────────────────

/** Options for constructing a RunManager. */
export interface RunManagerOptions {
  /**
   * Injected process supervisor for agent subprocess management.
   * When provided, wired into each RunState for stage execution.
   */
  supervisor?: ISupervisor;
  /**
   * Project root / working directory used for RunState and agent spawning.
   * Defaults to process.cwd() at construction time.
   */
  cwd?: string;
}

export class RunManager implements IRunManager {
  private runs = new Map<string, RunInfo>();
  private states = new Map<string, RunState>();
  private subscriptions = new Map<
    string,
    {
      connection: MessageConnection;
      runId?: string;
      stateSubscriptions: Array<{ runId: string; subscriptionId: string }>;
    }
  >();
  /** Active stage PIDs owned by each run. Cleared when run terminates. */
  private readonly runPids = new Map<string, Set<number>>();
  readonly supervisor: ISupervisor | undefined;
  private readonly cwd: string;

  constructor(opts: RunManagerOptions = {}) {
    this.supervisor = opts.supervisor;
    this.cwd = opts.cwd ?? process.cwd();
  }

  async start(params: {
    source: string;
    workflowName: string;
    agent: AgentType;
    inputs: Record<string, unknown>;
    cols?: number;
    rows?: number;
  }): Promise<{ runId: string }> {
    const { source, workflowName, agent, inputs, cols, rows } = params;
    const runId = randomUUID();

    const state = new RunState({
      runId,
      workflowName,
      agent,
      projectRoot: this.cwd,
    });

    const info: RunInfo = {
      runId,
      workflowName,
      agent,
      type: "workflow",
      status: "active",
      startedAt: new Date().toISOString(),
    };

    this.runs.set(runId, info);
    this.states.set(runId, state);

    void this.executeRun(state, info, source, inputs, { cols, rows }).catch((e: unknown) => {
      this.markRunError(state, info, e);
    });

    return { runId };
  }

  async startChat(params: {
    agent: AgentType;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): Promise<{ runId: string }> {
    const runId = randomUUID();
    const workflowName = `chat:${params.agent}`;
    const state = new RunState({
      runId,
      workflowName,
      agent: params.agent,
      projectRoot: params.cwd ?? this.cwd,
    });
    const info: RunInfo = {
      runId,
      workflowName,
      agent: params.agent,
      type: "chat",
      status: "active",
      startedAt: new Date().toISOString(),
    };

    this.runs.set(runId, info);
    this.states.set(runId, state);
    state.addStage({ name: "chat", status: "running" });
    state.sessionStarted("chat");

    if (!this.supervisor) {
      const err = new Error("No ISupervisor injected into RunManager — cannot start chat.");
      this.markRunError(state, info, err);
      throw err;
    }

    try {
      let chatPid: number | undefined;
      const result = await this.supervisor.spawn({
        runId,
        stageName: "chat",
        agent: params.agent,
        args: params.args,
        env: params.env,
        cwd: params.cwd,
        cols: params.cols,
        rows: params.rows,
        onExit: (exitCode, signal) => {
          if (chatPid !== undefined) this.runPids.get(runId)?.delete(chatPid);
          if (info.status !== "active") return;
          const ok = exitCode === 0;
          state.sessionEnded(
            "chat",
            ok ? "complete" : "error",
            ok ? undefined : `chat exited with code ${exitCode}${signal ? ` (${signal})` : ""}`,
          );
          if (ok) this.markRunComplete(state, info);
          else this.markRunError(state, info, new Error(`chat exited with code ${exitCode}`));
        },
      });
      chatPid = result.pid;
      this.runPids.set(runId, new Set([result.pid]));
      state.setForeground("chat");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.sessionEnded("chat", "error", msg);
      this.markRunError(state, info, err);
      throw err;
    }

    return { runId };
  }

  // ─── Terminal lifecycle helpers ───────────────────────────────────────────────

  /**
   * Idempotent. Transitions run to "complete".
   * No-op if info.status !== "active" or state is already cancelled.
   */
  private markRunComplete(state: RunState, info: RunInfo): void {
    if (info.status !== "active") return;
    if (state.isCancelled) return;
    info.status = "complete";
    info.endedAt = new Date().toISOString();
    state.markCompletionReached();
  }

  /**
   * Idempotent. Transitions run to "error".
   * No-op if info.status !== "active" or state is already cancelled.
   */
  private markRunError(state: RunState, info: RunInfo, err: unknown): void {
    if (info.status !== "active") return;
    if (state.isCancelled) return;
    info.status = "error";
    info.endedAt = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);
    state.setError(msg);
  }

  /**
   * Idempotent. Transitions run to "cancelled".
   * No-op if info.status !== "active".
   */
  private markRunCancelled(state: RunState, info: RunInfo): void {
    if (info.status !== "active") return;
    info.status = "cancelled";
    info.endedAt = new Date().toISOString();
    state.cancel(); // emits run/ended exactly once before clearing subscribers
  }

  // ─────────────────────────────────────────────────────────────────────────────

  private async executeRun(
    state: RunState,
    info: RunInfo,
    source: string,
    inputs: Record<string, unknown>,
    terminalSize: { cols?: number; rows?: number } = {},
  ): Promise<void> {
    try {
      const mod: unknown = await import(source);
      const runnable = selectRunnableWorkflow(mod, {
        source,
        workflowName: info.workflowName,
        agent: info.agent,
      });
      const ctx = new DaemonWorkflowContext({
        runId: state.runId,
        agent: info.agent,
        inputs,
        state,
        supervisor: this.supervisor ?? noopSupervisor,
        initialCols: terminalSize.cols,
        initialRows: terminalSize.rows,
        onStagePidRegistered: (rId, _stageName, pid) => {
          let pids = this.runPids.get(rId);
          if (!pids) {
            pids = new Set<number>();
            this.runPids.set(rId, pids);
          }
          pids.add(pid);
        },
        onStagePidReleased: (rId, _stageName, pid) => {
          this.runPids.get(rId)?.delete(pid);
        },
      });
      await runnable.run(ctx);
      this.markRunComplete(state, info);
    } catch (e: unknown) {
      this.markRunError(state, info, e);
    }
  }

  async stop(runId: string): Promise<void> {
    // Kill all active stage PIDs owned by this run before cancelling state.
    const pids = [...(this.runPids.get(runId) ?? [])];
    if (pids.length > 0 && this.supervisor) {
      // Stop must be immediate for panel quit/session kill. Use SIGKILL right
      // away instead of a graceful-delay cascade; Supervisor still routes this
      // through bun-pty first-class cleanup and best-effort descendant reaping.
      for (const pid of pids) {
        try {
          this.supervisor.kill(pid, "SIGKILL");
        } catch {
          // best-effort: process may have already exited
        }
      }
    }
    this.runPids.delete(runId);

    const info = this.runs.get(runId);
    const state = this.states.get(runId);
    if (info && state) {
      this.markRunCancelled(state, info);
    }
    if (state) {
      state.dispose();
    }
  }

  list(scope?: "active" | "completed" | "all"): RunInfo[] {
    const all = [...this.runs.values()];
    switch (scope) {
      case "active":
        return all.filter((r) => r.status === "active");
      case "completed":
        return all.filter((r) => r.status === "complete");
      case "all":
      case undefined:
        return all;
    }
  }

  get(runId: string): RunInfo | null {
    return this.runs.get(runId) ?? null;
  }

  getState(runId: string): RunState | null {
    return this.states.get(runId) ?? null;
  }

  async getTranscript(runId: string, sessionName: string): Promise<Record<string, unknown>[]> {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
    const messagesPath = join(home, ".atomic", "sessions", runId, sessionName, "messages.json");
    try {
      const raw = await readFile(messagesPath, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>[];
    } catch {
      return [];
    }
  }

  subscribe(connection: MessageConnection, runId?: string): string {
    const subscriptionId = randomUUID();
    const stateSubscriptions: Array<{ runId: string; subscriptionId: string }> = [];

    if (runId) {
      const state = this.states.get(runId);
      if (state) {
        const innerSubId = state.subscribe(connection);
        stateSubscriptions.push({ runId, subscriptionId: innerSubId });
      }
    } else {
      for (const [rid, state] of this.states) {
        const innerSubId = state.subscribe(connection);
        stateSubscriptions.push({ runId: rid, subscriptionId: innerSubId });
      }
    }

    this.subscriptions.set(subscriptionId, { connection, runId, stateSubscriptions });
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    const record = this.subscriptions.get(subscriptionId);
    if (!record) return;
    for (const inner of record.stateSubscriptions) {
      const state = this.states.get(inner.runId);
      state?.unsubscribe(inner.subscriptionId);
    }
    this.subscriptions.delete(subscriptionId);
  }
}

interface RunnableWorkflow {
  run(ctx: DaemonWorkflowContext): Promise<void>;
}

interface SelectRunnableWorkflowOptions {
  source: string;
  workflowName: string;
  agent: AgentType;
}

function defaultExportDetail(mod: unknown): string {
  if (!mod || typeof mod !== "object") return "module is not an object";
  const defaultExport = (mod as { default?: unknown }).default;
  if (defaultExport === undefined) return "no default export";
  if (defaultExport === null) return "default export is null";
  if (typeof defaultExport !== "object") return `default export is ${typeof defaultExport}`;
  return `default.run is ${typeof (defaultExport as { run?: unknown }).run}`;
}

function selectRunnableWorkflow(
  mod: unknown,
  opts: SelectRunnableWorkflowOptions,
): RunnableWorkflow {
  const definitions = extractWorkflowDefinitions(mod);
  if (definitions.length > 0) {
    const match = definitions.find((definition) =>
      definition.name === opts.workflowName && definition.agent === opts.agent,
    );
    if (!match) {
      const available = definitions
        .map((definition) => `${definition.agent}/${definition.name}`)
        .join(", ");
      throw new Error(
        `Invalid workflow module "${opts.source}": no WorkflowDefinition for ` +
          `workflowName="${opts.workflowName}" agent="${opts.agent}". ` +
          `Available: ${available || "(none)"}.`,
      );
    }
    return {
      run: (ctx) => match.run(ctx as never),
    };
  }

  throw new Error(
    `Invalid workflow module "${opts.source}": expected a WorkflowDefinition ` +
      `matching workflowName="${opts.workflowName}" agent="${opts.agent}". ` +
      `Got: ${defaultExportDetail(mod)}.`,
  );
}

// ─── noopSupervisor ───────────────────────────────────────────────────────────

/**
 * Fallback ISupervisor used when RunManager is constructed without a
 * supervisor (e.g. in tests that only exercise lifecycle, not stage spawning).
 * All methods throw with a clear error rather than silently doing nothing.
 */
const noopSupervisor: ISupervisor = {
  spawn(_params): Promise<{ pid: number }> {
    return Promise.reject(
      new Error(
        "No ISupervisor injected into RunManager — cannot spawn stage. " +
          "Construct RunManager with { supervisor } to enable stage execution.",
      ),
    );
  },
  sendInput(_runId, _stageName, _data): void {
    throw new Error("No ISupervisor injected into RunManager — cannot send input.");
  },
  getScrollback(_runId, _stageName, _fromOffset): { data: string; headOffset: number } {
    throw new Error("No ISupervisor injected into RunManager — cannot get scrollback.");
  },
  kill(_pid, _signal): void {
    throw new Error("No ISupervisor injected into RunManager — cannot kill process.");
  },
};
