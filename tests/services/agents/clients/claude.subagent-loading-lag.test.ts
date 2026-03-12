import { describe, expect, test } from "bun:test";

import { ClaudeAgentClient } from "@/services/agents/clients/claude.ts";
import { createClaudeSession } from "@/services/agents/clients/claude/lifecycle.ts";

describe("ClaudeAgentClient Ralph sub-agent loading lag reproduction", () => {
  test("does not reparse filesystem agents when relying on Claude native settings loading", async () => {
    class RalphLagReproClaudeClient extends ClaudeAgentClient {
      public loadCalls = 0;

      protected override async loadConfiguredAgents(_projectRoot: string) {
        this.loadCalls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        return [];
      }
    }

    const client = new RalphLagReproClaudeClient();
    (
      client as unknown as {
        isRunning: boolean;
      }
    ).isRunning = true;

    const plannerSession = await client.createSession({ sessionId: "ralph-planner" });
    const workerSessionA = await client.createSession({ sessionId: "ralph-worker-a" });
    const workerSessionB = await client.createSession({ sessionId: "ralph-worker-b" });
    const reviewerSession = await client.createSession({ sessionId: "ralph-reviewer" });

    await plannerSession.destroy();
    await workerSessionA.destroy();
    await workerSessionB.destroy();
    await reviewerSession.destroy();

    expect(client.loadCalls).toBe(0);
  });

  test("merges configured filesystem agents when programmatic Claude agents are provided", async () => {
    let emittedConfig: Record<string, unknown> | undefined;

    await createClaudeSession({
      config: {
        sessionId: "ralph-manual-agent",
        agents: {
          planner: {
            description: "Manual planner",
            prompt: "Plan work",
            tools: ["Read"],
          },
        },
      },
      isRunning: true,
      loadConfiguredAgents: async () => [
        {
          name: "debugger",
          source: "local",
          description: "Debug issues",
          prompt: "Debug work",
          tools: ["Read", "Bash"],
          model: "opus",
        },
      ],
      emitEvent: (_eventType, _sessionId, data) => {
        emittedConfig = data.config as Record<string, unknown> | undefined;
      },
      emitProviderEvent: () => {},
      emitRuntimeSelection: () => {},
      pendingHookSessionBindings: [],
      wrapQuery: (_queryInstance, sessionId, config) => ({
        id: sessionId,
        send: async () => ({ type: "text", content: "" }),
        stream: async function* () {},
        summarize: async () => {},
        getContextUsage: async () => ({
          inputTokens: 0,
          outputTokens: 0,
          maxTokens: 0,
          usagePercentage: 0,
        }),
        getSystemToolsTokens: () => 0,
        destroy: async () => {},
        abort: async () => {},
        abortBackgroundAgents: async () => {},
        __config: config,
      }) as never,
    });

    expect(emittedConfig).toBeDefined();
    expect(
      (
        emittedConfig as {
          agents?: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }>;
        }
      ).agents,
    ).toEqual({
      planner: {
        description: "Manual planner",
        prompt: "Plan work",
        tools: ["Read"],
      },
      debugger: {
        description: "Debug issues",
        prompt: "Debug work",
        tools: ["Read", "Bash"],
        model: "opus",
      },
    });
  });
});
