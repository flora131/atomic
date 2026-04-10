// ─── State Store ──────────────────────────────────
// Bridges the imperative OrchestratorPanel API with the React component tree.

import type { SessionData, SessionStatus, PanelSession } from "./orchestrator-panel-types.ts";

type Listener = () => void;

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
        name: "orchestrator",
        status: "running",
        parents: [],
        startedAt: Date.now(),
        endedAt: null,
      },
      ...sessions.map((s) => ({
        name: s.name,
        status: "pending" as SessionStatus,
        parents: s.parents.length > 0 ? s.parents : ["orchestrator"],
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

  addSession(session: SessionData): void {
    this.sessions.push(session);
    this.emit();
  }

  setCompletion(workflowName: string, transcriptsPath: string): void {
    this.completionInfo = { workflowName, transcriptsPath };
    const orch = this.sessions.find((s) => s.name === "orchestrator");
    if (orch) {
      orch.status = "complete";
      orch.endedAt = Date.now();
    }
    this.emit();
  }

  setFatalError(message: string): void {
    this.fatalError = message;
    this.completionReached = true;
    const orch = this.sessions.find((s) => s.name === "orchestrator");
    if (orch) {
      orch.status = "error";
      orch.endedAt = Date.now();
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
