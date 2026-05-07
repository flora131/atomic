/**
 * Unit tests for `validateDispatchToken` (exported from auto-dispatch.ts)
 * and the module-private compiled workflow registry (`getCompiledWorkflows`).
 *
 * The argv side-effects in auto-dispatch.ts run at module load and cannot be
 * unit-tested here — subprocess dispatch is exercised end-to-end by the
 * `tests/fixtures/sdk-compiled-consumer/` smoke matrix. This file covers
 * only the pure helper functions that are safe to call in-process.
 */

import { test, expect, describe } from "bun:test";
import { validateDispatchToken } from "./auto-dispatch.ts";
import { defineWorkflow, getCompiledWorkflows } from "../define-workflow.ts";

// ─── validateDispatchToken ────────────────────────────────────────────────────

const VALID_TOKEN = "a".repeat(32);
const VALID_ENV = {
  ATOMIC_HOST: "1",
  ATOMIC_DISPATCH_TOKEN: VALID_TOKEN,
};
const VALID_ARGV = [`--dispatch-token=${VALID_TOKEN}`, "_emit-workflow-meta"];

describe("validateDispatchToken", () => {
  test("returns true when all conditions met", () => {
    expect(validateDispatchToken(VALID_ENV, VALID_ARGV)).toBe(true);
  });

  test("returns false when ATOMIC_HOST is absent", () => {
    const env = { ATOMIC_DISPATCH_TOKEN: VALID_TOKEN };
    expect(validateDispatchToken(env, VALID_ARGV)).toBe(false);
  });

  test("returns false when ATOMIC_HOST is not '1'", () => {
    const env = { ATOMIC_HOST: "0", ATOMIC_DISPATCH_TOKEN: VALID_TOKEN };
    expect(validateDispatchToken(env, VALID_ARGV)).toBe(false);
  });

  test("returns false when ATOMIC_DISPATCH_TOKEN is absent", () => {
    const env = { ATOMIC_HOST: "1" };
    expect(validateDispatchToken(env, VALID_ARGV)).toBe(false);
  });

  test("returns false when env token is too short (< 32 chars)", () => {
    const shortToken = "a".repeat(31);
    const env = { ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: shortToken };
    const argv = [`--dispatch-token=${shortToken}`];
    expect(validateDispatchToken(env, argv)).toBe(false);
  });

  test("returns false when env token has non-hex chars", () => {
    const env = { ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: "z".repeat(32) };
    const argv = [`--dispatch-token=${"z".repeat(32)}`];
    expect(validateDispatchToken(env, argv)).toBe(false);
  });

  test("returns false when --dispatch-token flag is absent from argv", () => {
    expect(validateDispatchToken(VALID_ENV, ["_emit-workflow-meta"])).toBe(false);
  });

  test("returns false when argv token is too short (< 32 chars)", () => {
    const shortToken = "a".repeat(31);
    const argv = [`--dispatch-token=${shortToken}`];
    expect(validateDispatchToken(VALID_ENV, argv)).toBe(false);
  });

  test("returns false when argv token has non-hex chars", () => {
    const argv = [`--dispatch-token=${"z".repeat(32)}`];
    expect(validateDispatchToken(VALID_ENV, argv)).toBe(false);
  });

  test("returns false when tokens do not match", () => {
    const envToken = "a".repeat(32);
    const argToken = "b".repeat(32);
    const env = { ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: envToken };
    const argv = [`--dispatch-token=${argToken}`];
    expect(validateDispatchToken(env, argv)).toBe(false);
  });

  test("returns true with exactly 32-char lowercase hex token", () => {
    const token = "0123456789abcdef".repeat(2); // 32 chars
    const env = { ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: token };
    const argv = [`--dispatch-token=${token}`];
    expect(validateDispatchToken(env, argv)).toBe(true);
  });

  test("token comparison is case-insensitive", () => {
    const lowerToken = "abcdef1234567890abcdef1234567890"; // 32 chars
    const upperToken = lowerToken.toUpperCase();
    const env = { ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: lowerToken };
    const argv = [`--dispatch-token=${upperToken}`];
    expect(validateDispatchToken(env, argv)).toBe(true);
  });

  test("token longer than 32 chars is accepted", () => {
    const longToken = "a".repeat(64);
    const env = { ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: longToken };
    const argv = [`--dispatch-token=${longToken}`];
    expect(validateDispatchToken(env, argv)).toBe(true);
  });

  test("all three conditions required — missing one always fails", () => {
    // Only ATOMIC_HOST
    expect(validateDispatchToken({ ATOMIC_HOST: "1" }, VALID_ARGV)).toBe(false);
    // Only ATOMIC_DISPATCH_TOKEN
    expect(validateDispatchToken({ ATOMIC_DISPATCH_TOKEN: VALID_TOKEN }, VALID_ARGV)).toBe(false);
    // Only argv token
    expect(validateDispatchToken({}, VALID_ARGV)).toBe(false);
  });
});

// ─── getCompiledWorkflows registry ───────────────────────────────────────────

describe("getCompiledWorkflows", () => {
  test("returns an array (may include workflows compiled elsewhere in this process)", () => {
    const result = getCompiledWorkflows();
    expect(Array.isArray(result)).toBe(true);
  });

  test("compile() registers the workflow into the in-process registry", () => {
    const uniqueName = `test-registry-workflow-${Date.now()}`;
    defineWorkflow({
      name: uniqueName,
      description: "test",
      source: import.meta.path,
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const all = getCompiledWorkflows();
    const found = all.find((d) => d.name === uniqueName && d.agent === "claude");
    expect(found).toBeDefined();
    expect(found?.description).toBe("test");
    expect(found?.source).toBe(import.meta.path);
  });

  test("compiled definition has all serializable fields", () => {
    const uniqueName = `test-meta-fields-${Date.now()}`;
    defineWorkflow({
      name: uniqueName,
      description: "meta test",
      source: import.meta.path,
      minSDKVersion: "0.7.0",
      inputs: [{ name: "topic", type: "string", required: true }],
    })
      .for("copilot")
      .run(async () => {})
      .compile();

    const all = getCompiledWorkflows();
    const found = all.find((d) => d.name === uniqueName);
    expect(found).toBeDefined();
    expect(found?.minSDKVersion).toBe("0.7.0");
    expect(found?.inputs).toHaveLength(1);
    expect(found?.inputs[0]?.name).toBe("topic");
  });

  test("returns a snapshot — mutating the result does not affect the registry", () => {
    const before = getCompiledWorkflows().length;
    const snapshot = getCompiledWorkflows() as import("../types.ts").WorkflowDefinition[];
    snapshot.push({} as import("../types.ts").WorkflowDefinition);
    const after = getCompiledWorkflows().length;
    expect(after).toBe(before);
  });
});
