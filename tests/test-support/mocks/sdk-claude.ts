/**
 * Mock factory for the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * Usage:
 *   import { mockClaudeSDK, FakeClaudeSession, FakeClaudeQuery } from "tests/test-support/mocks/sdk-claude.ts";
 *   mockClaudeSDK();  // call before importing any module that depends on the SDK
 */

import { mock } from "bun:test";

// ---------------------------------------------------------------------------
// Fake Session — mirrors the Session interface that wrapClaudeQuerySession
// and other internal callers depend on.
// ---------------------------------------------------------------------------

export class FakeClaudeSession {
  readonly id: string;

  send = mock(() => Promise.resolve({ type: "text" as const, content: "fake response", role: "assistant" as const }));
  stream = mock(function* fakeStream() {
    yield { type: "text" as const, content: "fake delta", role: "assistant" as const };
  });
  summarize = mock(() => Promise.resolve());
  getContextUsage = mock(() =>
    Promise.resolve({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 200_000,
      usagePercentage: 0.075,
    }),
  );
  getSystemToolsTokens = mock(() => 0);
  getCompactionState = mock(() => null);
  getMcpSnapshot = mock(() => Promise.resolve(null));
  destroy = mock(() => Promise.resolve());
  abort = mock(() => Promise.resolve());

  constructor(id = "test-session-claude") {
    this.id = id;
  }
}

// ---------------------------------------------------------------------------
// Fake Query — mirrors the Query class from the Claude Agent SDK.
// A Query represents an ongoing interaction; the real ClaudeAgentClient
// wraps it into a Session via `wrapClaudeQuerySession`.
// ---------------------------------------------------------------------------

export class FakeClaudeQuery {
  readonly id: string;

  /** Simulates SDK's `query.send()` */
  send = mock(() => Promise.resolve({ role: "assistant", content: "fake-query-response" }));

  /** Simulates SDK's `query.abort()` */
  abort = mock(() => {});

  /**
   * Simulates the messages emitted during a query.
   * SDK messages typically arrive via a callback provided to `new Query(options)`.
   */
  messages: Array<Record<string, unknown>> = [];

  constructor(id = "test-query-claude") {
    this.id = id;
  }
}

// ---------------------------------------------------------------------------
// Fake top-level SDK class — the entrypoint that consumers `new ClaudeAgentSDK()`
// ---------------------------------------------------------------------------

export class FakeClaudeAgentSDK {
  private readonly _sessionFactory: () => FakeClaudeSession;
  private readonly _queryFactory: () => FakeClaudeQuery;

  constructor(
    options?: {
      sessionFactory?: () => FakeClaudeSession;
      queryFactory?: () => FakeClaudeQuery;
    },
  ) {
    this._sessionFactory = options?.sessionFactory ?? (() => new FakeClaudeSession());
    this._queryFactory = options?.queryFactory ?? (() => new FakeClaudeQuery());
  }

  createSession = mock(() => this._sessionFactory());
  query = mock((_options?: Record<string, unknown>) => this._queryFactory());
}

// ---------------------------------------------------------------------------
// mockClaudeSDK — replaces the real module in Bun's module registry.
// ---------------------------------------------------------------------------

export interface MockClaudeSDKOptions {
  /** Override the SDK class entirely. */
  sdkClass?: typeof FakeClaudeAgentSDK;
  /** Factory for sessions returned by `createSession()`. */
  sessionFactory?: () => FakeClaudeSession;
  /** Factory for queries returned by `query()`. */
  queryFactory?: () => FakeClaudeQuery;
}

/**
 * Replace `@anthropic-ai/claude-agent-sdk` with fakes.
 *
 * Call this **before** any module under test is imported so that Bun's
 * module resolution picks up the mock.
 */
export function mockClaudeSDK(options: MockClaudeSDKOptions = {}): void {
  const SDKClass = options.sessionFactory
    ? class extends FakeClaudeAgentSDK {
        constructor() {
          super({ sessionFactory: options.sessionFactory });
        }
      }
    : (options.sdkClass ?? FakeClaudeAgentSDK);
  const queryFactory = options.queryFactory;

  mock.module("@anthropic-ai/claude-agent-sdk", () => ({
    default: SDKClass,
    ClaudeAgentSDK: SDKClass,
    Query: class FakeQueryConstructor {
      id = "mock-query";
      send = mock(() =>
        Promise.resolve({ role: "assistant", content: "mock-response" }),
      );
      abort = mock(() => {});

      constructor() {
        const factory = queryFactory;
        if (factory) {
          const instance = factory();
          Object.assign(this, instance);
        }
      }
    },
    // Re-export commonly referenced type-level tokens as empty objects so
    // runtime `typeof` checks don't explode.
    SDKMessage: {},
    HookEvent: {},
  }));
}
