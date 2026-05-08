/**
 * RFC §5.4 tests for buildOpencodeResumeArgs — empty agentSessionId guards.
 */

import { test, expect, describe } from "bun:test";
import { buildOpencodeResumeArgs } from "./opencode.ts";

describe("buildOpencodeResumeArgs() — empty agentSessionId guards (RFC §5.4)", () => {
  // Guard: empty string
  test('throws "empty agentSessionId on resume" when agentSessionId is empty string', () => {
    expect(() =>
      buildOpencodeResumeArgs({ agentSessionId: "" }),
    ).toThrow("empty agentSessionId on resume");
  });

  // Guard: null
  test('throws "empty agentSessionId on resume" when agentSessionId is null', () => {
    expect(() =>
      buildOpencodeResumeArgs({ agentSessionId: null as unknown as string }),
    ).toThrow("empty agentSessionId on resume");
  });

  // Guard: undefined / field omitted
  test('throws "empty agentSessionId on resume" when agentSessionId field is omitted', () => {
    expect(() =>
      buildOpencodeResumeArgs(
        {} as Pick<{ agentSessionId: string }, "agentSessionId">,
      ),
    ).toThrow("empty agentSessionId on resume");
  });

  // RFC §5.4 §3 — no sentinel Enter token
  test("valid agentSessionId: returned args do not contain the string Enter", () => {
    const args = buildOpencodeResumeArgs({ agentSessionId: "oc-session-valid-001" });
    expect(args).not.toContain("Enter");
  });
});
