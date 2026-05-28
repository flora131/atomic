import { afterEach, describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  checkSubagentDepth,
  getSubagentDepthEnv,
  resolveWorkflowStageMaxSubagentDepth,
  subagentDepthBlockedMessage,
  WORKFLOW_STAGE_SUBAGENT_GUARD_ENV,
} from "../../packages/subagents/src/shared/types.js";

const DEPTH_ENV = "ATOMIC_SUBAGENT_DEPTH";
const MAX_DEPTH_ENV = "ATOMIC_SUBAGENT_MAX_DEPTH";

const savedEnv = new Map<string, string | undefined>();
for (const key of [DEPTH_ENV, MAX_DEPTH_ENV, WORKFLOW_STAGE_SUBAGENT_GUARD_ENV]) {
  savedEnv.set(key, process.env[key]);
}

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("subagent workflow-stage depth guard", () => {
  test("workflow-stage context preserves stricter limits and caps defaults at one", () => {
    delete process.env[DEPTH_ENV];
    delete process.env[MAX_DEPTH_ENV];
    delete process.env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV];
    const workflowCtx = {
      orchestrationContext: {
        kind: "workflow-stage" as const,
        workflowRunId: "run-1",
        workflowStageId: "stage-1",
        workflowStageName: "Stage",
        constraints: { disableWorkflowTool: true as const, maxSubagentDepth: 0 },
      },
    };

    assert.equal(resolveWorkflowStageMaxSubagentDepth(workflowCtx, undefined), 1);
    assert.equal(resolveWorkflowStageMaxSubagentDepth(workflowCtx, 0), 0);
    assert.equal(resolveWorkflowStageMaxSubagentDepth({}, undefined), 2);
  });

  test("workflow-stage first-level subagent call is allowed", () => {
    delete process.env[DEPTH_ENV];
    delete process.env[MAX_DEPTH_ENV];
    delete process.env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV];

    const result = checkSubagentDepth(1);
    assert.equal(result.blocked, false);
    assert.equal(result.depth, 0);
    assert.equal(result.maxDepth, 1);

    const env = getSubagentDepthEnv(1, { workflowStageSubagentGuard: true });
    assert.equal(env[DEPTH_ENV], "1");
    assert.equal(env[MAX_DEPTH_ENV], "1");
    assert.equal(env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV], "1");
  });

  test("workflow-stage child env marker produces nested workflow-stage rejection message", () => {
    delete process.env[DEPTH_ENV];
    delete process.env[MAX_DEPTH_ENV];
    delete process.env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV];

    const env = getSubagentDepthEnv(1, { workflowStageSubagentGuard: true });
    assert.equal(env[DEPTH_ENV], "1");
    assert.equal(env[MAX_DEPTH_ENV], "1");
    assert.equal(env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV], "1");

    process.env[DEPTH_ENV] = env[DEPTH_ENV];
    process.env[MAX_DEPTH_ENV] = env[MAX_DEPTH_ENV];
    process.env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV] = env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV];
    const result = checkSubagentDepth();
    assert.equal(result.blocked, true);
    assert.equal(result.workflowStageGuard, true);
    assert.match(
      subagentDepthBlockedMessage(result.depth, result.maxDepth, { workflowStageGuard: true }),
      /Sub-agents inside workflow stages cannot spawn nested sub-agents/,
    );
  });
});
