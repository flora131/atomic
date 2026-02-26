/**
 * Workflow Session Management
 *
 * Manages persistent session directories at ~/.atomic/workflows/sessions/{sessionId}/
 * for all workflow executions (including Ralph). Sub-agent outputs are stored as
 * individual JSON files for observability and debugging.
 */

import { join } from "path";
import { homedir } from "os";
import type { SubagentResult } from "./graph/types.ts";

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
  "workflows",
  "sessions",
);

// ============================================================================
// Session Lifecycle
// ============================================================================

export function generateWorkflowSessionId(): string {
  return crypto.randomUUID();
}

export function getWorkflowSessionDir(sessionId: string): string {
  return join(WORKFLOW_SESSIONS_DIR, sessionId);
}

export async function initWorkflowSession(
  workflowName: string,
  sessionId?: string,
): Promise<WorkflowSession> {
  const id = sessionId ?? generateWorkflowSessionId();
  const sessionDir = getWorkflowSessionDir(id);

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

export async function saveSubagentOutput(
  sessionDir: string,
  agentId: string,
  result: SubagentResult,
): Promise<string> {
  const outputPath = join(sessionDir, "agents", `${agentId}.json`);
  await Bun.write(outputPath, JSON.stringify(result, null, 2));
  return outputPath;
}
