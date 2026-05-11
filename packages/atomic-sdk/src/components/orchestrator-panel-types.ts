// ─── Orchestrator Panel Types ─────────────────────

/**
 * Name of the synthetic orchestrator session prepended by
 * `PanelStore.setWorkflowInfo`. It carries workflow-timing bookkeeping
 * (startedAt/endedAt) but is not a user-defined stage — the layout filters
 * it out and the header surfaces its duration separately. A rename here
 * silently breaks every filter downstream, so every consumer imports this
 * constant rather than spelling the string.
 */
export const SYNTHETIC_ORCHESTRATOR_NAME = "orchestrator";

export type SessionStatus = "pending" | "running" | "complete" | "error" | "awaiting_input" | "offloaded" | "resuming";

export type ViewMode = "graph" | "attached" | "resuming";

export interface PanelSession {
  name: string;
  parents: string[];
}

export interface PanelOptions {
  tmuxSession: string;
}

export interface SessionData {
  name: string;
  status: SessionStatus;
  parents: string[];
  error?: string;
  startedAt: number | null;
  endedAt: number | null;
}
