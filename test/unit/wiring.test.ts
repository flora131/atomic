/**
 * Runtime wiring tests for SDK-backed workflow stages.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeAdapters, extractAssistantText } from "../../src/extension/wiring.js";
import { createStageContext } from "../../src/runs/foreground/stage-runner.js";
import type { CreateAgentSessionOptions } from "@oh-my-pi/pi-coding-agent";
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

describe("extractAssistantText", () => {
  test("returns empty string for empty input", () => {
    assert.equal(extractAssistantText(""), "");
  });

  test("extracts the last assistant message", () => {
    const ndjson = [
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "first" }] } }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "second" }] } }),
    ].join("\n");
    assert.equal(extractAssistantText(ndjson), "second");
  });
});

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
    await adapters.agentSession!.create({ cwd: "/repo", tools: ["read"], mcp: { deny: ["network"] } });
    assert.equal(calls[0]?.cwd, "/repo");
    assert.deepEqual(calls[0]?.tools, ["read"]);
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

describe("subagent adapter — oh-my-pi task bridge", () => {
  test("calls pi.callTool task bridge when available", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (name, args) => { calls.push({ name, args }); return "ok"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "worker", task: "do it" });
    assert.equal(calls[0]?.name, "subagent");
    assert.equal(calls[0]?.args["action"], "run");
  });

  test("stage runner owns missing-subagent actionable error", async () => {
    const stage = createStageContext({ stageId: "s", stageName: "Stage", runId: "r", adapters: {} });
    await assert.rejects(stage.subagent({ agent: "a", task: "t" }), /oh-my-pi task delegation/);
  });
});
