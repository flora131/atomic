import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  buildModelCandidateIds,
  isRetryableModelFailure,
  validateWorkflowModels,
  WorkflowModelValidationError,
} from "../../packages/workflows/src/runs/shared/model-fallback.js";
import type { WorkflowModelInfo } from "../../packages/workflows/src/shared/types.js";

const models: readonly WorkflowModelInfo[] = [
  { provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
  { provider: "github-copilot", id: "claude-sonnet-4", fullId: "github-copilot/claude-sonnet-4" },
  { provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" },
];

describe("model fallback helpers", () => {
  test("buildModelCandidateIds preserves provider-qualified ids and de-duplicates", () => {
    assert.deepEqual(
      buildModelCandidateIds({
        primaryModel: "anthropic/claude-sonnet-4",
        fallbackModels: ["openai/gpt-5-mini", "anthropic/claude-sonnet-4"],
        currentModel: "openai/gpt-5-mini",
        availableModels: models,
      }),
      ["anthropic/claude-sonnet-4", "openai/gpt-5-mini"],
    );
  });

  test("buildModelCandidateIds resolves bare ids through preferred provider", () => {
    assert.deepEqual(
      buildModelCandidateIds({
        primaryModel: "claude-sonnet-4",
        fallbackModels: ["gpt-5-mini"],
        currentModel: "openai/gpt-5-mini",
        availableModels: models,
        preferredProvider: "github-copilot",
      }),
      ["github-copilot/claude-sonnet-4", "openai/gpt-5-mini"],
    );
  });

  test("validateWorkflowModels reports all unavailable and ambiguous models", async () => {
    await assert.rejects(
      validateWorkflowModels({
        catalog: { listModels: async () => models },
        requests: [
          { model: "claude-sonnet-4", fallbackModels: ["openai/missing-model"] },
        ],
      }),
      (err: Error) => {
        assert.ok(err instanceof WorkflowModelValidationError);
        assert.match(err.message, /claude-sonnet-4 \(ambiguous:/);
        assert.match(err.message, /openai\/missing-model \(not available\)/);
        return true;
      },
    );
  });

  test("validateWorkflowModels warns and falls back to current model when catalog is unavailable", async () => {
    const warnings = await validateWorkflowModels({
      catalog: {
        currentModel: "openai/current",
        listModels: async () => { throw new Error("registry unavailable"); },
      },
      requests: [{ model: "anthropic/primary", fallbackModels: ["openai/fallback"] }],
    });

    assert.deepEqual(warnings, [
      "workflows: model catalog unavailable; using the current selected model for fallback validation.",
    ]);
  });

  test("retry classifier accepts provider failures but rejects task failures", () => {
    assert.equal(isRetryableModelFailure("429 rate limit exceeded"), true);
    assert.equal(isRetryableModelFailure("model not found"), true);
    assert.equal(isRetryableModelFailure("command failed: bun test"), false);
    assert.equal(isRetryableModelFailure("user cancelled"), false);
  });
});
