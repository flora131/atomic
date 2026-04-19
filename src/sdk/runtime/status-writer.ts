/**
 * Workflow status snapshot — bridges the in-process panel state with
 * out-of-process consumers (e.g. `atomic workflow status`).
 *
 * The orchestrator subscribes to its `PanelStore` and writes a fresh
 * snapshot to `~/.atomic/sessions/<workflowRunId>/status.json` every
 * time the store mutates. Consumers read that file to derive the
 * overall workflow state without needing IPC into the orchestrator.
 */

import { join } from "node:path";
import type { SessionData, SessionStatus } from "../components/orchestrator-panel-types.ts";

/** File name used for the status snapshot inside each workflow's session directory. */
export const STATUS_FILE_NAME = "status.json";

/** High-level workflow state surfaced to the agent / CLI consumer. */
export type WorkflowOverallStatus =
  | "in_progress"
  | "error"
  | "completed"
  | "needs_review";

/** Per-session entry mirrored from the orchestrator's panel store. */
export interface WorkflowStatusSession {
  name: string;
  status: SessionStatus;
  parents: string[];
  error?: string;
  startedAt: number | null;
  endedAt: number | null;
}

/**
 * Snapshot persisted to disk for `atomic workflow status` to read.
 * Schema is versioned so future readers can stay backwards-compatible.
 */
export interface WorkflowStatusSnapshot {
  schemaVersion: 1;
  workflowRunId: string;
  tmuxSession: string;
  workflowName: string;
  agent: string;
  prompt: string;
  /** Overall state derived from per-session status + completion flags. */
  overall: WorkflowOverallStatus;
  /** True when the orchestrator has shown its completion banner. */
  completionReached: boolean;
  /** Fatal-error message set via `panel.showFatalError`, if any. */
  fatalError: string | null;
  /** Wall-clock time of the snapshot in ISO-8601 format. */
  updatedAt: string;
  sessions: WorkflowStatusSession[];
}

/**
 * Inputs the writer needs to render a snapshot — a strict subset of
 * `PanelStore` so the writer doesn't depend on the renderer module.
 */
export interface StatusWriterInputs {
  workflowRunId: string;
  tmuxSession: string;
  workflowName: string;
  agent: string;
  prompt: string;
  fatalError: string | null;
  completionReached: boolean;
  sessions: readonly SessionData[];
}

/**
 * Derive the overall workflow state from per-session statuses + the
 * orchestrator-level completion / fatal-error flags.
 *
 * Precedence (highest first):
 *   1. `error`          — fatal error or any session ended in error
 *   2. `needs_review`   — at least one session is awaiting human input (HIL)
 *   3. `completed`      — completion banner reached and nothing errored
 *   4. `in_progress`    — default
 *
 * `needs_review` outranks `completed` so an agent that pauses for HIL
 * right at the end is never reported as done while still waiting.
 */
export function deriveOverallStatus(input: {
  sessions: readonly SessionData[];
  completionReached: boolean;
  fatalError: string | null;
}): WorkflowOverallStatus {
  if (input.fatalError !== null) return "error";
  if (input.sessions.some((s) => s.status === "error")) return "error";
  if (input.sessions.some((s) => s.status === "awaiting_input")) {
    return "needs_review";
  }
  if (input.completionReached) return "completed";
  return "in_progress";
}

/** Build a snapshot from the writer inputs (pure — exported for tests). */
export function buildSnapshot(
  input: StatusWriterInputs,
  now: () => Date = () => new Date(),
): WorkflowStatusSnapshot {
  return {
    schemaVersion: 1,
    workflowRunId: input.workflowRunId,
    tmuxSession: input.tmuxSession,
    workflowName: input.workflowName,
    agent: input.agent,
    prompt: input.prompt,
    overall: deriveOverallStatus({
      sessions: input.sessions,
      completionReached: input.completionReached,
      fatalError: input.fatalError,
    }),
    completionReached: input.completionReached,
    fatalError: input.fatalError,
    updatedAt: now().toISOString(),
    sessions: input.sessions.map((s) => ({
      name: s.name,
      status: s.status,
      parents: [...s.parents],
      ...(s.error !== undefined ? { error: s.error } : {}),
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    })),
  };
}

/** Absolute path of the status file for a given workflow run directory. */
export function statusFilePath(sessionDir: string): string {
  return join(sessionDir, STATUS_FILE_NAME);
}

/**
 * Write a snapshot to `<sessionDir>/status.json`. Uses an atomic
 * write-then-rename so concurrent readers never see partial JSON.
 * Errors are swallowed — the orchestrator must keep running even if
 * the status file can't be persisted.
 */
export async function writeSnapshot(
  sessionDir: string,
  snapshot: WorkflowStatusSnapshot,
): Promise<void> {
  const finalPath = statusFilePath(sessionDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  try {
    await Bun.write(tmpPath, JSON.stringify(snapshot, null, 2));
    const { rename } = await import("node:fs/promises");
    await rename(tmpPath, finalPath);
  } catch {
    // Best-effort — never fail the workflow because of a status write.
  }
}

/**
 * Read a snapshot from disk. Returns `null` when the file doesn't
 * exist or fails to parse — callers fall back to deriving status from
 * the live tmux session list.
 */
export async function readSnapshot(
  sessionDir: string,
): Promise<WorkflowStatusSnapshot | null> {
  try {
    const file = Bun.file(statusFilePath(sessionDir));
    if (!(await file.exists())) return null;
    const parsed: unknown = JSON.parse(await file.text());
    if (!isSnapshot(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Runtime guard for deserialised snapshots — keeps the reader type-safe. */
function isSnapshot(value: unknown): value is WorkflowStatusSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 1 &&
    typeof v.workflowRunId === "string" &&
    typeof v.tmuxSession === "string" &&
    typeof v.overall === "string" &&
    Array.isArray(v.sessions)
  );
}

/**
 * Extract the `workflowRunId` (the trailing 8-hex segment) from a
 * tmux session name shaped `atomic-wf-<agent>-<name>-<id>`. Returns
 * `null` for non-workflow sessions or names that don't end in a
 * UUID-style suffix.
 */
export function workflowRunIdFromTmuxName(name: string): string | null {
  if (!name.startsWith("atomic-wf-")) return null;
  const lastDash = name.lastIndexOf("-");
  if (lastDash < 0) return null;
  const candidate = name.slice(lastDash + 1);
  // generateId() produces an 8-char hex slice from crypto.randomUUID.
  if (!/^[0-9a-f]{8}$/i.test(candidate)) return null;
  return candidate;
}
