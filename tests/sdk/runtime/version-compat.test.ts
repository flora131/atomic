import { describe, test, expect } from "bun:test";
import {
  compareVersions,
  satisfiesMinVersion,
} from "../../../src/sdk/runtime/version-compat.ts";

describe("compareVersions", () => {
  test("compares major versions", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
  });

  test("compares minor versions when major matches", () => {
    expect(compareVersions("1.1.0", "1.2.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(0);
  });

  test("compares patch versions when major and minor match", () => {
    expect(compareVersions("1.0.1", "1.0.2")).toBeLessThan(0);
    expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
  });

  test("returns 0 for identical versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.5.21-0", "0.5.21-0")).toBe(0);
  });

  test("prerelease ranks below the equivalent stable release", () => {
    // Per semver, 1.0.0 > 1.0.0-0 — a declared minSDKVersion of 1.0.0
    // should NOT be satisfied by a prerelease of the same triple.
    expect(compareVersions("1.0.0", "1.0.0-0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-0", "1.0.0")).toBeLessThan(0);
  });

  test("prerelease strings compare lexicographically", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-2", "1.0.0-10")).toBeGreaterThan(0);
  });

  test("treats unparseable versions as equal (graceful fallback)", () => {
    // A typo in minSDKVersion must not block the workflow — the visible
    // load error path is friendlier than a hard refusal with no context.
    expect(compareVersions("not-a-version", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "garbage")).toBe(0);
  });
});

describe("satisfiesMinVersion", () => {
  test("null / undefined requirement always satisfies", () => {
    // The "opt-in" contract: workflows that omit minSDKVersion are
    // treated as compatible with every CLI release.
    expect(satisfiesMinVersion("0.1.0", null)).toBe(true);
    expect(satisfiesMinVersion("0.1.0", undefined)).toBe(true);
  });

  test("satisfies when current >= required", () => {
    expect(satisfiesMinVersion("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesMinVersion("2.0.0", "1.5.0")).toBe(true);
    expect(satisfiesMinVersion("0.6.0", "0.5.0")).toBe(true);
  });

  test("does not satisfy when current < required", () => {
    expect(satisfiesMinVersion("0.5.21-0", "0.6.0")).toBe(false);
    expect(satisfiesMinVersion("1.0.0-0", "1.0.0")).toBe(false);
  });
});
