/**
 * Focused tests: MCP stage scoping order and snapshot storage.
 *
 * Asserts the exact sequence:
 *   stage start → MCP scope.set → adapter call → MCP scope.clear → stage end
 *
 * Also asserts mcpScope is stored on StageSnapshot.
 */
import { test, expect, describe } from "bun:test";
import { run } from "../../src/runs/sync/executor.js";
import { createStore } from "../../src/store.js";
import { defineWorkflow } from "../../src/workflows/define-workflow.js";
import type { WorkflowMcpPort } from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OrderEvent =
  | "stageStart"
  | "mcpSet"
  | "adapterCall"
  | "mcpClear"
  | "stageEnd";

function makeMcpPort(order: OrderEvent[]): WorkflowMcpPort {
  return {
    setScope(_stageId, _allow, _deny) {
      order.push("mcpSet");
    },
    clearScope(_stageId) {
      order.push("mcpClear");
    },
  };
}

function makePromptAdapter(order: OrderEvent[]) {
  return {
    prompt: async (_text: string) => {
      order.push("adapterCall");
      return "ok";
    },
  };
}

// ---------------------------------------------------------------------------
// Order: stage start → MCP set → adapter call → MCP clear → stage end
// ---------------------------------------------------------------------------

describe("MCP stage scoping — call order", () => {
  test("set fires before adapter, clear fires after adapter in finally", async () => {
    const order: OrderEvent[] = [];

    const wf = defineWorkflow("mcp-order-wf")
      .description("order test")
      .run(async (ctx) => {
        const s = ctx.stage("work", { mcp: { allow: ["github"] } });
        await s.prompt("go");
        return {};
      })
      .compile();

    await run(wf, {}, {
      store: createStore(),
      mcp: makeMcpPort(order),
      adapters: { prompt: makePromptAdapter(order) },
      onStageStart: () => order.push("stageStart"),
      onStageEnd: () => order.push("stageEnd"),
    });

    // Required exact subsequence: stageStart < mcpSet < adapterCall < mcpClear < stageEnd
    const idxStageStart = order.indexOf("stageStart");
    const idxMcpSet = order.indexOf("mcpSet");
    const idxAdapterCall = order.indexOf("adapterCall");
    const idxMcpClear = order.indexOf("mcpClear");
    const idxStageEnd = order.indexOf("stageEnd");

    expect(idxStageStart).toBeGreaterThanOrEqual(0);
    expect(idxMcpSet).toBeGreaterThan(idxStageStart);
    expect(idxAdapterCall).toBeGreaterThan(idxMcpSet);
    expect(idxMcpClear).toBeGreaterThan(idxAdapterCall);
    expect(idxStageEnd).toBeGreaterThan(idxMcpClear);
  });

  test("clear fires in finally even when adapter throws", async () => {
    const order: OrderEvent[] = [];

    const wf = defineWorkflow("mcp-order-fail-wf")
      .description("order fail test")
      .run(async (ctx) => {
        const s = ctx.stage("work", { mcp: { deny: ["filesystem"] } });
        await s.prompt("go");
        return {};
      })
      .compile();

    await run(wf, {}, {
      store: createStore(),
      mcp: makeMcpPort(order),
      adapters: {
        prompt: {
          prompt: async () => {
            order.push("adapterCall");
            throw new Error("adapter failure");
          },
        },
      },
      onStageStart: () => order.push("stageStart"),
      onStageEnd: () => order.push("stageEnd"),
    });

    const idxMcpSet = order.indexOf("mcpSet");
    const idxAdapterCall = order.indexOf("adapterCall");
    const idxMcpClear = order.indexOf("mcpClear");
    const idxStageEnd = order.indexOf("stageEnd");

    expect(idxMcpSet).toBeGreaterThanOrEqual(0);
    expect(idxAdapterCall).toBeGreaterThan(idxMcpSet);
    expect(idxMcpClear).toBeGreaterThan(idxAdapterCall);
    expect(idxStageEnd).toBeGreaterThan(idxMcpClear);
  });

  test("no MCP calls when stage has no mcp options", async () => {
    const order: OrderEvent[] = [];

    const wf = defineWorkflow("mcp-no-opts-wf")
      .description("no mcp opts")
      .run(async (ctx) => {
        await ctx.stage("plain").prompt("go");
        return {};
      })
      .compile();

    await run(wf, {}, {
      store: createStore(),
      mcp: makeMcpPort(order),
      adapters: { prompt: makePromptAdapter(order) },
      onStageStart: () => order.push("stageStart"),
      onStageEnd: () => order.push("stageEnd"),
    });

    expect(order).not.toContain("mcpSet");
    expect(order).not.toContain("mcpClear");
    // adapter still called
    expect(order).toContain("adapterCall");
  });

  test("concurrent stages: each gets distinct stageId in setScope", async () => {
    const setCalls: Array<{ stageId: string; allow: string[] | null }> = [];
    const clearCalls: string[] = [];

    const mcpPort: WorkflowMcpPort = {
      setScope(stageId, allow) { setCalls.push({ stageId, allow }); },
      clearScope(stageId) { clearCalls.push(stageId); },
    };

    const wf = defineWorkflow("mcp-concurrent-wf")
      .description("concurrent stages")
      .run(async (ctx) => {
        await Promise.all([
          ctx.stage("stage-a", { mcp: { allow: ["server-a"] } }).prompt("a"),
          ctx.stage("stage-b", { mcp: { allow: ["server-b"] } }).prompt("b"),
        ]);
        return {};
      })
      .compile();

    await run(wf, {}, {
      store: createStore(),
      mcp: mcpPort,
      adapters: { prompt: { prompt: async (t) => t } },
    });

    // Both stages should have called setScope with distinct stageIds
    expect(setCalls).toHaveLength(2);
    expect(clearCalls).toHaveLength(2);

    const stageIds = setCalls.map((c) => c.stageId);
    // Distinct UUIDs
    expect(stageIds[0]).not.toBe(stageIds[1]);

    // allow lists are stage-specific (not mixed)
    const aCall = setCalls.find((c) => c.allow?.includes("server-a"));
    const bCall = setCalls.find((c) => c.allow?.includes("server-b"));
    expect(aCall).toBeDefined();
    expect(bCall).toBeDefined();
    expect(aCall!.stageId).not.toBe(bCall!.stageId);
  });
});

// ---------------------------------------------------------------------------
// mcpScope stored on StageSnapshot
// ---------------------------------------------------------------------------

describe("MCP stage scoping — StageSnapshot.mcpScope", () => {
  test("mcpScope stored with allow and deny from StageOptions", async () => {
    const wf = defineWorkflow("mcp-snap-wf")
      .description("snapshot test")
      .run(async (ctx) => {
        await ctx.stage("s", { mcp: { allow: ["github", "fetch"], deny: ["filesystem"] } }).prompt("x");
        return {};
      })
      .compile();

    const result = await run(wf, {}, {
      store: createStore(),
      adapters: { prompt: { prompt: async () => "ok" } },
    });

    expect(result.status).toBe("completed");
    const snap = result.stages[0];
    expect(snap?.mcpScope).toBeDefined();
    expect(snap?.mcpScope?.allow).toEqual(["github", "fetch"]);
    expect(snap?.mcpScope?.deny).toEqual(["filesystem"]);
  });

  test("mcpScope.allow is null when only deny provided", async () => {
    const wf = defineWorkflow("mcp-snap-deny-only-wf")
      .description("deny only")
      .run(async (ctx) => {
        await ctx.stage("s", { mcp: { deny: ["bad-server"] } }).prompt("x");
        return {};
      })
      .compile();

    const result = await run(wf, {}, {
      store: createStore(),
      adapters: { prompt: { prompt: async () => "ok" } },
    });

    const snap = result.stages[0];
    expect(snap?.mcpScope?.allow).toBeNull();
    expect(snap?.mcpScope?.deny).toEqual(["bad-server"]);
  });

  test("mcpScope.deny is null when only allow provided", async () => {
    const wf = defineWorkflow("mcp-snap-allow-only-wf")
      .description("allow only")
      .run(async (ctx) => {
        await ctx.stage("s", { mcp: { allow: ["safe-server"] } }).prompt("x");
        return {};
      })
      .compile();

    const result = await run(wf, {}, {
      store: createStore(),
      adapters: { prompt: { prompt: async () => "ok" } },
    });

    const snap = result.stages[0];
    expect(snap?.mcpScope?.allow).toEqual(["safe-server"]);
    expect(snap?.mcpScope?.deny).toBeNull();
  });

  test("mcpScope absent when no mcp options passed", async () => {
    const wf = defineWorkflow("mcp-snap-none-wf")
      .description("no options")
      .run(async (ctx) => {
        await ctx.stage("plain").prompt("x");
        return {};
      })
      .compile();

    const result = await run(wf, {}, {
      store: createStore(),
      adapters: { prompt: { prompt: async () => "ok" } },
    });

    const snap = result.stages[0];
    expect(snap?.mcpScope).toBeUndefined();
  });

  test("mcpScope stored even when no mcp port configured", async () => {
    // Snapshot stores options regardless of port availability
    const wf = defineWorkflow("mcp-snap-no-port-wf")
      .description("no port")
      .run(async (ctx) => {
        await ctx.stage("s", { mcp: { allow: ["x"] } }).prompt("x");
        return {};
      })
      .compile();

    const result = await run(wf, {}, {
      store: createStore(),
      adapters: { prompt: { prompt: async () => "ok" } },
      // no mcp port
    });

    const snap = result.stages[0];
    expect(snap?.mcpScope).toBeDefined();
    expect(snap?.mcpScope?.allow).toEqual(["x"]);
  });
});
