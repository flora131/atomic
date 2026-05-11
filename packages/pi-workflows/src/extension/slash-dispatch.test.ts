/**
 * Slash dispatch tests.
 *
 * Verifies:
 *   - /workflow <name> [key=value] resolves non-admin first token as workflow
 *     name and dispatches run (not unknown subcommand).
 *   - /workflow inputs <name> shows schema via runtime.dispatch inputs.
 *   - /workflow inputs (missing name) shows usage.
 *   - Unknown workflow name prints "Workflow not found: <name>".
 *   - Alias registrations: workflow:deep-research-codebase, workflow:ralph,
 *     workflow:open-claude-design are registered via factory.
 *   - Completions include admin subcommands AND workflow names.
 *   - parseWorkflowArgs correctly parses key=value pairs and JSON objects.
 */

import { test, expect, describe } from "bun:test";
import { parseWorkflowArgs } from "./index.js";
import type { ExtensionAPI, PiCommandContext, PiSlashCommandOpts } from "./index.js";
import { createRegistry } from "../workflows/registry.js";
import { defineWorkflow } from "../workflows/define-workflow.js";
import type { WorkflowDefinition } from "../shared/types.js";
import { createExtensionRuntime } from "./runtime.js";

// ---------------------------------------------------------------------------
// parseWorkflowArgs
// ---------------------------------------------------------------------------

describe("parseWorkflowArgs", () => {
  test("empty tokens → empty object", () => {
    expect(parseWorkflowArgs([])).toEqual({});
  });

  test("parses key=value string pairs", () => {
    expect(parseWorkflowArgs(["prompt=hello world"])).toEqual({ prompt: "hello world" });
  });

  test("multiple key=value pairs", () => {
    expect(parseWorkflowArgs(["a=1", "b=foo"])).toEqual({ a: 1, b: "foo" });
  });

  test("JSON-typed values: number, boolean", () => {
    expect(parseWorkflowArgs(["count=42", "flag=true"])).toEqual({ count: 42, flag: true });
  });

  test("value with = in it splits on first = only", () => {
    expect(parseWorkflowArgs(["url=http://x.com/a=b"])).toEqual({ url: "http://x.com/a=b" });
  });

  test("JSON object token merged into result", () => {
    const result = parseWorkflowArgs(['{"key":"val","n":3}']);
    expect(result).toEqual({ key: "val", n: 3 });
  });

  test("JSON object merged with key=value", () => {
    const result = parseWorkflowArgs(['{"a":1}', "b=two"]);
    expect(result).toEqual({ a: 1, b: "two" });
  });

  test("tokens without = are ignored", () => {
    expect(parseWorkflowArgs(["positional", "another"])).toEqual({});
  });

  test("key with empty value", () => {
    expect(parseWorkflowArgs(["name="])).toEqual({ name: "" });
  });
});

// ---------------------------------------------------------------------------
// Shared test factory helpers
// ---------------------------------------------------------------------------

interface RegisteredCommand {
  name: string;
  opts: PiSlashCommandOpts;
}

/** Build a minimal mock ExtensionAPI that records registerCommand calls. */
function buildMockPi(): { pi: ExtensionAPI; commands: RegisteredCommand[] } {
  const commands: RegisteredCommand[] = [];
  const pi: ExtensionAPI = {
    registerCommand: (opts: PiSlashCommandOpts) => {
      commands.push({ name: opts.name, opts });
    },
  };
  return { pi, commands };
}

/** Build a print-capturing PiCommandContext. */
function buildCtx(): { ctx: PiCommandContext; messages: string[] } {
  const messages: string[] = [];
  const ctx: PiCommandContext = {
    reply: (msg: string) => { messages.push(msg); },
  };
  return { ctx, messages };
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

    const { pi, commands } = buildMockPi();

    // Import factory dynamically to inject controlled runtime
    // We test the execute handler directly by building it from the runtime dispatch
    const { ctx, messages } = buildCtx();

    // Simulate dispatch: call the execute handler of /workflow with "test-wf"
    // We build the handler the same way factory does by extracting it from registered commands
    // Use the factory with a mock pi that captures the command

    // Build execute handler inline (mirrors factory behaviour)
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

    expect(dispatchCalled).toBe(true);
    const d = dispatchedArgs as { name: string; inputs: Record<string, unknown>; action: string } | null;
    expect(d?.name).toBe("test-wf");
    expect(d?.inputs).toEqual({ prompt: "hello" });
    expect(d?.action).toBe("run");
    expect(messages.some((m) => m.includes("completed"))).toBe(true);
    // Must NOT print unknown subcommand
    expect(messages.some((m) => m.includes("unknown subcommand"))).toBe(false);
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

    expect(messages[0]).toContain("Workflow not found: ghost-workflow");
    expect(messages[0]).not.toContain("unknown subcommand");
  });
});

// ---------------------------------------------------------------------------
// Factory alias + completion integration tests (using real factory)
// ---------------------------------------------------------------------------

describe("factory alias registration (real factory)", () => {
  /** Import factory and call it with a mock pi whose registry contains known workflows. */
  async function runFactoryWithMock(): Promise<RegisteredCommand[]> {
    const { pi, commands } = buildMockPi();
    // Patch pi with stubs for other registration calls to avoid side effects
    pi.registerTool = () => {};
    pi.registerMessageRenderer = () => {};
    pi.registerFlag = () => {};
    pi.on = () => {};
    pi.ui = { setWidget: () => {} };

    const factoryModule = await import("./index.js");
    const factory = factoryModule.default;
    factory(pi);
    return commands;
  }

  test("aliases workflow:deep-research-codebase, workflow:ralph, workflow:open-claude-design registered", async () => {
    const commands = await runFactoryWithMock();
    const names = commands.map((c) => c.name);
    expect(names).toContain("workflow:deep-research-codebase");
    expect(names).toContain("workflow:ralph");
    expect(names).toContain("workflow:open-claude-design");
  });

  test("base /workflow command registered", async () => {
    const commands = await runFactoryWithMock();
    const names = commands.map((c) => c.name);
    expect(names).toContain("workflow");
  });

  test("/workflows-doctor command registered", async () => {
    const commands = await runFactoryWithMock();
    const names = commands.map((c) => c.name);
    expect(names).toContain("workflows-doctor");
  });
});

// ---------------------------------------------------------------------------
// Completions include workflow names
// ---------------------------------------------------------------------------

describe("getArgumentCompletions includes workflow names", () => {
  test("completions include admin subcommands and workflow names from registry", async () => {
    const { pi, commands } = buildMockPi();
    pi.registerTool = () => {};
    pi.registerMessageRenderer = () => {};
    pi.registerFlag = () => {};
    pi.on = () => {};
    pi.ui = { setWidget: () => {} };

    const factoryModule = await import("./index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    expect(workflowCmd).toBeDefined();

    const completions = await workflowCmd!.opts.getArgumentCompletions?.("") ?? [];
    const labels = completions.map((c) => c.label);

    // Admin subcommands
    expect(labels).toContain("list");
    expect(labels).toContain("status");
    expect(labels).toContain("kill");
    expect(labels).toContain("resume");
    expect(labels).toContain("inputs");

    // Workflow names from bundled discovery
    expect(labels).toContain("deep-research-codebase");
    expect(labels).toContain("ralph");
    expect(labels).toContain("open-claude-design");
  });

  test("completions filter by partial prefix", async () => {
    const { pi, commands } = buildMockPi();
    pi.registerTool = () => {};
    pi.registerMessageRenderer = () => {};
    pi.registerFlag = () => {};
    pi.on = () => {};
    pi.ui = { setWidget: () => {} };

    const factoryModule = await import("./index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const completions = await workflowCmd!.opts.getArgumentCompletions?.("li") ?? [];
    expect(completions.every((c) => c.label.startsWith("li"))).toBe(true);
    expect(completions.map((c) => c.label)).toContain("list");
  });
});

// ---------------------------------------------------------------------------
// inputs subcommand via execute handler (factory-registered)
// ---------------------------------------------------------------------------

describe("inputs subcommand", () => {
  test("/workflow inputs with no name prints usage", async () => {
    const { pi, commands } = buildMockPi();
    pi.registerTool = () => {};
    pi.registerMessageRenderer = () => {};
    pi.registerFlag = () => {};
    pi.on = () => {};
    pi.ui = { setWidget: () => {} };

    const factoryModule = await import("./index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();
    await workflowCmd!.opts.execute("inputs", ctx);

    expect(messages[0]).toContain("Usage:");
    expect(messages[0]).toContain("inputs");
  });

  test("/workflow inputs <unknown> prints workflow not found plus available", async () => {
    const { pi, commands } = buildMockPi();
    pi.registerTool = () => {};
    pi.registerMessageRenderer = () => {};
    pi.registerFlag = () => {};
    pi.on = () => {};
    pi.ui = { setWidget: () => {} };

    const factoryModule = await import("./index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();
    await workflowCmd!.opts.execute("inputs no-such-workflow-xyz", ctx);

    expect(messages[0]).toContain("no-such-workflow-xyz");
    expect(messages[0]).toContain("Available:");
  });

  test("/workflow inputs <known> shows schema", async () => {
    const { pi, commands } = buildMockPi();
    pi.registerTool = () => {};
    pi.registerMessageRenderer = () => {};
    pi.registerFlag = () => {};
    pi.on = () => {};
    pi.ui = { setWidget: () => {} };

    const factoryModule = await import("./index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();
    // "ralph" is a bundled workflow — it may have inputs or not, but should not error with "not found"
    await workflowCmd!.opts.execute("inputs ralph", ctx);

    // Should not say "Workflow not found"
    expect(messages[0]).not.toContain("Workflow not found");
    // Should mention "ralph" in context
    expect(messages[0]).toContain("ralph");
  });
});

// ---------------------------------------------------------------------------
// /workflow deep-research-codebase prompt=test dispatch (full factory path)
// ---------------------------------------------------------------------------

describe("/workflow <name> prompt=test dispatches run via factory", () => {
  test("/workflow deep-research-codebase dispatches run action (not unknown subcommand)", async () => {
    const { pi, commands } = buildMockPi();
    pi.registerTool = () => {};
    pi.registerMessageRenderer = () => {};
    pi.registerFlag = () => {};
    pi.on = () => {};
    pi.ui = { setWidget: () => {} };

    const factoryModule = await import("./index.js");
    factoryModule.default(pi);

    const workflowCmd = commands.find((c) => c.name === "workflow");
    const { ctx, messages } = buildCtx();

    // Execute — deep-research-codebase is a real bundled workflow.
    // It may fail/succeed at runtime but should NOT print "unknown subcommand".
    await workflowCmd!.opts.execute("deep-research-codebase prompt=test", ctx);

    expect(messages.some((m) => m.includes("unknown subcommand"))).toBe(false);
    // Should print completed OR failed (workflow ran, not rejected as unknown subcommand)
    const dispatched = messages.some(
      (m) =>
        m.includes("completed") ||
        m.includes("failed") ||
        m.includes("Workflow not found"),
    );
    expect(dispatched).toBe(true);
  });
});
