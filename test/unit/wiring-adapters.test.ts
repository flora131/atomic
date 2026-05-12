/**
 * Tests for buildRuntimeAdapters — oh-my-pi AgentSession wiring and task-tool fallback.
 *
 * The legacy `buildUIAdapter` (pi.ui → WorkflowUIAdapter for HIL) was removed
 * when workflows became background-only — HIL prompts now route through the
 * store-backed background adapter (see `background-ui-adapter.test.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeAdapters, extractAssistantText } from "../../src/extension/wiring.js";
import type { CreateAgentSessionOptions } from "@oh-my-pi/pi-coding-agent";
import type { RuntimeWiringSurface } from "../../src/extension/wiring.js";
import type { StageSessionRuntime } from "../../src/runs/foreground/stage-runner.js";
import type { StageExecutionMeta } from "../../src/shared/types.js";

function fakeSession(): StageSessionRuntime {
  let last = "";
  return {
    async prompt(text: string): Promise<string> { last = `reply:${text}`; return last; },
    async steer(text: string): Promise<void> { last = `steer:${text}`; },
    async followUp(text: string): Promise<void> { last = `follow:${text}`; },
    subscribe: () => () => {},
    sessionFile: undefined,
    sessionId: "session-1",
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

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

function makeNdjson(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("buildRuntimeAdapters — SDK AgentSession adapter", () => {
  test("provides an agentSession adapter without requiring pi.exec", () => {
    const adapters = buildRuntimeAdapters({});
    assert.notEqual(adapters.agentSession, undefined);
    assert.equal(adapters.prompt, undefined);
    assert.equal(adapters.complete, undefined);
  });

  test("agentSession.create delegates to createAgentSession seam", async () => {
    const calls: Array<CreateAgentSessionOptions | undefined> = [];
    const adapters = buildRuntimeAdapters({}, {
      createAgentSession: async (options) => { calls.push(options); return { session: fakeSession() }; },
    });
    const session = await adapters.agentSession!.create({ cwd: "/tmp/project" });
    assert.equal(session.sessionId, "session-1");
    assert.equal(calls[0]?.cwd, "/tmp/project");
  });

  test("strips workflow-only mcp options before calling createAgentSession", async () => {
    const calls: Array<CreateAgentSessionOptions | undefined> = [];
    const adapters = buildRuntimeAdapters({}, {
      createAgentSession: async (options) => { calls.push(options); return { session: fakeSession() }; },
    });
    await adapters.agentSession!.create({ cwd: "/tmp/project", mcp: { allow: ["github"] } });
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0], "mcp"), false);
    assert.equal(calls[0]?.cwd, "/tmp/project");
  });
});

describe("buildRuntimeAdapters — subagent adapter via oh-my-pi task bridge", () => {
  test("delegates to pi.callTool('subagent', args)", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (name, args) => { calls.push({ name, args }); return "done"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "reviewer", task: "review", context: "ctx" });
    assert.equal(calls[0]?.name, "subagent");
    assert.equal(calls[0]?.args["agent"], "reviewer");
    assert.equal(calls[0]?.args["context"], "ctx");
  });

  test("passes workflow env from meta", async () => {
    const signal = makeSignal();
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (name, args) => { calls.push({ name, args }); return "ok"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "run", stageId: "stage", stageName: "N", signal };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    assert.equal((calls[0]?.args["env"] as Record<string, string>)["PI_WORKFLOW_RUN_ID"], "run");
    assert.equal((calls[0]?.args["env"] as Record<string, string>)["PI_WORKFLOW_STAGE_ID"], "stage");
  });
});

describe("extractAssistantText", () => {
  test("extracts text from message_end assistant event", () => {
    assert.equal(extractAssistantText(makeNdjson("hello world")), "hello world");
  });

  test("returns empty string when no assistant message exists", () => {
    assert.equal(extractAssistantText('{"type":"message_start"}'), "");
  });
});
