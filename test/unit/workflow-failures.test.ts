/**
 * Unit tests for workflow-local failure classification.
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_AUTH_FAILURE_MESSAGE,
  classifyWorkflowFailure,
} from "../../packages/workflows/src/shared/workflow-failures.js";

describe("classifyWorkflowFailure", () => {
  test("normalizes auth/no-key failures to workflow login guidance", () => {
    const failure = classifyWorkflowFailure(new Error("No API key found for provider"));
    assert.equal(failure.kind, "auth");
    assert.equal(failure.userMessage, WORKFLOW_AUTH_FAILURE_MESSAGE);
    assert.equal(failure.message, "No API key found for provider");
    assert.equal(failure.retryable, true);
    assert.equal(failure.resumable, true);
  });

  test("classifies 429/quota failures as resumable rate limits", () => {
    const failure = classifyWorkflowFailure(new Error("HTTP 429 quota exceeded"));
    assert.equal(failure.kind, "rate_limit");
    assert.equal(failure.userMessage, "HTTP 429 quota exceeded");
    assert.equal(failure.retryable, true);
    assert.equal(failure.resumable, true);
  });

  test("classifies abort errors as non-resumable cancellation", () => {
    const failure = classifyWorkflowFailure(new DOMException("workflow killed", "AbortError"));
    assert.equal(failure.kind, "cancelled");
    assert.equal(failure.retryable, false);
    assert.equal(failure.resumable, false);
  });

  test("classifies provider/model outages separately from auth", () => {
    const failure = classifyWorkflowFailure(new Error("model provider service unavailable"));
    assert.equal(failure.kind, "provider");
    assert.equal(failure.retryable, true);
    assert.equal(failure.resumable, true);
  });
});
