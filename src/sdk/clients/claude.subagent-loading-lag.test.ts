import { describe, expect, test } from "bun:test";

import { ClaudeAgentClient } from "./claude.ts";

describe("ClaudeAgentClient Ralph sub-agent loading lag reproduction", () => {
  test("loads configured agents for every sub-agent session created by a Ralph-style run", async () => {
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

    const startedAt = Date.now();
    const plannerSession = await client.createSession({ sessionId: "ralph-planner" });
    const workerSessionA = await client.createSession({ sessionId: "ralph-worker-a" });
    const workerSessionB = await client.createSession({ sessionId: "ralph-worker-b" });
    const reviewerSession = await client.createSession({ sessionId: "ralph-reviewer" });
    const elapsedMs = Date.now() - startedAt;

    await plannerSession.destroy();
    await workerSessionA.destroy();
    await workerSessionB.destroy();
    await reviewerSession.destroy();

    expect(client.loadCalls).toBe(4);
    expect(elapsedMs).toBeGreaterThanOrEqual(80);
  });
});
