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

/**
 * Implements `ISupervisor` by delegating to a `Supervisor` instance.
 *
 * Agent executables are resolved once per spawn via `Bun.which` so that no
 * user-controlled string is ever interpolated through a shell.
 */
export class DaemonSupervisorAdapter implements ISupervisor {
  private readonly supervisor: Supervisor;

  constructor(supervisor?: Supervisor) {
    this.supervisor = supervisor ?? new Supervisor();
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
  }): Promise<{ pid: number }> {
    const { runId, stageName, agent, args, env } = params;

    // Resolve binary safely — Bun.which never invokes a shell.
    const cmd = AGENT_CONFIG[agent].cmd;
    const file = Bun.which(cmd, { PATH: process.env["PATH"] ?? "" });
    if (!file) {
      throw missingDependency(cmd);
    }

    // Use the daemon's working directory as the subprocess cwd.
    const cwd = process.cwd();

    // spawn is synchronous inside Supervisor; wrap in Promise for interface compat.
    const result = this.supervisor.spawn({ runId, stageName, agent, file, args, cwd, env });
    return Promise.resolve(result);
  }

  // ─── ISupervisor: sendInput ────────────────────────────────────────────────

  sendInput(runId: string, stageName: string, data: string): void {
    this.supervisor.sendInput(runId, stageName, data);
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
