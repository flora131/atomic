import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentType } from "../../models";
import { parseSlashCommand } from "./index.ts";
import type { CommandContext, CommandResult } from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import { registerBuiltinSkills } from "./skill-commands.ts";

const PROVIDERS: AgentType[] = ["claude", "opencode", "copilot"];

function createMockContext(
  agentType: AgentType,
  sentMessages: string[],
): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: (content: string) => {
      sentMessages.push(content);
    },
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

async function executeSlashPlaywrightCommand(
  rawCommand: string,
  agentType: AgentType,
): Promise<{ result: CommandResult; sentMessages: string[] }> {
  const parsed = parseSlashCommand(rawCommand);
  expect(parsed.isCommand).toBe(true);

  const command = globalRegistry.get(parsed.name);
  expect(command).toBeDefined();

  const sentMessages: string[] = [];
  const context = createMockContext(agentType, sentMessages);
  const result = await Promise.resolve(command!.execute(parsed.args, context));

  return { result, sentMessages };
}

describe("playwright-cli slash command E2E provider matrix", () => {
  beforeEach(() => {
    globalRegistry.clear();
    registerBuiltinSkills();
  });

  test.each(PROVIDERS)(
    "provider %s: /playwright-cli loads skill content and forwards user arguments",
    async (provider) => {
      const { result, sentMessages } = await executeSlashPlaywrightCommand(
        "/playwright-cli fetch https://example.com",
        provider,
      );

      expect(result.success).toBe(true);
      expect(result.skillLoaded).toBe("playwright-cli");
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toContain('<skill-loaded name="playwright-cli">');
      expect(sentMessages[0]).toContain("User request: fetch https://example.com");
      expect(sentMessages[0]).toContain("playwright-cli open [url]");
      expect(sentMessages[0]).not.toContain("WebFetch");
      expect(sentMessages[0]).not.toContain("WebSearch");
    },
  );

  test.each(PROVIDERS)(
    "provider %s: /pw and /playwright aliases resolve to identical playwright-cli payloads",
    async (provider) => {
      const viaPw = await executeSlashPlaywrightCommand(
        "/pw capture login flow",
        provider,
      );
      const viaPlaywright = await executeSlashPlaywrightCommand(
        "/playwright capture login flow",
        provider,
      );

      expect(viaPw.result.success).toBe(true);
      expect(viaPw.result.skillLoaded).toBe("playwright-cli");
      expect(viaPlaywright.result.success).toBe(true);
      expect(viaPlaywright.result.skillLoaded).toBe("playwright-cli");
      expect(viaPw.sentMessages).toHaveLength(1);
      expect(viaPlaywright.sentMessages).toHaveLength(1);
      expect(viaPw.sentMessages[0]).toBe(viaPlaywright.sentMessages[0]);
    },
  );

  test.each(PROVIDERS)(
    "provider %s: /playwright-cli without arguments uses deterministic placeholder",
    async (provider) => {
      const { result, sentMessages } = await executeSlashPlaywrightCommand(
        "/playwright-cli",
        provider,
      );

      expect(result.success).toBe(true);
      expect(result.skillLoaded).toBe("playwright-cli");
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toContain("User request: [no arguments provided]");
    },
  );
});
