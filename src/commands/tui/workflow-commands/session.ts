import { join } from "path";
import { readFile, rename, unlink } from "fs/promises";
import {
  getWorkflowSessionDir,
  type WorkflowSession,
} from "@/services/workflows/session.ts";
import {
  normalizeTodoItem,
  normalizeTodoItems,
  type NormalizedTodoItem,
} from "@/lib/ui/task-status.ts";
import type { WorkflowRuntimeTaskResultEnvelope } from "@/services/workflows/runtime-contracts.ts";

const activeSessions = new Map<string, WorkflowSession>();

export function getActiveSession(): WorkflowSession | undefined {
  const sessions = Array.from(activeSessions.values());
  return sessions.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

export function registerActiveSession(session: WorkflowSession): void {
  activeSessions.set(session.sessionId, session);
}

export function completeSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

async function atomicWrite(
  targetPath: string,
  content: string | Buffer,
): Promise<void> {
  const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
  const tempPath = join(dir, `.tasks-${crypto.randomUUID()}.tmp`);

  try {
    await Bun.write(tempPath, content);
    await rename(tempPath, targetPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors.
    }
    throw error;
  }
}

export async function saveTasksToActiveSession(
  tasks: Array<{
    id?: string;
    content: string;
    status: string;
    activeForm: string;
    blockedBy?: string[];
    taskResult?: WorkflowRuntimeTaskResultEnvelope;
  }>,
  sessionId?: string,
): Promise<void> {
  let sessionDir: string | undefined;
  if (sessionId) {
    sessionDir = getWorkflowSessionDir(sessionId);
  } else {
    const session = getActiveSession();
    sessionDir = session?.sessionDir;
  }
  if (!sessionDir) {
    console.error(
      "[workflow] saveTasksToActiveSession: no session directory found",
    );
    return;
  }
  const tasksPath = join(sessionDir, "tasks.json");
  try {
    const content = JSON.stringify(
      tasks.map((task) => normalizeTodoItem(task)),
      null,
      2,
    );
    await atomicWrite(tasksPath, content);
  } catch (error) {
    console.error("[workflow] Failed to write tasks.json:", error);
  }
}

export async function readTasksFromDisk(
  sessionDir: string,
): Promise<NormalizedTodoItem[]> {
  const tasksPath = join(sessionDir, "tasks.json");
  try {
    const content = await readFile(tasksPath, "utf-8");
    return normalizeTodoItems(JSON.parse(content));
  } catch {
    return [];
  }
}
