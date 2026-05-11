/**
 * Unit tests — integrations/subagents.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  injectWorkflowEnv,
  readWorkflowEnv,
  emitStageStart,
  emitStageEnd,
  isSubagentsPresent,
  assertSubagentsPresent,
} from "../../src/extension/subagents.js";

describe("injectWorkflowEnv", () => {
  test("returns correct env vars", () => {
    const env = injectWorkflowEnv("run-abc", "stage-xyz");
    assert.equal(env.PI_WORKFLOW_RUN_ID, "run-abc");
    assert.equal(env.PI_WORKFLOW_STAGE_ID, "stage-xyz");
  });

  test("returns plain object (no extra keys)", () => {
    const env = injectWorkflowEnv("r1", "s1");
    assert.deepEqual(Object.keys(env).sort(), ["PI_WORKFLOW_RUN_ID", "PI_WORKFLOW_STAGE_ID"]);
  });
});

describe("readWorkflowEnv", () => {
  test("returns undefined values when env vars not set", () => {
    const origRun = process.env["PI_WORKFLOW_RUN_ID"];
    const origStage = process.env["PI_WORKFLOW_STAGE_ID"];
    delete process.env["PI_WORKFLOW_RUN_ID"];
    delete process.env["PI_WORKFLOW_STAGE_ID"];
    const env = readWorkflowEnv();
    assert.equal(env.PI_WORKFLOW_RUN_ID, undefined);
    assert.equal(env.PI_WORKFLOW_STAGE_ID, undefined);
    if (origRun !== undefined) process.env["PI_WORKFLOW_RUN_ID"] = origRun;
    if (origStage !== undefined) process.env["PI_WORKFLOW_STAGE_ID"] = origStage;
  });

  test("reads env vars when set", () => {
    process.env["PI_WORKFLOW_RUN_ID"] = "run-test";
    process.env["PI_WORKFLOW_STAGE_ID"] = "stage-test";
    const env = readWorkflowEnv();
    assert.equal(env.PI_WORKFLOW_RUN_ID, "run-test");
    assert.equal(env.PI_WORKFLOW_STAGE_ID, "stage-test");
    delete process.env["PI_WORKFLOW_RUN_ID"];
    delete process.env["PI_WORKFLOW_STAGE_ID"];
  });
});

describe("emitStageStart", () => {
  test("calls pi.events.emit with workflow.stage.start", () => {
    const emitted: { event: string; payload: Record<string, unknown> }[] = [];
    const pi = {
      events: {
        emit: (event: string, payload: Record<string, unknown>) => { emitted.push({ event, payload }); },
      },
    };
    emitStageStart(pi, { runId: "r1", stageId: "s1", stageName: "scout", startedAt: 1000 });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "workflow.stage.start");
    assert.deepEqual(emitted[0].payload, { runId: "r1", stageId: "s1", stageName: "scout" }) // TODO: was toMatchObject — may need subset check;
  });

  test("no-op when pi.events absent", () => {
    assert.doesNotThrow(() => emitStageStart({}, { runId: "r", stageId: "s", stageName: "n", startedAt: 0 }));
  });
});

describe("emitStageEnd", () => {
  test("calls pi.events.emit with workflow.stage.end", () => {
    const emitted: { event: string; payload: Record<string, unknown> }[] = [];
    const pi = {
      events: {
        emit: (event: string, payload: Record<string, unknown>) => { emitted.push({ event, payload }); },
      },
    };
    emitStageEnd(pi, { runId: "r1", stageId: "s1", stageName: "scout", status: "completed", endedAt: 2000, durationMs: 1000 });
    assert.equal(emitted[0].event, "workflow.stage.end");
    assert.deepEqual(emitted[0].payload, { status: "completed", durationMs: 1000 }) // TODO: was toMatchObject — may need subset check;
  });

  test("no-op when pi.events absent", () => {
    assert.doesNotThrow(() => emitStageEnd({}, { runId: "r", stageId: "s", stageName: "n", status: "failed", endedAt: 0 }));
  });
});

describe("isSubagentsPresent", () => {
  test("returns false when subagents undefined", () => {
    assert.equal(isSubagentsPresent({}), false);
  });

  test("returns true when subagents object present", () => {
    assert.equal(isSubagentsPresent({ subagents: {} }), true);
  });

  test("returns false when subagents null", () => {
    assert.equal(isSubagentsPresent({ subagents: null }), false);
  });
});

describe("assertSubagentsPresent", () => {
  test("throws with actionable message when absent", () => {
    assert.throws(() => assertSubagentsPresent({}), { message: "pi-workflows: subagent delegation requires pi-subagents — install npm:pi-subagents and restart pi.", });
  });

  test("does not throw when present", () => {
    assert.doesNotThrow(() => assertSubagentsPresent({ subagents: {} }));
  });
});
