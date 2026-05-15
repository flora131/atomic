/**
 * Unit tests — extension/subagents.ts
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  injectWorkflowEnv,
  readWorkflowEnv,
  emitStageStart,
  emitStageEnd,
  isSubagentsPresent,
  assertSubagentsPresent,
  WORKFLOW_RUN_ID_ENV,
  WORKFLOW_STAGE_ID_ENV,
} from "../../packages/workflows/src/extension/subagents.js";

describe("injectWorkflowEnv", () => {
  test("returns correct env vars", () => {
    const env = injectWorkflowEnv("run-abc", "stage-xyz");
    assert.equal(env[WORKFLOW_RUN_ID_ENV], "run-abc");
    assert.equal(env[WORKFLOW_STAGE_ID_ENV], "stage-xyz");
  });

  test("returns plain object (no extra keys)", () => {
    const env = injectWorkflowEnv("r1", "s1");
    assert.deepEqual(Object.keys(env).sort(), [WORKFLOW_RUN_ID_ENV, WORKFLOW_STAGE_ID_ENV].sort());
  });
});

describe("readWorkflowEnv", () => {
  test("returns undefined values when env vars not set", () => {
    const origRun = process.env[WORKFLOW_RUN_ID_ENV];
    const origStage = process.env[WORKFLOW_STAGE_ID_ENV];
    delete process.env[WORKFLOW_RUN_ID_ENV];
    delete process.env[WORKFLOW_STAGE_ID_ENV];
    const env = readWorkflowEnv();
    assert.equal(env.runId, undefined);
    assert.equal(env.stageId, undefined);
    if (origRun !== undefined) process.env[WORKFLOW_RUN_ID_ENV] = origRun;
    if (origStage !== undefined) process.env[WORKFLOW_STAGE_ID_ENV] = origStage;
  });

  test("reads env vars when set", () => {
    process.env[WORKFLOW_RUN_ID_ENV] = "run-test";
    process.env[WORKFLOW_STAGE_ID_ENV] = "stage-test";
    const env = readWorkflowEnv();
    assert.equal(env.runId, "run-test");
    assert.equal(env.stageId, "stage-test");
    delete process.env[WORKFLOW_RUN_ID_ENV];
    delete process.env[WORKFLOW_STAGE_ID_ENV];
  });
});

describe("emitStageStart", () => {
  test("calls pi.events.emit with workflow.stage.start", () => {
    const emitted: { event: string; payload: Record<string, unknown> }[] = [];
    const pi = {
      events: {
        emit: (event: string, payload: Record<string, unknown>) => {
          emitted.push({ event, payload });
        },
      },
    };
    emitStageStart(pi, { runId: "r1", stageId: "s1", stageName: "scout", startedAt: 1000 });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.event, "workflow.stage.start");
  });
});

describe("emitStageEnd", () => {
  test("calls pi.events.emit with workflow.stage.end", () => {
    const emitted: { event: string; payload: Record<string, unknown> }[] = [];
    const pi = {
      events: {
        emit: (event: string, payload: Record<string, unknown>) => {
          emitted.push({ event, payload });
        },
      },
    };
    emitStageEnd(pi, { runId: "r1", stageId: "s1", stageName: "scout", status: "completed", endedAt: 2000, durationMs: 1000 });
    assert.equal(emitted[0]?.event, "workflow.stage.end");
  });
});

describe("isSubagentsPresent", () => {
  test("returns false when callTool undefined", () => {
    assert.equal(isSubagentsPresent({}), false);
  });

  test("returns true when callTool present", () => {
    assert.equal(isSubagentsPresent({ callTool: async () => "ok" }), true);
  });
});

describe("assertSubagentsPresent", () => {
  test("throws with actionable message when absent", () => {
    assert.throws(() => assertSubagentsPresent({}), {
      message: "pi-workflows: subagent delegation requires pi task delegation support.",
    });
  });

  test("does not throw when present", () => {
    assert.doesNotThrow(() => assertSubagentsPresent({ callTool: async () => "ok" }));
  });
});
