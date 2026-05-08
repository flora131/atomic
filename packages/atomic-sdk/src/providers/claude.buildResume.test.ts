/**
 * Snapshot tests for buildClaudeResumeArgs.
 *
 * Verifies the exact argv array shape. Hook settings path is injected by the
 * caller (from ensureWorkflowHookSettings()) — this file exercises the pure
 * argv builder only.
 */

import { test, expect, describe } from "bun:test";
import { buildClaudeResumeArgs } from "./claude.ts";

type ClaudeMeta = Parameters<typeof buildClaudeResumeArgs>[0];

const FIXTURE_CHAT_FLAGS: string[] = [
  "--allow-dangerously-skip-permissions",
  "--dangerously-skip-permissions",
];
const FIXTURE_META: ClaudeMeta = {
  agentSessionId: "9f3a8f1d-1c0e-4b1f-9a2f-5e7d8b0e1a23",
  chatFlags: FIXTURE_CHAT_FLAGS,
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

  test("threads supplied chatFlags verbatim", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    for (const flag of FIXTURE_CHAT_FLAGS) {
      expect(args).toContain(flag);
    }
  });

  test("includes --settings flag followed by the injected path", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    const settingsIdx = args.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThan(-1);
    expect(args[settingsIdx + 1]).toBe(FIXTURE_HOOK_PATH);
  });

  test("exact structure: [--resume, <id>, ...chatFlags, --settings, <path>]", () => {
    const args = buildClaudeResumeArgs(FIXTURE_META, FIXTURE_HOOK_PATH);
    expect(args).toEqual([
      "--resume",
      FIXTURE_META.agentSessionId,
      ...FIXTURE_CHAT_FLAGS,
      "--settings",
      FIXTURE_HOOK_PATH,
    ]);
  });

  test("different agentSessionId produces different resume arg", () => {
    const args1 = buildClaudeResumeArgs(
      { agentSessionId: "uuid-aaa", chatFlags: FIXTURE_CHAT_FLAGS },
      FIXTURE_HOOK_PATH,
    );
    const args2 = buildClaudeResumeArgs(
      { agentSessionId: "uuid-bbb", chatFlags: FIXTURE_CHAT_FLAGS },
      FIXTURE_HOOK_PATH,
    );
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
