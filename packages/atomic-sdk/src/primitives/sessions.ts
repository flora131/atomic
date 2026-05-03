/**
 * Session-management primitives.
 *
 * Thin wrappers around the tmux runtime utilities and the on-disk
 * `~/.atomic/sessions/<workflowRunId>/` layout. Consumers (atomic CLI,
 * third-party CLIs, embedding TUIs) call these instead of touching tmux
 * commands or the status-writer schema directly.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import {
  attachSession as tmuxAttach,
  detachClients as tmuxDetachClients,
  isTmuxInstalled,
  killSession,
  listSessions as listAllTmuxSessions,
  nextWindow as tmuxNextWindow,
  previousWindow as tmuxPreviousWindow,
  selectWindow as tmuxSelectWindow,
  type SessionType,
  type TmuxSession,
} from "../runtime/tmux.ts";
import {
  readSnapshot,
  workflowRunIdFromTmuxName,
  type WorkflowStatusSnapshot,
} from "../runtime/status-writer.ts";
import { MissingDependencyError, SessionNotFoundError } from "../errors.ts";
import type { AgentType, SavedMessage } from "../types.ts";

/** Scope filter for session listings — chat sessions, workflow sessions, or both. */
export type SessionScope = "chat" | "workflow" | "all";

/** Single session entry returned by `listSessions` / `getSession`. */
export interface SessionInfo {
  /** Tmux session name (e.g. `atomic-wf-claude-ralph-a1b2c3d4`). */
  id: string;
  /** Session type derived from the name prefix. */
  type?: SessionType;
  /** Agent backend that owns this session. */
  agent?: string;
  /** ISO 8601 creation timestamp. */
  created: string;
  /** Whether a tmux client is currently attached. */
  attached: boolean;
}

/** Status snapshot persisted by the orchestrator at `~/.atomic/sessions/<id>/status.json`. */
export type StatusSnapshot = WorkflowStatusSnapshot;

/** Options for filtering `listSessions()`. */
export interface ListSessionsOptions {
  /** Restrict to one or more agent backends. */
  agent?: AgentType | readonly AgentType[];
  /** Restrict by session kind. Defaults to `"all"`. */
  scope?: SessionScope;
}

/**
 * Injectable dependencies for the session primitives.
 *
 * Defaults wire through to the real tmux/status-writer implementations.
 * Tests pass in mocks; embedding consumers can override the base directory
 * or swap the tmux backend (e.g. for psmux on Windows) without monkey-
 * patching the underlying modules.
 */
export interface SessionPrimitiveDeps {
  isTmuxInstalled: () => boolean;
  listAllTmuxSessions: () => readonly TmuxSession[];
  killSession: (id: string) => void;
  attachSession: (id: string) => void;
  detachClients: (id: string) => void;
  nextWindow: (id: string) => void;
  previousWindow: (id: string) => void;
  /** `target` is a tmux window target like `<session>:<index>`. */
  selectWindow: (target: string) => void;
  readSnapshot: typeof readSnapshot;
  /** Base directory for session artefacts. Defaults to `~/.atomic/sessions`. */
  sessionsBaseDir: string;
}

/** Default deps object — wires through to the real implementations. */
const defaultDeps: SessionPrimitiveDeps = {
  isTmuxInstalled,
  listAllTmuxSessions,
  killSession,
  attachSession: tmuxAttach,
  detachClients: tmuxDetachClients,
  nextWindow: tmuxNextWindow,
  previousWindow: tmuxPreviousWindow,
  selectWindow: tmuxSelectWindow,
  readSnapshot,
  sessionsBaseDir: join(homedir(), ".atomic", "sessions"),
};

/** Convert a TmuxSession into the consumer-facing SessionInfo shape. */
function toSessionInfo(s: TmuxSession): SessionInfo {
  return {
    id: s.name,
    type: s.type,
    agent: s.agent,
    created: s.created,
    attached: s.attached,
  };
}

/** Filter sessions by scope. */
function filterByScope(
  sessions: readonly TmuxSession[],
  scope: SessionScope,
): TmuxSession[] {
  if (scope === "all") return [...sessions];
  return sessions.filter((s) => s.type === scope);
}

/** Normalise the optional `agent` option into a flat list. Empty list = no filter. */
function toAgentList(
  agent: AgentType | readonly AgentType[] | undefined,
): readonly AgentType[] {
  if (agent === undefined) return [];
  if (Array.isArray(agent)) return agent as readonly AgentType[];
  return [agent as AgentType];
}

/** Filter sessions by an allow-list of agent backends. */
function filterByAgents(
  sessions: readonly TmuxSession[],
  agents: readonly AgentType[],
): TmuxSession[] {
  if (agents.length === 0) return [...sessions];
  const allowed = new Set<string>(agents);
  return sessions.filter((s) => s.agent !== undefined && allowed.has(s.agent));
}

/**
 * List atomic-managed tmux sessions on the shared `atomic` socket.
 *
 * Returns an empty array when tmux is not installed or the server has no
 * sessions — never throws on the cold-start path.
 */
export function listSessions(
  options: ListSessionsOptions = {},
  deps: SessionPrimitiveDeps = defaultDeps,
): SessionInfo[] {
  if (!deps.isTmuxInstalled()) return [];
  const scope = options.scope ?? "all";
  const agents = toAgentList(options.agent);

  const all = deps.listAllTmuxSessions();
  const scoped = filterByScope(all, scope);
  const filtered = filterByAgents(scoped, agents);
  return filtered.map(toSessionInfo);
}

/** Look up a single session by id. Returns `undefined` when not found. */
export function getSession(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): SessionInfo | undefined {
  if (!deps.isTmuxInstalled()) return undefined;
  const match = deps.listAllTmuxSessions().find((s) => s.name === id);
  return match ? toSessionInfo(match) : undefined;
}

/**
 * Stop a running session. Best-effort: if the session is already gone
 * the underlying `tmux kill-session` is a no-op-equivalent.
 */
export async function stopSession(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<void> {
  if (!deps.isTmuxInstalled()) return;
  try {
    deps.killSession(id);
  } catch {
    // tmux returns non-zero when the session has already been torn down —
    // surface that as a successful stop rather than a hard failure.
  }
}

/**
 * Attach to a running session interactively. Only valid when the host
 * process has a TTY — otherwise the underlying tmux invocation will
 * complain that it can't take over the terminal.
 */
export async function attachSession(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<void> {
  if (!deps.isTmuxInstalled()) {
    throw new MissingDependencyError("tmux");
  }
  deps.attachSession(id);
}

/**
 * Validate that tmux is installed and the session id exists on the
 * atomic socket. Shared preamble for the navigation primitives.
 */
function ensureSession(id: string, deps: SessionPrimitiveDeps): void {
  if (!deps.isTmuxInstalled()) {
    throw new MissingDependencyError("tmux");
  }
  const session = deps.listAllTmuxSessions().find((s) => s.name === id);
  if (!session) {
    throw new SessionNotFoundError(id);
  }
}

/**
 * Move the session's current-window pointer to the next window.
 * Mirrors the `Ctrl+\` keybinding bound inside an attached client.
 *
 * Pure navigation: never attaches. An already-attached client sees the
 * change live; if no client is watching, the session's current-window
 * pointer is updated silently and a subsequent `attachSession` will
 * land on the new window. Compose `nextWindow(id)` + `attachSession(id)`
 * if you want navigate-then-attach.
 */
export async function nextWindow(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<void> {
  ensureSession(id, deps);
  deps.nextWindow(id);
}

/**
 * Move the session's current-window pointer to the previous window.
 * Symmetrical counterpart to {@link nextWindow} — also pure navigation.
 */
export async function previousWindow(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<void> {
  ensureSession(id, deps);
  deps.previousWindow(id);
}

/**
 * Jump to the orchestrator window (window 0) of the target session.
 * Mirrors the `Ctrl+G` keybinding bound inside an attached client.
 *
 * For workflow sessions, window 0 hosts the orchestrator graph view;
 * for chat sessions, window 0 is the agent pane. Pure navigation —
 * never attaches.
 */
export async function gotoOrchestrator(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<void> {
  ensureSession(id, deps);
  deps.selectWindow(`${id}:0`);
}

/**
 * Detach every client currently attached to a session. The session
 * itself keeps running in the background — re-attach with
 * {@link attachSession} or `tmux -L atomic attach -t <id>`.
 *
 * Best-effort, idempotent: returns silently when tmux is missing, the
 * session is already gone, or no clients are attached.
 */
export async function detachSession(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<void> {
  if (!deps.isTmuxInstalled()) return;
  try {
    deps.detachClients(id);
  } catch {
    // tmux returns non-zero when the session is gone or no clients are
    // attached — surface that as a successful detach rather than a hard
    // failure, matching `stopSession`'s best-effort semantics.
  }
}

/**
 * Read the on-disk status snapshot for a workflow session. Returns
 * `null` when the orchestrator hasn't written one yet (the workflow
 * is still very early) or when the directory doesn't exist.
 */
export async function getSessionStatus(
  id: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<StatusSnapshot | null> {
  const runId = workflowRunIdFromTmuxName(id);
  if (!runId) return null;
  return await deps.readSnapshot(join(deps.sessionsBaseDir, runId));
}

/**
 * Read the saved native-message transcript for a single session inside
 * a workflow run. `id` is the tmux session id (`atomic-wf-...`); the
 * `sessionName` is the `name` passed to `ctx.stage({ name })` whose
 * messages were saved via `s.save(...)`.
 *
 * Returns an empty array when no transcript was persisted (e.g. the
 * workflow chose not to call `s.save`).
 */
export async function getSessionTranscript(
  id: string,
  sessionName: string,
  deps: SessionPrimitiveDeps = defaultDeps,
): Promise<SavedMessage[]> {
  const runId = workflowRunIdFromTmuxName(id);
  if (!runId) return [];
  const file = Bun.file(
    join(deps.sessionsBaseDir, runId, sessionName, "messages.json"),
  );
  if (!(await file.exists())) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isSavedMessage);
}

/** Runtime guard for deserialised SavedMessage objects. */
function isSavedMessage(value: unknown): value is SavedMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.provider === "claude" ||
    v.provider === "copilot" ||
    v.provider === "opencode"
  );
}
