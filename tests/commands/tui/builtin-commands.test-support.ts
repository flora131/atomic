import {
  builtinCommands,
  clearCommand,
  compactCommand,
  exitCommand,
  formatGroupedModels,
  groupByProvider,
  mcpCommand,
  modelCommand,
  themeCommand,
} from "@/commands/tui/builtin-commands.ts";
import type { CommandContext } from "@/commands/tui/registry.ts";

export {
  builtinCommands,
  clearCommand,
  compactCommand,
  exitCommand,
  formatGroupedModels,
  groupByProvider,
  mcpCommand,
  modelCommand,
  themeCommand,
};

export function createMockContext(
  overrides?: Partial<CommandContext>,
): CommandContext {
  return {
    session: null,
    ensureSession: async () => {},
    state: {
      isStreaming: false,
      messageCount: 0,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    waitForUserInput: async () => "",
    clearContext: async () => {},
    setTodoItems: () => {},
    setWorkflowSessionDir: () => {},
    setWorkflowSessionId: () => {},
    setWorkflowTaskIds: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
}
