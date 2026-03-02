import { describe, expect, mock, test } from "bun:test";
import { createAgentCommand, type AgentInfo } from "./agent-commands.ts";
import type { CommandContext } from "./registry.ts";

function createContext(overrides: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: { isStreaming: false, messageCount: 0 },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    setWorkflowSessionDir: () => {},
    setWorkflowSessionId: () => {},
    setWorkflowTaskIds: () => {},
    waitForUserInput: async () => "",
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("agent command routing", () => {
  const baseAgent: AgentInfo = {
    name: "worker",
    description: "test agent",
    source: "project",
    filePath: ".claude/agents/worker.md",
  };

  test("routes OpenCode @agent as agent-only stream", () => {
    const sendSilentMessage = mock(() => {});
    const command = createAgentCommand(baseAgent);

    command.execute("do work", createContext({ agentType: "opencode", sendSilentMessage }));

    expect(sendSilentMessage).toHaveBeenCalledWith("do work", {
      agent: "worker",
      isAgentOnlyStream: true,
    });
  });

  test("routes Claude @agent as agent-only stream", () => {
    const sendSilentMessage = mock(() => {});
    const command = createAgentCommand(baseAgent);

    command.execute("do work", createContext({ agentType: "claude", sendSilentMessage }));

    expect(sendSilentMessage).toHaveBeenCalledWith("do work", {
      agent: "worker",
      isAgentOnlyStream: true,
    });
  });
});
