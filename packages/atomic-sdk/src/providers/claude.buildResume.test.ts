/**
 * Snapshot tests for buildClaudeResumeArgs.
 *
 * Verifies the exact argv array shape. Hook settings path is injected by the
 * caller (from ensureWorkflowHookSettings()) — this file exercises the pure
 * argv builder only.
 */

import { test, expect, describe } from "bun:test";
import { buildClaudeResumeArgs } from "./claude.ts";

const FIXTURE_META = {
  agentSessionId: "9f3a8f1d-1c0e-4b1f-9a2f-5e7d8b0e1a23",
};
const FIXTURE_HOOK_PATH = "/dev/null/fake-settings.json";

describe("buildClaudeResumeArgs()", () => {
  test("returns array with --resume flag at index 0", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    expect(args[0]).toBe("--resume");
  });

  test("places agentSessionId at index 1", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    expect(args[1]).toBe(FIXTURE_META.agentSessionId);
  });

  test("includes --allow-dangerously-skip-permissions flag", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    expect(args).toContain("--allow-dangerously-skip-permissions");
  });

  test("includes --dangerously-skip-permissions flag", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    expect(args).toContain("--dangerously-skip-permissions");
  });

  test("includes --settings flag followed by the injected path", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    const settingsIdx = args.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThan(-1);
    expect(args[settingsIdx + 1]).toBe(FIXTURE_HOOK_PATH);
  });

  test("exact structure: [--resume, <id>, ...chatFlags, --settings, <path>]", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    expect(args.slice(0, 2)).toEqual(["--resume", FIXTURE_META.agentSessionId]);
    const lastTwo = args.slice(-2);
    expect(lastTwo[0]).toBe("--settings");
    expect(lastTwo[1]).toBe(FIXTURE_HOOK_PATH);
    // Total length: 2 (resume) + 2 (chatFlags) + 2 (settings) = 6
    expect(args).toHaveLength(6);
  });

  test("different agentSessionId produces different resume arg", () => {
    const args1 = buildClaudeResumeArgs({ agentSessionId: "uuid-aaa" }, FIXTURE_HOOK_PATH);
    const args2 = buildClaudeResumeArgs({ agentSessionId: "uuid-bbb" }, FIXTURE_HOOK_PATH);
    expect(args1[1]).toBe("uuid-aaa");
    expect(args2[1]).toBe("uuid-bbb");
  });

  test("injected hook path reflected verbatim in --settings position", () => {
    const customPath = "/tmp/my-settings-abc123.json";
    const args = buildClaudeResumeArgs(FIXTURE_META, customPath);
    const settingsIdx = args.indexOf("--settings");
    expect(args[settingsIdx + 1]).toBe(customPath);
  });
});
