import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TodoItem } from "../../sdk/tools/todo-write.ts";
import type { CommandContext } from "./registry.ts";
import { getWorkflowCommands } from "./workflow-commands.ts";
import { getWorkflowSessionDir } from "../../workflows/session.ts";

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("workflow-commands /ralph resume", () => {
  test("normalizes interrupted states and persists normalized tasks before resuming", async () => {
    const sessionId = crypto.randomUUID();
    const sessionDir = getWorkflowSessionDir(sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const taskPayload = [
      { id: "#1", content: "pending", activeForm: "working on pending", status: "pending" },
      { id: "#2", content: "in-progress", activeForm: "working on in-progress", status: "in_progress" },
      { id: "#3", content: "done", activeForm: "working on done", status: "completed" },
      { id: "#4", content: "failed", activeForm: "working on failed", status: "error" },
    ];

    await Bun.write(join(sessionDir, "tasks.json"), JSON.stringify(taskPayload, null, 2));

    const todoSnapshots: TodoItem[][] = [];
    let capturedSessionDir: string | null = null;
    let capturedSessionId: string | null = null;

    const context = createMockContext({
      setTodoItems: (items) => {
        todoSnapshots.push(items);
      },
      setRalphSessionDir: (dir) => {
        capturedSessionDir = dir;
      },
      setRalphSessionId: (id) => {
        capturedSessionId = id;
      },
    });

    try {
      const ralphCommand = getWorkflowCommands().find((cmd) => cmd.name === "ralph");
      expect(ralphCommand).toBeDefined();

      const result = await ralphCommand!.execute(`--resume ${sessionId}`, context);
      expect(result.success).toBe(true);

      expect(capturedSessionDir as string | null).toEqual(sessionDir);
      expect(capturedSessionId as string | null).toEqual(sessionId);
      expect(todoSnapshots.length).toBeGreaterThan(0);
      // Resume normalizes in_progress -> pending; no auto-orchestration runs
      expect(todoSnapshots[0]?.map((task) => task.status) as string[]).toEqual([
        "pending",
        "pending",
        "completed",
        "error", // error tasks remain as error (not reset to pending)
      ]);

      // Persisted tasks reflect normalized state only (no orchestrator completion)
      const persisted = JSON.parse(readFileSync(join(sessionDir, "tasks.json"), "utf-8")) as Array<{ status: string }>;
      expect(persisted.map((task) => task.status)).toEqual([
        "pending",   // remains pending (no auto-dispatch)
        "pending",   // normalized from in_progress to pending (no auto-dispatch)
        "completed",
        "error",     // error tasks remain as error
      ]);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
