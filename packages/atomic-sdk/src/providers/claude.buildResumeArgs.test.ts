/**
 * RFC §5.4 tests for buildClaudeResumeArgs (pure argv builder) and
 * ensureWorkflowHookSettings (side-effecting writer).
 */

import { test, expect, describe } from "bun:test";
import { statSync, readFileSync } from "node:fs";
import { buildClaudeResumeArgs, ensureWorkflowHookSettings } from "./claude.ts";

type ClaudeMeta = Parameters<typeof buildClaudeResumeArgs>[0];
function meta(agentSessionId: string, chatFlags: string[] = []): ClaudeMeta {
  return { agentSessionId, chatFlags };
}

describe("buildClaudeResumeArgs — pure argv builder", () => {
  test("returns argv with injected hook path", () => {
    const hookSettingsPath = "/dev/null/fake-settings.json";
    const args = buildClaudeResumeArgs(meta("uuid-fixture"), hookSettingsPath);

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
    const hookSettingsPath = "/dev/null/fake-settings.json";

    // Non-existent path must not throw (proves no I/O)
    let args1: string[];
    let args2: string[];
    expect(() => {
      args1 = buildClaudeResumeArgs(meta("uuid-fixture"), hookSettingsPath);
      args2 = buildClaudeResumeArgs(meta("uuid-fixture"), hookSettingsPath);
    }).not.toThrow();

    expect(args1!).toEqual(args2!);
  });

  // RFC §5.4 — empty agentSessionId guards
  test('throws "empty agentSessionId on resume" when agentSessionId is empty string', () => {
    expect(() =>
      buildClaudeResumeArgs(meta(""), "/dev/null/fake-settings.json"),
    ).toThrow("empty agentSessionId on resume");
  });

  test('throws "empty agentSessionId on resume" when agentSessionId is null', () => {
    expect(() =>
      buildClaudeResumeArgs(
        { agentSessionId: null as unknown as string, chatFlags: [] },
        "/dev/null/fake-settings.json",
      ),
    ).toThrow("empty agentSessionId on resume");
  });

  // RFC §5.4 §3 — no sentinel Enter token in valid resume args
  test("valid agentSessionId: returned args do not contain the string Enter", () => {
    const args = buildClaudeResumeArgs(meta("uuid-fixture"), "/dev/null/fake-settings.json");
    expect(args).not.toContain("Enter");
  });

  // RFC §5.4 — chatFlags threading

  test("chatFlags: [] (empty array) produces no extra flags between resume id and --settings", () => {
    const args = buildClaudeResumeArgs(meta("abc-123", []), "/hooks.json");
    expect(args).toEqual(["--resume", "abc-123", "--settings", "/hooks.json"]);
  });

  test("chatFlags: ['--model', 'opus'] → flags appear between resume id and --settings", () => {
    const args = buildClaudeResumeArgs(meta("abc-123", ["--model", "opus"]), "/hooks.json");
    expect(args).toEqual([
      "--resume",
      "abc-123",
      "--model",
      "opus",
      "--settings",
      "/hooks.json",
    ]);
  });

  test("chatFlags: ['--add-dir', '/some/path'] → preserved verbatim", () => {
    const args = buildClaudeResumeArgs(
      meta("abc-123", ["--add-dir", "/some/path"]),
      "/hooks.json",
    );
    expect(args).toEqual([
      "--resume",
      "abc-123",
      "--add-dir",
      "/some/path",
      "--settings",
      "/hooks.json",
    ]);
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
