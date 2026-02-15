import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TodoItem } from "../../sdk/tools/todo-write.ts";
import type { CommandContext } from "./registry.ts";
import { getWorkflowCommands } from "./workflow-commands.ts";
import { getWorkflowSessionDir } from "../../workflows/session.ts";
import { setSubagentBridge, SubagentGraphBridge, type SubagentResult } from "../../graph/subagent-bridge.ts";

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
  // Mock bridge setup
  beforeAll(() => {
    const mockBridge = new SubagentGraphBridge({
      createSession: async () => {
        throw new Error("Mock bridge: createSession should not be called in these tests");
      },
    });
    
    // Override spawn to complete tasks immediately
    mockBridge.spawn = async (options) => {
      // Read current tasks and mark the first pending task as completed
      const sessionId = options.agentId.split("-")[0]; // Extract session context if needed
      return {
        agentId: options.agentId,
        success: true,
        output: "Task completed",
        toolUses: 0,
        durationMs: 0,
      };
    };
    
    setSubagentBridge(mockBridge);
  });
  
  afterAll(() => {
    setSubagentBridge(null);
  });

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

    let capturedTodos: TodoItem[] = [];
    let capturedSessionDir: string | null = null;
    let capturedSessionId: string | null = null;

    const context = createMockContext({
      setTodoItems: (items) => {
        capturedTodos = items;
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
      expect(capturedTodos.map((task) => task.status) as string[]).toEqual([
        "pending",
        "pending",
        "completed",
        "error", // error tasks remain as error (not reset to pending)
      ]);

      // DAG orchestrator should complete all pending tasks
      const persisted = JSON.parse(readFileSync(join(sessionDir, "tasks.json"), "utf-8")) as Array<{ status: string }>;
      expect(persisted.map((task) => task.status)).toEqual([
        "completed", // DAG orchestrator completed #1
        "completed", // DAG orchestrator completed #2 (was normalized from in_progress to pending)
        "completed",
        "error", // error tasks remain as error
      ]);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
