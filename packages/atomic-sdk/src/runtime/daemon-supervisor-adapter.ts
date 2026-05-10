/**
 * DaemonSupervisorAdapter — typed bridge from ISupervisor to Supervisor.
 *
 * Maps the RPC-level ISupervisor interface to the low-level Supervisor
 * primitive without unsafe `as any` casts.
 *
 * Responsibilities:
 *   - Resolve agent executable via `Bun.which` (no shell interpolation).
 *   - Delegate spawn/sendInput/getScrollback/kill to Supervisor methods.
 *   - Throw AtomicRpcError (MISSING_DEPENDENCY) when the agent binary is absent.
 */

import type { AgentType } from "../types.ts";
import type { ISupervisor } from "./ui-protocol/methods.ts";
import { Supervisor } from "./supervisor.ts";
import { AGENT_CONFIG } from "../services/config/definitions.ts";
import { missingDependency } from "./ui-protocol/errors.ts";

// ─── DaemonSupervisorAdapter ──────────────────────────────────────────────────

/** Options for constructing a DaemonSupervisorAdapter. */
export interface DaemonSupervisorAdapterOptions {
  /**
   * Low-level Supervisor instance to delegate to.
   * Defaults to a freshly constructed Supervisor.
   */
  supervisor?: Supervisor;
  /**
   * Working directory used as the cwd for spawned agent subprocesses.
   * Defaults to process.cwd() at construction time.
   */
  cwd?: string;
}

/**
 * Implements `ISupervisor` by delegating to a `Supervisor` instance.
 *
 * Agent executables are resolved once per spawn via `Bun.which` so that no
 * user-controlled string is ever interpolated through a shell.
 */
export class DaemonSupervisorAdapter implements ISupervisor {
  private readonly supervisor: Supervisor;
  private readonly cwd: string;

  constructor(opts: DaemonSupervisorAdapterOptions = {}) {
    this.supervisor = opts.supervisor ?? new Supervisor();
    this.cwd = opts.cwd ?? process.cwd();
  }

  // ─── ISupervisor: spawn ─────────────────────────────────────────────────────

  /**
   * Resolve the agent binary and spawn a PTY subprocess.
   *
   * @throws AtomicRpcError (MISSING_DEPENDENCY) if the agent binary is not in PATH.
   * @throws AtomicRpcError (PTY_FAILED) if the PTY cannot be created.
   */
  async spawn(params: {
    runId: string;
    stageName: string;
    agent: AgentType;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    cols?: number;
    rows?: number;
    onExit?: (exitCode: number, signal?: string) => void;
  }): Promise<{ pid: number }> {
    const { runId, stageName, agent, args, env, cwd, cols, rows, onExit } = params;

    // Resolve binary safely — Bun.which never invokes a shell. Prefer the
    // caller-provided PATH because chat clients may start a long-lived daemon
    // from a different shell than the one where the agent CLI is installed.
    const cmd = AGENT_CONFIG[agent].cmd;
    const pathEnv = env?.PATH ?? process.env["PATH"] ?? "";
    const copilotCliPath = agent === "copilot" ? env?.COPILOT_CLI_PATH : undefined;
    const file = copilotCliPath ?? Bun.which(cmd, { PATH: pathEnv });
    if (!file) {
      throw missingDependency(cmd);
    }

    // Wire onExit through StageCallbacks so callers can await subprocess exit.
    const callbacks = onExit ? { onExit } : undefined;

    return this.supervisor.spawn({
      runId,
      stageName,
      agent,
      file,
      args,
      cwd: cwd ?? this.cwd,
      env,
      cols,
      rows,
      callbacks,
    });
  }

  // ─── ISupervisor: sendInput ────────────────────────────────────────────────

  sendInput(runId: string, stageName: string, data: string): void {
    this.supervisor.sendInput(runId, stageName, data);
  }

  subscribeOutput(runId: string, stageName: string, conn: import("vscode-jsonrpc").MessageConnection): string {
    return this.supervisor.subscribeOutput(runId, stageName, conn);
  }

  unsubscribeOutput(subscriptionId: string): void {
    this.supervisor.unsubscribeOutput(subscriptionId);
  }

  resize(runId: string, stageName: string, cols: number, rows: number): void {
    this.supervisor.resizeStage(runId, stageName, cols, rows);
  }

  // ─── ISupervisor: getScrollback ────────────────────────────────────────────

  getScrollback(
    runId: string,
    stageName: string,
    fromOffset?: number,
  ): { data: string; headOffset: number } {
    return this.supervisor.getScrollback(runId, stageName, fromOffset);
  }

  // ─── ISupervisor: kill ─────────────────────────────────────────────────────

  kill(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
    this.supervisor.killByPid(pid, signal);
  }
}
