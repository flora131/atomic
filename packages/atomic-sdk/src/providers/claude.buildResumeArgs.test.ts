/**
 * RFC §5.4 tests for buildClaudeResumeArgs (pure argv builder) and
 * ensureWorkflowHookSettings (side-effecting writer).
 */

import { test, expect, describe } from "bun:test";
import { statSync, readFileSync } from "node:fs";
import { buildClaudeResumeArgs, ensureWorkflowHookSettings } from "./claude.ts";

describe("buildClaudeResumeArgs — pure argv builder", () => {
  test("returns argv with injected hook path", () => {
    const meta = { agentSessionId: "uuid-fixture" };
    const hookSettingsPath = "/dev/null/fake-settings.json";
    const args = buildClaudeResumeArgs(meta, hookSettingsPath);

    const resumeIdx = args.indexOf("--resume");
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(args[resumeIdx + 1]).toBe("uuid-fixture");

    const settingsIdx = args.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThan(-1);
    expect(args[settingsIdx + 1]).toBe("/dev/null/fake-settings.json");

    // Order: --resume pair comes before --settings pair
    expect(resumeIdx).toBeLessThan(settingsIdx);
  });

  test("is referentially transparent — same inputs, same outputs, no I/O", () => {
    const meta = { agentSessionId: "uuid-fixture" };
    const hookSettingsPath = "/dev/null/fake-settings.json";

    // Non-existent path must not throw (proves no I/O)
    let args1: string[];
    let args2: string[];
    expect(() => {
      args1 = buildClaudeResumeArgs(meta, hookSettingsPath);
      args2 = buildClaudeResumeArgs(meta, hookSettingsPath);
    }).not.toThrow();

    expect(args1!).toEqual(args2!);
  });
});

describe("ensureWorkflowHookSettings — side-effecting writer", () => {
  test("writes settings file with 0o600 mode and valid JSON hook contents", () => {
    const path = ensureWorkflowHookSettings();

    const stat = statSync(path);
    expect(stat.mode & 0o777).toBe(0o600);

    const contents = readFileSync(path, "utf-8");
    const parsed = JSON.parse(contents) as { hooks?: unknown };
    expect(parsed).toHaveProperty("hooks");
  });

  test("returns same path on repeated calls (content-addressed, idempotent)", () => {
    const path1 = ensureWorkflowHookSettings();
    const path2 = ensureWorkflowHookSettings();
    expect(path1).toBe(path2);
  });
});
