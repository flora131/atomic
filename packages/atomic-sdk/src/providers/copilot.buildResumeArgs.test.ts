/**
 * RFC §5.4 tests for buildCopilotResumeArgs — empty agentSessionId guards.
 */

import { test, expect, describe } from "bun:test";
import { buildCopilotResumeArgs } from "./copilot.ts";

describe("buildCopilotResumeArgs() — empty agentSessionId guards (RFC §5.4)", () => {
  // Guard: empty string
  test('throws "empty agentSessionId on resume" when agentSessionId is empty string', () => {
    expect(() =>
      buildCopilotResumeArgs({ agentSessionId: "" }),
    ).toThrow("empty agentSessionId on resume");
  });

  // Guard: null
  test('throws "empty agentSessionId on resume" when agentSessionId is null', () => {
    expect(() =>
      buildCopilotResumeArgs({ agentSessionId: null as unknown as string }),
    ).toThrow("empty agentSessionId on resume");
  });

  // Guard: undefined / field omitted
  test('throws "empty agentSessionId on resume" when agentSessionId field is omitted', () => {
    expect(() =>
      buildCopilotResumeArgs(
        {} as Pick<{ agentSessionId: string }, "agentSessionId">,
      ),
    ).toThrow("empty agentSessionId on resume");
  });

  // RFC §5.4 §3 — no sentinel Enter token
  test("valid agentSessionId: returned args do not contain the string Enter", () => {
    const args = buildCopilotResumeArgs({ agentSessionId: "cop-session-valid-001" });
    expect(args).not.toContain("Enter");
  });
});
