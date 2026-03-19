/**
 * Active Session Registry
 *
 * Manages the in-memory registry of active workflow sessions.
 * Extracted from `commands/tui/workflow-commands/session.ts` to break the
 * circular dependency where `services/workflows/` imported
 * `registerActiveSession` from `commands/tui/workflow-commands.ts`.
 *
 * Both `commands/tui/` and `services/workflows/` now import from this module.
 */

import type { WorkflowSession } from "@/services/workflows/session.ts";

const activeSessions = new Map<string, WorkflowSession>();

/**
 * Retrieve the most recently created active workflow session.
 */
export function getActiveSession(): WorkflowSession | undefined {
  const sessions = Array.from(activeSessions.values());
  return sessions.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

/**
 * Register a workflow session as active.
 * The session is keyed by its `sessionId` so it can be retrieved or removed later.
 */
export function registerActiveSession(session: WorkflowSession): void {
  activeSessions.set(session.sessionId, session);
}

/**
 * Remove a workflow session from the active registry.
 */
export function completeSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

/**
 * Return a snapshot of all currently active sessions.
 * Useful for diagnostics or status queries.
 */
export function getActiveSessions(): ReadonlyMap<string, WorkflowSession> {
  return activeSessions;
}

/**
 * @internal — visible for testing only.
 * Clear all active sessions from the registry.
 */
export function clearActiveSessions(): void {
  activeSessions.clear();
}
