/**
 * cli-flags regression tests.
 * Covers: parseWorkflowFlags, registerWorkflowCliFlags, runWorkflowFromCliFlags.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkflowFlags,
  registerWorkflowCliFlags,
  runWorkflowFromCliFlags,
} from "../../src/runs/shared/cli-flags.js";
import type { WorkflowFlagValues } from "../../src/runs/shared/cli-flags.js";
import type { ExtensionAPI, PiFlagNamedOpts } from "../../src/extension/index.js";
import type { ExtensionRuntime } from "../../src/extension/runtime.js";
import type { WorkflowToolArgs } from "../../src/extension/index.js";
import type { WorkflowToolResult } from "../../src/extension/render-result.js";

// ---------------------------------------------------------------------------
// parseWorkflowFlags
// ---------------------------------------------------------------------------

describe("parseWorkflowFlags", () => {
  test("returns null when --workflow absent", () => {
    assert.equal(parseWorkflowFlags([]), null);
    assert.equal(parseWorkflowFlags(["--other=val"]), null);
  });

  test("--workflow=<name>", () => {
    const r = parseWorkflowFlags(["--workflow=my-flow"]);
    assert.deepEqual(r, { workflow: "my-flow", inputs: {} });
  });

  test("--workflow <name> (space-separated)", () => {
    const r = parseWorkflowFlags(["--workflow", "my-flow"]);
    assert.deepEqual(r, { workflow: "my-flow", inputs: {} });
  });

  test("--workflow does NOT consume next flag token when it starts with --", () => {
    const r = parseWorkflowFlags(["--workflow", "--other"]);
    // --other starts with --, so no valid name token; workflow remains null → null result.
    assert.equal(r, null);
  });

  test("--workflow-input-<key>=<value> string", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-env=production"]);
    assert.deepEqual(r, {
      workflow: "flow",
      inputs: { env: "production" },
    });
  });

  test("--workflow-input-<key>=<value> number JSON-parsed", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-count=42"]);
    assert.equal(r?.inputs.count, 42);
  });

  test("--workflow-input-<key>=<value> boolean JSON-parsed", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-dry=true"]);
    assert.equal(r?.inputs.dry, true);
  });

  test("--workflow-input-<key>=<value> object JSON-parsed", () => {
    const r = parseWorkflowFlags([
      "--workflow=flow",
      '--workflow-input-cfg={"k":"v"}',
    ]);
    assert.deepEqual(r?.inputs.cfg, { k: "v" });
  });

  test("--workflow-input-<key> <value> space-separated", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-env", "staging"]);
    assert.equal(r?.inputs.env, "staging");
  });

  test("--workflow-input-<key> with no value → true", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-verbose"]);
    assert.equal(r?.inputs.verbose, true);
  });

  test("multiple inputs", () => {
    const r = parseWorkflowFlags([
      "--workflow=flow",
      "--workflow-input-env=prod",
      "--workflow-input-count=3",
      "--workflow-input-dry=false",
    ]);
    assert.deepEqual(r?.inputs, { env: "prod", count: 3, dry: false });
  });

  test("mixed positional flags ignored", () => {
    const r = parseWorkflowFlags([
      "--headless",
      "--workflow=deploy",
      "--some-other=thing",
      "--workflow-input-region=us-east-1",
    ]);
    assert.equal(r?.workflow, "deploy");
    assert.deepEqual(r?.inputs, { region: "us-east-1" });
  });

  // Task-spec named inputs
  test("--workflow-input-prompt=hello → string", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-prompt=hello"]);
    assert.equal(r?.inputs.prompt, "hello");
  });

  test("--workflow-input-max=3 → number", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-max=3"]);
    assert.equal(r?.inputs.max, 3);
  });

  test("--workflow-input-dryRun=true → boolean (camelCase key preserved)", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-dryRun=true"]);
    assert.equal(r?.inputs.dryRun, true);
  });

  test('--workflow-input-options={"a":1} → parsed object', () => {
    const r = parseWorkflowFlags(["--workflow=flow", '--workflow-input-options={"a":1}']);
    assert.deepEqual(r?.inputs.options, { a: 1 });
  });

  test("--workflow-input-prompt <value> space-separated", () => {
    const r = parseWorkflowFlags(["--workflow=flow", "--workflow-input-prompt", "hello"]);
    assert.equal(r?.inputs.prompt, "hello");
  });
});

// ---------------------------------------------------------------------------
// registerWorkflowCliFlags
// ---------------------------------------------------------------------------

describe("registerWorkflowCliFlags", () => {
  function registeredFlags(): Array<{ name: string; opts: PiFlagNamedOpts }> {
    const calls: Array<{ name: string; opts: PiFlagNamedOpts }> = [];
    registerWorkflowCliFlags({
      registerFlag: (name, opts) => {
        calls.push({ name, opts });
      },
    });
    return calls;
  }

  test("registers workflow and workflow-input-<key> flags", () => {
    const flags = registeredFlags();
    const names = flags.map((flag) => flag.name);
    assert.ok(names.includes("workflow"));
    assert.ok(names.includes("workflow-input-<key>"));
    assert.equal(flags.find((flag) => flag.name === "workflow")?.opts.type, "string");
  });

  test("degrades silently when registerFlag absent", () => {
    const pi: ExtensionAPI = {};
    // Should not throw
    assert.doesNotThrow(() => registerWorkflowCliFlags(pi));
  });

  test("opts exclude name; descriptions and types preserved (canonical Pi-shaped mock)", () => {
    const flags = registeredFlags();
    const workflow = flags.find((flag) => flag.name === "workflow");
    const inputKey = flags.find((flag) => flag.name === "workflow-input-<key>");

    assert.notEqual(workflow, undefined);
    assert.notEqual(inputKey, undefined);
    assert.equal("name" in workflow!.opts, false);
    assert.equal("name" in inputKey!.opts, false);
    assert.equal(workflow!.opts.type, "string");
    assert.equal(inputKey!.opts.type, "string");
    assert.equal(typeof workflow!.opts.description, "string");
    assert.ok(workflow!.opts.description.length > 0);
    assert.equal(typeof inputKey!.opts.description, "string");
    assert.ok(inputKey!.opts.description.length > 0);
  });
});

// ---------------------------------------------------------------------------
// runWorkflowFromCliFlags
// ---------------------------------------------------------------------------

describe("runWorkflowFromCliFlags", () => {
  function makeRuntime(dispatchImpl: (args: { name: string; inputs: Record<string, unknown> }) => Promise<WorkflowToolResult>): ExtensionRuntime {
    return {
      get registry() {
        return { names: () => [], get: () => undefined } as unknown as ExtensionRuntime["registry"];
      },
      dispatch: (args) => dispatchImpl({ name: args.name ?? "", inputs: args.inputs ?? {} }),
    };
  }

  test("returns handled:false when --workflow absent", async () => {
    const runtime = makeRuntime(async () => ({ action: "list", workflows: [] }));
    const result = await runWorkflowFromCliFlags({ runtime, argv: ["--headless"] });
    assert.equal(result.handled, false);
  });

  test("dispatches with correct name and inputs", async () => {
    const capture: { args: { name: string; inputs: Record<string, unknown> } | null } = { args: null };
    const runtime = makeRuntime(async (args) => {
      capture.args = args;
      return {
        action: "run",
        name: args.name,
        runId: "run-1",
        status: "completed",
        stages: [],
      };
    });

    const result = await runWorkflowFromCliFlags({
      runtime,
      argv: ["--workflow=deploy", "--workflow-input-env=prod", "--workflow-input-count=2"],
    });

    assert.equal(result.handled, true);
    assert.equal(capture.args?.name, "deploy");
    assert.deepEqual(capture.args?.inputs, { env: "prod", count: 2 });
  });

  test("returns status:completed on successful run", async () => {
    const runtime = makeRuntime(async () => ({
      action: "run",
      name: "flow",
      runId: "r1",
      status: "completed",
      stages: [],
    }));
    const result = await runWorkflowFromCliFlags({ runtime, argv: ["--workflow=flow"] });
    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "completed");
    }
  });

  test("returns status:failed when dispatch result is failed", async () => {
    const runtime = makeRuntime(async () => ({
      action: "run",
      name: "flow",
      runId: "",
      status: "failed",
      error: "Workflow not found: \"flow\"",
      stages: [],
    }));
    const result = await runWorkflowFromCliFlags({ runtime, argv: ["--workflow=flow"] });
    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "failed");
      assert.ok(result.error.includes("not found"));
    }
  });

  test("returns status:failed on dispatch throw", async () => {
    const runtime = makeRuntime(async () => {
      throw new Error("executor exploded");
    });
    const result = await runWorkflowFromCliFlags({ runtime, argv: ["--workflow=flow"] });
    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "failed");
      assert.ok(result.error.includes("executor exploded"));
    }
  });

  test("space-separated --workflow <name>", async () => {
    let name = "";
    const runtime = makeRuntime(async (args) => {
      name = args.name;
      return { action: "run", name: args.name, runId: "r1", status: "completed", stages: [] };
    });
    await runWorkflowFromCliFlags({ runtime, argv: ["--workflow", "my-flow"] });
    assert.equal(name, "my-flow");
  });

  test("uses process.argv when argv not provided (smoke, does not throw)", async () => {
    // process.argv won't have --workflow; handled:false expected
    const runtime = makeRuntime(async () => ({ action: "list", workflows: [] }));
    const result = await runWorkflowFromCliFlags({ runtime });
    // We only verify it doesn't throw and returns a result
    assert.equal(typeof result.handled, "boolean");
  });

  test("dispatch payload contains action:run, name, and inputs", async () => {
    let captured: WorkflowToolArgs | null = null;
    const runtime: ExtensionRuntime = {
      get registry() {
        return { names: () => [], get: () => undefined } as unknown as ExtensionRuntime["registry"];
      },
      dispatch: async (args) => {
        captured = args;
        return { action: "run", name: args.name!, runId: "r1", status: "completed", stages: [] };
      },
    };
    await runWorkflowFromCliFlags({
      runtime,
      argv: ["--workflow=release", "--workflow-input-prompt=hello", "--workflow-input-max=3"],
    });
    assert.notEqual(captured, null);
    const c = captured!;
    assert.equal(c.action, "run");
    assert.equal(c.name, "release");
    assert.deepEqual((c as WorkflowToolArgs & { inputs: Record<string, unknown> }).inputs, {
      prompt: "hello",
      max: 3,
    });
  });
});
