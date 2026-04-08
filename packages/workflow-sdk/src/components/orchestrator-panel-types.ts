// ─── Orchestrator Panel Types ─────────────────────

export type SessionStatus = "pending" | "running" | "complete" | "error";

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
