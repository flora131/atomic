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
      message: "pi-workflows: subagent delegation requires oh-my-pi task delegation support.",
    });
  });

  test("does not throw when present", () => {
    assert.doesNotThrow(() => assertSubagentsPresent({ callTool: async () => "ok" }));
  });
});
