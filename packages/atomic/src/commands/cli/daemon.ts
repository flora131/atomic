/**
 * Daemon management CLI commands.
 *
 * These commands intentionally avoid the normal workflow/chat bootstrap path so
 * operators can recover a stale daemon quickly, e.g. `atomic daemon restart`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  closeDaemonConnection,
  ensureStarted,
  readEndpointFile,
  type DaemonEndpoint,
  type EnsureStartedOptions,
} from "@bastani/atomic-sdk/runtime/daemon";

type DaemonConnection = Awaited<ReturnType<typeof ensureStarted>>;

export interface DaemonRestartDeps {
  endpointFile: string;
  readEndpoint: (endpointFile: string) => Promise<DaemonEndpoint | null>;
  ensureStarted: (opts: EnsureStartedOptions) => Promise<DaemonConnection>;
  closeConnection: (conn: DaemonConnection) => void;
  signalProcess: (pid: number, signal: NodeJS.Signals) => void;
  isProcessAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  stdout: Pick<typeof process.stdout, "write">;
  stderr: Pick<typeof process.stderr, "write">;
  now: () => number;
}

export interface DaemonRestartOptions {
  /** Milliseconds to wait after SIGTERM before escalating. */
  timeoutMs?: number;
  /** Poll interval while waiting for the old daemon to exit. */
  pollIntervalMs?: number;
}

const DEFAULT_RESTART_TIMEOUT_MS = 2_000;
const DEFAULT_RESTART_POLL_MS = 50;

export function defaultDaemonEndpointFile(homeDir = homedir()): string {
  return join(homeDir, ".atomic", "daemon.endpoint.json");
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export function createDefaultDaemonRestartDeps(): DaemonRestartDeps {
  return {
    endpointFile: defaultDaemonEndpointFile(),
    readEndpoint: readEndpointFile,
    ensureStarted,
    closeConnection: closeDaemonConnection,
    signalProcess: (pid, signal) => { process.kill(pid, signal); },
    isProcessAlive: defaultIsProcessAlive,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    stdout: process.stdout,
    stderr: process.stderr,
    now: () => Date.now(),
  };
}

async function waitForDaemonToStop(
  pid: number,
  deps: DaemonRestartDeps,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = deps.now() + timeoutMs;
  while (deps.now() < deadline) {
    const endpoint = await deps.readEndpoint(deps.endpointFile);
    if (endpoint === null || endpoint.pid !== pid) return true;
    if (!deps.isProcessAlive(pid)) return true;
    await deps.sleep(pollIntervalMs);
  }
  return false;
}

function signalOldDaemon(
  endpoint: DaemonEndpoint,
  signal: NodeJS.Signals,
  deps: DaemonRestartDeps,
): boolean {
  try {
    deps.signalProcess(endpoint.pid, signal);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return true;
    const message = err instanceof Error ? err.message : String(err);
    deps.stderr.write(`[atomic/daemon] failed to send ${signal} to pid ${endpoint.pid}: ${message}\n`);
    return false;
  }
}

export async function daemonRestartCommand(
  options: DaemonRestartOptions = {},
  deps: DaemonRestartDeps = createDefaultDaemonRestartDeps(),
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESTART_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RESTART_POLL_MS;

  const existing = await deps.readEndpoint(deps.endpointFile);
  if (existing) {
    deps.stdout.write(`[atomic/daemon] stopping pid ${existing.pid}\n`);
    if (!signalOldDaemon(existing, "SIGTERM", deps)) return 1;

    let stopped = await waitForDaemonToStop(existing.pid, deps, timeoutMs, pollIntervalMs);
    if (!stopped) {
      deps.stderr.write(`[atomic/daemon] pid ${existing.pid} did not stop after ${timeoutMs}ms; sending SIGKILL\n`);
      if (!signalOldDaemon(existing, "SIGKILL", deps)) return 1;
      stopped = await waitForDaemonToStop(existing.pid, deps, timeoutMs, pollIntervalMs);
    }

    if (!stopped) {
      deps.stderr.write(`[atomic/daemon] failed to stop pid ${existing.pid}\n`);
      return 1;
    }
  } else {
    deps.stdout.write("[atomic/daemon] no running daemon found; starting one\n");
  }

  let conn: DaemonConnection | null = null;
  try {
    conn = await deps.ensureStarted({
      endpointFile: deps.endpointFile,
      clientName: "@bastani/atomic/daemon",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.stderr.write(`[atomic/daemon] failed to start daemon: ${message}\n`);
    return 1;
  } finally {
    if (conn) deps.closeConnection(conn);
  }

  const next = await deps.readEndpoint(deps.endpointFile);
  if (next) {
    deps.stdout.write(`[atomic/daemon] restarted pid ${next.pid} on ${next.host}:${next.port}\n`);
  } else {
    deps.stdout.write("[atomic/daemon] restarted\n");
  }

  return 0;
}
