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
  beforeAll,
  afterAll,
  mock,
} from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// `mock.module` is process-global in Bun and leaks across every test file
// loaded in the same run — live ESM bindings in other files rebind to the
// stub as soon as it registers, and re-registering with the real module in
// `afterAll` does not restore the original namespace identity. Capture the
// real SDK modules first, install the mocks only while this file's tests
// are running, and never mock `claude.ts` (other test files exercise its
// real exports). All consumers in `auth.ts` use dynamic `await import(...)`,
// so lazy mock registration is safe here.
const actualCopilotSdk = await import("@github/copilot-sdk");
const actualClaudeSdk = await import("@anthropic-ai/claude-agent-sdk");

// Put a fake `claude` binary on PATH so `resolveHeadlessClaudeBin()` (called
// by `checkClaudeAuth`) succeeds without hitting the real CLI on disk. The
// mocked SDK `query()` never actually spawns the subprocess — the path is
// only passed through to the SDK constructor.
let pathBefore: string | undefined;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "atomic-auth-test-path-"));
  const bin = join(dir, "claude");
  writeFileSync(bin, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(bin, 0o755);
  pathBefore = process.env.PATH;
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;

  mock.module("@github/copilot-sdk", () => ({
    ...actualCopilotSdk,
    CopilotClient: FakeCopilotClient,
  }));
  mock.module("@anthropic-ai/claude-agent-sdk", () => ({
    ...actualClaudeSdk,
    query: () => ({
      initializationResult: () => claudeInit(),
      close: () => claudeClose(),
    }),
  }));
});

afterAll(() => {
  if (pathBefore === undefined) delete process.env.PATH;
  else process.env.PATH = pathBefore;
  mock.module("@github/copilot-sdk", () => ({ ...actualCopilotSdk }));
  mock.module("@anthropic-ai/claude-agent-sdk", () => ({ ...actualClaudeSdk }));
});

const { checkAgentAuth, printAuthError } = await import("./auth.ts");

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

describe("printAuthError", () => {
  function captureStderr(): {
    output: () => string;
    restore: () => void;
  } {
    const chunks: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((c: string | Uint8Array) => {
      chunks.push(typeof c === "string" ? c : new TextDecoder().decode(c));
      return true;
    }) as typeof process.stderr.write;
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      chunks.push(args.map((a) => String(a)).join(" ") + "\n");
    };
    return {
      output: () => chunks.join(""),
      restore: () => {
        process.stderr.write = orig;
        console.error = origErr;
      },
    };
  }

  test("prints the Claude login hint with optional detail line", () => {
    const cap = captureStderr();
    try {
      printAuthError("claude", { loggedIn: false, detail: "token expired" });
      const out = cap.output();
      expect(out).toContain("Not logged in to Claude Code");
      expect(out).toContain("token expired");
      expect(out).toContain("/login");
    } finally {
      cap.restore();
    }
  });

  test("omits the detail line when no detail is given", () => {
    const cap = captureStderr();
    try {
      printAuthError("copilot", { loggedIn: false });
      const out = cap.output();
      expect(out).toContain("Not logged in to GitHub Copilot CLI");
      expect(out).toContain("`/login`");
    } finally {
      cap.restore();
    }
  });

  test("prints the OpenCode login hint", () => {
    const cap = captureStderr();
    try {
      printAuthError("opencode", { loggedIn: false });
      const out = cap.output();
      expect(out).toContain("Not logged in to OpenCode");
      expect(out).toContain("opencode auth login");
    } finally {
      cap.restore();
    }
  });
});
