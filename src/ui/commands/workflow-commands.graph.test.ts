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
    });

    const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
    expect(command).toBeDefined();

    const result = await command!.execute("Ship the graph migration", context);

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(false);
    expect(todoUpdates.length).toBeGreaterThan(0);
    expect(ralphTaskIds.length).toBeGreaterThan(0);
    expect(result.workflowPhases?.some((phase) => phase.message.includes("Task Decomposition"))).toBe(true);
  });

  test("captures stream and sub-agent activity in phase accumulators", async () => {
    const context = createMockContext({
      streamAndWait: async () => ({
        content: JSON.stringify([
          {
            id: "#1",
            content: "Capture events task",
            status: "pending",
            activeForm: "Capturing events",
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
              overall_confidence_score: 0.99,
            }),
          };
        }
        return { success: true, output: "worker complete" };
      },
    });

    const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
    expect(command).toBeDefined();

    const result = await command!.execute("Capture phase events", context);

    expect(result.success).toBe(true);
    const workflowPhases = result.workflowPhases ?? [];
    expect(workflowPhases.length).toBeGreaterThan(0);
    expect(workflowPhases.some((phase) => phase.message === "[Task Decomposition] Decomposed into 1 task.")).toBe(
      true,
    );
    expect(workflowPhases.some((phase) => phase.events.length > 0)).toBe(true);
    const capturedEventTypes = workflowPhases.flatMap((phase) => phase.events.map((event) => event.type));
    expect(capturedEventTypes).toContain("text");
    expect(capturedEventTypes).toContain("agent_spawn");
    expect(capturedEventTypes).toContain("agent_complete");
  });
});
