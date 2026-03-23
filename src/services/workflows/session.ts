/**
 * Workflow Session Management
 *
 * Manages persistent session directories at ~/.atomic/sessions/workflows/{workflowName}/{sessionId}/
 * for all workflow executions (including Ralph). Sub-agent outputs are stored as
 * individual JSON files for observability and debugging.
 *
 * Session state is stored separately from workflow definitions (~/.atomic/workflows/)
 * to avoid conflicts with workflow file discovery.
 */

import { join } from "path";
import { homedir } from "os";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowSession {
  sessionId: string;
  workflowName: string;
  sessionDir: string;
  createdAt: string;
  lastUpdated: string;
  status: "running" | "paused" | "completed" | "failed";
  nodeHistory: string[];
  outputs: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

export const WORKFLOW_SESSIONS_DIR = join(
  homedir(),
  ".atomic",
  "sessions",
  "workflows",
);

// ============================================================================
// Session Lifecycle
// ============================================================================

export function generateWorkflowSessionId(): string {
  return crypto.randomUUID();
}

export function getWorkflowSessionDir(workflowName: string, sessionId: string): string {
  return join(WORKFLOW_SESSIONS_DIR, workflowName, sessionId);
}

export async function initWorkflowSession(
  workflowName: string,
  sessionId?: string,
): Promise<WorkflowSession> {
  const id = sessionId ?? generateWorkflowSessionId();
  const sessionDir = getWorkflowSessionDir(workflowName, id);

  // Create directory structure
  await Bun.write(join(sessionDir, ".gitkeep"), "");
  for (const subdir of ["checkpoints", "agents", "logs"]) {
    await Bun.write(join(sessionDir, subdir, ".gitkeep"), "");
  }

  const session: WorkflowSession = {
    sessionId: id,
    workflowName,
    sessionDir,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    status: "running",
    nodeHistory: [],
    outputs: {},
  };

  await saveWorkflowSession(session);
  return session;
}

export async function saveWorkflowSession(session: WorkflowSession): Promise<void> {
  session.lastUpdated = new Date().toISOString();
  await Bun.write(
    join(session.sessionDir, "session.json"),
    JSON.stringify(session, null, 2),
  );
}

