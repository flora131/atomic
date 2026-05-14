/**
 * Tests for buildRuntimeAdapters — pi AgentSession wiring and task-tool fallback.
 *
 * The legacy `buildUIAdapter` (pi.ui → WorkflowUIAdapter for HIL) was removed
 * when workflows became background-only — HIL prompts now route through the
 * store-backed background adapter (see `background-ui-adapter.test.ts`).
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { buildRuntimeAdapters } from "../../src/extension/wiring.js";
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import type { RuntimeWiringSurface } from "../../src/extension/wiring.js";
import type { StageSessionRuntime } from "../../src/runs/foreground/stage-runner.js";
import type { StageExecutionMeta } from "../../src/shared/types.js";

// pi-subagents v0.24.2 SubagentParams contract — single execution mode:
//   { agent, task, context?: "fresh" | "fork", ... }
// Action is OMITTED for execution. "run" is NOT a valid action and is
// rejected by createSubagentExecutor.execute.
// `env` is not part of SubagentParams; pi-subagents silently drops it.
const SCHEMA_FORBIDDEN_KEYS = ["action", "env"] as const;

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



describe("buildRuntimeAdapters — SDK AgentSession adapter", () => {
  test("provides an agentSession adapter without requiring pi.exec", () => {
    const adapters = buildRuntimeAdapters({});
    assert.notEqual(adapters.agentSession, undefined);
    assert.equal(adapters.prompt, undefined);
    assert.equal(adapters.complete, undefined);
  });

  test(
    "falls back to the pi SDK createAgentSession in production (NODE_ENV unset) — proves pi-coding-agent ≥ 0.74 integration",
    () => {
      // The pi SDK (`@earendil-works/pi-coding-agent` ≥ 0.74) exposes
      // `createAgentSession` as a top-level package export, NOT on the
      // ExtensionAPI surface. The workflow extension MUST resolve a default
      // session factory from that package in production (no test context,
      // no caller-provided seam). Otherwise stages that rely on the default
      // SDK-backed prompt() path crash with "prompt adapter not configured"
      // at runtime.
      const savedNodeEnv = process.env["NODE_ENV"];
      const savedNodeTestCtx = process.env["NODE_TEST_CONTEXT"];
      delete process.env["NODE_ENV"];
      delete process.env["NODE_TEST_CONTEXT"];
      try {
        const adapters = buildRuntimeAdapters({});
        assert.notEqual(
          adapters.agentSession,
          undefined,
          "production buildRuntimeAdapters MUST wire an agentSession adapter via the pi SDK; got undefined.",
        );
      } finally {
        if (savedNodeEnv === undefined) delete process.env["NODE_ENV"];
        else process.env["NODE_ENV"] = savedNodeEnv;
        if (savedNodeTestCtx === undefined) delete process.env["NODE_TEST_CONTEXT"];
        else process.env["NODE_TEST_CONTEXT"] = savedNodeTestCtx;
      }
    },
  );

  test("agentSession.create delegates to createAgentSession seam", async () => {
    const calls: Array<CreateAgentSessionOptions | undefined> = [];
    const adapters = buildRuntimeAdapters({}, {
      createAgentSession: async (options) => { calls.push(options); return { session: fakeSession() }; },
    });
    const session = await adapters.agentSession!.create({ cwd: "/tmp/project" });
    assert.equal(session.sessionId, "session-1");
    assert.equal(calls[0]?.cwd, "/tmp/project");
  });

  test("agentSession.create forwards stage options unchanged (pi SDK leaves resource isolation to SettingsManager)", async () => {
    const calls: Array<CreateAgentSessionOptions | undefined> = [];
    const adapters = buildRuntimeAdapters({}, {
      createAgentSession: async (options) => { calls.push(options); return { session: fakeSession() }; },
    });
    await adapters.agentSession!.create({ cwd: "/tmp/project" });
    assert.equal(calls[0]?.cwd, "/tmp/project");
    // Per-call isolation knobs (`disableExtensionDiscovery`, `skills`,
    // `promptTemplates`, `slashCommands`) are not part of the pi SDK
    // surface — resource loading is owned by `SettingsManager` /
    // `ResourceLoader`. The SDK intentionally has no equivalent fields.
    assert.ok(!("disableExtensionDiscovery" in calls[0]!));
    assert.ok(!("skills" in calls[0]!));
    assert.ok(!("promptTemplates" in calls[0]!));
    assert.ok(!("slashCommands" in calls[0]!));
  });

  test("agentSession.create lets callers override fields the SDK still supports", async () => {
    const calls: Array<CreateAgentSessionOptions | undefined> = [];
    const adapters = buildRuntimeAdapters({}, {
      createAgentSession: async (options) => { calls.push(options); return { session: fakeSession() }; },
    });
    await adapters.agentSession!.create({
      cwd: "/tmp/project",
      thinkingLevel: "high",
      noTools: "all",
    });
    assert.equal(calls[0]?.cwd, "/tmp/project");
    assert.equal(calls[0]?.thinkingLevel, "high");
    assert.equal(calls[0]?.noTools, "all");
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

describe("buildRuntimeAdapters — subagent adapter via pi task bridge", () => {
  test("delegates to pi.callTool('subagent', args)", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (name, args) => { calls.push({ name, args }); return "done"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "reviewer", task: "review", context: "fork" });
    assert.equal(calls[0]?.name, "subagent");
    assert.equal(calls[0]?.args["agent"], "reviewer");
    assert.equal(calls[0]?.args["task"], "review");
    assert.equal(calls[0]?.args["context"], "fork");
  });

  test(
    "sends schema-compliant args — no `action`, no `env` (pi-subagents v0.24.2 SubagentParams contract)",
    async () => {
      // pi-subagents/src/shared/types.ts:597 — SUBAGENT_ACTIONS does NOT
      // include "run"; execution requires omitting `action` entirely.
      // pi-subagents/src/extension/schemas.ts — SubagentParams has no `env`
      // field; sending it is silently dropped and gives a false sense of
      // workflow-metadata propagation.
      const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const pi: RuntimeWiringSurface = {
        callTool: async (name, args) => { calls.push({ name, args }); return "ok"; },
      };
      const adapters = buildRuntimeAdapters(pi);
      const meta: StageExecutionMeta = {
        runId: "run",
        stageId: "stage",
        stageName: "N",
        signal: new AbortController().signal,
      };
      await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
      const args = calls[0]?.args ?? {};
      for (const key of SCHEMA_FORBIDDEN_KEYS) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(args, key),
          false,
          `subagent adapter MUST NOT send '${key}' — not part of pi-subagents SubagentParams`,
        );
      }
    },
  );

  test("omits `context` when caller does not provide it", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (name, args) => { calls.push({ name, args }); return "ok"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t" });
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0]?.args ?? {}, "context"), false);
  });
});

