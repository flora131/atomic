import { describe, expect, test } from "bun:test";

import { resolveCopilotUserInputSessionId } from "./copilot.ts";

describe("resolveCopilotUserInputSessionId", () => {
  test("keeps preferred session when it is active", () => {
    const resolved = resolveCopilotUserInputSessionId("copilot_123", [
      "copilot_001",
      "copilot_123",
    ]);

    expect(resolved).toBe("copilot_123");
  });

  test("falls back to latest active session when preferred is unknown", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", [
      "copilot_001",
      "copilot_002",
    ]);

    expect(resolved).toBe("copilot_002");
  });

  test("returns preferred session when no active sessions exist", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", []);

    expect(resolved).toBe("tentative_session");
  });
});
