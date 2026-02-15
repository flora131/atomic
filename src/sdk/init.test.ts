/**
 * Tests for SDK initialization factory functions
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
  initClaudeOptions,
  initOpenCodeConfigOverrides,
  initCopilotSessionOptions,
  type OpenCodePermissionRule,
} from "./init.ts";

describe("initClaudeOptions", () => {
  let result: ReturnType<typeof initClaudeOptions>;

  beforeEach(() => {
    result = initClaudeOptions();
  });

  test("returns an object with expected structure", () => {
    expect(result).toBeInstanceOf(Object);
    expect(result).toHaveProperty("settingSources");
    expect(result).toHaveProperty("permissionMode");
    expect(result).toHaveProperty("allowDangerouslySkipPermissions");
  });

  test("returns settingSources with correct priority order", () => {
    expect(result.settingSources).toEqual(["local", "project", "user"]);
    expect(result.settingSources).toHaveLength(3);
  });

  test("returns bypassPermissions as permissionMode", () => {
    expect(result.permissionMode).toBe("bypassPermissions");
  });

  test("sets allowDangerouslySkipPermissions to true", () => {
    expect(result.allowDangerouslySkipPermissions).toBe(true);
  });

  test("returns a new object on each call (no singleton)", () => {
    const secondCall = initClaudeOptions();
    expect(result).not.toBe(secondCall);
    expect(result).toEqual(secondCall);
  });
});

describe("initOpenCodeConfigOverrides", () => {
  let result: OpenCodePermissionRule[];

  beforeEach(() => {
    result = initOpenCodeConfigOverrides();
  });

  test("returns an array of permission rules", () => {
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test("includes a wildcard allow rule for all permissions", () => {
    const wildcardRule = result.find(
      (rule) => rule.permission === "*" && rule.pattern === "*"
    );
    expect(wildcardRule).toBeDefined();
    expect(wildcardRule?.action).toBe("allow");
  });

  test("each rule has required properties", () => {
    for (const rule of result) {
      expect(rule).toHaveProperty("permission");
      expect(rule).toHaveProperty("pattern");
      expect(rule).toHaveProperty("action");
      expect(["allow", "deny", "ask"]).toContain(rule.action);
    }
  });

  test("returns a new array on each call (no singleton)", () => {
    const secondCall = initOpenCodeConfigOverrides();
    expect(result).not.toBe(secondCall);
    expect(result).toEqual(secondCall);
  });
});

describe("initCopilotSessionOptions", () => {
  let result: ReturnType<typeof initCopilotSessionOptions>;

  beforeEach(() => {
    result = initCopilotSessionOptions();
  });

  test("returns an object with OnPermissionRequest handler", () => {
    expect(result).toBeInstanceOf(Object);
    expect(result).toHaveProperty("OnPermissionRequest");
    expect(typeof result.OnPermissionRequest).toBe("function");
  });

  test("OnPermissionRequest returns approved kind", async () => {
    const response = await result.OnPermissionRequest();
    expect(response).toEqual({ kind: "approved" });
  });

  test("returns a new object on each call (no singleton)", async () => {
    const secondCall = initCopilotSessionOptions();
    expect(result).not.toBe(secondCall);
    // Verify both OnPermissionRequest handlers work
    const response1 = await result.OnPermissionRequest();
    const response2 = await secondCall.OnPermissionRequest();
    expect(response1).toEqual(response2);
  });
});
