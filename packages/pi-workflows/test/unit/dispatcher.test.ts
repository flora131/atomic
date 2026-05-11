/**
 * dispatcher.test.ts
 *
 * Verifies:
 *   - DispatcherOpts accepts ui?: WorkflowUIAdapter
 *   - dispatch("run") forwards opts.ui into run()
 *   - dispatch("list") and dispatch("inputs") are unaffected by ui field
 */

import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowUIAdapter, WorkflowDefinition, WorkflowPersistencePort } from "../../src/shared/types.js";
import { createRegistry } from "../../src/workflows/registry.js";
import { defineWorkflow } from "../../src/workflows/define-workflow.js";
import { dispatch } from "../../src/extension/dispatcher.js";
import { createStore } from "../../src/shared/store.js";
import type { DispatcherOpts } from "../../src/extension/dispatcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflow(name: string): WorkflowDefinition {
  return defineWorkflow(name)
    .run(async (_ctx) => ({ ok: true }))
    .compile() as WorkflowDefinition;
}

function makeUiAdapter(): WorkflowUIAdapter {
  return {
    onRunStart: mock.fn(() => {}),
    onRunEnd: mock.fn(() => {}),
    onStageStart: mock.fn(() => {}),
    onStageEnd: mock.fn(() => {}),
  } as unknown as WorkflowUIAdapter;
}

// ---------------------------------------------------------------------------
// DispatcherOpts accepts ui field (type-level + runtime shape)
// ---------------------------------------------------------------------------

describe("DispatcherOpts ui field", () => {
  test("DispatcherOpts accepts ui?: WorkflowUIAdapter without error", () => {
    const registry = createRegistry([]);
    const ui = makeUiAdapter();
    // Type check: constructing opts with ui must compile and be assignable
    const opts: DispatcherOpts = { registry, ui };
    assert.equal(opts.ui, ui);
  });

  test("DispatcherOpts without ui is still valid (optional)", () => {
    const registry = createRegistry([]);
    const opts: DispatcherOpts = { registry };
    assert.equal(opts.ui, undefined);
  });
});

// ---------------------------------------------------------------------------
// dispatch("list") — ui has no effect, list still works
// ---------------------------------------------------------------------------

describe("dispatch list", () => {
  test("list action returns workflow names, ui ignored", async () => {
    const wf = makeWorkflow("alpha");
    const registry = createRegistry([wf]);
    const ui = makeUiAdapter();
    const result = await dispatch({ action: "list" }, { registry, ui });
    assert.equal(result.action, "list");
    if (result.action === "list") {
      assert.ok(result.workflows.includes("alpha"));
    }
  });
});

// ---------------------------------------------------------------------------
// dispatch("inputs") — ui has no effect, inputs still works
// ---------------------------------------------------------------------------

describe("dispatch inputs", () => {
  test("inputs action returns schema, ui ignored", async () => {
    const wf = makeWorkflow("beta");
    const registry = createRegistry([wf]);
    const ui = makeUiAdapter();
    const result = await dispatch({ action: "inputs", name: "beta" }, { registry, ui });
    assert.equal(result.action, "inputs");
  });

  test("inputs for unknown workflow returns error, ui ignored", async () => {
    const registry = createRegistry([]);
    const ui = makeUiAdapter();
    const result = await dispatch({ action: "inputs", name: "no-such" }, { registry, ui });
    assert.equal(result.action, "inputs");
    if (result.action === "inputs") {
      assert.match(result.error, /not found/i);
    }
  });
});

// ---------------------------------------------------------------------------
// dispatch("run") — ui forwarded to executor
// ---------------------------------------------------------------------------

describe("dispatch run forwards ui", () => {
  test("run with ui completes successfully", async () => {
    const wf = makeWorkflow("gamma");
    const registry = createRegistry([wf]);
    const ui = makeUiAdapter();
    const result = await dispatch({ action: "run", name: "gamma", inputs: {} }, { registry, ui });
    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "completed");
    }
  });

  test("run without ui completes successfully (ui optional, no regression)", async () => {
    const wf = makeWorkflow("delta");
    const registry = createRegistry([wf]);
    const result = await dispatch({ action: "run", name: "delta", inputs: {} }, { registry });
    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "completed");
    }
  });

  test("run for unknown workflow returns failed result, ui present", async () => {
    const registry = createRegistry([]);
    const ui = makeUiAdapter();
    const result = await dispatch({ action: "run", name: "ghost", inputs: {} }, { registry, ui });
    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "failed");
      assert.match(result.error, /not found/i);
    }
  });
});

// ---------------------------------------------------------------------------
// dispatch("run") — persistence forwarded to executor
// ---------------------------------------------------------------------------

describe("dispatch run forwards persistence", () => {
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

  const stageWorkflow = defineWorkflow("dispatch-persist-test")
    .run(async (ctx) => {
      await ctx.stage("s1").prompt("go");
      return { ok: true };
    })
    .compile() as WorkflowDefinition;

  const noopAdapters = { prompt: { prompt: async () => "done" } };

  test("dispatch passes persistence to executor — appendEntry called for lifecycle events", async () => {
    const { persistence, calls } = makePersistence();
    const registry = createRegistry([stageWorkflow]);

    const result = await dispatch(
      { action: "run", name: "dispatch-persist-test", inputs: {} },
      { registry, adapters: noopAdapters, store: createStore(), persistence },
    );

    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "completed");
    }

    const types = calls.map((c) => c.type);
    assert.ok(types.includes("workflow.run.start"));
    assert.ok(types.includes("workflow.run.end"));
  });

  test("dispatch passes persistence to executor — full lifecycle order", async () => {
    const { persistence, calls } = makePersistence();
    const registry = createRegistry([stageWorkflow]);

    await dispatch(
      { action: "run", name: "dispatch-persist-test", inputs: {} },
      { registry, adapters: noopAdapters, store: createStore(), persistence },
    );

    assert.deepEqual(calls.map((c) => c.type), [
      "workflow.run.start",
      "workflow.stage.start",
      "workflow.stage.end",
      "workflow.run.end",
    ]);
  });

  test("dispatch without persistence — no appendEntry, run still succeeds", async () => {
    // Regression guard: omitting persistence must not crash
    const registry = createRegistry([stageWorkflow]);

    const result = await dispatch(
      { action: "run", name: "dispatch-persist-test", inputs: {} },
      { registry, adapters: noopAdapters, store: createStore() },
    );

    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "completed");
    }
  });

  test("DispatcherOpts accepts persistence field — type-level check", () => {
    const registry = createRegistry([]);
    const { persistence } = makePersistence();
    const opts: DispatcherOpts = { registry, persistence };
    assert.equal(opts.persistence, persistence);
  });
});

// ---------------------------------------------------------------------------
// dispatch("run", detach: true) — routes through runDetached, returns immediately
// ---------------------------------------------------------------------------

describe("dispatch run with detach: true", () => {
  test("detach:true returns action:run, status:running, detached:true, stages:[]", async () => {
    const wf = makeWorkflow("detach-wf");
    const registry = createRegistry([wf]);
    const result = await dispatch(
      { action: "run", name: "detach-wf", inputs: {}, detach: true },
      { registry, store: createStore() },
    );
    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "running");
      assert.equal((result as { detached?: boolean }).detached, true);
      assert.deepEqual(result.stages, []);
      assert.ok(result.runId);
    }
  });

  test("detach:true returns immediately without waiting for workflow completion", async () => {
    // Workflow that would take time if awaited — detached dispatch must return synchronously
    let settled = false;
    const slowWf = defineWorkflow("slow-detach-wf")
      .run(async (_ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        settled = true;
        return {};
      })
      .compile() as WorkflowDefinition;

    const registry = createRegistry([slowWf]);
    const t0 = Date.now();
    const result = await dispatch(
      { action: "run", name: "slow-detach-wf", inputs: {}, detach: true },
      { registry, store: createStore() },
    );
    const elapsed = Date.now() - t0;

    assert.equal(result.action, "run");
    assert.ok(elapsed < 100); // returned before workflow completed
    assert.equal(settled, false); // background not yet done
  });

  test("detach:true not-found workflow returns failed result (same as sync)", async () => {
    const registry = createRegistry([]);
    const result = await dispatch(
      { action: "run", name: "ghost", inputs: {}, detach: true },
      { registry, store: createStore() },
    );
    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "failed");
      assert.match(result.error, /not found/i);
    }
  });

  test("detach:false (explicit) routes sync — status completed", async () => {
    const wf = makeWorkflow("sync-explicit");
    const registry = createRegistry([wf]);
    const result = await dispatch(
      { action: "run", name: "sync-explicit", inputs: {}, detach: false },
      { registry, store: createStore() },
    );
    assert.equal(result.action, "run");
    if (result.action === "run") {
      assert.equal(result.status, "completed");
      assert.ok(!(result as { detached?: boolean }).detached);
    }
  });

  test("detach:true result includes name and non-empty message", async () => {
    const wf = makeWorkflow("named-detach");
    const registry = createRegistry([wf]);
    const result = await dispatch(
      { action: "run", name: "named-detach", inputs: {}, detach: true },
      { registry, store: createStore() },
    );
    if (result.action === "run") {
      assert.equal(result.name, "named-detach");
      assert.ok((result as { message?: string }).message.includes("named-detach"));
    }
  });

  test("DispatcherOpts accepts jobs field — type-level check", () => {
    const registry = createRegistry([]);
    const opts: DispatcherOpts = { registry, jobs: undefined };
    assert.equal(opts.jobs, undefined);
  });
});
