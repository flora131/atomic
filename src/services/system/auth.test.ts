/**
 * Tests for the SDK-level auth probes in `auth.ts`.
 *
 * Both the Copilot SDK and Claude Agent SDK spawn native agent binaries
 * under the hood, which makes the probes unsuitable for unit tests on a
 * CI runner that has neither binary installed. We `mock.module()` each
 * SDK so the probes read from in-test fakes, then assert the wrapper's
 * translation into `AuthCheckResult` shape.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from "bun:test";

// ─── Copilot SDK fake ──────────────────────────────────────────────────────
// `CopilotClient` is a class; the constructor captures latest test state.
// We swap `start` / `stop` / `getAuthStatus` per-test via mockable fns.

interface CopilotAuthStatus {
  isAuthenticated: boolean;
  login?: string;
  statusMessage?: string;
}

let copilotStart = mock(async () => {});
let copilotStop = mock(async () => [] as unknown[]);
let copilotGetAuthStatus = mock<() => Promise<CopilotAuthStatus>>(async () => ({
  isAuthenticated: true,
  login: "octocat",
}));

class FakeCopilotClient {
  async start(): Promise<void> {
    await copilotStart();
  }
  async stop(): Promise<unknown[]> {
    return copilotStop();
  }
  async getAuthStatus(): Promise<CopilotAuthStatus> {
    return copilotGetAuthStatus();
  }
}

mock.module("@github/copilot-sdk", () => ({
  CopilotClient: FakeCopilotClient,
}));

// ─── Claude Agent SDK fake ────────────────────────────────────────────────
// `query()` returns something with `initializationResult()` and `close()`.
// We ignore the `prompt` stream — the real SDK consumes it lazily, and the
// probe only calls `initializationResult()` before closing.

interface ClaudeAccount {
  email?: string;
  tokenSource?: string;
  apiKeySource?: string;
}

let claudeInit = mock<() => Promise<{ account: ClaudeAccount }>>(async () => ({
  account: { email: "user@example.com", tokenSource: "oauth" },
}));
let claudeClose = mock(() => {});

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => ({
    initializationResult: () => claudeInit(),
    close: () => claudeClose(),
  }),
}));

// Stub the claude provider module so we don't probe PATH for `claude`.
mock.module("../../sdk/providers/claude.ts", () => ({
  resolveHeadlessClaudeBin: () => "/usr/local/bin/claude",
}));

const { checkAgentAuth } = await import("./auth.ts");

beforeEach(() => {
  copilotStart.mockClear();
  copilotStart.mockImplementation(async () => {});
  copilotStop.mockClear();
  copilotStop.mockImplementation(async () => []);
  copilotGetAuthStatus.mockClear();
  copilotGetAuthStatus.mockImplementation(async () => ({
    isAuthenticated: true,
    login: "octocat",
  }));
  claudeInit.mockClear();
  claudeInit.mockImplementation(async () => ({
    account: { email: "user@example.com", tokenSource: "oauth" },
  }));
  claudeClose.mockClear();
  claudeClose.mockImplementation(() => {});
});

describe("checkAgentAuth(copilot)", () => {
  test("returns loggedIn=true when the SDK reports isAuthenticated", async () => {
    const result = await checkAgentAuth("copilot");
    expect(result.loggedIn).toBe(true);
    expect(result.identity).toBe("octocat");
    // Hygiene: client must be stopped even on the happy path so we
    // don't leak a long-running CLI subprocess.
    expect(copilotStop).toHaveBeenCalledTimes(1);
  });

  test("returns loggedIn=false when the SDK reports isAuthenticated=false", async () => {
    copilotGetAuthStatus.mockImplementationOnce(async () => ({
      isAuthenticated: false,
      statusMessage: "no credentials on disk",
    }));
    const result = await checkAgentAuth("copilot");
    expect(result.loggedIn).toBe(false);
    expect(result.detail).toBe("no credentials on disk");
  });

  test("returns loggedIn=false when the SDK throws on start", async () => {
    copilotStart.mockImplementationOnce(async () => {
      throw new Error("CLI not installed");
    });
    const result = await checkAgentAuth("copilot");
    expect(result.loggedIn).toBe(false);
    expect(result.detail).toContain("CLI not installed");
  });

  test("swallows errors from stop() on the failure path", async () => {
    copilotGetAuthStatus.mockImplementationOnce(async () => {
      throw new Error("auth probe failed");
    });
    copilotStop.mockImplementationOnce(async () => {
      throw new Error("stop crashed");
    });
    const result = await checkAgentAuth("copilot");
    expect(result.loggedIn).toBe(false);
    expect(result.detail).toContain("auth probe failed");
    // The stop failure must not shadow the probe result.
    expect(result.detail).not.toContain("stop crashed");
  });
});

describe("checkAgentAuth(claude)", () => {
  test("returns loggedIn=true when initializationResult has account email", async () => {
    const result = await checkAgentAuth("claude");
    expect(result.loggedIn).toBe(true);
    expect(result.identity).toBe("user@example.com");
    expect(claudeClose).toHaveBeenCalledTimes(1);
  });

  test("returns loggedIn=true when only tokenSource is populated", async () => {
    claudeInit.mockImplementationOnce(async () => ({
      account: { tokenSource: "oauth" },
    }));
    const result = await checkAgentAuth("claude");
    expect(result.loggedIn).toBe(true);
  });

  test("returns loggedIn=true when only apiKeySource is populated", async () => {
    claudeInit.mockImplementationOnce(async () => ({
      account: { apiKeySource: "env" },
    }));
    const result = await checkAgentAuth("claude");
    expect(result.loggedIn).toBe(true);
  });

  test("returns loggedIn=false when account is empty", async () => {
    claudeInit.mockImplementationOnce(async () => ({ account: {} }));
    const result = await checkAgentAuth("claude");
    expect(result.loggedIn).toBe(false);
  });

  test("returns loggedIn=false when initializationResult throws", async () => {
    claudeInit.mockImplementationOnce(async () => {
      throw new Error("subprocess init failed — check authentication");
    });
    const result = await checkAgentAuth("claude");
    expect(result.loggedIn).toBe(false);
    expect(result.detail).toContain("subprocess init failed");
  });
});

describe("checkAgentAuth(opencode)", () => {
  test("is a no-op — returns loggedIn=true without probing the SDK", async () => {
    // OpenCode handles auth interactively on first use; there's no
    // equivalent RPC probe, so the wrapper short-circuits.
    const result = await checkAgentAuth("opencode");
    expect(result.loggedIn).toBe(true);
    // Confirm neither SDK fake was touched.
    expect(copilotStart).not.toHaveBeenCalled();
    expect(claudeInit).not.toHaveBeenCalled();
  });
});
