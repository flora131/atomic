/**
 * Tests for runtime wiring helpers (src/extension/wiring.ts).
 *
 * Covers:
 * - extractAssistantText: NDJSON parsing
 * - buildRuntimeAdapters: absent exec → empty adapters
 * - buildRuntimeAdapters: exec present → adapters delegate to pi subprocess
 * - prompt/complete/subagent adapters: correct arg construction
 * - complete adapter: --model flag forwarding
 * - subagent adapter: agent+context prompt construction
 * - error handling: non-zero exit, no assistant text
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAssistantText,
  buildRuntimeAdapters,
  type RuntimeWiringSurface,
  type PiExecResult,
} from "../../src/extension/wiring.js";
import { createStageContext } from "../../src/runs/foreground/stage-runner.js";
import type { StageAdapters } from "../../src/runs/foreground/stage-runner.js";
import type { SubagentStageOpts, CompleteStageOpts } from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// extractAssistantText
// ---------------------------------------------------------------------------

describe("extractAssistantText", () => {
  function makeMessageEnd(text: string, role = "assistant"): string {
    return JSON.stringify({
      type: "message_end",
      message: {
        role,
        content: [{ type: "text", text }],
      },
    });
  }

  test("returns empty string for empty input", () => {
    assert.equal(extractAssistantText(""), "");
  });

  test("returns empty string when no message_end event", () => {
    const ndjson = [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({ type: "turn_start" }),
    ].join("\n");
    assert.equal(extractAssistantText(ndjson), "");
  });

  test("extracts text from message_end with role=assistant", () => {
    const ndjson = [
      JSON.stringify({ type: "agent_start" }),
      makeMessageEnd("Hello from pi"),
    ].join("\n");
    assert.equal(extractAssistantText(ndjson), "Hello from pi");
  });

  test("ignores message_end with role=user", () => {
    const ndjson = makeMessageEnd("user text", "user");
    assert.equal(extractAssistantText(ndjson), "");
  });

  test("returns last assistant message_end when multiple present", () => {
    const ndjson = [
      makeMessageEnd("first response"),
      makeMessageEnd("second response"),
    ].join("\n");
    assert.equal(extractAssistantText(ndjson), "second response");
  });

  test("concatenates multiple text content blocks", () => {
    const event = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      },
    });
    assert.equal(extractAssistantText(event), "Hello world");
  });

  test("skips non-text content blocks", () => {
    const event = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "bash", input: {} },
          { type: "text", text: "Done!" },
        ],
      },
    });
    assert.equal(extractAssistantText(event), "Done!");
  });

  test("skips malformed JSON lines gracefully", () => {
    const ndjson = [
      "not valid json{{{",
      makeMessageEnd("valid response"),
    ].join("\n");
    assert.equal(extractAssistantText(ndjson), "valid response");
  });

  test("handles trailing newline without crashing", () => {
    const ndjson = makeMessageEnd("response") + "\n";
    assert.equal(extractAssistantText(ndjson), "response");
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeAdapters — absent exec
// ---------------------------------------------------------------------------

describe("buildRuntimeAdapters — absent exec", () => {
  test("returns empty object when pi.exec is absent", () => {
    const adapters = buildRuntimeAdapters({});
    assert.deepEqual(adapters, {});
  });

  test("returns empty object when pi.exec is not a function", () => {
    const pi = { exec: "not-a-function" } as unknown as RuntimeWiringSurface;
    const adapters = buildRuntimeAdapters(pi);
    assert.deepEqual(adapters, {});
  });

  test("prompt/complete/subagent are all undefined when exec absent", () => {
    const adapters = buildRuntimeAdapters({});
    assert.equal(adapters.prompt, undefined);
    assert.equal(adapters.complete, undefined);
    assert.equal(adapters.subagent, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeAdapters — exec present
// ---------------------------------------------------------------------------

/** Build a mock pi surface whose exec records calls and returns a given NDJSON. */
function makeMockPi(ndjson: string, exitCode = 0): {
  pi: RuntimeWiringSurface;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const result: PiExecResult = { stdout: ndjson, stderr: "", code: exitCode, killed: false };
  const pi: RuntimeWiringSurface = {
    exec: async (command, args) => {
      calls.push({ command, args });
      return result;
    },
  };
  return { pi, calls };
}

function makeNdjsonWithText(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("buildRuntimeAdapters — exec present", () => {
  test("returns prompt and complete adapters when only exec is present", () => {
    const { pi } = makeMockPi(makeNdjsonWithText("ok"));
    const adapters = buildRuntimeAdapters(pi);
    assert.notEqual(adapters.prompt, undefined);
    assert.notEqual(adapters.complete, undefined);
    assert.equal(adapters.subagent, undefined);
  });
});

// ---------------------------------------------------------------------------
// prompt adapter
// ---------------------------------------------------------------------------

describe("prompt adapter", () => {
  test("calls pi --mode json -p <text> --no-session", async () => {
    const { pi, calls } = makeMockPi(makeNdjsonWithText("pong"));
    const adapters = buildRuntimeAdapters(pi);
    const result = await adapters.prompt!.prompt("ping");
    assert.equal(result, "pong");
    assert.equal(calls.length, 1);
    const { command, args } = calls[0]!;
    assert.equal(command, "pi");
    assert.ok(args.includes("--mode"));
    assert.ok(args.includes("json"));
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("ping"));
    assert.ok(args.includes("--no-session"));
  });

  test("returns extracted assistant text", async () => {
    const { pi } = makeMockPi(makeNdjsonWithText("The answer is 42"));
    const adapters = buildRuntimeAdapters(pi);
    const result = await adapters.prompt!.prompt("What is the answer?");
    assert.equal(result, "The answer is 42");
  });

  test("throws when pi returns no assistant text", async () => {
    const { pi } = makeMockPi(JSON.stringify({ type: "agent_start" }));
    const adapters = buildRuntimeAdapters(pi);
    await assert.rejects(adapters.prompt!.prompt("hi"), { message: "pi-workflows: pi subprocess produced no assistant text", });
  });

  test("throws on non-zero exit with empty stdout", async () => {
    const failResult: PiExecResult = { stdout: "", stderr: "pi: command not found", code: 127, killed: false };
    const pi: RuntimeWiringSurface = {
      exec: async () => failResult,
    };
    const adapters = buildRuntimeAdapters(pi);
    await assert.rejects(adapters.prompt!.prompt("hi"), { message: "code 127" });
  });
});

// ---------------------------------------------------------------------------
// complete adapter
// ---------------------------------------------------------------------------

describe("complete adapter", () => {
  test("calls pi --mode json -p <text> --no-session without model", async () => {
    const { pi, calls } = makeMockPi(makeNdjsonWithText("summary"));
    const adapters = buildRuntimeAdapters(pi);
    await adapters.complete!.complete("Summarize this");
    const { args } = calls[0]!;
    assert.ok(args.includes("--mode"));
    assert.ok(args.includes("json"));
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("Summarize this"));
    assert.ok(args.includes("--no-session"));
    assert.ok(!args.includes("--model"));
  });

  test("forwards model option as --model flag", async () => {
    const { pi, calls } = makeMockPi(makeNdjsonWithText("summary"));
    const adapters = buildRuntimeAdapters(pi);
    const opts: CompleteStageOpts = { model: "claude-sonnet-4" };
    await adapters.complete!.complete("Summarize this", opts);
    const { args } = calls[0]!;
    assert.ok(args.includes("--model"));
    const modelIdx = args.indexOf("--model");
    assert.equal(args[modelIdx + 1], "claude-sonnet-4");
  });

  test("does not add --model when opts is undefined", async () => {
    const { pi, calls } = makeMockPi(makeNdjsonWithText("ok"));
    const adapters = buildRuntimeAdapters(pi);
    await adapters.complete!.complete("text", undefined);
    assert.ok(!calls[0]!.args.includes("--model"));
  });

  test("does not add --model when model is undefined in opts", async () => {
    const { pi, calls } = makeMockPi(makeNdjsonWithText("ok"));
    const adapters = buildRuntimeAdapters(pi);
    await adapters.complete!.complete("text", {});
    assert.ok(!calls[0]!.args.includes("--model"));
  });
});

// ---------------------------------------------------------------------------
// subagent adapter — delegates to pi.subagents.run or pi.callTool (no exec)
// ---------------------------------------------------------------------------

describe("subagent adapter — pi.subagents.run delegation", () => {
  test("calls pi.subagents.run when available", async () => {
    const runCalls: Array<Record<string, unknown>> = [];
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      subagents: {
        run: async (opts: Record<string, unknown>) => {
          runCalls.push(opts);
          return "subagent-result";
        },
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    const result = await adapters.subagent!.subagent({ agent: "code-reviewer", task: "Review PR" });
    assert.equal(result, "subagent-result");
    assert.equal(runCalls.length, 1);
    assert.deepEqual(runCalls[0], { agent: "code-reviewer", task: "Review PR" }) // TODO: was toMatchObject — may need subset check;
  });

  test("passes context to pi.subagents.run when provided", async () => {
    const runCalls: Array<Record<string, unknown>> = [];
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      subagents: {
        run: async (opts: Record<string, unknown>) => { runCalls.push(opts); return "done"; },
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t", context: "some context" });
    assert.deepEqual(runCalls[0], { context: "some context" }) // TODO: was toMatchObject — may need subset check;
  });

  test("does NOT call exec for subagent when pi.subagents.run available", async () => {
    const execCalls: Array<unknown> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (...args) => { execCalls.push(args); return { stdout: "", stderr: "", code: 0, killed: false }; },
      subagents: {
        run: async () => "result",
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t" });
    assert.equal(execCalls.length, 0);
  });

  test("passes env record to pi.subagents.run", async () => {
    const runCalls: Array<Record<string, unknown>> = [];
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      subagents: {
        run: async (opts: Record<string, unknown>) => { runCalls.push(opts); return "done"; },
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t" });
    assert.ok("env" in runCalls[0]);
    assert.equal(typeof runCalls[0]!["env"], "object");
  });
});

describe("subagent adapter — pi.callTool fallback", () => {
  test("calls pi.callTool('subagent', ...) when pi.subagents absent", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      callTool: async (name, args) => { toolCalls.push({ name, args }); return "calltool-result"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    const result = await adapters.subagent!.subagent({ agent: "doc-writer", task: "Write docs" });
    assert.equal(result, "calltool-result");
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]!.name, "subagent");
    assert.deepEqual(toolCalls[0]!.args, { action: "run", agent: "doc-writer", task: "Write docs" }) // TODO: was toMatchObject — may need subset check;
  });

  test("passes context in callTool args when provided", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      callTool: async (name, args) => { toolCalls.push({ name, args }); return "done"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t", context: "repo context" });
    assert.deepEqual(toolCalls[0]!.args, { context: "repo context" }) // TODO: was toMatchObject — may need subset check;
  });

  test("omits context key from callTool args when absent", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      callTool: async (name, args) => { toolCalls.push({ name, args }); return "done"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t" });
    assert.ok(!(toolCalls[0]!.args));
  });

  test("does NOT call exec for subagent via callTool path", async () => {
    const execCalls: Array<unknown> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (...args) => { execCalls.push(args); return { stdout: "", stderr: "", code: 0, killed: false }; },
      callTool: async () => "result",
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t" });
    assert.equal(execCalls.length, 0);
  });
});

describe("subagent adapter — unavailable runtime", () => {
  test("subagent adapter is undefined when neither pi.subagents nor pi.callTool available", () => {
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    };
    const adapters = buildRuntimeAdapters(pi);
    assert.equal(adapters.subagent, undefined);
  });

  test("exec-only runtime configures prompt and complete only", () => {
    const pi: RuntimeWiringSurface = {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    };
    const adapters = buildRuntimeAdapters(pi);
    assert.notEqual(adapters.prompt, undefined);
    assert.notEqual(adapters.complete, undefined);
    assert.equal(adapters.subagent, undefined);
  });

  test("stage runner owns missing-subagent actionable error", async () => {
    const ctx = createStageContext({
      runId: "run",
      stageId: "stage",
      stageName: "missing-subagent",
      adapters: {},
    });
    await assert.rejects(ctx.subagent({ agent: "a", task: "t" }), { message: "pi-subagents" });
  });
});

// ---------------------------------------------------------------------------
// subagent adapter — explicit metadata injection (RFC: injecting-subagent-env)
// ---------------------------------------------------------------------------

import type { SubagentStageMeta } from "../../src/runs/foreground/stage-runner.js";

describe("subagent adapter — explicit metadata merges env (pi.subagents.run path)", () => {
  function makeSubagentsPi(runCalls: Array<Record<string, unknown>>): RuntimeWiringSurface {
    return {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      subagents: {
        run: async (opts: Record<string, unknown>) => {
          runCalls.push(opts);
          return "ok";
        },
      },
    };
  }

  test("injects PI_WORKFLOW_RUN_ID from explicit meta", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapters = buildRuntimeAdapters(makeSubagentsPi(calls));
    const meta: SubagentStageMeta = { runId: "run-explicit-123", stageId: "stage-abc", stageName: "test-stage" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    const env = calls[0]!["env"] as Record<string, string>;
    assert.equal(env["PI_WORKFLOW_RUN_ID"], "run-explicit-123");
  });

  test("injects PI_WORKFLOW_STAGE_ID from explicit meta", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapters = buildRuntimeAdapters(makeSubagentsPi(calls));
    const meta: SubagentStageMeta = { runId: "r", stageId: "stage-explicit-456", stageName: "test-stage" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    const env = calls[0]!["env"] as Record<string, string>;
    assert.equal(env["PI_WORKFLOW_STAGE_ID"], "stage-explicit-456");
  });

  test("explicit meta overrides ambient process.env values", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapters = buildRuntimeAdapters(makeSubagentsPi(calls));
    // Set ambient env
    const origRun = process.env["PI_WORKFLOW_RUN_ID"];
    const origStage = process.env["PI_WORKFLOW_STAGE_ID"];
    process.env["PI_WORKFLOW_RUN_ID"] = "ambient-run";
    process.env["PI_WORKFLOW_STAGE_ID"] = "ambient-stage";
    try {
      const meta: SubagentStageMeta = { runId: "explicit-run", stageId: "explicit-stage", stageName: "test-stage" };
      await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
      const env = calls[0]!["env"] as Record<string, string>;
      assert.equal(env["PI_WORKFLOW_RUN_ID"], "explicit-run");
      assert.equal(env["PI_WORKFLOW_STAGE_ID"], "explicit-stage");
    } finally {
      if (origRun !== undefined) process.env["PI_WORKFLOW_RUN_ID"] = origRun;
      else delete process.env["PI_WORKFLOW_RUN_ID"];
      if (origStage !== undefined) process.env["PI_WORKFLOW_STAGE_ID"] = origStage;
      else delete process.env["PI_WORKFLOW_STAGE_ID"];
    }
  });

  test("ambient process.env used as fallback when meta absent", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapters = buildRuntimeAdapters(makeSubagentsPi(calls));
    const origRun = process.env["PI_WORKFLOW_RUN_ID"];
    const origStage = process.env["PI_WORKFLOW_STAGE_ID"];
    process.env["PI_WORKFLOW_RUN_ID"] = "ambient-fallback-run";
    process.env["PI_WORKFLOW_STAGE_ID"] = "ambient-fallback-stage";
    try {
      await adapters.subagent!.subagent({ agent: "a", task: "t" });
      const env = calls[0]!["env"] as Record<string, string>;
      assert.equal(env["PI_WORKFLOW_RUN_ID"], "ambient-fallback-run");
      assert.equal(env["PI_WORKFLOW_STAGE_ID"], "ambient-fallback-stage");
    } finally {
      if (origRun !== undefined) process.env["PI_WORKFLOW_RUN_ID"] = origRun;
      else delete process.env["PI_WORKFLOW_RUN_ID"];
      if (origStage !== undefined) process.env["PI_WORKFLOW_STAGE_ID"] = origStage;
      else delete process.env["PI_WORKFLOW_STAGE_ID"];
    }
  });

  test("does not mutate process.env when explicit meta provided", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapters = buildRuntimeAdapters(makeSubagentsPi(calls));
    const before = process.env["PI_WORKFLOW_RUN_ID"];
    const meta: SubagentStageMeta = { runId: "should-not-leak", stageId: "s", stageName: "test-stage" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    assert.equal(process.env["PI_WORKFLOW_RUN_ID"], before);
  });

  test("passes meta.signal to pi.subagents.run", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapters = buildRuntimeAdapters(makeSubagentsPi(calls));
    const controller = new AbortController();
    const meta: SubagentStageMeta = { runId: "r", stageId: "s", stageName: "test-stage", signal: controller.signal };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    assert.equal(calls[0]!["signal"], controller.signal);
  });

  test("passes undefined signal when meta has no signal", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapters = buildRuntimeAdapters(makeSubagentsPi(calls));
    const meta: SubagentStageMeta = { runId: "r", stageId: "s", stageName: "test-stage" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    assert.equal(calls[0]!["signal"], undefined);
  });
});

describe("subagent adapter — explicit metadata merges env (pi.callTool path)", () => {
  function makeCallToolPi(toolCalls: Array<{ name: string; args: Record<string, unknown> }>): RuntimeWiringSurface {
    return {
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      callTool: async (name, args) => {
        toolCalls.push({ name, args });
        return "ok";
      },
    };
  }

  test("injects PI_WORKFLOW_RUN_ID from explicit meta in callTool path", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolPi(calls));
    const meta: SubagentStageMeta = { runId: "calltool-run-id", stageId: "s", stageName: "test-stage" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    const env = calls[0]!.args["env"] as Record<string, string>;
    assert.equal(env["PI_WORKFLOW_RUN_ID"], "calltool-run-id");
  });

  test("injects PI_WORKFLOW_STAGE_ID from explicit meta in callTool path", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolPi(calls));
    const meta: SubagentStageMeta = { runId: "r", stageId: "calltool-stage-id", stageName: "test-stage" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    const env = calls[0]!.args["env"] as Record<string, string>;
    assert.equal(env["PI_WORKFLOW_STAGE_ID"], "calltool-stage-id");
  });

  test("explicit meta overrides ambient env in callTool path", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolPi(calls));
    const origRun = process.env["PI_WORKFLOW_RUN_ID"];
    process.env["PI_WORKFLOW_RUN_ID"] = "ambient-should-be-overridden";
    try {
      const meta: SubagentStageMeta = { runId: "override-wins", stageId: "s", stageName: "test-stage" };
      await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
      const env = calls[0]!.args["env"] as Record<string, string>;
      assert.equal(env["PI_WORKFLOW_RUN_ID"], "override-wins");
    } finally {
      if (origRun !== undefined) process.env["PI_WORKFLOW_RUN_ID"] = origRun;
      else delete process.env["PI_WORKFLOW_RUN_ID"];
    }
  });
});

// ---------------------------------------------------------------------------
// stage-runner — propagates runId/stageId/signal to SubagentAdapter
// ---------------------------------------------------------------------------

describe("stage-runner createStageContext — propagates metadata to subagent adapter", () => {
  test("passes runId from StageRunnerOpts to adapter meta", async () => {
    const receivedMeta: SubagentStageMeta[] = [];
    const adapters: StageAdapters = {
      subagent: {
        async subagent(_opts, meta) {
          receivedMeta.push(meta!);
          return "done";
        },
      },
    };
    const ctx = createStageContext({ stageId: "s1", stageName: "test", adapters, runId: "run-from-opts" });
    await ctx.subagent({ agent: "a", task: "t" });
    assert.equal(receivedMeta[0]!.runId, "run-from-opts");
  });

  test("passes stageId from StageRunnerOpts to adapter meta", async () => {
    const receivedMeta: SubagentStageMeta[] = [];
    const adapters: StageAdapters = {
      subagent: {
        async subagent(_opts, meta) {
          receivedMeta.push(meta!);
          return "done";
        },
      },
    };
    const ctx = createStageContext({ stageId: "stage-from-opts", stageName: "test", adapters, runId: "r" });
    await ctx.subagent({ agent: "a", task: "t" });
    assert.equal(receivedMeta[0]!.stageId, "stage-from-opts");
  });

  test("passes signal from StageRunnerOpts to adapter meta", async () => {
    const receivedMeta: SubagentStageMeta[] = [];
    const adapters: StageAdapters = {
      subagent: {
        async subagent(_opts, meta) {
          receivedMeta.push(meta!);
          return "done";
        },
      },
    };
    const controller = new AbortController();
    const ctx = createStageContext({
      stageId: "s",
      stageName: "test",
      adapters,
      runId: "r",
      signal: controller.signal,
    });
    await ctx.subagent({ agent: "a", task: "t" });
    assert.equal(receivedMeta[0]!.signal, controller.signal);
  });

  test("meta carries runId and undefined signal when signal omitted from opts", async () => {
    const receivedMeta: Array<SubagentStageMeta | undefined> = [];
    const adapters: StageAdapters = {
      subagent: {
        async subagent(_opts, meta) {
          receivedMeta.push(meta);
          return "done";
        },
      },
    };
    const ctx = createStageContext({ stageId: "s", stageName: "test", runId: "run-no-signal", adapters });
    await ctx.subagent({ agent: "a", task: "t" });
    assert.notEqual(receivedMeta[0], undefined);
    assert.equal(receivedMeta[0]!.runId, "run-no-signal");
    assert.equal(receivedMeta[0]!.signal, undefined);
  });
});
