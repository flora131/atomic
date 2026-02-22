import { describe, expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";
import type { CommandContext } from "./registry.ts";
import { getWorkflowCommands } from "./workflow-commands.ts";

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
    streamAndWait: async () => ({ content: "", wasInterrupted: false, wasCancelled: false }),
    waitForUserInput: async () => "",
    clearContext: async () => {},
    setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
    setRalphTaskIds: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("/ralph integration", () => {
  test("persists tasks.json and completes full cycle", async () => {
    let sessionDir: string | null = null;

    const context = createMockContext({
      streamAndWait: async () => ({
        content: JSON.stringify([
          {
            id: "#1",
            content: "First task",
            status: "pending",
            activeForm: "Doing first task",
            blockedBy: [],
          },
          {
            id: "#2",
            content: "Second task",
            status: "pending",
            activeForm: "Doing second task",
            blockedBy: ["#1"],
          },
        ]),
        wasInterrupted: false,
        wasCancelled: false,
      }),
      spawnSubagent: async ({ name }) => {
        if (name === "reviewer") {
          return {
            success: true,
            output: JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation: "No findings",
              overall_confidence_score: 0.92,
            }),
          };
        }

        return {
          success: true,
          output: "worker done",
        };
      },
      setRalphSessionDir: (dir) => {
        sessionDir = dir;
      },
    });

    const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
    expect(command).toBeDefined();

    const result = await command!.execute("Implement workflow", context);
    expect(result.success).toBe(true);
    expect(sessionDir).not.toBeNull();

    if (!sessionDir) {
      throw new Error("sessionDir was not set");
    }

    const tasksPath = join(sessionDir, "tasks.json");
    const saved = JSON.parse(await readFile(tasksPath, "utf-8")) as Array<{
      id: string;
      status: string;
    }>;

    expect(saved).toHaveLength(2);
    expect(saved.every((task) => task.status === "completed")).toBe(true);
  });
});
