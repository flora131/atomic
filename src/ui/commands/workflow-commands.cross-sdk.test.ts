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
    spawnSubagent: async ({ name }) => {
      if (name === "reviewer") {
        return {
          success: true,
          output: JSON.stringify({
            findings: [],
            overall_correctness: "patch is correct",
            overall_explanation: "No issues",
            overall_confidence_score: 0.9,
          }),
        };
      }

      return {
        success: true,
        output: "worker complete",
      };
    },
    streamAndWait: async () => ({
      content: JSON.stringify([
        {
          id: "#1",
          content: "Cross SDK smoke task",
          status: "pending",
          activeForm: "Running cross SDK smoke task",
          blockedBy: [],
        },
      ]),
      wasInterrupted: false,
      wasCancelled: false,
    }),
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

describe("/ralph cross-SDK smoke", () => {
  for (const agentType of ["claude", "opencode", "copilot"] as const) {
    test(`executes successfully for ${agentType}`, async () => {
      const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
      expect(command).toBeDefined();

      const result = await command!.execute(
        "Run cross-SDK smoke",
        createMockContext({ agentType }),
      );

      expect(result.success).toBe(true);
      expect(result.stateUpdate?.workflowActive).toBe(false);
    });
  }
});
