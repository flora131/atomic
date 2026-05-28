import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  buildModelCandidates,
  currentModelFullId,
} from "../../packages/subagents/src/runs/shared/model-fallback.js";
import type { AvailableModelInfo } from "../../packages/subagents/src/runs/shared/model-fallback.js";

const models: AvailableModelInfo[] = [
  { provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
  { provider: "anthropic", id: "claude-opus-4-8", fullId: "anthropic/claude-opus-4-8" },
  { provider: "github-copilot", id: "claude-sonnet-4", fullId: "github-copilot/claude-sonnet-4" },
  { provider: "github-copilot", id: "claude-opus-4.7", fullId: "github-copilot/claude-opus-4.7" },
  { provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" },
];

describe("subagent model fallback helpers", () => {
  test("appends the current selected model after configured fallbacks", () => {
    assert.deepEqual(
      buildModelCandidates(
        "anthropic/primary",
        ["openai/fallback"],
        models,
        "github-copilot",
        "github-copilot/claude-sonnet-4",
      ),
      ["anthropic/primary", "openai/fallback", "github-copilot/claude-sonnet-4"],
    );
  });

  test("de-duplicates the current selected model when already attempted", () => {
    assert.deepEqual(
      buildModelCandidates(
        "claude-sonnet-4",
        ["openai/gpt-5-mini"],
        models,
        "github-copilot",
        "github-copilot/claude-sonnet-4",
      ),
      ["github-copilot/claude-sonnet-4", "openai/gpt-5-mini"],
    );
  });

  test("normalizes Anthropic Opus 4.8 with existing Copilot Opus 4.7 fallback", () => {
    assert.deepEqual(
      buildModelCandidates(
        "claude-opus-4-8",
        ["github-copilot/claude-opus-4.7"],
        models,
        "anthropic",
        "openai/gpt-5-mini",
      ),
      ["anthropic/claude-opus-4-8", "github-copilot/claude-opus-4.7", "openai/gpt-5-mini"],
    );
  });

  test("formats the selected model from the runtime model object", () => {
    assert.equal(
      currentModelFullId({ provider: "openai", id: "gpt-5-mini" }),
      "openai/gpt-5-mini",
    );
  });
});
