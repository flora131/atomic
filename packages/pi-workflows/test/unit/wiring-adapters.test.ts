/**
 * Tests for buildUIAdapter — maps pi ctx.ui dialog surface to WorkflowUIAdapter.
 * Tests for buildRuntimeAdapters — prompt/complete/subagent wiring, signal propagation.
 *
 * cross-ref: packages/pi-workflows/src/extension/wiring.ts buildUIAdapter
 *            packages/pi-workflows/src/extension/wiring.ts buildRuntimeAdapters
 *            packages/pi-workflows/src/shared/types.ts WorkflowUIAdapter
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildUIAdapter, buildRuntimeAdapters, extractAssistantText } from "../../src/extension/wiring.js";
import type { PiUISurface, UIWiringSurface, PiExecResult, PiExecOpts, RuntimeWiringSurface } from "../../src/extension/wiring.js";
import type { StageExecutionMeta } from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Helpers — NDJSON builder
// ---------------------------------------------------------------------------

function makeNdjson(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function okExecResult(text: string): PiExecResult {
  return { stdout: makeNdjson(text), stderr: "", code: 0, killed: false };
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

// ---------------------------------------------------------------------------
// buildRuntimeAdapters — prompt adapter exec invocation
// ---------------------------------------------------------------------------

describe("buildRuntimeAdapters — prompt adapter", () => {
  test("calls exec('pi', args, { signal }) — first arg is 'pi'", async () => {
    const calls: Array<{ cmd: string; args: string[]; opts?: PiExecOpts }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return okExecResult("hello"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    const signal = makeSignal();
    const meta: StageExecutionMeta = { runId: "r1", stageId: "s1", stageName: "S", signal };
    await adapters.prompt!.prompt("the text", meta);
    assert.equal(calls[0]?.cmd, "pi");
  });

  test("calls exec with --mode json and -p flags", async () => {
    const calls: Array<{ args: string[] }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (_cmd, args) => { calls.push({ args }); return okExecResult("reply"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.prompt!.prompt("my prompt", { runId: "r", stageId: "s", stageName: "N" });
    assert.ok(calls[0]?.args.includes("--mode"));
    assert.ok(calls[0]?.args.includes("json"));
    assert.ok(calls[0]?.args.includes("-p"));
    assert.ok(calls[0]?.args.includes("my prompt"));
    assert.ok(calls[0]?.args.includes("--no-session"));
  });

  test("passes { signal } in exec opts when meta.signal present", async () => {
    const calls: Array<{ opts?: PiExecOpts }> = [];
    const signal = makeSignal();
    const pi: RuntimeWiringSurface = {
      exec: async (_cmd, _args, opts) => { calls.push({ opts }); return okExecResult("ok"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "r", stageId: "s", stageName: "N", signal };
    await adapters.prompt!.prompt("text", meta);
    assert.equal(calls[0]?.opts?.signal, signal);
  });

  test("passes empty opts (no signal key) when meta.signal absent", async () => {
    const calls: Array<{ opts?: PiExecOpts }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (_cmd, _args, opts) => { calls.push({ opts }); return okExecResult("ok"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "r", stageId: "s", stageName: "N" };
    await adapters.prompt!.prompt("text", meta);
    assert.equal(calls[0]?.opts?.signal, undefined);
  });

  test("prompt adapter absent when pi.exec absent", () => {
    const adapters = buildRuntimeAdapters({});
    assert.equal(adapters.prompt, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeAdapters — complete adapter exec invocation
// ---------------------------------------------------------------------------

describe("buildRuntimeAdapters — complete adapter", () => {
  test("calls exec('pi', args, { signal }) — first arg is 'pi'", async () => {
    const calls: Array<{ cmd: string }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (cmd) => { calls.push({ cmd }); return okExecResult("done"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    const signal = makeSignal();
    const meta: StageExecutionMeta = { runId: "r", stageId: "s", stageName: "N", signal };
    await adapters.complete!.complete("text", undefined, meta);
    assert.equal(calls[0]?.cmd, "pi");
  });

  test("passes signal through exec opts for complete", async () => {
    const calls: Array<{ opts?: PiExecOpts }> = [];
    const signal = makeSignal();
    const pi: RuntimeWiringSurface = {
      exec: async (_cmd, _args, opts) => { calls.push({ opts }); return okExecResult("done"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "r", stageId: "s", stageName: "N", signal };
    await adapters.complete!.complete("text", undefined, meta);
    assert.equal(calls[0]?.opts?.signal, signal);
  });

  test("appends --model flag when CompleteStageOpts.model provided", async () => {
    const calls: Array<{ args: string[] }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (_cmd, args) => { calls.push({ args }); return okExecResult("ok"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.complete!.complete("text", { model: "gpt-4o" });
    assert.ok(calls[0]?.args.includes("--model"));
    assert.ok(calls[0]?.args.includes("gpt-4o"));
  });

  test("does not append --model when CompleteStageOpts.model absent", async () => {
    const calls: Array<{ args: string[] }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (_cmd, args) => { calls.push({ args }); return okExecResult("ok"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.complete!.complete("text", {});
    assert.ok(!calls[0]?.args.includes("--model"));
  });

  test("does not append --model when no opts passed", async () => {
    const calls: Array<{ args: string[] }> = [];
    const pi: RuntimeWiringSurface = {
      exec: async (_cmd, args) => { calls.push({ args }); return okExecResult("ok"); },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.complete!.complete("text");
    assert.ok(!calls[0]?.args.includes("--model"));
  });

  test("complete adapter absent when pi.exec absent", () => {
    const adapters = buildRuntimeAdapters({});
    assert.equal(adapters.complete, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeAdapters — subagent adapter: pi.subagents.run path
// ---------------------------------------------------------------------------

describe("buildRuntimeAdapters — subagent adapter via pi.subagents.run", () => {
  test("subagent adapter present when pi.subagents.run exists and pi.exec absent", () => {
    const pi: RuntimeWiringSurface = {
      subagents: { run: async () => "ok" },
    };
    const adapters = buildRuntimeAdapters(pi);
    assert.notEqual(adapters.subagent, undefined);
  });

  test("subagent adapter present when pi.subagents.run exists alongside pi.exec", () => {
    const pi: RuntimeWiringSurface = {
      exec: async () => okExecResult("hi"),
      subagents: { run: async () => "ok" },
    };
    const adapters = buildRuntimeAdapters(pi);
    assert.notEqual(adapters.subagent, undefined);
  });

  test("delegates to pi.subagents.run with agent and task", async () => {
    const calls: Array<{ agent: string; task: string }> = [];
    const pi: RuntimeWiringSurface = {
      subagents: {
        run: async (opts: { agent: string; task: string }) => {
          calls.push({ agent: opts.agent, task: opts.task });
          return "result";
        },
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "coder", task: "fix it" });
    assert.equal(calls[0]?.agent, "coder");
    assert.equal(calls[0]?.task, "fix it");
  });

  test("passes signal from meta to pi.subagents.run", async () => {
    const signal = makeSignal();
    const calls: Array<{ signal?: AbortSignal }> = [];
    const pi: RuntimeWiringSurface = {
      subagents: {
        run: async (opts: { signal?: AbortSignal }) => {
          calls.push({ signal: opts.signal });
          return "ok";
        },
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "r", stageId: "s", stageName: "N", signal };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    assert.equal(calls[0]?.signal, signal);
  });

  test("injects runId into env passed to pi.subagents.run", async () => {
    const calls: Array<{ env?: Record<string, string> }> = [];
    const pi: RuntimeWiringSurface = {
      subagents: {
        run: async (opts: { env?: Record<string, string> }) => {
          calls.push({ env: opts.env });
          return "ok";
        },
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "run-999", stageId: "s", stageName: "N" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    assert.equal(calls[0]?.env?.["PI_WORKFLOW_RUN_ID"], "run-999");
  });

  test("injects stageId into env passed to pi.subagents.run", async () => {
    const calls: Array<{ env?: Record<string, string> }> = [];
    const pi: RuntimeWiringSurface = {
      subagents: {
        run: async (opts: { env?: Record<string, string> }) => {
          calls.push({ env: opts.env });
          return "ok";
        },
      },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "r", stageId: "stage-42", stageName: "N" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    assert.equal(calls[0]?.env?.["PI_WORKFLOW_STAGE_ID"], "stage-42");
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeAdapters — subagent adapter: pi.callTool fallback
// ---------------------------------------------------------------------------

describe("buildRuntimeAdapters — subagent adapter via pi.callTool", () => {
  test("subagent adapter present when pi.callTool exists and pi.exec absent", () => {
    const pi: RuntimeWiringSurface = {
      callTool: async () => "ok",
    };
    const adapters = buildRuntimeAdapters(pi);
    assert.notEqual(adapters.subagent, undefined);
  });

  test("subagent adapter present when pi.callTool exists alongside pi.exec", () => {
    const pi: RuntimeWiringSurface = {
      exec: async () => okExecResult("hi"),
      callTool: async () => "ok",
    };
    const adapters = buildRuntimeAdapters(pi);
    assert.notEqual(adapters.subagent, undefined);
  });

  test("delegates to pi.callTool('subagent', args) when pi.subagents absent", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (name, args) => { calls.push({ name, args }); return "done"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "reviewer", task: "review" });
    assert.equal(calls[0]?.name, "subagent");
    assert.equal(calls[0]?.args["agent"], "reviewer");
    assert.equal(calls[0]?.args["task"], "review");
  });

  test("includes context in callTool args when provided", async () => {
    const calls: Array<{ args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (_name, args) => { calls.push({ args }); return "ok"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t", context: "ctx text" });
    assert.equal(calls[0]?.args["context"], "ctx text");
  });

  test("omits context key in callTool args when not provided", async () => {
    const calls: Array<{ args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (_name, args) => { calls.push({ args }); return "ok"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    await adapters.subagent!.subagent({ agent: "a", task: "t" });
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0]?.args, "context"), false);
  });

  test("passes runId env to callTool args", async () => {
    const calls: Array<{ args: Record<string, unknown> }> = [];
    const pi: RuntimeWiringSurface = {
      callTool: async (_name, args) => { calls.push({ args }); return "ok"; },
    };
    const adapters = buildRuntimeAdapters(pi);
    const meta: StageExecutionMeta = { runId: "run-ct", stageId: "s", stageName: "N" };
    await adapters.subagent!.subagent({ agent: "a", task: "t" }, meta);
    const env = calls[0]?.args["env"] as Record<string, string>;
    assert.equal(env["PI_WORKFLOW_RUN_ID"], "run-ct");
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeAdapters — degraded: no surfaces
// ---------------------------------------------------------------------------

describe("buildRuntimeAdapters — degraded (no surfaces)", () => {
  test("returns empty adapter set when pi has no exec, subagents, or callTool", () => {
    const adapters = buildRuntimeAdapters({});
    assert.equal(adapters.prompt, undefined);
    assert.equal(adapters.complete, undefined);
    assert.equal(adapters.subagent, undefined);
  });
});

// ---------------------------------------------------------------------------
// extractAssistantText — sanity checks
// ---------------------------------------------------------------------------

describe("extractAssistantText", () => {
  test("extracts text from message_end assistant event", () => {
    const ndjson = makeNdjson("hello world");
    assert.equal(extractAssistantText(ndjson), "hello world");
  });

  test("returns empty string for empty input", () => {
    assert.equal(extractAssistantText(""), "");
  });

  test("returns empty string when no message_end event", () => {
    assert.equal(extractAssistantText('{"type":"message_start"}\n{"type":"content_block_delta"}'), "");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function piWith(ui: PiUISurface): UIWiringSurface {
  return { ui };
}

// ---------------------------------------------------------------------------
// buildUIAdapter — absent / degraded surface
// ---------------------------------------------------------------------------

describe("buildUIAdapter — absent surface", () => {
  test("returns undefined when pi.ui is absent", () => {
    assert.equal(buildUIAdapter({}), undefined);
  });

  test("returns undefined when pi.ui is present but has no dialog methods", () => {
    // setWidget-only object (widget surface but no dialog methods)
    assert.equal(buildUIAdapter({ ui: {} as PiUISurface }), undefined);
  });

  test("returns adapter when at least one dialog method present", () => {
    const adapter = buildUIAdapter(piWith({
      input: async (_title) => "x",
    }));
    assert.notEqual(adapter, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildUIAdapter — input
// ---------------------------------------------------------------------------

describe("buildUIAdapter — input", () => {
  test("delegates to pi.ui.input using prompt as title", async () => {
    const calls: string[] = [];
    const adapter = buildUIAdapter(piWith({
      input: async (title) => { calls.push(title); return "typed text"; },
    }))!;
    const result = await adapter.input("Your name?");
    assert.deepEqual(calls, ["Your name?"]);
    assert.equal(result, "typed text");
  });

  test("returns empty string when pi.ui.input returns undefined (dismissed)", async () => {
    const adapter = buildUIAdapter(piWith({
      input: async (_title) => undefined,
    }))!;
    assert.equal(await adapter.input("prompt"), "");
  });

  test("returns empty string when pi.ui.input is absent", async () => {
    // Only confirm present — input fallback returns ""
    const adapter = buildUIAdapter(piWith({
      confirm: async (_t, _m) => true,
    }))!;
    assert.equal(await adapter.input("prompt"), "");
  });
});

// ---------------------------------------------------------------------------
// buildUIAdapter — confirm
// ---------------------------------------------------------------------------

describe("buildUIAdapter — confirm", () => {
  test("passes message as both title and message args to pi.ui.confirm", async () => {
    const calls: Array<[string, string]> = [];
    const adapter = buildUIAdapter(piWith({
      confirm: async (title, message) => { calls.push([title, message]); return true; },
    }))!;
    const result = await adapter.confirm("Delete everything?");
    assert.deepEqual(calls, [["Delete everything?", "Delete everything?"]]);
    assert.equal(result, true);
  });

  test("returns false when pi.ui.confirm is absent", async () => {
    const adapter = buildUIAdapter(piWith({
      input: async (_t) => "x",
    }))!;
    assert.equal(await adapter.confirm("Are you sure?"), false);
  });
});

// ---------------------------------------------------------------------------
// buildUIAdapter — select
// ---------------------------------------------------------------------------

describe("buildUIAdapter — select", () => {
  test("delegates to pi.ui.select with spread options array", async () => {
    const calls: Array<[string, string[]]> = [];
    const adapter = buildUIAdapter(piWith({
      select: async (title, options) => { calls.push([title, options]); return "b"; },
    }))!;
    const result = await adapter.select("Pick one", ["a", "b", "c"] as const);
    assert.deepEqual(calls, [["Pick one", ["a", "b", "c"]]]);
    assert.equal(result, "b");
  });

  test("returns first option when pi.ui.select returns undefined (dismissed)", async () => {
    const adapter = buildUIAdapter(piWith({
      select: async (_title, _opts) => undefined,
    }))!;
    const result = await adapter.select("Pick", ["x", "y"] as const);
    assert.equal(result, "x");
  });

  test("returns first option when pi.ui.select is absent", async () => {
    const adapter = buildUIAdapter(piWith({
      input: async (_t) => "ignored",
    }))!;
    const result = await adapter.select("Pick", ["alpha", "beta"] as const);
    assert.equal(result, "alpha");
  });

  test("preserves generic T type — result assignable to original union", async () => {
    type Color = "red" | "green" | "blue";
    const adapter = buildUIAdapter(piWith({
      select: async (_t, _o) => "green",
    }))!;
    const result: Color = await adapter.select("Color?", ["red", "green", "blue"] as const);
    assert.equal(result, "green");
  });
});

// ---------------------------------------------------------------------------
// buildUIAdapter — editor
// ---------------------------------------------------------------------------

describe("buildUIAdapter — editor", () => {
  test("delegates to pi.ui.editor with empty-string title and prefill", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const adapter = buildUIAdapter(piWith({
      editor: async (title, prefill) => { calls.push([title, prefill]); return "edited"; },
    }))!;
    const result = await adapter.editor("initial content");
    assert.deepEqual(calls, [["", "initial content"]]);
    assert.equal(result, "edited");
  });

  test("passes undefined prefill when no initial provided", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const adapter = buildUIAdapter(piWith({
      editor: async (title, prefill) => { calls.push([title, prefill]); return "x"; },
    }))!;
    await adapter.editor();
    assert.deepEqual(calls[0], ["", undefined]);
  });

  test("returns initial when pi.ui.editor returns undefined (dismissed)", async () => {
    const adapter = buildUIAdapter(piWith({
      editor: async (_t, _p) => undefined,
    }))!;
    assert.equal(await adapter.editor("fallback text"), "fallback text");
  });

  test("returns empty string when dismissed and no initial", async () => {
    const adapter = buildUIAdapter(piWith({
      editor: async (_t, _p) => undefined,
    }))!;
    assert.equal(await adapter.editor(), "");
  });

  test("returns empty string when pi.ui.editor is absent", async () => {
    const adapter = buildUIAdapter(piWith({
      input: async (_t) => "x",
    }))!;
    assert.equal(await adapter.editor("init"), "init");
  });
});

// ---------------------------------------------------------------------------
// Integration — full surface present
// ---------------------------------------------------------------------------

describe("buildUIAdapter — full pi surface", () => {
  test("all four methods delegate correctly in sequence", async () => {
    const log: string[] = [];
    const adapter = buildUIAdapter(piWith({
      input: async (t) => { log.push(`input:${t}`); return "alice"; },
      confirm: async (t, m) => { log.push(`confirm:${t}:${m}`); return false; },
      select: async (t, o) => { log.push(`select:${t}`); return o[1]; },
      editor: async (_t, p) => { log.push(`editor:${p ?? ""}`); return "done"; },
    }))!;

    assert.equal(await adapter.input("Name?"), "alice");
    assert.equal(await adapter.confirm("Sure?"), false);
    assert.equal(await adapter.select("Mode?", ["a", "b", "c"] as const), "b");
    assert.equal(await adapter.editor("draft"), "done");

    assert.deepEqual(log, [
      "input:Name?",
      "confirm:Sure?:Sure?",
      "select:Mode?",
      "editor:draft",
    ]);
  });
});
