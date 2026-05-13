/**
 * Regression tests — subagent env metadata propagation through the executor.
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { run } from "../../src/runs/foreground/executor.js";
import { createStore } from "../../src/shared/store.js";
import { defineWorkflow } from "../../src/workflows/define-workflow.js";
import { buildRuntimeAdapters } from "../../src/extension/wiring.js";
import type { RuntimeWiringSurface } from "../../src/extension/wiring.js";

function makeCallToolSurface(
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
): RuntimeWiringSurface {
  return {
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    callTool: async (name, args) => {
      toolCalls.push({ name, args });
      return "calltool-ok";
    },
  };
}

describe("executor → subagent env propagation", () => {
  test("PI_WORKFLOW_RUN_ID matches executor runId via task bridge", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolSurface(toolCalls));

    const def = defineWorkflow("meta-run-id-calltool")
      .run(async (ctx) => {
        await ctx.stage("scout").subagent({ agent: "a", task: "t" });
        return {};
      })
      .compile();

    const result = await run(def, {}, { adapters, store: createStore() });
    assert.equal(result.status, "completed");

    const env = toolCalls[0]!.args["env"] as Record<string, string>;
    assert.equal(env["PI_WORKFLOW_RUN_ID"], result.runId);
  });

  test("PI_WORKFLOW_STAGE_ID is non-empty via task bridge", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolSurface(toolCalls));

    const def = defineWorkflow("meta-stage-id-calltool")
      .run(async (ctx) => {
        await ctx.stage("probe").subagent({ agent: "a", task: "t" });
        return {};
      })
      .compile();

    await run(def, {}, { adapters, store: createStore() });

    const env = toolCalls[0]!.args["env"] as Record<string, string>;
    assert.equal(typeof env["PI_WORKFLOW_STAGE_ID"], "string");
    assert.ok(env["PI_WORKFLOW_STAGE_ID"].length > 0);
  });

  test("stage id matches executor snapshot stage id", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolSurface(toolCalls));
    let capturedStageId: string | undefined;

    const def = defineWorkflow("meta-stage-id-matches-snapshot")
      .run(async (ctx) => {
        await ctx.stage("verify").subagent({ agent: "a", task: "t" });
        return {};
      })
      .compile();

    const result = await run(def, {}, {
      adapters,
      store: createStore(),
      onStageStart: (_runId, snap) => {
        capturedStageId = snap.id;
      },
    });

    assert.equal(result.status, "completed");
    const env = toolCalls[0]!.args["env"] as Record<string, string>;
    assert.equal(env["PI_WORKFLOW_STAGE_ID"], capturedStageId);
  });

  test("executor metadata overrides ambient process env", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolSurface(toolCalls));

    const origRun = process.env["PI_WORKFLOW_RUN_ID"];
    const origStage = process.env["PI_WORKFLOW_STAGE_ID"];
    process.env["PI_WORKFLOW_RUN_ID"] = "ambient-run-should-be-overridden";
    process.env["PI_WORKFLOW_STAGE_ID"] = "ambient-stage-should-be-overridden";

    try {
      const def = defineWorkflow("meta-override-ambient")
        .run(async (ctx) => {
          await ctx.stage("override-test").subagent({ agent: "a", task: "t" });
          return {};
        })
        .compile();

      const result = await run(def, {}, { adapters, store: createStore() });
      const env = toolCalls[0]!.args["env"] as Record<string, string>;

      assert.equal(env["PI_WORKFLOW_RUN_ID"], result.runId);
      assert.notEqual(env["PI_WORKFLOW_RUN_ID"], "ambient-run-should-be-overridden");
      assert.notEqual(env["PI_WORKFLOW_STAGE_ID"], "ambient-stage-should-be-overridden");
    } finally {
      if (origRun !== undefined) process.env["PI_WORKFLOW_RUN_ID"] = origRun;
      else delete process.env["PI_WORKFLOW_RUN_ID"];
      if (origStage !== undefined) process.env["PI_WORKFLOW_STAGE_ID"] = origStage;
      else delete process.env["PI_WORKFLOW_STAGE_ID"];
    }
  });

  test("parallel stages share run id and get distinct stage ids", async () => {
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const adapters = buildRuntimeAdapters(makeCallToolSurface(toolCalls));

    const def = defineWorkflow("parallel-subagent-env")
      .run(async (ctx) => {
        await Promise.all([
          ctx.stage("one").subagent({ agent: "a", task: "t1" }),
          ctx.stage("two").subagent({ agent: "b", task: "t2" }),
        ]);
        return {};
      })
      .compile();

    const result = await run(def, {}, { adapters, store: createStore() });
    assert.equal(result.status, "completed");
    assert.equal(toolCalls.length, 2);

    const runIds = new Set(toolCalls.map((c) => (c.args["env"] as Record<string, string>)["PI_WORKFLOW_RUN_ID"]));
    const stageIds = new Set(toolCalls.map((c) => (c.args["env"] as Record<string, string>)["PI_WORKFLOW_STAGE_ID"]));
    assert.deepEqual([...runIds], [result.runId]);
    assert.equal(stageIds.size, 2);
  });
});
