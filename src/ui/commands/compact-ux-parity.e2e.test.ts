import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentType } from "../../models";
import type { CommandContext, CommandResult } from "./registry.ts";
import { parseSlashCommand } from "./index.ts";
import { globalRegistry } from "./registry.ts";
import { registerBuiltinCommands } from "./builtin-commands.ts";
import { getSpinnerVerbForCommand } from "../chat.tsx";
import type { ChatMessage } from "../chat.tsx";
import {
  appendCompactionSummary,
  appendToHistoryBuffer,
  clearHistoryBuffer,
  readHistoryBuffer,
} from "../utils/conversation-history-buffer.ts";

const PROVIDERS: AgentType[] = ["claude", "opencode", "copilot"];

function makeChatMessages(count: number, prefix = "m"): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    role: "user" as const,
    content: `message ${i + 1}`,
    timestamp: new Date().toISOString(),
  }));
}

function createMockContext(
  agentType: AgentType,
  summarize: () => Promise<void>,
): CommandContext {
  const mockSession = {
    summarize,
  } as Pick<NonNullable<CommandContext["session"]>, "summarize">;

  return {
    session: mockSession as NonNullable<CommandContext["session"]>,
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
    clearContext: async () => {},
    setTodoItems: () => {},
    setWorkflowSessionDir: () => {},
    setWorkflowSessionId: () => {},
    setWorkflowTaskIds: () => {},
    waitForUserInput: async () => "",
    updateWorkflowState: () => {},
    agentType,
  };
}

async function executeCompactSlashCommand(
  agentType: AgentType,
  summarize: () => Promise<void>,
): Promise<{ parsedName: string; result: CommandResult }> {
  const parsed = parseSlashCommand("/compact");
  expect(parsed.isCommand).toBe(true);

  const command = globalRegistry.get(parsed.name);
  expect(command).toBeDefined();

  const context = createMockContext(agentType, summarize);
  const result = await Promise.resolve(command!.execute(parsed.args, context));

  return {
    parsedName: parsed.name,
    result,
  };
}

describe("compact slash command e2e parity", () => {
  beforeEach(() => {
    globalRegistry.clear();
    registerBuiltinCommands();
    clearHistoryBuffer();
  });

  afterEach(() => {
    clearHistoryBuffer();
  });

  test.each(PROVIDERS)(
    "provider %s: /compact keeps spinner verb and command contract parity",
    async (provider) => {
      let summarizeCalls = 0;
      const { parsedName, result } = await executeCompactSlashCommand(provider, async () => {
        summarizeCalls += 1;
      });

      expect(getSpinnerVerbForCommand(parsedName)).toBe("Compacting");
      expect(result.success).toBe(true);
      expect(result.message).toBe("Conversation compacted (ctrl+o for history)");
      expect(result.clearMessages).toBe(true);
      expect(result.compactionSummary).toContain("Conversation context was compacted");
      expect(summarizeCalls).toBe(1);
    },
  );

  test.each(PROVIDERS)(
    "provider %s: long-chat compact lifecycle preserves summary then continued history",
    async (provider) => {
      appendToHistoryBuffer(makeChatMessages(120, "long"));
      expect(await readHistoryBuffer()).toHaveLength(120);

      const { result } = await executeCompactSlashCommand(provider, async () => {});
      expect(result.success).toBe(true);
      expect(result.clearMessages).toBe(true);
      expect(result.compactionSummary).toBeDefined();

      const shouldResetHistory = result.destroySession || Boolean(result.compactionSummary);
      if (result.clearMessages && shouldResetHistory) {
        clearHistoryBuffer();
        if (result.compactionSummary) {
          appendCompactionSummary(result.compactionSummary);
        }
      }

      const compactedHistory = await readHistoryBuffer();
      expect(compactedHistory).toHaveLength(1);
      expect(compactedHistory[0]?.id).toMatch(/^compact_/);
      expect(compactedHistory[0]?.role).toBe("assistant");
      expect(compactedHistory[0]?.content).toContain("Conversation context was compacted");

      appendToHistoryBuffer(makeChatMessages(12, "post"));
      const continuedHistory = await readHistoryBuffer();
      expect(continuedHistory).toHaveLength(13);
      expect(continuedHistory[0]?.id).toMatch(/^compact_/);
      expect(continuedHistory[1]?.id).toBe("post1");
      expect(continuedHistory[12]?.id).toBe("post12");
    },
  );
});
