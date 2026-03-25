/**
 * Mock factory for the OpenCode SDK (`@opencode-ai/sdk/v2/client`).
 *
 * Usage:
 *   import { mockOpenCodeSDK, FakeOpenCodeSession, FakeOpenCodeClient } from "tests/test-support/mocks/sdk-opencode.ts";
 *   mockOpenCodeSDK();  // call before importing any module that depends on the SDK
 */

import { mock } from "bun:test";

// ---------------------------------------------------------------------------
// Fake Session — mirrors what OpenCode SDK returns from session.create
// ---------------------------------------------------------------------------

export class FakeOpenCodeSession {
  readonly id: string;
  readonly title: string;

  send = mock(() => Promise.resolve({ type: "text" as const, content: "fake response" }));
  stream = mock(function* fakeStream() {
    yield { type: "text" as const, content: "fake delta" };
  });
  summarize = mock(() => Promise.resolve());
  getContextUsage = mock(() =>
    Promise.resolve({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 128_000,
      usagePercentage: 0.1,
    }),
  );
  getSystemToolsTokens = mock(() => 0);
  destroy = mock(() => Promise.resolve());
  abort = mock(() => Promise.resolve());

  constructor(id = "test-session-opencode", title = "Test Session") {
    this.id = id;
    this.title = title;
  }
}

// ---------------------------------------------------------------------------
// Fake Event — mirrors the Event type from the OpenCode SDK
// ---------------------------------------------------------------------------

export interface FakeOpenCodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

export function createFakeOpenCodeEvent(
  type: string,
  properties: Record<string, unknown> = {},
): FakeOpenCodeEvent {
  return { type, properties };
}

// ---------------------------------------------------------------------------
// Fake OpencodeClient — mirrors `createOpencodeClient` return from SDK
// ---------------------------------------------------------------------------

export class FakeOpenCodeClient {
  readonly baseUrl: string;

  session = {
    create: mock((_options?: Record<string, unknown>) => Promise.resolve({ id: "fake-oc-session-id" })),
    get: mock((_sessionId: string) => Promise.resolve({ id: "fake-oc-session-id", title: "Fake" })),
    list: mock(() => Promise.resolve([])),
    chat: mock((_sessionId: string, _message: Record<string, unknown>) =>
      Promise.resolve({ id: "fake-oc-message-id" }),
    ),
    abort: mock((_sessionId: string) => Promise.resolve()),
    summarize: mock((_sessionId: string) => Promise.resolve()),
  };

  event = {
    list: mock(() => Promise.resolve([])),
    subscribe: mock(function* fakeSubscribe(): Generator<FakeOpenCodeEvent> {
      // yields nothing by default; tests can override
    }),
  };

  model = {
    list: mock(() => Promise.resolve([])),
  };

  mcp = {
    list: mock(() => Promise.resolve([])),
    register: mock(() => Promise.resolve()),
  };

  provider = {
    list: mock(() => Promise.resolve([])),
  };

  constructor(baseUrl = "http://127.0.0.1:4096") {
    this.baseUrl = baseUrl;
  }
}

// ---------------------------------------------------------------------------
// mockOpenCodeSDK — replaces the real module in Bun's module registry.
// ---------------------------------------------------------------------------

export interface MockOpenCodeSDKOptions {
  /** Provide a pre-built FakeOpenCodeClient (so tests can spy on it). */
  client?: FakeOpenCodeClient;
  /** Override the base URL used when constructing a default client. */
  baseUrl?: string;
}

/**
 * Replace `@opencode-ai/sdk/v2/client` with fakes.
 *
 * Call this **before** any module under test is imported so that Bun's
 * module resolution picks up the mock.
 */
export function mockOpenCodeSDK(options: MockOpenCodeSDKOptions = {}): void {
  const clientInstance = options.client ?? new FakeOpenCodeClient(options.baseUrl);

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: mock(() => clientInstance),
  }));
}
