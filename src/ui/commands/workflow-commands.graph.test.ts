import { describe, expect, test } from "bun:test";
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

describe("/ralph graph command bridge", () => {
  test("executes through graph stream and returns workflow state update", async () => {
    const todoUpdates: unknown[] = [];
    const ralphTaskIds: Array<string[]> = [];
    const assistantMessages: string[] = [];

    const context = createMockContext({
      streamAndWait: async () => ({
        content: JSON.stringify([
          {
            id: "#1",
            content: "Implement command bridge",
            status: "pending",
            activeForm: "Implementing command bridge",
            blockedBy: [],
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
              overall_explanation: "No actionable findings",
              overall_confidence_score: 0.98,
            }),
          };
        }

        return { success: true, output: "worker done" };
      },
      setTodoItems: (items) => {
        todoUpdates.push(items);
      },
      setRalphTaskIds: (ids) => {
        ralphTaskIds.push(Array.from(ids));
      },
      addMessage: (role, content) => {
        if (role === "assistant") {
          assistantMessages.push(content);
        }
      },
    });

    const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
    expect(command).toBeDefined();

    const result = await command!.execute("Ship the graph migration", context);

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(false);
    expect(todoUpdates.length).toBeGreaterThan(0);
    expect(ralphTaskIds.length).toBeGreaterThan(0);
    expect(assistantMessages.some((message) => message.includes("Task Decomposition"))).toBe(true);
  });
});
