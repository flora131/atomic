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

  test("does not treat log information/input errors as auth failures", () => {
    for (const message of [
      "failed to log information about request",
      "failed to log input before validation",
    ]) {
      const failure = classifyWorkflowFailure(new Error(message));
      assert.equal(failure.kind, "unknown");
      assert.equal(failure.userMessage, message);
      assert.equal(failure.retryable, false);
    }
  });

  test("still treats bounded log in guidance as auth failure", () => {
    const failure = classifyWorkflowFailure(new Error("Please log in to continue"));
    assert.equal(failure.kind, "auth");
    assert.equal(failure.userMessage, WORKFLOW_AUTH_FAILURE_MESSAGE);
  });

  test("does not treat generic domain/tool model errors as provider outages", () => {
    for (const message of [
      "domain model validation failed",
      "invalid model parameter passed to tool",
    ]) {
      const failure = classifyWorkflowFailure(new Error(message));
      assert.equal(failure.kind, "unknown");
      assert.equal(failure.retryable, false);
    }
  });

  test("still treats unavailable model errors as provider outages", () => {
    const failure = classifyWorkflowFailure(new Error("model unavailable"));
    assert.equal(failure.kind, "provider");
    assert.equal(failure.retryable, true);
  });

  test("does not treat generic OAuth metadata errors as auth failures", () => {
    const failure = classifyWorkflowFailure(new Error("OAuth callback metadata parse failed"));
    assert.equal(failure.kind, "unknown");
    assert.equal(failure.userMessage, "OAuth callback metadata parse failed");
  });

  test("still treats OAuth token errors as auth failures", () => {
    const failure = classifyWorkflowFailure(new Error("OAuth token expired"));
    assert.equal(failure.kind, "auth");
    assert.equal(failure.userMessage, WORKFLOW_AUTH_FAILURE_MESSAGE);
  });
});
