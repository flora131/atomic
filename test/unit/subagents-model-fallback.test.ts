import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  buildModelCandidates,
  currentModelFullId,
  isRetryableModelFailure,
  modelFailureMessage,
  normalizeModelFailureSignal,
} from "../../packages/subagents/src/runs/shared/model-fallback.js";
import type { AvailableModelInfo } from "../../packages/subagents/src/runs/shared/model-fallback.js";

const models: AvailableModelInfo[] = [
  { provider: "anthropic", id: "claude-sonnet-4", fullId: "anthropic/claude-sonnet-4" },
  { provider: "github-copilot", id: "claude-sonnet-4", fullId: "github-copilot/claude-sonnet-4" },
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

  test("formats the selected model from the runtime model object", () => {
    assert.equal(
      currentModelFullId({ provider: "openai", id: "gpt-5-mini" }),
      "openai/gpt-5-mini",
    );
  });

  test("retry classifier uses structured diagnostics before localized text", () => {
    const failure = {
      role: "assistant",
      stopReason: "error",
      errorMessage: "プロバイダー エラー",
      diagnostics: [{ error: { code: 429, message: "quota exhausted" } }],
    };

    assert.equal(normalizeModelFailureSignal(failure).kind, "rate_limit");
    assert.equal(isRetryableModelFailure(failure), true);
    assert.equal(isRetryableModelFailure({
      message: "localized wrapper",
      diagnostics: [{ error: { message: "service unavailable" } }],
    }), true);
  });

  test("retry classifier uses status, code, name, and causes", () => {
    assert.equal(isRetryableModelFailure({ status: 503, message: "localized" }), true);
    assert.equal(isRetryableModelFailure({ statusCode: 401, message: "localized" }), true);
    assert.equal(isRetryableModelFailure({ httpStatus: 403, message: "localized" }), true);
    assert.equal(isRetryableModelFailure({ code: "invalid_api_key", message: "localized" }), true);
    assert.equal(isRetryableModelFailure(new Error("outer", { cause: { code: "overloaded" } })), true);
  });

  test("assistant stopReason error without an errorMessage is fallbackable", () => {
    const failure = { role: "assistant", stopReason: "error", diagnostics: [] };

    assert.equal(modelFailureMessage(failure), "Assistant message ended with stopReason:error");
    assert.equal(normalizeModelFailureSignal(failure).kind, "provider_unavailable");
    assert.equal(isRetryableModelFailure(failure), true);
  });

  test("retry classifier refuses aborted and task failures", () => {
    assert.equal(isRetryableModelFailure({ stopReason: "aborted", status: 503 }), false);
    assert.equal(isRetryableModelFailure({ name: "AbortError", status: 503, message: "aborted" }), false);
    assert.equal(isRetryableModelFailure({ status: 503, message: "shell command failed" }), false);
    assert.equal(isRetryableModelFailure("completion guard failed after 429"), false);
    assert.equal(isRetryableModelFailure("command failed: bun test"), false);
  });
});
