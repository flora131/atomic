/**
 * Extension runtime dispatcher tests.
 * Covers: list, inputs (found/not-found), run (success/not-found/failure), renderResult.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../../src/extension/dispatcher.js";
import { createExtensionRuntime } from "../../src/extension/runtime.js";
import { createRegistry } from "../../src/workflows/registry.js";
import { defineWorkflow } from "../../src/workflows/define-workflow.js";
import { createStore } from "../../src/shared/store.js";
import { renderResult } from "../../src/extension/render-result.js";
import type { WorkflowDefinition, WorkflowUIAdapter, WorkflowPersistencePort } from "../../src/shared/types.js";
import type { StageAdapters } from "../../src/runs/foreground/stage-runner.js";
import type {
  WorkflowToolResult,
  WorkflowInputEntry,
  WorkflowRunEntry,
} from "../../src/extension/render-result.js";

// ---------------------------------------------------------------------------
// Type-safe result narrowers
// ---------------------------------------------------------------------------

type ListResult   = Extract<WorkflowToolResult, { action: "list" }>;
type InputsResult = Extract<WorkflowToolResult, { action: "inputs" }>;
type RunResult    = Extract<WorkflowToolResult, { action: "run"; runId: string }>;

function asList(r: WorkflowToolResult): ListResult {
  if (r.action !== "list") throw new Error(`expected list, got ${r.action}`);
  return r as ListResult;
}
function asInputs(r: WorkflowToolResult): InputsResult {
  if (r.action !== "inputs") throw new Error(`expected inputs, got ${r.action}`);
  return r as InputsResult;
}
function asRun(r: WorkflowToolResult): RunResult {
  if (r.action !== "run" || !("runId" in r)) throw new Error(`expected run, got ${r.action}`);
  return r as RunResult;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const noopAdapters: StageAdapters = {
  prompt: { prompt: async (text) => `echo:${text}` },
  complete: { complete: async (text) => `echo:${text}` },
};

// Cast to base WorkflowDefinition to avoid contravariant TInputs error in arrays.
const helloWorkflow = defineWorkflow("hello-world")
  .description("Simple greeting")
  .input("name", { type: "text", required: true })
  .run(async (ctx) => {
    const stage = ctx.stage("greet");
    const out = await stage.prompt(`Hello ${String(ctx.inputs["name"])}`);
    return { greeting: out };
  })
  .compile() as WorkflowDefinition;

const schemaWorkflow = defineWorkflow("schema-test")
  .description("Multi-input schema")
  .input("text", { type: "text", default: "hi" })
  .input("count", { type: "number", required: false })
  .input("flag", { type: "boolean", required: true })
  .run(async (_ctx) => ({ ok: true }))
  .compile() as WorkflowDefinition;

// ---------------------------------------------------------------------------
// dispatch: list
// ---------------------------------------------------------------------------

describe("dispatch — list", () => {
  test("returns empty when registry is empty", async () => {
    const registry = createRegistry();
    const result = await dispatch({ name: "", inputs: {}, action: "list" }, { registry });
    const list = asList(result);
    assert.deepEqual(list.workflows, []);
  });

  test("returns all registered names", async () => {
    const registry = createRegistry([helloWorkflow, schemaWorkflow]);
    const result = await dispatch({ name: "", inputs: {}, action: "list" }, { registry });
    const list = asList(result);
    assert.ok(list.workflows.includes("hello-world"));
    assert.ok(list.workflows.includes("schema-test"));
    assert.equal(list.workflows.length, 2);
  });
});

// ---------------------------------------------------------------------------
// dispatch: inputs
// ---------------------------------------------------------------------------

describe("dispatch — inputs", () => {
  test("returns not-found result (not throw) for unknown workflow", async () => {
    const registry = createRegistry();
    const result = await dispatch(
      { name: "no-such-workflow", inputs: {}, action: "inputs" },
      { registry },
    );
    const inp = asInputs(result);
    assert.deepEqual(inp.inputs, []);
    assert.ok(inp.error.includes("no-such-workflow"));
  });

  test("returns schema entries for known workflow", async () => {
    const registry = createRegistry([schemaWorkflow]);
    const result = await dispatch(
      { name: "schema-test", inputs: {}, action: "inputs" },
      { registry },
    );
    const inp = asInputs(result);
    assert.equal(inp.error, undefined);
    const byName = Object.fromEntries(inp.inputs.map((i: WorkflowInputEntry) => [i.name, i]));
    assert.equal(byName["text"]?.type, "text");
    assert.equal(byName["text"]?.default, "hi");
    assert.ok(!byName["count"]?.required);
    assert.equal(byName["flag"]?.required, true);
  });
});

// ---------------------------------------------------------------------------
// dispatch: run
// ---------------------------------------------------------------------------

describe("dispatch — run", () => {
  test("returns structured failed result when workflow not found", async () => {
    const registry = createRegistry();
    const result = await dispatch({ name: "ghost", inputs: {}, action: "run" }, { registry });
    const run = asRun(result);
    assert.equal(run.status, "failed");
    assert.ok(run.error.includes("ghost"));
    assert.equal(run.runId, "");
  });

  test("runs workflow and returns real RunResult fields", async () => {
    const registry = createRegistry([helloWorkflow]);
    const activeStore = createStore();
    const result = await dispatch(
      { name: "hello-world", inputs: { name: "Alice" }, action: "run" },
      { registry, adapters: noopAdapters, store: activeStore },
    );
    const run = asRun(result);
    assert.equal(run.name, "hello-world");
    assert.equal(typeof run.runId, "string");
    assert.ok(run.runId.length > 0);
    assert.equal(run.status, "completed");
    assert.ok(run.result?.["greeting"].includes("Hello Alice"));
    assert.equal(run.error, undefined);
    assert.equal(Array.isArray(run.stages), true);
    assert.equal(run.stages!.length, 1);
  });

  test("propagates execution errors as failed status — no success-shaped swallow", async () => {
    const failingWorkflow = defineWorkflow("fail-me")
      .run(async (_ctx) => {
        throw new Error("intentional failure");
      })
      .compile() as WorkflowDefinition;
    const registry = createRegistry([failingWorkflow]);
    const activeStore = createStore();
    const result = await dispatch(
      { name: "fail-me", inputs: {}, action: "run" },
      { registry, adapters: noopAdapters, store: activeStore },
    );
    const run = asRun(result);
    assert.equal(run.status, "failed");
    assert.ok(run.error.includes("intentional failure"));
  });

  test("propagates input validation errors (missing required input)", async () => {
    const registry = createRegistry([helloWorkflow]);
    await assert.rejects(dispatch(
        { name: "hello-world", inputs: {}, action: "run" }, // missing required `name`
        { registry, adapters: noopAdapters },
      ), { message: 'required input "name"' });
  });
});

// ---------------------------------------------------------------------------
// dispatch: unknown action throws
// ---------------------------------------------------------------------------

describe("dispatch — unknown action", () => {
  test("throws for unrecognised action", async () => {
    const registry = createRegistry();
    await assert.rejects(dispatch(
        { name: "", inputs: {}, action: "status" as "list" },
        { registry },
      ), { message: "unknown action" });
  });
});

// ---------------------------------------------------------------------------
// createExtensionRuntime
// ---------------------------------------------------------------------------

describe("createExtensionRuntime", () => {
  test("empty registry by default", () => {
    const runtime = createExtensionRuntime();
    assert.deepEqual(runtime.registry.names(), []);
  });

  test("seeds registry from definitions array", () => {
    const runtime = createExtensionRuntime({ definitions: [helloWorkflow] });
    assert.ok(runtime.registry.names().includes("hello-world"));
  });

  test("accepts external registry", () => {
    const external = createRegistry([helloWorkflow, schemaWorkflow]);
    const runtime = createExtensionRuntime({ registry: external });
    assert.equal(runtime.registry.names().length, 2);
  });

  test("dispatch delegates to registry", async () => {
    const runtime = createExtensionRuntime({ definitions: [helloWorkflow] });
    const result = await runtime.dispatch({ name: "", inputs: {}, action: "list" });
    const list = asList(result);
    assert.ok(list.workflows.includes("hello-world"));
  });
});

// ---------------------------------------------------------------------------
// renderResult — new run variant
// ---------------------------------------------------------------------------

describe("renderResult — run variant", () => {
  test("completed run with result", () => {
    const out = renderResult({
      action: "run",
      name: "hello-world",
      runId: "abc-123",
      status: "completed",
      result: { greeting: "Hello Alice" },
      stages: [],
    });
    assert.ok(out.includes("abc-123"));
    assert.ok(out.includes("hello-world"));
    assert.ok(out.includes("completed"));
  });

  test("failed run shows error", () => {
    const out = renderResult({
      action: "run",
      name: "hello-world",
      runId: "abc-123",
      status: "failed",
      error: "intentional failure",
      stages: [],
    });
    assert.ok(out.includes("failed"));
    assert.ok(out.includes("intentional failure"));
  });

  test("partial run shows in-progress", () => {
    const out = renderResult(
      {
        action: "run",
        name: "hello-world",
        runId: "abc-123",
        status: "running",
        stages: [],
      },
      { isPartial: true },
    );
    assert.ok(out.includes("in progress"));
  });

  test("inputs not-found carries error field in result", async () => {
    const registry = createRegistry();
    const result = await dispatch(
      { name: "ghost", inputs: {}, action: "inputs" },
      { registry },
    );
    const inp = asInputs(result);
    assert.ok(inp.error.includes("ghost"));
  });

  test("status list uses WorkflowRunEntry shape", () => {
    const runs: WorkflowRunEntry[] = [
      { runId: "r1", name: "wf", status: "running" },
    ];
    const out = renderResult({ action: "status", runs });
    assert.ok(out.includes("r1"));
    assert.ok(out.includes("wf"));
  });
});

// ---------------------------------------------------------------------------
// WorkflowUIAdapter — forwarding through createExtensionRuntime → dispatch → run
// ---------------------------------------------------------------------------

describe("WorkflowUIAdapter — runtime forwarding", () => {
  const uiWorkflow = defineWorkflow("ui-test")
    .description("Tests HIL ui forwarding")
    .run(async (ctx) => {
      const answer = await ctx.ui.input("What is your name?");
      return { answer };
    })
    .compile() as WorkflowDefinition;

  test("ui adapter is called when provided via createExtensionRuntime", async () => {
    let captured: string | undefined;
    const mockUI: WorkflowUIAdapter = {
      input: async (prompt) => { captured = prompt; return "Alice"; },
      confirm: async () => false,
      select: async <T extends string>(_msg: string, options: readonly T[]): Promise<T> => options[0]!,
      editor: async () => "",
    };

    const runtime = createExtensionRuntime({
      definitions: [uiWorkflow],
      ui: mockUI,
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "ui-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "completed");
    assert.equal(run.result?.["answer"], "Alice");
    assert.equal(captured, "What is your name?");
  });

  test("ui adapter is called when provided via dispatch directly", async () => {
    let called = false;
    const mockUI: WorkflowUIAdapter = {
      input: async () => { called = true; return "Bob"; },
      confirm: async () => false,
      select: async <T extends string>(_msg: string, options: readonly T[]): Promise<T> => options[0]!,
      editor: async () => "",
    };

    const registry = createRegistry([uiWorkflow]);
    const result = await dispatch(
      { name: "ui-test", inputs: {}, action: "run" },
      { registry, ui: mockUI, store: createStore() },
    );
    const run = asRun(result);
    assert.equal(run.status, "completed");
    assert.equal(called, true);
  });

  test("omitting ui causes HIL call to reject with unavailable error", async () => {
    const runtime = createExtensionRuntime({
      definitions: [uiWorkflow],
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "ui-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "failed");
    assert.ok(run.error.includes("ui.input is unavailable"));
  });

  // ---- confirm ---------------------------------------------------------------

  const confirmWorkflow = defineWorkflow("confirm-test")
    .description("Tests confirm forwarding")
    .run(async (ctx) => {
      const agreed = await ctx.ui.confirm("Proceed?");
      return { agreed };
    })
    .compile() as WorkflowDefinition;

  test("confirm primitive forwarded through createExtensionRuntime dispatch", async () => {
    let capturedMsg: string | undefined;
    const mockUI: WorkflowUIAdapter = {
      input: async () => "",
      confirm: async (message) => { capturedMsg = message; return true; },
      select: async <T extends string>(_msg: string, options: readonly T[]): Promise<T> => options[0]!,
      editor: async () => "",
    };

    const runtime = createExtensionRuntime({
      definitions: [confirmWorkflow],
      ui: mockUI,
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "confirm-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "completed");
    assert.equal(run.result?.["agreed"], true);
    assert.equal(capturedMsg, "Proceed?");
  });

  test("omitting ui causes confirm call to fail with unavailable error", async () => {
    const runtime = createExtensionRuntime({
      definitions: [confirmWorkflow],
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "confirm-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "failed");
    assert.ok(run.error.includes("ui.confirm is unavailable"));
  });

  // ---- select ----------------------------------------------------------------

  const selectWorkflow = defineWorkflow("select-test")
    .description("Tests select forwarding")
    .run(async (ctx) => {
      const choice = await ctx.ui.select("Pick one", ["alpha", "beta", "gamma"] as const);
      return { choice };
    })
    .compile() as WorkflowDefinition;

  test("select primitive forwarded through createExtensionRuntime dispatch", async () => {
    let capturedMsg: string | undefined;
    let capturedOptions: readonly string[] | undefined;
    const mockUI: WorkflowUIAdapter = {
      input: async () => "",
      confirm: async () => false,
      select: async <T extends string>(message: string, options: readonly T[]): Promise<T> => {
        capturedMsg = message;
        capturedOptions = options;
        return options[1]!;
      },
      editor: async () => "",
    };

    const runtime = createExtensionRuntime({
      definitions: [selectWorkflow],
      ui: mockUI,
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "select-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "completed");
    assert.equal(run.result?.["choice"], "beta");
    assert.equal(capturedMsg, "Pick one");
    assert.deepEqual(capturedOptions, ["alpha", "beta", "gamma"]);
  });

  test("omitting ui causes select call to fail with unavailable error", async () => {
    const runtime = createExtensionRuntime({
      definitions: [selectWorkflow],
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "select-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "failed");
    assert.ok(run.error.includes("ui.select is unavailable"));
  });

  // ---- editor ----------------------------------------------------------------

  const editorWorkflow = defineWorkflow("editor-test")
    .description("Tests editor forwarding")
    .run(async (ctx) => {
      const content = await ctx.ui.editor("# draft");
      return { content };
    })
    .compile() as WorkflowDefinition;

  test("editor primitive forwarded through createExtensionRuntime dispatch", async () => {
    let capturedInitial: string | undefined;
    const mockUI: WorkflowUIAdapter = {
      input: async () => "",
      confirm: async () => false,
      select: async <T extends string>(_msg: string, options: readonly T[]): Promise<T> => options[0]!,
      editor: async (initial) => { capturedInitial = initial; return "final content"; },
    };

    const runtime = createExtensionRuntime({
      definitions: [editorWorkflow],
      ui: mockUI,
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "editor-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "completed");
    assert.equal(run.result?.["content"], "final content");
    assert.equal(capturedInitial, "# draft");
  });

  test("omitting ui causes editor call to fail with unavailable error", async () => {
    const runtime = createExtensionRuntime({
      definitions: [editorWorkflow],
      store: createStore(),
    });

    const result = await runtime.dispatch({ name: "editor-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "failed");
    assert.ok(run.error.includes("ui.editor is unavailable"));
  });
});

// ---------------------------------------------------------------------------
// WorkflowPersistencePort — forwarding through createExtensionRuntime → dispatch → executor
// ---------------------------------------------------------------------------

describe("WorkflowPersistencePort — runtime persistence forwarding", () => {
  function makePersistence() {
    const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const persistence: WorkflowPersistencePort = {
      appendEntry(type: string, payload: Record<string, unknown>): string {
        calls.push({ type, payload });
        return `entry-${calls.length}`;
      },
    };
    return { persistence, calls };
  }

  const persistWorkflow = defineWorkflow("persist-forwarding-test")
    .description("Tests persistence port forwarding through runtime")
    .run(async (ctx) => {
      const stage = ctx.stage("persist-stage");
      await stage.prompt("hello");
      return { done: true };
    })
    .compile() as WorkflowDefinition;

  const noopAdaptersForPersist: StageAdapters = {
    prompt: { prompt: async () => "ok" },
  };

  test("createExtensionRuntime forwards persistence — appendEntry called with run.start and run.end", async () => {
    const { persistence, calls } = makePersistence();

    const runtime = createExtensionRuntime({
      definitions: [persistWorkflow],
      adapters: noopAdaptersForPersist,
      store: createStore(),
      persistence,
    });

    const result = await runtime.dispatch({ name: "persist-forwarding-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "completed");

    const types = calls.map((c) => c.type);
    assert.ok(types.includes("workflow.run.start"));
    assert.ok(types.includes("workflow.run.end"));
  });

  test("createExtensionRuntime forwards persistence — full lifecycle order: run.start → stage.start → stage.end → run.end", async () => {
    const { persistence, calls } = makePersistence();

    const runtime = createExtensionRuntime({
      definitions: [persistWorkflow],
      adapters: noopAdaptersForPersist,
      store: createStore(),
      persistence,
    });

    const result = await runtime.dispatch({ name: "persist-forwarding-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "completed");

    assert.deepEqual(calls.map((c) => c.type), [
      "workflow.run.start",
      "workflow.stage.start",
      "workflow.stage.end",
      "workflow.run.end",
    ]);
  });

  test("createExtensionRuntime forwards persistence — run.start payload contains runId and name", async () => {
    const { persistence, calls } = makePersistence();

    const runtime = createExtensionRuntime({
      definitions: [persistWorkflow],
      adapters: noopAdaptersForPersist,
      store: createStore(),
      persistence,
    });

    const result = await runtime.dispatch({ name: "persist-forwarding-test", inputs: {}, action: "run" });
    const run = asRun(result);

    const runStart = calls.find((c) => c.type === "workflow.run.start");
    assert.notEqual(runStart, undefined);
    assert.equal(runStart?.payload["runId"], run.runId);
    assert.equal(runStart?.payload["name"], "persist-forwarding-test");
    assert.equal(typeof runStart?.payload["ts"], "number");
  });

  test("omitting persistence — no appendEntry calls, run still completes", async () => {
    const runtime = createExtensionRuntime({
      definitions: [persistWorkflow],
      adapters: noopAdaptersForPersist,
      store: createStore(),
      // no persistence
    });

    const result = await runtime.dispatch({ name: "persist-forwarding-test", inputs: {}, action: "run" });
    const run = asRun(result);
    assert.equal(run.status, "completed");
  });
});
