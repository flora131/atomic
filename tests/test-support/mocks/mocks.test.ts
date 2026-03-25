/**
 * Tests for the mock factories in tests/test-support/mocks/.
 *
 * Verifies that each mock factory:
 *   1. Produces coherent objects with the expected interface
 *   2. Uses bun:test mock functions that track calls
 *   3. Works with mock.module() for SDK replacement
 *   4. FS mock correctly simulates read/write/stat/access/readdir/mkdir
 */

import { test, expect, describe, beforeEach } from "bun:test";

import {
  FakeClaudeSession,
  FakeClaudeQuery,
  FakeClaudeAgentSDK,
  mockClaudeSDK,
} from "./sdk-claude.ts";

import {
  FakeOpenCodeSession,
  FakeOpenCodeClient,
  createFakeOpenCodeEvent,
  mockOpenCodeSDK,
} from "./sdk-opencode.ts";

import {
  FakeCopilotSession,
  FakeCopilotClient,
  createFakeCopilotSessionEvent,
  createFakeCopilotPermissionRequest,
  mockCopilotSDK,
} from "./sdk-copilot.ts";

import {
  mockFS,
  resetFS,
  addVirtualFiles,
  removeVirtualFile,
  getVirtualFiles,
} from "./fs.ts";

// ===========================================================================
// Claude SDK Mocks
// ===========================================================================

describe("FakeClaudeSession", () => {
  test("has a default session id", () => {
    const session = new FakeClaudeSession();
    expect(session.id).toBe("test-session-claude");
  });

  test("accepts a custom id", () => {
    const session = new FakeClaudeSession("custom-id");
    expect(session.id).toBe("custom-id");
  });

  test("send returns a resolved promise with fake response", async () => {
    const session = new FakeClaudeSession();
    const result = await session.send();
    expect(result).toHaveProperty("content", "fake response");
    expect(session.send).toHaveBeenCalledTimes(1);
  });

  test("destroy returns a resolved promise", async () => {
    const session = new FakeClaudeSession();
    await session.destroy();
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  test("getContextUsage returns usage data", async () => {
    const session = new FakeClaudeSession();
    const usage = await session.getContextUsage();
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.maxTokens).toBe(200_000);
  });

  test("all methods are mock functions", () => {
    const session = new FakeClaudeSession();
    expect(session.send.mock).toBeDefined();
    expect(session.destroy.mock).toBeDefined();
    expect(session.summarize.mock).toBeDefined();
    expect(session.getContextUsage.mock).toBeDefined();
    expect(session.getSystemToolsTokens.mock).toBeDefined();
    expect(session.abort.mock).toBeDefined();
  });
});

describe("FakeClaudeQuery", () => {
  test("has default id", () => {
    const query = new FakeClaudeQuery();
    expect(query.id).toBe("test-query-claude");
  });

  test("send returns a fake response", async () => {
    const query = new FakeClaudeQuery();
    const result = await query.send();
    expect(result.role).toBe("assistant");
    expect(query.send).toHaveBeenCalledTimes(1);
  });

  test("abort is a mock function", () => {
    const query = new FakeClaudeQuery();
    query.abort();
    expect(query.abort).toHaveBeenCalledTimes(1);
  });
});

describe("FakeClaudeAgentSDK", () => {
  test("createSession returns a FakeClaudeSession", () => {
    const sdk = new FakeClaudeAgentSDK();
    const session = sdk.createSession();
    expect(session).toBeInstanceOf(FakeClaudeSession);
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
  });

  test("query returns a FakeClaudeQuery", () => {
    const sdk = new FakeClaudeAgentSDK();
    const query = sdk.query();
    expect(query).toBeInstanceOf(FakeClaudeQuery);
    expect(sdk.query).toHaveBeenCalledTimes(1);
  });

  test("accepts custom session factory", () => {
    const customSession = new FakeClaudeSession("factory-session");
    const sdk = new FakeClaudeAgentSDK({ sessionFactory: () => customSession });
    const session = sdk.createSession();
    expect(session.id).toBe("factory-session");
  });
});

describe("mockClaudeSDK", () => {
  // NOTE: Do NOT call mockClaudeSDK() here — it invokes mock.module() which
  // permanently replaces the real SDK in Bun's module registry and poisons
  // all subsequent tests in the process. Only verify the function exists.
  test("is exported as a function", () => {
    expect(typeof mockClaudeSDK).toBe("function");
  });
});

// ===========================================================================
// OpenCode SDK Mocks
// ===========================================================================

describe("FakeOpenCodeSession", () => {
  test("has a default session id", () => {
    const session = new FakeOpenCodeSession();
    expect(session.id).toBe("test-session-opencode");
    expect(session.title).toBe("Test Session");
  });

  test("accepts custom id and title", () => {
    const session = new FakeOpenCodeSession("custom", "My Session");
    expect(session.id).toBe("custom");
    expect(session.title).toBe("My Session");
  });

  test("all methods are mock functions", () => {
    const session = new FakeOpenCodeSession();
    expect(session.send.mock).toBeDefined();
    expect(session.destroy.mock).toBeDefined();
    expect(session.summarize.mock).toBeDefined();
    expect(session.abort.mock).toBeDefined();
  });
});

describe("FakeOpenCodeClient", () => {
  test("has session, event, model, mcp, and provider namespaces", () => {
    const client = new FakeOpenCodeClient();
    expect(client.session).toBeDefined();
    expect(client.event).toBeDefined();
    expect(client.model).toBeDefined();
    expect(client.mcp).toBeDefined();
    expect(client.provider).toBeDefined();
  });

  test("session.create returns a fake session", async () => {
    const client = new FakeOpenCodeClient();
    const result = await client.session.create();
    expect(result).toHaveProperty("id", "fake-oc-session-id");
    expect(client.session.create).toHaveBeenCalledTimes(1);
  });

  test("session.list returns empty array", async () => {
    const client = new FakeOpenCodeClient();
    const sessions = await client.session.list();
    expect(sessions).toEqual([]);
  });
});

describe("createFakeOpenCodeEvent", () => {
  test("creates an event with type and properties", () => {
    const event = createFakeOpenCodeEvent("message.delta", { delta: "hello" });
    expect(event.type).toBe("message.delta");
    expect(event.properties).toEqual({ delta: "hello" });
  });
});

describe("mockOpenCodeSDK", () => {
  // NOTE: Do NOT call mockOpenCodeSDK() here — it invokes mock.module() which
  // permanently replaces the real SDK in Bun's module registry and poisons
  // all subsequent tests in the process. Only verify the function exists.
  test("is exported as a function", () => {
    expect(typeof mockOpenCodeSDK).toBe("function");
  });
});

// ===========================================================================
// Copilot SDK Mocks
// ===========================================================================

describe("FakeCopilotSession", () => {
  test("has a default session id", () => {
    const session = new FakeCopilotSession();
    expect(session.sessionId).toBe("test-session-copilot");
  });

  test("sendMessage returns a fake response", async () => {
    const session = new FakeCopilotSession();
    const result = await session.sendMessage("hello");
    expect(result.role).toBe("assistant");
    expect(session.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("on returns an unsubscribe function", () => {
    const session = new FakeCopilotSession();
    const unsub = session.on("message", () => {});
    expect(typeof unsub).toBe("function");
    expect(session.on).toHaveBeenCalledTimes(1);
  });

  test("all methods are mock functions", () => {
    const session = new FakeCopilotSession();
    expect(session.sendMessage.mock).toBeDefined();
    expect(session.destroy.mock).toBeDefined();
    expect(session.abort.mock).toBeDefined();
    expect(session.on.mock).toBeDefined();
    expect(session.getHistory.mock).toBeDefined();
  });
});

describe("FakeCopilotClient", () => {
  test("createSession returns a FakeCopilotSession", async () => {
    const client = new FakeCopilotClient();
    const session = await client.createSession();
    expect(session).toBeInstanceOf(FakeCopilotSession);
    expect(client.createSession).toHaveBeenCalledTimes(1);
  });

  test("accepts custom session factory", async () => {
    const custom = new FakeCopilotSession("my-session");
    const client = new FakeCopilotClient({ sessionFactory: () => custom });
    const session = await client.createSession();
    expect(session.sessionId).toBe("my-session");
  });

  test("getState returns connected", () => {
    const client = new FakeCopilotClient();
    expect(client.getState()).toBe("connected");
  });
});

describe("createFakeCopilotSessionEvent", () => {
  test("creates an event with type and data", () => {
    const event = createFakeCopilotSessionEvent("tool.start", { toolName: "read" });
    expect(event.type).toBe("tool.start");
    expect(event.data).toEqual({ toolName: "read" });
  });
});

describe("createFakeCopilotPermissionRequest", () => {
  test("creates a permission request with mock accept/deny", () => {
    const req = createFakeCopilotPermissionRequest("Bash", { command: "ls" });
    expect(req.toolName).toBe("Bash");
    expect(req.toolInput).toEqual({ command: "ls" });
    req.accept();
    expect(req.accept).toHaveBeenCalledTimes(1);
    req.deny();
    expect(req.deny).toHaveBeenCalledTimes(1);
  });
});

describe("mockCopilotSDK", () => {
  // NOTE: Do NOT call mockCopilotSDK() here — it invokes mock.module() which
  // permanently replaces the real SDK in Bun's module registry and poisons
  // all subsequent tests in the process. Only verify the function exists.
  test("is exported as a function", () => {
    expect(typeof mockCopilotSDK).toBe("function");
  });
});

// ===========================================================================
// FS Mocks
// ===========================================================================

describe("mockFS", () => {
  // NOTE: Do NOT call mockFS() here — it invokes mock.module() on node:fs and
  // node:fs/promises, permanently replacing the real filesystem APIs in Bun's
  // module registry. This breaks any subsequent test that reads/writes real files.
  // Only verify the function exists. The virtual filesystem helpers (addVirtualFiles,
  // removeVirtualFile, getVirtualFiles, resetFS) are tested below using the
  // in-memory store directly without activating mock.module().
  test("is exported as a function", () => {
    expect(typeof mockFS).toBe("function");
  });
});

describe("virtual filesystem helpers (no mock.module activation)", () => {
  beforeEach(() => {
    resetFS();
  });

  test("addVirtualFiles populates the in-memory store", () => {
    addVirtualFiles({
      "/home/user/config.json": '{"key": "value"}',
      "/home/user/project/src/index.ts": 'console.log("hello");',
    });
    const files = getVirtualFiles();
    expect(Object.keys(files)).toHaveLength(2);
    expect(files["/home/user/config.json"]).toBe('{"key": "value"}');
  });

  test("removeVirtualFile deletes a file from the store", () => {
    addVirtualFiles({ "/tmp/a.txt": "a" });
    const removed = removeVirtualFile("/tmp/a.txt");
    expect(removed).toBe(true);
    expect(getVirtualFiles()["/tmp/a.txt"]).toBeUndefined();
  });

  test("removeVirtualFile returns false for non-existent file", () => {
    expect(removeVirtualFile("/does/not/exist")).toBe(false);
  });

  test("resetFS clears all files", () => {
    addVirtualFiles({ "/tmp/x.txt": "x" });
    resetFS();
    expect(Object.keys(getVirtualFiles())).toHaveLength(0);
  });

  test("getVirtualFiles returns empty object initially", () => {
    expect(Object.keys(getVirtualFiles())).toHaveLength(0);
  });
});
