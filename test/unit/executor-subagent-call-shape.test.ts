/**
 * Regression tests \u2014 executor \u2192 subagent call shape via pi.callTool.
 *
 * pi-subagents v0.24.2 SubagentParams (see
 * `nicobailon/pi-subagents@635112d:src/extension/schemas.ts` and
 * `src/shared/types.ts:597 SUBAGENT_ACTIONS`) accepts these execution-mode
 * shapes only \u2014
 *
 *   single   :  { agent, task, context?, model?, cwd?, output?, outputMode?,
 *               skill?, async?, clarify?, maxOutput?, ... }
 *   parallel :  { tasks: [...] , concurrency?, worktree?, context? }
 *   chain    :  { chain: [...], clarify?, async?, chainDir? }
 *
 * Critical contract notes verified by this suite:
 *   1. `action` MUST be omitted for execution. The historical `action: "run"`
 *      our adapter used to send is NOT a valid SUBAGENT_ACTIONS member and
 *      is rejected by createSubagentExecutor.execute.
 *   2. There is NO `env` field in SubagentParams. Workflow metadata
 *      (PI_WORKFLOW_RUN_ID / PI_WORKFLOW_STAGE_ID) cannot be propagated
 *      through this tool surface; the adapter must not pretend it can.
 *   3. `context` is the literal union `"fresh" | "fork"`.
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { run } from "../../packages/workflows/src/runs/foreground/executor.js";
import { createStore } from "../../packages/workflows/src/shared/store.js";
import { defineWorkflow } from "../../packages/workflows/src/workflows/define-workflow.js";
import { buildRuntimeAdapters } from "../../packages/workflows/src/extension/wiring.js";
import type { RuntimeWiringSurface } from "../../packages/workflows/src/extension/wiring.js";

interface RecordedToolCall {
  name: string;
  args: Record<string, unknown>;
}

function makeCallToolSurface(calls: RecordedToolCall[]): RuntimeWiringSurface {
  return {
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    callTool: async (name, args) => {
      calls.push({ name, args });
      return "calltool-ok";
    },
  };
}

describe("executor \u2192 subagent call shape", () => {
  test("emits a schema-compliant SubagentParams payload for single execution", async () => {
    const calls: RecordedToolCall[] = [];
    const adapters = buildRuntimeAdapters(makeCallToolSurface(calls));

    const def = defineWorkflow("single-shape")
      .run(async (ctx) => {
        await ctx.stage("scout").subagent({ agent: "reviewer", task: "audit auth" });
        return {};
      })
      .compile();

    const result = await run(def, {}, { adapters, store: createStore() });
    assert.equal(result.status, "completed");
    assert.equal(calls.length, 1);

    const args = calls[0]!.args;
    assert.equal(calls[0]!.name, "subagent");
    assert.equal(args["agent"], "reviewer");
    assert.equal(args["task"], "audit auth");
  });

  test(
    "MUST NOT send `action` \u2014 'run' is not a valid SUBAGENT_ACTIONS member",
    async () => {
      // pi-subagents rejects unknown actions in createSubagentExecutor.execute
      // with: `Unknown action: ${params.action}. Valid: ${SUBAGENT_ACTIONS.join(", ")}`
      const calls: RecordedToolCall[] = [];
      const adapters = buildRuntimeAdapters(makeCallToolSurface(calls));

      const def = defineWorkflow("no-action")
        .run(async (ctx) => {
          await ctx.stage("scout").subagent({ agent: "a", task: "t" });
          return {};
        })
        .compile();

      await run(def, {}, { adapters, store: createStore() });
      const args = calls[0]!.args;
      assert.equal(
        Object.prototype.hasOwnProperty.call(args, "action"),
        false,
        "subagent execution shape MUST omit `action` \u2014 pi-subagents rejects unknown actions and 'run' is not valid",
      );
    },
  );

  test(
    "MUST NOT send `env` \u2014 not part of SubagentParams (silently dropped by pi-subagents)",
    async () => {
      // pi-subagents/src/extension/schemas.ts SubagentParams has no `env`
      // field; threading workflow env through args gives a false sense of
      // propagation. Workflow metadata must use a supported channel
      // (task prefix, file-shared state, etc.) if needed downstream.
      const calls: RecordedToolCall[] = [];
      const adapters = buildRuntimeAdapters(makeCallToolSurface(calls));

      const def = defineWorkflow("no-env")
        .run(async (ctx) => {
          await ctx.stage("verify").subagent({ agent: "a", task: "t" });
          return {};
        })
        .compile();

      await run(def, {}, { adapters, store: createStore() });
      const args = calls[0]!.args;
      assert.equal(
        Object.prototype.hasOwnProperty.call(args, "env"),
        false,
        "subagent adapter MUST NOT send `env` \u2014 pi-subagents v0.24.2 SubagentParams does not accept it",
      );
    },
  );

  test("parallel subagent stages each produce one tool call with no shared mutable state", async () => {
    const calls: RecordedToolCall[] = [];
    const adapters = buildRuntimeAdapters(makeCallToolSurface(calls));

    const def = defineWorkflow("parallel-shape")
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
    assert.equal(calls.length, 2);

    const agents = new Set(calls.map((c) => c.args["agent"]));
    const tasks = new Set(calls.map((c) => c.args["task"]));
    assert.deepEqual([...agents].sort(), ["a", "b"]);
    assert.deepEqual([...tasks].sort(), ["t1", "t2"]);

    for (const call of calls) {
      assert.equal(Object.prototype.hasOwnProperty.call(call.args, "action"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(call.args, "env"), false);
    }
  });
});
