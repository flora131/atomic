/**
 * Runtime wiring tests for SDK-backed workflow stages.
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { buildRuntimeAdapters } from "../../src/extension/wiring.js";
import { createStageContext } from "../../src/runs/foreground/stage-runner.js";
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import type { RuntimeWiringSurface } from "../../src/extension/wiring.js";
import type { StageSessionRuntime } from "../../src/runs/foreground/stage-runner.js";

function fakeSession(): StageSessionRuntime {
  let last = "";
  return {
    async prompt(text: string): Promise<string> { last = `sdk:${text}`; return last; },
    async steer(text: string): Promise<void> { last = `steer:${text}`; },
    async followUp(text: string): Promise<void> { last = `follow:${text}`; },
    subscribe: () => () => {},
    sessionFile: undefined,
    sessionId: "session-id",
    async setModel(): Promise<void> {},
    setThinkingLevel(): void {},
    async cycleModel(): Promise<undefined> { return undefined; },
    cycleThinkingLevel(): undefined { return undefined; },
    agent: {} as StageSessionRuntime["agent"],
    model: undefined,
    thinkingLevel: "medium" as StageSessionRuntime["thinkingLevel"],
    messages: [],
    isStreaming: false,
    async navigateTree(): Promise<{ cancelled: boolean }> { return { cancelled: true }; },
    async compact(): ReturnType<StageSessionRuntime["compact"]> {
      return undefined as unknown as Awaited<ReturnType<StageSessionRuntime["compact"]>>;
    },
    abortCompaction(): void {},
    async abort(): Promise<void> {},
    dispose(): void {},
    getLastAssistantText(): string | undefined { return last; },
  };
}

describe("buildRuntimeAdapters — SDK sessions", () => {
  test("always configures agentSession without pi.exec", () => {
    const adapters = buildRuntimeAdapters({});
    assert.notEqual(adapters.agentSession, undefined);
    assert.equal(adapters.prompt, undefined);
    assert.equal(adapters.complete, undefined);
  });

  test("forwards createAgentSession options from stage options", async () => {
    const calls: Array<CreateAgentSessionOptions | undefined> = [];
    const adapters = buildRuntimeAdapters({}, {
      createAgentSession: async (options) => { calls.push(options); return { session: fakeSession() }; },
    });
    await adapters.agentSession!.create({ cwd: "/repo", tools: ["read"], mcp: { deny: ["network"] } } as unknown as Parameters<NonNullable<typeof adapters.agentSession>["create"]>[0]);
    assert.equal(calls[0]?.cwd, "/repo");
    assert.deepEqual((calls[0] as unknown as { tools?: string[] })?.tools, ["read"]);
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0], "mcp"), false);
  });

  test("stage prompt delegates to the SDK session adapter", async () => {
    const adapters = buildRuntimeAdapters({}, {
      createAgentSession: async () => ({ session: fakeSession() }),
    });
    const stage = createStageContext({ stageId: "s", stageName: "Stage", runId: "r", adapters });
    const result = await stage.prompt("hello");
    assert.equal(result, "sdk:hello");
    assert.equal(stage.getLastAssistantText(), "sdk:hello");
  });
});

describe("subagent adapter — pi task bridge", () => {
  test(
    "calls pi.callTool('subagent', { agent, task }) without `action` (execution mode)",
    async () => {
      // pi-subagents v0.24.2: execution mode omits `action` entirely. The
      // valid SUBAGENT_ACTIONS list is {list,get,create,update,delete,
      // status,interrupt,resume,doctor} — "run" is NOT a member and is
      // rejected by createSubagentExecutor.execute.
      const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const pi: RuntimeWiringSurface = {
        callTool: async (name, args) => { calls.push({ name, args }); return "ok"; },
      };
      const adapters = buildRuntimeAdapters(pi);
      await adapters.subagent!.subagent({ agent: "worker", task: "do it" });
      assert.equal(calls[0]?.name, "subagent");
      assert.equal(calls[0]?.args["agent"], "worker");
      assert.equal(calls[0]?.args["task"], "do it");
      assert.equal(Object.prototype.hasOwnProperty.call(calls[0]?.args, "action"), false);
    },
  );

  test("stage runner owns missing-subagent actionable error", async () => {
    const stage = createStageContext({ stageId: "s", stageName: "Stage", runId: "r", adapters: {} });
    await assert.rejects(stage.subagent({ agent: "a", task: "t" }), /pi task delegation/);
  });
});
