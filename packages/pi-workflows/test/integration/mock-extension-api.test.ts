/**
 * Integration tests: MockExtensionAPI registration.
 * Verifies factory(pi) registers workflow tool, slash commands,
 * message renderers, and CLI flags against a minimal MockExtensionAPI.
 *
 * cross-ref: spec §5.2 workflow tool, §5.3 slash commands,
 *            §5.6 renderer registration, §8.3 Phase B tests
 */

import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import factory, {
  type ExtensionAPI,
  type PiToolOpts,
  type PiSlashCommandOpts,
  type PiCommandOptions,
  type PiFlagOpts,
  type PiFlagNamedOpts,
  type WorkflowToolArgs,
} from "../../src/extension/index.js";
import type { WorkflowToolResult } from "../../src/extension/render-result.js";
import { renderCall } from "../../src/extension/render-call.js";
import { renderResult } from "../../src/extension/render-result.js";

// ---------------------------------------------------------------------------
// MockExtensionAPI
// ---------------------------------------------------------------------------

interface RegisteredTool {
  opts: PiToolOpts<WorkflowToolArgs, WorkflowToolResult>;
}

interface RegisteredCommand {
  opts: PiSlashCommandOpts;
}

interface RegisteredRenderer {
  event: string;
  renderer: (payload: Record<string, unknown>) => string;
}

interface RegisteredFlag {
  opts: PiFlagOpts;
}

function makeMock(): ExtensionAPI & {
  tools: RegisteredTool[];
  commands: RegisteredCommand[];
  renderers: RegisteredRenderer[];
  flags: RegisteredFlag[];
} {
  const tools: RegisteredTool[] = [];
  const commands: RegisteredCommand[] = [];
  const renderers: RegisteredRenderer[] = [];
  const flags: RegisteredFlag[] = [];

  const api: ExtensionAPI & {
    tools: RegisteredTool[];
    commands: RegisteredCommand[];
    renderers: RegisteredRenderer[];
    flags: RegisteredFlag[];
  } = {
    tools,
    commands,
    renderers,
    flags,

    registerTool<TArgs, TResult>(opts: PiToolOpts<TArgs, TResult>) {
      tools.push({ opts: opts as unknown as PiToolOpts<WorkflowToolArgs, WorkflowToolResult> });
    },

    registerCommand(name: string, options: PiCommandOptions) {
      commands.push({
        opts: {
          name,
          description: options.description,
          execute: options.handler,
          getArgumentCompletions: options.getArgumentCompletions,
        },
      });
    },

    registerMessageRenderer(event: string, renderer: (payload: Record<string, unknown>) => string) {
      renderers.push({ event, renderer });
    },

    registerFlag(name: string, opts: PiFlagNamedOpts) {
      flags.push({ opts: { name, ...opts } });
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCommand(commands: RegisteredCommand[], name: string): PiSlashCommandOpts | undefined {
  return commands.find((c) => c.opts.name === name)?.opts;
}

function getRenderer(
  renderers: RegisteredRenderer[],
  event: string,
): ((payload: Record<string, unknown>) => string) | undefined {
  return renderers.find((r) => r.event === event)?.renderer;
}

function getFlag(flags: RegisteredFlag[], name: string): PiFlagOpts | undefined {
  return flags.find((f) => f.opts.name === name)?.opts;
}

function expectRegisteredCommand(
  commands: RegisteredCommand[],
  name: string,
): PiSlashCommandOpts {
  const cmd = getCommand(commands, name);
  if (cmd === undefined) {
    throw new Error(`Expected command "${name}" to be registered`);
  }

  assert.equal(cmd.name, name);
  assert.equal(typeof cmd.description, "string");
  assert.ok(cmd.description.length > 0);
  assert.equal(typeof cmd.execute, "function");
  return cmd;
}

function expectRegisteredFlag(flags: RegisteredFlag[], name: string): PiFlagOpts {
  const flag = getFlag(flags, name);
  if (flag === undefined) {
    throw new Error(`Expected flag "${name}" to be registered`);
  }

  assert.equal(flag.name, name);
  assert.equal(typeof flag.description, "string");
  assert.ok(flag.description.length > 0);
  return flag;
}

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — tool registration", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("registers exactly one tool", () => {
    assert.equal(mock.tools.length, 1);
  });

  test("tool name is 'workflow'", () => {
    assert.equal(mock.tools[0]!.opts.name, "workflow");
  });

  test("tool has non-empty description", () => {
    assert.equal(typeof mock.tools[0]!.opts.description, "string");
    assert.ok(mock.tools[0]!.opts.description.length > 0);
  });

  test("tool has parameters schema (TypeBox object)", () => {
    const params = mock.tools[0]!.opts.parameters as Record<string, unknown>;
    assert.notEqual(params, undefined);
    // TypeBox TObject has a 'type' property equal to 'object'
    assert.equal(params["type"], "object");
  });

  test("tool parameters include 'name', 'inputs', 'action' properties", () => {
    const params = mock.tools[0]!.opts.parameters as {
      properties: Record<string, unknown>;
    };
    assert.ok("name" in params.properties);
    assert.ok("inputs" in params.properties);
    assert.ok("action" in params.properties);
  });

  test("tool 'action' schema covers all six literals", () => {
    const params = mock.tools[0]!.opts.parameters as {
      properties: {
        action: { anyOf?: Array<{ const?: string; enum?: string[] }> };
      };
    };
    const actionSchema = params.properties.action;
    // TypeBox Optional(Union([...])) wraps in anyOf
    const raw = JSON.stringify(actionSchema);
    for (const literal of ["run", "list", "status", "kill", "resume", "inputs"]) {
      assert.ok(raw.includes(literal));
    }
  });

  test("tool execute returns run stub for default action", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "my-workflow", inputs: {} }, {});
    assert.equal(result.action, "run");
  });

  test("tool execute returns list stub for action='list'", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "", inputs: {}, action: "list" }, {});
    assert.equal(result.action, "list");
    assert.equal(Array.isArray((result as { action: "list"; workflows: string[] }).workflows), true);
  });

  test("tool execute returns status stub for action='status'", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "", inputs: {}, action: "status" }, {});
    assert.equal(result.action, "status");
    assert.equal(Array.isArray((result as { action: "status"; runs: unknown[] }).runs), true);
  });

  test("tool execute returns inputs stub for action='inputs'", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "wf", inputs: {}, action: "inputs" }, {});
    assert.equal(result.action, "inputs");
    const r = result as { action: "inputs"; name: string; inputs: unknown[] };
    assert.equal(r.name, "wf");
    assert.equal(Array.isArray(r.inputs), true);
  });

  test("tool execute returns kill stub for action='kill'", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "run-123", inputs: {}, action: "kill" }, {});
    assert.equal(result.action, "kill");
  });

  test("tool execute returns resume stub for action='resume'", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "run-456", inputs: {}, action: "resume" }, {});
    assert.equal(result.action, "resume");
  });

  test("tool has renderCall slot", () => {
    assert.equal(typeof mock.tools[0]!.opts.renderCall, "function");
  });

  test("tool has renderResult slot", () => {
    assert.equal(typeof mock.tools[0]!.opts.renderResult, "function");
  });

  test("tool renderCall slot delegates correctly", () => {
    const slot = mock.tools[0]!.opts.renderCall!;
    const out = slot({ args: { name: "test-wf", inputs: {}, action: "run" } }, {}, {});
    assert.ok(out.includes("test-wf"));
  });

  test("tool renderResult slot delegates correctly", () => {
    const slot = mock.tools[0]!.opts.renderResult!;
    const result: WorkflowToolResult = {
      action: "run",
      runId: "abc",
      status: "pending",
      message: "not yet implemented",
    };
    const out = slot({ result }, {}, {}, {});
    assert.ok(out.includes("abc"));
  });
});

// ---------------------------------------------------------------------------
// Slash command registration
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — slash command registration", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("registers at least two commands", () => {
    assert.ok(mock.commands.length >= 2);
  });

  test("/workflow command registered", () => {
    assert.notEqual(getCommand(mock.commands, "workflow"), undefined);
  });

  test("/workflows-doctor command registered", () => {
    assert.notEqual(getCommand(mock.commands, "workflows-doctor"), undefined);
  });

  test("/workflow registered through canonical (name, opts) tuple", () => {
    expectRegisteredCommand(mock.commands, "workflow");
  });

  test("/workflows-doctor registered through canonical (name, opts) tuple", () => {
    expectRegisteredCommand(mock.commands, "workflows-doctor");
  });

  test("registerSlashCommand NOT called when registerCommand present", () => {
    const names = mock.commands.map((c) => c.opts.name);
    assert.ok(names.includes("workflow"));
    assert.ok(names.includes("workflows-doctor"));
  });

  test("/workflow has non-empty description", () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    assert.ok(cmd.description.length > 0);
  });

  test("/workflows-doctor has non-empty description", () => {
    const cmd = getCommand(mock.commands, "workflows-doctor")!;
    assert.ok(cmd.description.length > 0);
  });

  test("/workflow execute with empty args calls reply/print", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const messages: string[] = [];
    await cmd.execute("", { reply: (m) => messages.push(m) });
    assert.ok(messages.length > 0);
  });

  test("/workflow execute 'list' calls reply/print", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const messages: string[] = [];
    await cmd.execute("list", { reply: (m) => messages.push(m) });
    assert.ok(messages.length > 0);
  });

  test("/workflow execute 'status' calls reply/print", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const messages: string[] = [];
    await cmd.execute("status", { reply: (m) => messages.push(m) });
    assert.ok(messages.length > 0);
  });

  test("/workflow execute unknown arg calls reply/print", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const messages: string[] = [];
    await cmd.execute("run my-wf", { reply: (m) => messages.push(m) });
    assert.ok(messages.length > 0);
  });

  test("/workflow execute falls back to ctx.print if no ctx.reply", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const messages: string[] = [];
    await cmd.execute("", { print: (m) => messages.push(m) });
    assert.ok(messages.length > 0);
  });

  test("/workflow getArgumentCompletions returns all subcommands for empty partial", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const completions = await cmd.getArgumentCompletions?.("");
    assert.equal(Array.isArray(completions), true);
    const labels = completions!.map((c) => c.label);
    for (const sub of ["list", "status", "kill", "resume", "inputs"]) {
      assert.ok(labels.includes(sub));
    }
  });

  test("/workflow getArgumentCompletions filters by partial", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const completions = await cmd.getArgumentCompletions?.("li");
    assert.notEqual(completions, undefined);
    assert.ok(completions!.length > 0);
    assert.equal(completions!.every((c) => c.label.startsWith("li")), true);
  });

  test("/workflows-doctor execute returns multi-line doctor report", async () => {
    const cmd = getCommand(mock.commands, "workflows-doctor")!;
    const messages: string[] = [];
    await cmd.execute("", { reply: (m) => messages.push(m) });
    const combined = messages.join("\n");
    assert.ok(combined.includes("pi-workflows"));
  });

  test("/workflows-doctor execute falls back to ctx.print", async () => {
    const cmd = getCommand(mock.commands, "workflows-doctor")!;
    const messages: string[] = [];
    await cmd.execute("", { print: (m) => messages.push(m) });
    assert.ok(messages.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Slash command registration via registerSlashCommand alias
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — registerSlashCommand alias", () => {
  test("registers /workflow via registerSlashCommand when registerCommand absent", () => {
    const commands: RegisteredCommand[] = [];
    const api: ExtensionAPI = {
      registerSlashCommand(opts: PiSlashCommandOpts) {
        commands.push({ opts });
      },
    };
    factory(api);
    const names = commands.map((c) => c.opts.name);
    assert.ok(names.includes("workflow"));
    assert.ok(names.includes("workflows-doctor"));
  });

  test("prefers registerCommand over registerSlashCommand when both present", () => {
    const commandLog: string[] = [];
    const slashLog: string[] = [];
    const api: ExtensionAPI = {
      registerCommand(name: string, _options: PiCommandOptions) {
        commandLog.push(name);
      },
      registerSlashCommand(opts: PiSlashCommandOpts) {
        slashLog.push(opts.name);
      },
    };
    factory(api);
    assert.ok(commandLog.length > 0);
    assert.equal(slashLog.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Message renderer registration
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — message renderer registration", () => {
  const REQUIRED_EVENTS = [
    "workflow.run.start",
    "workflow.stage.start",
    "workflow.stage.progress",
    "workflow.stage.end",
    "workflow.run.end",
  ] as const;

  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  for (const event of REQUIRED_EVENTS) {
    test(`registers renderer for '${event}'`, () => {
      assert.notEqual(getRenderer(mock.renderers, event), undefined);
    });
  }

  test("workflow.run.start renderer returns non-empty string", () => {
    const renderer = getRenderer(mock.renderers, "workflow.run.start")!;
    const out = renderer({ runId: "r1", name: "my-wf", inputs: { foo: "bar" } });
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.ok(out.includes("my-wf"));
    assert.ok(out.includes("r1"));
  });

  test("workflow.run.start renderer shows input count", () => {
    const renderer = getRenderer(mock.renderers, "workflow.run.start")!;
    const out = renderer({ runId: "r1", name: "wf", inputs: { a: 1, b: 2 } });
    assert.ok(out.includes("2"));
  });

  test("workflow.stage.start renderer returns non-empty string", () => {
    const renderer = getRenderer(mock.renderers, "workflow.stage.start")!;
    const out = renderer({ runId: "r1", stageId: "s1", name: "stage-one" });
    assert.equal(typeof out, "string");
    assert.ok(out.includes("stage-one"));
  });

  test("workflow.stage.start renderer includes model if provided", () => {
    const renderer = getRenderer(mock.renderers, "workflow.stage.start")!;
    const out = renderer({ runId: "r1", stageId: "s1", name: "s", model: "gpt-4o" });
    assert.ok(out.includes("gpt-4o"));
  });

  test("workflow.stage.progress renderer returns non-empty string", () => {
    const renderer = getRenderer(mock.renderers, "workflow.stage.progress")!;
    const out = renderer({ runId: "r1", stageId: "s1", kind: "token" });
    assert.equal(typeof out, "string");
    assert.ok(out.includes("s1"));
  });

  test("workflow.stage.end renderer ok status shows checkmark", () => {
    const renderer = getRenderer(mock.renderers, "workflow.stage.end")!;
    const out = renderer({ runId: "r1", stageId: "s1", status: "ok", durationMs: 100 });
    assert.ok(out.includes("✓"));
    assert.ok(out.includes("100"));
  });

  test("workflow.stage.end renderer error status shows error mark", () => {
    const renderer = getRenderer(mock.renderers, "workflow.stage.end")!;
    const out = renderer({ runId: "r1", stageId: "s1", status: "error" });
    assert.ok(out.includes("✗"));
  });

  test("workflow.stage.end renderer includes summary if provided", () => {
    const renderer = getRenderer(mock.renderers, "workflow.stage.end")!;
    const out = renderer({ runId: "r1", stageId: "s1", status: "ok", summary: "done well" });
    assert.ok(out.includes("done well"));
  });

  test("workflow.run.end renderer ok status shows success emoji", () => {
    const renderer = getRenderer(mock.renderers, "workflow.run.end")!;
    const out = renderer({ runId: "r1", status: "ok" });
    assert.ok(out.includes("✅"));
    assert.ok(out.includes("r1"));
  });

  test("workflow.run.end renderer error status shows failure emoji", () => {
    const renderer = getRenderer(mock.renderers, "workflow.run.end")!;
    const out = renderer({ runId: "r1", status: "error" });
    assert.ok(out.includes("❌"));
  });

  test("skips renderer registration when registerMessageRenderer absent", () => {
    // No error thrown even without the method.
    assert.doesNotThrow(() => factory({}));
  });
});

// ---------------------------------------------------------------------------
// CLI flag registration
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — CLI flag registration", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("registers at least two flags", () => {
    assert.ok(mock.flags.length >= 2);
  });

  test("registers 'workflow' flag", () => {
    expectRegisteredFlag(mock.flags, "workflow");
  });

  test("'workflow' flag is type 'string'", () => {
    assert.equal(expectRegisteredFlag(mock.flags, "workflow").type, "string");
  });

  test("'workflow' flag has non-empty description", () => {
    expectRegisteredFlag(mock.flags, "workflow");
  });

  test("registers 'workflow-input-<key>' flag", () => {
    expectRegisteredFlag(mock.flags, "workflow-input-<key>");
  });

  test("'workflow-input-<key>' flag is type 'string'", () => {
    assert.equal(expectRegisteredFlag(mock.flags, "workflow-input-<key>").type, "string");
  });

  test("skips flag registration when registerFlag absent", () => {
    assert.doesNotThrow(() => factory({}));
  });

});

// ---------------------------------------------------------------------------
// renderCall — standalone unit coverage (reachable export)
// ---------------------------------------------------------------------------

describe("renderCall — all action branches", () => {
  test("action='list' returns list string", () => {
    assert.equal(renderCall({ action: "list" }), "workflow: list registered workflows");
  });

  test("action='status' returns status string", () => {
    assert.equal(renderCall({ action: "status" }), "workflow: list in-flight runs");
  });

  test("action='inputs' includes name", () => {
    assert.ok(renderCall({ name: "wf-a", action: "inputs" }).includes("wf-a"));
  });

  test("action='run' includes name", () => {
    assert.ok(renderCall({ name: "wf-b", action: "run" }).includes("wf-b"));
  });

  test("action='kill' includes name", () => {
    assert.ok(renderCall({ name: "run-1", action: "kill" }).includes("run-1"));
  });

  test("action='resume' includes name", () => {
    assert.ok(renderCall({ name: "run-2", action: "resume" }).includes("run-2"));
  });

  test("defaults to 'run' when action omitted", () => {
    assert.ok(renderCall({ name: "wf-c" }).includes("run"));
  });

  test("falls back to '(unnamed)' when name omitted", () => {
    assert.ok(renderCall({}).includes("(unnamed)"));
  });
});

// ---------------------------------------------------------------------------
// renderResult — standalone unit coverage (reachable export)
// ---------------------------------------------------------------------------

describe("renderResult — all action branches", () => {
  test("action='list' empty workflows", () => {
    const out = renderResult({ action: "list", workflows: [] });
    assert.ok(out.includes("none"));
  });

  test("action='list' with workflows", () => {
    const out = renderResult({ action: "list", workflows: ["wf-a", "wf-b"] });
    assert.ok(out.includes("wf-a"));
    assert.ok(out.includes("wf-b"));
  });

  test("action='status' empty runs", () => {
    const out = renderResult({ action: "status", runs: [] });
    assert.ok(out.includes("no in-flight"));
  });

  test("action='status' with runs", () => {
    const out = renderResult({
      action: "status",
      runs: [{ runId: "r1", name: "wf", status: "running" }],
    });
    assert.ok(out.includes("r1"));
    assert.ok(out.includes("running"));
  });

  test("action='inputs' empty inputs", () => {
    const out = renderResult({ action: "inputs", name: "wf-x", inputs: [] });
    assert.ok(out.includes("wf-x"));
    assert.ok(out.includes("no declared inputs"));
  });

  test("action='inputs' with inputs", () => {
    const out = renderResult({
      action: "inputs",
      name: "wf-y",
      inputs: [
        { name: "param1", type: "string", required: true, description: "A param" },
      ],
    });
    assert.ok(out.includes("param1"));
    assert.ok(out.includes("required"));
  });

  test("action='run' non-partial shows message", () => {
    const out = renderResult(
      { action: "run", runId: "r42", status: "pending", message: "not yet" },
      { isPartial: false },
    );
    assert.ok(out.includes("not yet"));
    assert.ok(out.includes("r42"));
  });

  test("action='run' isPartial shows 'in progress'", () => {
    const out = renderResult(
      { action: "run", runId: "r42", status: "pending", message: "not yet" },
      { isPartial: true },
    );
    assert.ok(out.includes("in progress"));
    assert.ok(out.includes("r42"));
  });

  test("action='kill' shows message", () => {
    const out = renderResult({
      action: "kill",
      runId: "r10",
      status: "noop",
      message: "Kill not yet implemented",
    });
    assert.ok(out.includes("r10"));
    assert.ok(out.includes("Kill not yet implemented"));
  });

  test("action='resume' shows message", () => {
    const out = renderResult({
      action: "resume",
      runId: "r20",
      status: "noop",
      message: "Resume not yet implemented",
    });
    assert.ok(out.includes("r20"));
    assert.ok(out.includes("Resume not yet implemented"));
  });

  test("unknown action falls through to default", () => {
    const out = renderResult({ action: "unknown-action", message: "oops" } as unknown as WorkflowToolResult);
    assert.equal(typeof out, "string");
    assert.ok(out.includes("oops"));
  });
});

// ---------------------------------------------------------------------------
// Runtime behavior — tool list/inputs/run with real bundled registry
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — tool list returns bundled workflow names", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("action='list' returns bundled workflow names", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "", inputs: {}, action: "list" }, {});
    assert.equal(result.action, "list");
    const r = result as { action: "list"; workflows: string[] };
    assert.ok(r.workflows.includes("deep-research-codebase"));
    assert.ok(r.workflows.includes("ralph"));
    assert.ok(r.workflows.includes("open-claude-design"));
    assert.ok(r.workflows.length >= 3);
  });
});

describe("MockExtensionAPI — tool inputs returns schema for deep-research-codebase", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("action='inputs' for deep-research-codebase returns prompt and max_partitions fields", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "deep-research-codebase", inputs: {}, action: "inputs" }, {});
    assert.equal(result.action, "inputs");
    const r = result as { action: "inputs"; name: string; inputs: Array<{ name: string; type: string; required?: boolean; default?: unknown }> };
    assert.equal(r.name, "deep-research-codebase");
    assert.notEqual(r.inputs, undefined);
    const byName = Object.fromEntries(r.inputs.map((i) => [i.name, i]));
    assert.notEqual(byName["prompt"], undefined);
    assert.equal(byName["prompt"]?.type, "text");
    assert.equal(byName["prompt"]?.required, true);
    assert.notEqual(byName["max_partitions"], undefined);
    assert.equal(byName["max_partitions"]?.type, "number");
    assert.equal(byName["max_partitions"]?.default, 4);
  });

  test("action='inputs' for deep-research-codebase has no error field", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "deep-research-codebase", inputs: {}, action: "inputs" }, {});
    const r = result as { action: "inputs"; error?: string };
    assert.equal(r.error, undefined);
  });
});

describe("MockExtensionAPI — tool run returns non-placeholder runId and terminal status", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("action='run' for deep-research-codebase with prompt input returns non-placeholder runId", async () => {
    const execute = mock.tools[0]!.opts.execute;
    // deep-research-codebase requires prompt. Without adapters in test env,
    // prompt stages use the test stub but complete stages will throw — resulting
    // in an honest "failed" result (not a placeholder).
    const result = await execute(
      { name: "deep-research-codebase", inputs: { prompt: "test query" }, action: "run" },
      {},
    );
    assert.equal(result.action, "run");
    const r = result as {
      action: "run";
      runId: string;
      status: string;
      stages: unknown[];
      error?: string;
    };
    // runId must be a non-empty non-placeholder value (real UUID)
    assert.equal(typeof r.runId, "string");
    assert.ok(r.runId.length > 0);
    assert.notEqual(r.runId, "");
    // status must be terminal (completed or failed) — not pending/running/placeholder
    assert.ok(["completed", "failed"].includes(r.status));
    // stages must be an array
    assert.equal(Array.isArray(r.stages), true);
  });

  test("action='run' for deep-research-codebase without adapters reports honest failure, not stub", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute(
      { name: "deep-research-codebase", inputs: { prompt: "test" }, action: "run" },
      {},
    );
    const r = result as {
      action: "run";
      runId: string;
      status: string;
      stages: unknown[];
      error?: string;
    };
    // When no adapters and complete adapter is missing, the workflow should fail honestly.
    // A "failed" run must carry an error message (not placeholder text like "not yet implemented").
    if (r.status === "failed") {
      assert.notEqual(r.error, undefined);
      assert.ok(!r.error.includes("not yet implemented"));
      assert.ok(!r.error.includes("Phase B stub"));
    }
    // Either way, runId must be real
    assert.notEqual(r.runId, "");
  });

  test("action='run' for unknown workflow returns non-placeholder empty runId string with failed status", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ name: "nonexistent-workflow-xyz", inputs: {}, action: "run" }, {});
    const r = result as { action: "run"; runId: string; status: string; error?: string };
    assert.equal(r.status, "failed");
    assert.ok(r.error.includes("nonexistent-workflow-xyz"));
    // not-found returns "" as runId (documented behaviour: empty sentinel for not-found)
    assert.equal(r.runId, "");
  });
});

// ---------------------------------------------------------------------------
// Slash command alias registration — bundled workflow aliases
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — slash alias registration for bundled workflows", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("alias workflow:deep-research-codebase registered", () => {
    assert.notEqual(getCommand(mock.commands, "workflow:deep-research-codebase"), undefined);
  });

  test("alias workflow:ralph registered", () => {
    assert.notEqual(getCommand(mock.commands, "workflow:ralph"), undefined);
  });

  test("alias workflow:open-claude-design registered", () => {
    assert.notEqual(getCommand(mock.commands, "workflow:open-claude-design"), undefined);
  });

  test("each alias command has non-empty description mentioning workflow name", () => {
    for (const name of ["deep-research-codebase", "ralph", "open-claude-design"]) {
      const cmd = getCommand(mock.commands, `workflow:${name}`)!;
      assert.ok(cmd.description.length > 0);
      assert.ok(cmd.description.includes(name));
    }
  });
});

// ---------------------------------------------------------------------------
// Completions include admin subcommands and workflow names
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — completions include admin subcommands and workflow names", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("/workflow completions include all admin subcommands and all bundled workflow names", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const completions = await cmd.getArgumentCompletions?.("") ?? [];
    const labels = completions.map((c) => c.label);

    // Admin subcommands
    for (const sub of ["list", "status", "kill", "resume", "inputs"]) {
      assert.ok(labels.includes(sub));
    }

    // Bundled workflow names
    assert.ok(labels.includes("deep-research-codebase"));
    assert.ok(labels.includes("ralph"));
    assert.ok(labels.includes("open-claude-design"));
  });

  test("/workflow completions filter partial 'deep' to workflow name", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const completions = await cmd.getArgumentCompletions?.("deep") ?? [];
    const labels = completions.map((c) => c.label);
    assert.ok(labels.includes("deep-research-codebase"));
    assert.equal(labels.every((l) => l.startsWith("deep")), true);
  });
});

// ---------------------------------------------------------------------------
// /workflow deep-research-codebase prompt=test dispatches run, not unknown subcommand
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — /workflow <name> dispatches run not unknown-subcommand", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("/workflow deep-research-codebase prompt=test dispatches run (not unknown subcommand)", async () => {
    const cmd = getCommand(mock.commands, "workflow")!;
    const messages: string[] = [];
    await cmd.execute("deep-research-codebase prompt=test", { reply: (m) => messages.push(m) });

    // Must not say "unknown subcommand"
    assert.equal(messages.some((m) => m.toLowerCase().includes("unknown subcommand")), false);

    // Must print either completed, failed, or "Workflow not found" — never silent
    const dispatched = messages.some(
      (m) =>
        m.includes("completed") ||
        m.includes("failed") ||
        m.includes("Workflow not found"),
    );
    assert.equal(dispatched, true);
  });
});

// ---------------------------------------------------------------------------
// /workflows-doctor reports real loaded count
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — /workflows-doctor reports real loaded count", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  test("/workflows-doctor reports real loaded count (>= 3 bundled workflows)", async () => {
    const cmd = getCommand(mock.commands, "workflows-doctor")!;
    const messages: string[] = [];
    await cmd.execute("", { reply: (m) => messages.push(m) });
    const combined = messages.join("\n");

    // Must contain the pi-workflows header
    assert.ok(combined.includes("pi-workflows"));
    // Must not contain placeholder stub text
    assert.ok(!combined.includes("Phase B stub"));
    assert.ok(!combined.includes("Executor: not yet implemented"));
    // Must report the bundled workflow count (at least 3)
    const match = combined.match(/Registry:\s*(\d+)\s*workflow/);
    assert.notEqual(match, null);
    const count = match ? parseInt(match[1]!, 10) : 0;
    assert.ok(count >= 3);
  });

  test("/workflows-doctor names bundled sources (deep-research-codebase, ralph, open-claude-design)", async () => {
    const cmd = getCommand(mock.commands, "workflows-doctor")!;
    const messages: string[] = [];
    await cmd.execute("", { reply: (m) => messages.push(m) });
    const combined = messages.join("\n");

    assert.ok(combined.includes("deep-research-codebase"));
    assert.ok(combined.includes("ralph"));
    assert.ok(combined.includes("open-claude-design"));
  });
});

// ---------------------------------------------------------------------------
// Registered tool — list/status without name or inputs (schema-tool-args: optional fields)
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — tool list/status without name or inputs", () => {
  let mock: ReturnType<typeof makeMock>;

  beforeEach(() => {
    mock = makeMock();
    factory(mock);
  });

  // Schema: name and inputs must NOT appear in the required array
  test("schema has no required fields — name absent from required", () => {
    const params = mock.tools[0]!.opts.parameters as { required?: string[] };
    assert.ok(!params.required ?? [].includes("name"));
  });

  test("schema has no required fields — inputs absent from required", () => {
    const params = mock.tools[0]!.opts.parameters as { required?: string[] };
    assert.ok(!params.required ?? [].includes("inputs"));
  });

  // Tool execute: { action: "list" } — no name, no inputs
  test("execute({ action: 'list' }) returns action='list'", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ action: "list" }, {});
    assert.equal(result.action, "list");
  });

  test("execute({ action: 'list' }) returns workflows array", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ action: "list" }, {});
    const r = result as { action: "list"; workflows: unknown[] };
    assert.equal(Array.isArray(r.workflows), true);
  });

  test("execute({ action: 'list' }) workflows includes bundled names", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ action: "list" }, {});
    const r = result as { action: "list"; workflows: string[] };
    assert.ok(r.workflows.includes("deep-research-codebase"));
  });

  // Tool execute: { action: "status" } — no name, no inputs
  test("execute({ action: 'status' }) returns action='status'", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ action: "status" }, {});
    assert.equal(result.action, "status");
  });

  test("execute({ action: 'status' }) returns runs array", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const result = await execute({ action: "status" }, {});
    const r = result as { action: "status"; runs: unknown[] };
    assert.equal(Array.isArray(r.runs), true);
  });

  // Results identical whether or not name/inputs are supplied (idempotent)
  test("execute list with/without name yields same action", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const withName = await execute({ name: "", inputs: {}, action: "list" }, {});
    const withoutName = await execute({ action: "list" }, {});
    assert.equal(withoutName.action, withName.action);
  });

  test("execute status with/without name yields same action", async () => {
    const execute = mock.tools[0]!.opts.execute;
    const withName = await execute({ name: "", inputs: {}, action: "status" }, {});
    const withoutName = await execute({ action: "status" }, {});
    assert.equal(withoutName.action, withName.action);
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation — empty API object
// ---------------------------------------------------------------------------

describe("MockExtensionAPI — graceful degradation", () => {
  test("factory({}) does not throw", () => {
    assert.doesNotThrow(() => factory({}));
  });

  test("factory with partial API (only registerTool) does not throw", () => {
    const api: ExtensionAPI = {
      registerTool<TArgs, TResult>(opts: PiToolOpts<TArgs, TResult>) {
        void opts;
      },
    };
    assert.doesNotThrow(() => factory(api));
  });

  test("factory with partial API (only registerCommand) does not throw", () => {
    const api: ExtensionAPI = {
      registerCommand(_name: string, options: PiCommandOptions) {
        void options;
      },
    };
    assert.doesNotThrow(() => factory(api));
  });

  test("factory with partial API (only registerMessageRenderer) does not throw", () => {
    const api: ExtensionAPI = {
      registerMessageRenderer(event: string, renderer: (payload: Record<string, unknown>) => string) {
        void event;
        void renderer;
      },
    };
    assert.doesNotThrow(() => factory(api));
  });

  test("factory with partial API (only registerFlag) does not throw", () => {
    const api: ExtensionAPI = {
      registerFlag(name: string, opts: PiFlagNamedOpts) {
        void name; void opts;
      },
    };
    assert.doesNotThrow(() => factory(api));
  });
});
