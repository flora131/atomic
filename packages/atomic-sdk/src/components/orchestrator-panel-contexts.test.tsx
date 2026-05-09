import { test, expect, mock } from "bun:test";
import { OffloadManagerContext } from "./orchestrator-panel-contexts.ts";
import type { OffloadManager } from "../runtime/offload-manager.ts";

// ─── OffloadManagerContext ─────────────────────────────────────────────────

test("OffloadManagerContext default value is null", () => {
  // createContext(null) — the _currentValue internal field holds the default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect((OffloadManagerContext as any)._currentValue).toBeNull();
});

test("OffloadManagerContext is a React context object", () => {
  expect(OffloadManagerContext).toBeDefined();
  expect(typeof OffloadManagerContext.Provider).toBe("object");
  expect(typeof OffloadManagerContext.Consumer).toBe("object");
});

// ─── useOffloadManager ─────────────────────────────────────────────────────

test("useOffloadManager throws when called outside React component", () => {
  // import lazily to avoid top-level module issues with react hook rules
  const { useOffloadManager } = require("./orchestrator-panel-contexts.ts");
  expect(() => useOffloadManager()).toThrow();
});

// ─── useOffloadManager with provider value ────────────────────────────────

test("useOffloadManager returns value from OffloadManagerContext.Provider", () => {
  // Test by mocking React's useContext to return a known value, then verifying
  // useOffloadManager returns it (white-box: hook is a thin useContext wrapper)
  const mockManager: OffloadManager = {
    registerSession: mock(async () => {}),
    offloadSession: mock(async () => {}),
    onWorkflowCompletion: mock(async () => {}),
    requestResume: mock(async () => {}),
    getStatus: mock(() => "alive" as const),
  };

  // Temporarily replace useContext from react with a stub returning our mock
  mock.module("react", () => {
    const real = require("react");
    return {
      ...real,
      useContext: (ctx: unknown) => {
        if (ctx === OffloadManagerContext) return mockManager;
        return real.useContext(ctx);
      },
    };
  });

  // Reload the module so it picks up the mocked react
  const { useOffloadManager: freshUseOffloadManager } = require("./orchestrator-panel-contexts.ts");

  const result = freshUseOffloadManager();
  expect(result).toBe(mockManager);

  // Restore real react
  mock.restore();
});
