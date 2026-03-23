import { join } from "path";
import { readFile, rename, unlink } from "fs/promises";
import {
  normalizeTodoItem,
  normalizeTodoItems,
  type NormalizedTodoItem,
} from "@/state/parts/helpers/task-status.ts";
import type { WorkflowRuntimeTaskResultEnvelope } from "@/services/workflows/runtime-contracts.ts";

// Re-export session management from canonical service module
export {
  getActiveSession,
  registerActiveSession,
  completeSession,
} from "@/services/agent-discovery/index.ts";

// Local import for use within this file
import { getActiveSession, getActiveSessions } from "@/services/agent-discovery/index.ts";

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
    description: string;
    status: string;
    summary: string;
    blockedBy?: string[];
    taskResult?: WorkflowRuntimeTaskResultEnvelope;
  }>,
  sessionId?: string,
): Promise<void> {
  let sessionDir: string | undefined;
  if (sessionId) {
    const registeredSession = getActiveSessions().get(sessionId);
    sessionDir = registeredSession?.sessionDir;
  }
  if (!sessionDir) {
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
