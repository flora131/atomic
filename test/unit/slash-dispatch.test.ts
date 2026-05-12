/**
 * Slash dispatch tests.
 *
 * Verifies:
 *   - /workflow <name> [key=value] resolves non-admin first token as workflow
 *     name and dispatches run (not unknown subcommand).
 *   - /workflow inputs <name> shows schema via runtime.dispatch inputs.
 *   - /workflow inputs (missing name) shows usage.
 *   - Unknown workflow name prints "Workflow not found: <name>".
 *   - Per-workflow slash aliases are not registered; /workflow <name> is the
 *     single workflow-run slash surface.
 *   - /workflow completions include admin subcommands AND workflow names.
 *   - parseWorkflowArgs correctly parses key=value pairs and JSON objects.
 */

import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowArgs, makeExecuteWorkflowTool } from "../../src/extension/index.js";
import type { ExtensionAPI, PiCommandContext, PiCommandOptions, PiSlashCommandOpts } from "../../src/extension/index.js";
import { createRegistry } from "../../src/workflows/registry.js";
import { defineWorkflow } from "../../src/workflows/define-workflow.js";
import type { WorkflowDefinition } from "../../src/shared/types.js";
import { createExtensionRuntime } from "../../src/extension/runtime.js";
import { store } from "../../src/shared/store.js";
import type { PiCustomOverlayOpts } from "../../src/extension/wiring.js";
import { killAllRuns } from "../../src/runs/background/status.js";
import { cancellationRegistry } from "../../src/runs/background/cancellation-registry.js";
import { jobTracker } from "../../src/runs/background/job-tracker.js";
import type { StageSessionRuntime } from "../../src/runs/foreground/stage-runner.js";

afterEach(async () => {
  killAllRuns({ store, cancellation: cancellationRegistry });
  await Promise.all(jobTracker.runIds().map((runId) => jobTracker.get(runId)?.promise));
  store.clear();
});

// ---------------------------------------------------------------------------
// parseWorkflowArgs
// ---------------------------------------------------------------------------

describe("parseWorkflowArgs", () => {
  test("empty tokens → empty object", () => {
    assert.deepEqual(parseWorkflowArgs([]), {});
  });

  test("parses key=value string pairs", () => {
    assert.deepEqual(parseWorkflowArgs(["prompt=hello world"]), { prompt: "hello world" });
  });

  test("multiple key=value pairs", () => {
    assert.deepEqual(parseWorkflowArgs(["a=1", "b=foo"]), { a: 1, b: "foo" });
  });

  test("JSON-typed values: number, boolean", () => {
    assert.deepEqual(parseWorkflowArgs(["count=42", "flag=true"]), { count: 42, flag: true });
  });

  test("value with = in it splits on first = only", () => {
    assert.deepEqual(parseWorkflowArgs(["url=http://x.com/a=b"]), { url: "http://x.com/a=b" });
  });

  test("JSON object token merged into result", () => {
    const result = parseWorkflowArgs(['{"key":"val","n":3}']);
    assert.deepEqual(result, { key: "val", n: 3 });
  });

  test("JSON object merged with key=value", () => {
    const result = parseWorkflowArgs(['{"a":1}', "b=two"]);
    assert.deepEqual(result, { a: 1, b: "two" });
  });

  test("tokens without = are ignored", () => {
    assert.deepEqual(parseWorkflowArgs(["positional", "another"]), {});
  });

  test("key with empty value", () => {
    assert.deepEqual(parseWorkflowArgs(["name="]), { name: "" });
  });
});

// ---------------------------------------------------------------------------
// Shared test factory helpers
// ---------------------------------------------------------------------------

interface RegisteredCommand {
  name: string;
  opts: PiSlashCommandOpts;
}

function buildMockPi(): { pi: ExtensionAPI; commands: RegisteredCommand[] } {
  const commands: RegisteredCommand[] = [];
  const pi: ExtensionAPI = {
    registerCommand: (name: string, options: PiCommandOptions) => {
      const opts: PiSlashCommandOpts = {
        name,
        description: options.description,
        execute: options.handler,
        getArgumentCompletions: options.getArgumentCompletions,
      };
      commands.push({ name, opts });
    },
  };
  return { pi, commands };
}

function buildCtx(): { ctx: PiCommandContext; messages: string[] } {
  const messages: string[] = [];
  const ctx: PiCommandContext = {
    reply(msg: string) {
      messages.push(msg);
    },
  };
  return { ctx, messages };
}

function addFactoryStubs(pi: ExtensionAPI): void {
  pi.registerTool = () => {};
  pi.registerMessageRenderer = () => {};
  pi.registerFlag = () => {};
  pi.on = () => {};
  pi.ui = { setWidget: () => {} };
  pi.createAgentSession = async () => ({ session: fakeAgentSession() });
  pi.disableAsyncDiscovery = true;
}

function fakeAgentSession(): StageSessionRuntime {
  let last = "";
  return {
    async prompt(text: string): Promise<string> {
      last = `stub:${text.slice(0, 24)}`;
      return last;
    },
    async steer(text: string): Promise<void> {
      last = `steer:${text}`;
    },
    async followUp(text: string): Promise<void> {
      last = `follow:${text}`;
    },
    subscribe: () => () => {},
    sessionFile: undefined,
    sessionId: "slash-dispatch-test-session",
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
    getLastAssistantText(): string | undefined {
      return last;
    },
  };
}

async function runFactory(pi: ExtensionAPI): Promise<void> {
  addFactoryStubs(pi);
  const factoryModule = await import("../../src/extension/index.js");
  factoryModule.default(pi);
}

// ---------------------------------------------------------------------------
// Slash dispatch: non-admin first token → workflow name run
// ---------------------------------------------------------------------------

describe("slash /workflow <name> dispatch", () => {
  test("/workflow <known-name> dispatches run, not unknown subcommand", async () => {
    const wf = defineWorkflow("test-wf")
      .run(async (_ctx) => ({ done: true }))
      .compile() as WorkflowDefinition;

    const registry = createRegistry([wf]);
    const runtime = createExtensionRuntime({ registry });

    const { ctx, messages } = buildCtx();

    let dispatchCalled = false;
    let dispatchedArgs: { name: string; inputs: Record<string, unknown>; action: string } | null = null;

    const execute = async (args: string, execCtx: PiCommandContext) => {
      const print = execCtx.reply ?? execCtx.print ?? ((_msg: string) => undefined);
      const rawParts = args.trim().split(/\s+/);
      const parts = rawParts[0] === "" ? [] : rawParts;
      const subcommand = parts[0] ?? "";

      const ADMIN = new Set(["list", "status", "kill", "resume", "inputs"]);

      if (!subcommand || subcommand === "list") {
        print(`Registered workflows: ${runtime.registry.names().join(", ")}`);
        return;
      }

      if (!ADMIN.has(subcommand)) {
        dispatchCalled = true;
        const inputTokens = parts.slice(1);
        const inputs = parseWorkflowArgs(inputTokens);
        dispatchedArgs = { name: subcommand, inputs, action: "run" };
        const result = await runtime.dispatch({ name: subcommand, inputs, action: "run" });
        if (result.action === "run" && "runId" in result) {
          const r = result as { action: "run"; runId: string; status: string; error?: string };
          if (r.status === "failed" && r.runId === "") {
            const available = runtime.registry.names();
            print(`Workflow not found: ${subcommand}\nAvailable: ${available.join(", ")}`);
          } else {
            print(`Workflow "${subcommand}" completed (runId: ${r.runId})`);
          }
        }
        return;
      }
      print(`unknown subcommand: ${subcommand}`);
    };

    await execute("test-wf prompt=hello", ctx);

    assert.equal(dispatchCalled, true);
    const d = dispatchedArgs as { name: string; inputs: Record<string, unknown>; action: string } | null;
    assert.equal(d?.name, "test-wf");
    assert.deepEqual(d?.inputs, { prompt: "hello" });
    assert.equal(d?.action, "run");
    assert.equal(messages.some((m) => m.includes("completed")), true);
    // Must NOT print unknown subcommand
    assert.equal(messages.some((m) => m.includes("unknown subcommand")), false);
  });

  test("/workflow <unknown-name> prints 'Workflow not found: <name>'", async () => {
    const registry = createRegistry([]);
    const runtime = createExtensionRuntime({ registry });
    const { ctx, messages } = buildCtx();

    const ADMIN = new Set(["list", "status", "kill", "resume", "inputs"]);
    const execute = async (args: string, execCtx: PiCommandContext) => {
      const print = execCtx.reply ?? execCtx.print ?? ((_msg: string) => undefined);
      const rawParts = args.trim().split(/\s+/);
      const parts = rawParts[0] === "" ? [] : rawParts;
      const subcommand = parts[0] ?? "";
      if (!ADMIN.has(subcommand) && subcommand) {
        const result = await runtime.dispatch({ name: subcommand, inputs: {}, action: "run" });
        if (result.action === "run" && "runId" in result) {
          const r = result as { action: "run"; runId: string; status: string };
          if (r.status === "failed" && r.runId === "") {
            const available = runtime.registry.names();
            print(`Workflow not found: ${subcommand}\nAvailable: ${available.length > 0 ? available.join(", ") : "(none)"}`);
          }
        }
      }
    };

    await execute("ghost-workflow", ctx);

    assert.ok(messages[0].includes("Workflow not found: ghost-workflow"));
    assert.ok(!messages[0].includes("unknown subcommand"));
  });
});

// ---------------------------------------------------------------------------
// Factory command registration + completion integration tests (using real factory)
// ---------------------------------------------------------------------------

describe("factory command registration (real factory)", () => {
  /** Import factory and call it with a mock pi whose registry contains known workflows. */
  async function runFactoryWithMock(): Promise<RegisteredCommand[]> {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);
    return commands;
  }

  test("per-workflow slash aliases are not registered", async () => {
    const commands = await runFactoryWithMock();
    const names = commands.map((c) => c.name);
    assert.equal(names.some((name) => name.startsWith("workflow:")), false);
  });

  test("base /workflow command registered", async () => {
    const commands = await runFactoryWithMock();
    const names = commands.map((c) => c.name);
    assert.ok(names.includes("workflow"));
  });

  test("/workflows-doctor command registered", async () => {
    const commands = await runFactoryWithMock();
    const names = commands.map((c) => c.name);
    assert.ok(names.includes("workflows-doctor"));
  });
});

// ---------------------------------------------------------------------------
// Completions include workflow names
// ---------------------------------------------------------------------------

describe("getArgumentCompletions includes workflow names", () => {
  test("completions include admin subcommands and workflow names from registry", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    assert.notEqual(workflowCmd, undefined);

    const completions = await workflowCmd!.opts.getArgumentCompletions?.("") ?? [];
    const labels = completions.map((c) => c.label);

    assert.ok(labels.includes("list"));
    assert.ok(labels.includes("status"));
    assert.ok(labels.includes("connect"));
    assert.ok(labels.includes("kill"));
    assert.ok(labels.includes("resume"));
    assert.ok(labels.includes("inputs"));
    assert.equal(labels.includes("session"), false);

    assert.ok(labels.includes("deep-research-codebase"));
    assert.ok(labels.includes("ralph"));
    assert.ok(labels.includes("open-claude-design"));
  });

  test("completions filter by partial prefix", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const completions = await workflowCmd!.opts.getArgumentCompletions?.("li") ?? [];
    assert.equal(completions.every((c) => c.label.startsWith("li")), true);
    assert.ok(completions.map((c) => c.label).includes("list"));
  });

  test("completions cover subcommand arguments without shadowing submit", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const completions = workflowCmd!.opts.getArgumentCompletions?.("kill -") ?? [];
    assert.ok(completions.some((c) => c.value === "kill -y "));
  });
});

// ---------------------------------------------------------------------------
// removed session namespace
// ---------------------------------------------------------------------------

describe("/workflow session namespace removed", () => {
  test("/workflow session ... is not treated as a control namespace", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();
    await workflowCmd!.opts.execute("session kill abc12345", ctx);

    const joined = messages.join("\n");
    assert.match(joined, /Workflow not found: session/);
    assert.doesNotMatch(joined, /Usage: \/workflow session/);
  });
});

// ---------------------------------------------------------------------------
// inputs subcommand via execute handler (factory-registered)
// ---------------------------------------------------------------------------

describe("inputs subcommand", () => {
  test("/workflow inputs with no name prints usage", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();
    await workflowCmd!.opts.execute("inputs", ctx);

    assert.ok(messages[0].includes("Usage:"));
    assert.ok(messages[0].includes("inputs"));
  });

  test("/workflow inputs <unknown> prints workflow not found plus available", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();
    await workflowCmd!.opts.execute("inputs no-such-workflow-xyz", ctx);

    assert.ok(messages[0].includes("no-such-workflow-xyz"));
    assert.ok(messages[0].includes("Available:"));
  });

  test("/workflow inputs <known> shows schema", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();
    await workflowCmd!.opts.execute("inputs ralph", ctx);

    assert.ok(!messages[0].includes("Workflow not found"));
    assert.ok(messages[0].includes("ralph"));
  });
});

// ---------------------------------------------------------------------------
// /workflow deep-research-codebase prompt=test dispatch (full factory path)
// ---------------------------------------------------------------------------

describe("/workflow <name> prompt=test dispatches run via factory", () => {
  test("/workflow deep-research-codebase dispatches run action (not unknown subcommand)", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();

    await workflowCmd!.opts.execute("deep-research-codebase prompt=test", ctx);

    assert.equal(messages.some((m) => m.includes("unknown subcommand")), false);
    const dispatched = messages.some(
      (m) =>
        m.includes("completed") ||
        m.includes("started") ||
        m.includes("failed") ||
        m.includes("Workflow not found"),
    );
    assert.equal(dispatched, true);
  });
});

// ---------------------------------------------------------------------------
// /workflow <name> --help prints schema, skips dispatch
// ---------------------------------------------------------------------------

describe("/workflow <name> --help prints schema without dispatching", () => {
  test("--help token short-circuits to the schema printer", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();

    await workflowCmd!.opts.execute("deep-research-codebase --help", ctx);

    // Schema printer prints the pretty 'INPUTS FOR <NAME>' header (theme mode),
    // or the legacy 'Inputs for "<name>":' line in plain mode.
    assert.ok(
      messages.some((m) => /INPUTS FOR DEEP-RESEARCH-CODEBASE|Inputs for "deep-research-codebase":/.test(m)),
      `expected schema header in messages; got: ${JSON.stringify(messages)}`,
    );
    // Should NOT have a run completion/failure line
    assert.equal(
      messages.some((m) => m.includes("started") || m.includes("completed (runId:")),
      false,
    );
  });

  test("-h alias also short-circuits", async () => {
    const { pi, commands } = buildMockPi();
    await runFactory(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();

    await workflowCmd!.opts.execute("deep-research-codebase -h", ctx);
    assert.ok(
      messages.some((m) => /INPUTS FOR DEEP-RESEARCH-CODEBASE|Inputs for "deep-research-codebase":/.test(m)),
    );
  });
});

// ---------------------------------------------------------------------------
// Canonical registerCommand shape — opts.handler, no opts.execute
// ---------------------------------------------------------------------------

interface RawRegisteredCommand {
  name: string;
  options: PiCommandOptions;
}

function buildRawMockPi(): { pi: ExtensionAPI; commands: RawRegisteredCommand[] } {
  const commands: RawRegisteredCommand[] = [];
  const pi: ExtensionAPI = {
    registerCommand: (name: string, options: PiCommandOptions) => {
      commands.push({ name, options });
    },
  };
  return { pi, commands };
}

describe("canonical registerCommand — opts.handler shape", () => {
  async function runFactoryRaw(): Promise<RawRegisteredCommand[]> {
    const { pi, commands } = buildRawMockPi();
    await runFactory(pi);
    return commands;
  }

  test("registerCommand receives string name 'workflow'", async () => {
    const commands = await runFactoryRaw();
    const names = commands.map((c) => c.name);
    assert.ok(names.includes("workflow"));
  });

  test("registerCommand receives string name 'workflows-doctor'", async () => {
    const commands = await runFactoryRaw();
    const names = commands.map((c) => c.name);
    assert.ok(names.includes("workflows-doctor"));
  });

  test("registerCommand does not receive per-workflow alias names", async () => {
    const commands = await runFactoryRaw();
    const names = commands.map((c) => c.name);
    assert.equal(names.some((n) => n.startsWith("workflow:")), false);
  });

  test("opts passed to registerCommand have 'handler' (function)", async () => {
    const commands = await runFactoryRaw();
    for (const { name, options } of commands) {
      assert.equal(typeof options.handler, "function", `${name}: handler should be function`);
    }
  });

  test("opts passed to registerCommand do NOT have 'execute' property", async () => {
    const commands = await runFactoryRaw();
    for (const { name, options } of commands) {
      assert.equal(Object.prototype.hasOwnProperty.call(options, "execute"),
        false, `${name}: opts must not have execute — use handler`);
    }
  });

  test("opts have 'description' string", async () => {
    const commands = await runFactoryRaw();
    for (const { name, options } of commands) {
      assert.equal(typeof options.description, "string", `${name}: description should be string`);
    }
  });

  test("handler for 'workflow' is callable — does not throw synchronously", async () => {
    const commands = await runFactoryRaw();
    const workflowCmd = commands.find((c) => c.name === "workflow");
    assert.notEqual(workflowCmd, undefined);
    const msgs: string[] = [];
    const ctx: PiCommandContext = {
      reply(message) {
        msgs.push(message);
      },
    };
    await workflowCmd!.options.handler("list", ctx);
    assert.ok(msgs.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Canonical preference — registerCommand wins over registerSlashCommand
// ---------------------------------------------------------------------------

describe("canonical preference — registerCommand preferred over registerSlashCommand", () => {
  test("when both present, registerCommand called and registerSlashCommand NOT called", async () => {
    let canonicalCalls = 0;
    let legacyCalls = 0;

    const pi: ExtensionAPI = {
      registerCommand() {
        canonicalCalls++;
      },
      registerSlashCommand() {
        legacyCalls++;
      },
    };

    await runFactory(pi);

    assert.ok(canonicalCalls > 0);
    assert.equal(legacyCalls, 0);
  });
});

// ---------------------------------------------------------------------------
// Legacy fallback — registerSlashCommand called when registerCommand absent
// ---------------------------------------------------------------------------

describe("legacy fallback — registerSlashCommand when registerCommand absent", () => {
  async function runFactoryLegacy(): Promise<PiSlashCommandOpts[]> {
    const legacyCommands: PiSlashCommandOpts[] = [];

    const pi: ExtensionAPI = {
      registerSlashCommand(opts: PiSlashCommandOpts) {
        legacyCommands.push(opts);
      },
    };

    await runFactory(pi);
    return legacyCommands;
  }

  test("registerSlashCommand called for all commands when registerCommand absent", async () => {
    const legacyCommands = await runFactoryLegacy();

    assert.ok(legacyCommands.length > 0);
    const names = legacyCommands.map((c) => c.name);
    assert.ok(names.includes("workflow"));
    assert.ok(names.includes("workflows-doctor"));
  });

  test("legacy opts have 'execute' function (not 'handler')", async () => {
    const legacyCommands = await runFactoryLegacy();

    for (const opts of legacyCommands) {
      assert.equal(typeof opts.execute, "function", `${opts.name}: execute should be function on legacy path`);
    }
  });

  test("legacy opts have 'name' string", async () => {
    const legacyCommands = await runFactoryLegacy();

    for (const opts of legacyCommands) {
      assert.equal(typeof opts.name, "string", `${opts.name}: name should be string`);
    }
  });
});


// ---------------------------------------------------------------------------
// resume regression: /workflow resume opens overlay + no legacy message
// ---------------------------------------------------------------------------

function makeInflightRun(id: string) {
  return {
    id,
    name: "test-wf",
    inputs: {},
    status: "running" as const,
    stages: [],
    startedAt: Date.now(),
  };
}

describe("/workflow kill chat command", () => {
  test("top-level /workflow kill defaults to the active run", async () => {
    const runId = `kill-active-${Date.now()}`;
    store.recordRunStart(makeInflightRun(runId));

    const { pi, commands } = buildMockPi();
    addFactoryStubs(pi);

    const factoryModule = await import("../../src/extension/index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow")!;
    const msgs: string[] = [];
    const ctx: PiCommandContext = {
      ui: {
        notify: (message: string) => { msgs.push(message); },
        confirm: async () => false,
      },
    };

    await workflowCmd.opts.execute("kill", ctx);

    const run = store.runs().find((r) => r.id === runId);
    assert.equal(run?.status, "killed");
    assert.equal(msgs.some((m) => m.includes("killed")), true);
  });

  test("top-level /workflow kill <id> kills from chat without requiring confirmation", async () => {
    const runId = `kill-chat-${Date.now()}`;
    store.recordRunStart(makeInflightRun(runId));

    const { pi, commands } = buildMockPi();
    addFactoryStubs(pi);

    const factoryModule = await import("../../src/extension/index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow")!;
    const msgs: string[] = [];
    let confirmCalls = 0;
    const ctx: PiCommandContext = {
      ui: {
        notify: (message: string) => { msgs.push(message); },
        confirm: async () => {
          confirmCalls++;
          return false;
        },
      },
    };

    await workflowCmd.opts.execute(`kill ${runId}`, ctx);

    const run = store.runs().find((r) => r.id === runId);
    assert.equal(confirmCalls, 0);
    assert.equal(run?.status, "killed");
    assert.equal(msgs.some((m) => m.includes("killed")), true);
  });
});

// ---------------------------------------------------------------------------
// resume regression: /workflow resume opens overlay + no legacy message
// ---------------------------------------------------------------------------

describe("/workflow resume <runId> — overlay open + no legacy message", () => {
  test("seeds active run; /workflow resume calls overlay.open (pi.ui.custom invoked with overlay:true)", async () => {
    const runId = `resume-slash-overlay-${Date.now()}`;
    store.recordRunStart(makeInflightRun(runId));

    const openCalls: Array<{ overlay: boolean }> = [];
    const { pi, commands } = buildMockPi();
    addFactoryStubs(pi);
    pi.ui = {
      setWidget: () => {},
      custom: (opts: PiCustomOverlayOpts) => {
        openCalls.push({ overlay: !!opts.overlay });
        return { close: () => {} };
      },
    };

    const factoryModule = await import("../../src/extension/index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow")!;
    const msgs: string[] = [];
    const ctx: PiCommandContext = { reply: (m: string) => { msgs.push(m); } };

    await workflowCmd.opts.execute(`resume ${runId}`, ctx);

    assert.ok(openCalls.length > 0);
    assert.equal(openCalls[0].overlay, true);
  });

  test("active run resume output does NOT include 'still active — no resume needed'", async () => {
    const runId = `resume-nomsg-${Date.now()}`;
    store.recordRunStart(makeInflightRun(runId));

    const { pi, commands } = buildMockPi();
    addFactoryStubs(pi);
    pi.ui = {
      setWidget: () => {},
      custom: () => ({ close: () => {} }),
    };

    const factoryModule = await import("../../src/extension/index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow")!;
    const msgs: string[] = [];
    const ctx: PiCommandContext = { reply: (m: string) => { msgs.push(m); } };

    await workflowCmd.opts.execute(`resume ${runId}`, ctx);

    assert.equal(msgs.every((m) => !m.includes("still active")), true);
    assert.equal(msgs.every((m) => !m.includes("no resume needed")), true);
  });
});

// ---------------------------------------------------------------------------
// resume regression: tool action "resume" against active run returns status:"ok"
// ---------------------------------------------------------------------------

describe("tool action resume — active run returns status:ok", () => {
  test("makeExecuteWorkflowTool resume against in-flight run returns status:'ok'", async () => {
    const runId = `resume-tool-ok-${Date.now()}`;
    store.recordRunStart(makeInflightRun(runId));

    const registry = createRegistry([]);
    const runtime = createExtensionRuntime({ registry });
    const handler = makeExecuteWorkflowTool(runtime, () => undefined);

    const result = await handler(
      { action: "resume", name: runId },
      {} as never,
    );

    assert.equal(result.action, "resume");
    const r = result as { action: string; status: string; runId: string };
    assert.equal(r.status, "ok");
    assert.equal(r.runId, runId);
  });
});
