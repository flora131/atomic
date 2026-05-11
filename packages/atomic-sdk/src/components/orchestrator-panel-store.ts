// ─── State Store ──────────────────────────────────
// Bridges the imperative OrchestratorPanel API with the React component tree.

import { SYNTHETIC_ORCHESTRATOR_NAME } from "./orchestrator-panel-types.ts";
import type { SessionData, SessionStatus, PanelSession, ViewMode } from "./orchestrator-panel-types.ts";

type Listener = () => void;

export type ToastKind = "info" | "warning" | "error";

export interface ToastEntry {
  id: number;
  message: string;
  kind: ToastKind;
  createdAt: number;
}

/** Default time-to-live for auto-dismissed toasts (ms). */
export const TOAST_DEFAULT_TTL_MS = 5000;

export class PanelStore {
  version = 0;
  workflowName = "";
  agent = "";
  prompt = "";
  sessions: SessionData[] = [];
  completionInfo: { workflowName: string; transcriptsPath: string } | null = null;
  fatalError: string | null = null;
  completionReached = false;
  exitResolve: (() => void) | null = null;
  abortResolve: (() => void) | null = null;

  /** Number of background tasks/headless stages currently running. */
  backgroundTaskCount = 0;

  /** Current view mode — graph overview or attached to a specific agent. */
  viewMode: ViewMode = "graph";
  /** ID of the agent currently attached to (only meaningful when viewMode === "attached" or "resuming"). */
  activeAgentId = "";

  /** Active toast notifications. */
  toasts: ToastEntry[] = [];
  private nextToastId = 1;
  private toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  setWorkflowInfo(
    name: string,
    agent: string,
    sessions: PanelSession[],
    prompt: string,
  ): void {
    this.workflowName = name;
    this.agent = agent;
    this.prompt = prompt;
    this.sessions = [
      {
        name: SYNTHETIC_ORCHESTRATOR_NAME,
        status: "running",
        parents: [],
        startedAt: Date.now(),
        endedAt: null,
      },
      ...sessions.map((s) => ({
        name: s.name,
        status: "pending" as SessionStatus,
        parents: s.parents.length > 0 ? s.parents : [SYNTHETIC_ORCHESTRATOR_NAME],
        startedAt: null,
        endedAt: null,
      })),
    ];
    this.emit();
  }

  startSession(name: string): void {
    const session = this.sessions.find((s) => s.name === name);
    if (!session) return;
    session.status = "running";
    session.startedAt = Date.now();
    this.emit();
  }

  completeSession(name: string): void {
    const session = this.sessions.find((s) => s.name === name);
    if (!session) return;
    session.status = "complete";
    session.endedAt = Date.now();
    this.emit();
  }

  failSession(name: string, error: string): void {
    const session = this.sessions.find((s) => s.name === name);
    if (!session) return;
    session.status = "error";
    session.error = error;
    session.endedAt = Date.now();
    this.emit();
  }

  awaitingInput(name: string): void {
    const session = this.sessions.find((s) => s.name === name);
    if (session && session.status === "running") {
      session.status = "awaiting_input";
      this.emit();
    }
  }

  resumeSession(name: string): void {
    const session = this.sessions.find((s) => s.name === name);
    if (session && session.status === "awaiting_input") {
      session.status = "running";
      this.emit();
    }
  }

  setSessionStatus(name: string, status: SessionData["status"]): void {
    const session = this.sessions.find((s) => s.name === name);
    if (!session) return;
    session.status = status;
    this.emit();
  }

  addSession(session: SessionData): void {
    this.sessions.push(session);
    this.emit();
  }

  /**
   * The synthetic orchestrator session — the timing bookkeeping entry
   * prepended by `setWorkflowInfo`. Single source of truth for header
   * duration and completion/failure timestamps.
   */
  getOrchestratorSession(): SessionData | undefined {
    return this.sessions.find((s) => s.name === SYNTHETIC_ORCHESTRATOR_NAME);
  }

  /**
   * Sessions excluding the synthetic orchestrator entry — i.e. the
   * user-defined stages that render as nodes in the graph and appear in
   * the agent switcher. Single source of truth for everything that wants
   * "the real stages".
   */
  getStageSessions(): SessionData[] {
    return this.sessions.filter((s) => s.name !== SYNTHETIC_ORCHESTRATOR_NAME);
  }

  setCompletion(workflowName: string, transcriptsPath: string): void {
    this.completionInfo = { workflowName, transcriptsPath };
    const orch = this.getOrchestratorSession();
    if (orch) {
      orch.status = "complete";
      orch.endedAt = Date.now();
    }
    this.emit();
  }

  setFatalError(message: string): void {
    this.fatalError = message;
    this.completionReached = true;
    const orch = this.getOrchestratorSession();
    if (orch) {
      orch.status = "error";
      orch.endedAt = Date.now();
    }
    this.emit();
  }

  incrementBackgroundTasks(): void {
    this.backgroundTaskCount++;
    this.emit();
  }

  decrementBackgroundTasks(): void {
    this.backgroundTaskCount = Math.max(0, this.backgroundTaskCount - 1);
    this.emit();
  }

  /**
   * Switch between graph, attached, and resuming view modes.
   * When switching to "attached" or "resuming", provide the agent ID.
   * Switching to "graph" clears the active agent.
   */
  setViewMode(mode: ViewMode, agentId?: string): void {
    this.viewMode = mode;
    this.activeAgentId = (mode === "attached" || mode === "resuming") && agentId ? agentId : "";
    this.emit();
  }

  /**
   * Show a toast notification that auto-dismisses after `ttlMs`.
   *
   * Pass `ttlMs: 0` to disable auto-dismiss (caller owns the lifetime).
   * The internal timer is `unref()`'d so it never blocks process exit.
   */
  showToast(message: string, kind: ToastKind = "error", ttlMs = TOAST_DEFAULT_TTL_MS): void {
    const id = this.nextToastId++;
    this.toasts.push({ id, message, kind, createdAt: Date.now() });
    if (ttlMs > 0) {
      const timer = setTimeout(() => this.dismissToast(id), ttlMs);
      // Don't keep the event loop alive solely for a toast timeout.
      const unref = (timer as { unref?: () => void }).unref;
      if (typeof unref === "function") unref.call(timer);
      this.toastTimers.set(id, timer);
    }
    this.emit();
  }

  dismissToast(id: number): void {
    const idx = this.toasts.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.toasts.splice(idx, 1);
    const timer = this.toastTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.toastTimers.delete(id);
    }
    this.emit();
  }

  /** Safely invoke exitResolve at most once, guarding against rapid repeated calls. */
  resolveExit(): void {
    if (this.exitResolve) {
      const resolve = this.exitResolve;
      this.exitResolve = null;
      resolve();
    }
  }

  /** Safely invoke abortResolve at most once to signal mid-execution quit. */
  resolveAbort(): void {
    if (this.abortResolve) {
      const resolve = this.abortResolve;
      this.abortResolve = null;
      resolve();
    }
  }

  /** Quit the workflow — routes to the correct handler based on current phase. */
  requestQuit(): void {
    if (this.completionReached) {
      this.resolveExit();
    } else {
      this.resolveAbort();
    }
  }

  markCompletionReached(): void {
    this.completionReached = true;
    this.emit();
  }
}
