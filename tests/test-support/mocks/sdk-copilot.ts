/**
 * Mock factory for the GitHub Copilot SDK (`@github/copilot-sdk`).
 *
 * Usage:
 *   import { mockCopilotSDK, FakeCopilotSession, FakeCopilotClient } from "tests/test-support/mocks/sdk-copilot.ts";
 *   mockCopilotSDK();  // call before importing any module that depends on the SDK
 */

import { mock } from "bun:test";

// ---------------------------------------------------------------------------
// Fake Session — mirrors SdkCopilotSession from @github/copilot-sdk
// ---------------------------------------------------------------------------

export class FakeCopilotSession {
  readonly sessionId: string;

  sendMessage = mock((_message: string) =>
    Promise.resolve({ role: "assistant" as const, content: "fake copilot response" }),
  );
  streamMessage = mock(function* fakeStream() {
    yield { type: "text" as const, content: "fake copilot delta" };
  });
  getHistory = mock(() => Promise.resolve([]));
  destroy = mock(() => Promise.resolve());
  abort = mock(() => Promise.resolve());

  /**
   * Simulates subscribing to session events (e.g., tool use, completion).
   * Returns an unsubscribe function.
   */
  on = mock((_eventType: string, _handler: (...args: unknown[]) => void) => {
    return () => {}; // unsubscribe
  });

  constructor(sessionId = "test-session-copilot") {
    this.sessionId = sessionId;
  }
}

// ---------------------------------------------------------------------------
// Fake SessionEvent — mirrors SdkSessionEvent from @github/copilot-sdk
// ---------------------------------------------------------------------------

export interface FakeCopilotSessionEvent {
  type: string;
  data: Record<string, unknown>;
}

export function createFakeCopilotSessionEvent(
  type: string,
  data: Record<string, unknown> = {},
): FakeCopilotSessionEvent {
  return { type, data };
}

// ---------------------------------------------------------------------------
// Fake PermissionRequest — mirrors SdkPermissionRequest
// ---------------------------------------------------------------------------

export interface FakeCopilotPermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  accept: () => void;
  deny: () => void;
}

export function createFakeCopilotPermissionRequest(
  toolName: string,
  toolInput: Record<string, unknown> = {},
): FakeCopilotPermissionRequest {
  return {
    toolName,
    toolInput,
    accept: mock(() => {}),
    deny: mock(() => {}),
  };
}

// ---------------------------------------------------------------------------
// Fake CopilotClient — mirrors SdkCopilotClient from @github/copilot-sdk
// ---------------------------------------------------------------------------

export class FakeCopilotClient {
  private readonly _sessionFactory: () => FakeCopilotSession;

  createSession = mock((_config?: Record<string, unknown>) => {
    return Promise.resolve(this._sessionFactory());
  });
  resumeSession = mock((_sessionId: string) => {
    return Promise.resolve(this._sessionFactory());
  });
  deleteSession = mock((_sessionId: string) => Promise.resolve());
  listSessions = mock(() => Promise.resolve([]));
  listModels = mock(() => Promise.resolve([]));

  getState = mock(() => "connected" as const);
  stop = mock(() => Promise.resolve());
  start = mock(() => Promise.resolve());

  constructor(
    options?: {
      sessionFactory?: () => FakeCopilotSession;
    },
  ) {
    this._sessionFactory = options?.sessionFactory ?? (() => new FakeCopilotSession());
  }
}

// ---------------------------------------------------------------------------
// mockCopilotSDK — replaces the real module in Bun's module registry.
// ---------------------------------------------------------------------------

export interface MockCopilotSDKOptions {
  /** Provide a pre-built FakeCopilotClient (so tests can spy on it). */
  client?: FakeCopilotClient;
  /** Factory for sessions returned by `createSession()`. */
  sessionFactory?: () => FakeCopilotSession;
}

/**
 * Replace `@github/copilot-sdk` with fakes.
 *
 * Call this **before** any module under test is imported so that Bun's
 * module resolution picks up the mock.
 */
export function mockCopilotSDK(options: MockCopilotSDKOptions = {}): void {
  const clientInstance =
    options.client ?? new FakeCopilotClient({ sessionFactory: options.sessionFactory });

  mock.module("@github/copilot-sdk", () => ({
    CopilotClient: class MockCopilotClientConstructor {
      createSession = clientInstance.createSession;
      resumeSession = clientInstance.resumeSession;
      deleteSession = clientInstance.deleteSession;
      listSessions = clientInstance.listSessions;
      listModels = clientInstance.listModels;
      getState = clientInstance.getState;
      stop = clientInstance.stop;
      start = clientInstance.start;
    },
  }));
}
