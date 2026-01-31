/**
 * Unit tests for HookManager
 *
 * Tests cover:
 * - Hook registration and unregistration
 * - Event emission and handler execution
 * - Handler result processing
 * - Event mapping for Claude, OpenCode, and Copilot clients
 * - Error handling in hook handlers
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  HookManager,
  createHookManager,
  type UnifiedHookEvent,
  type HookContext,
  type HookHandler,
  type HookResult,
} from "../../src/sdk/hooks.ts";
import { ClaudeAgentClient } from "../../src/sdk/claude-client.ts";
import { OpenCodeClient } from "../../src/sdk/opencode-client.ts";
import { CopilotClient } from "../../src/sdk/copilot-client.ts";

describe("HookManager", () => {
  let hookManager: HookManager;

  beforeEach(() => {
    hookManager = new HookManager();
  });

  describe("Hook Registration", () => {
    test("on() registers a handler", () => {
      const handler: HookHandler = () => {};
      hookManager.on("session.start", handler);
      expect(hookManager.hasHandlers("session.start")).toBe(true);
      expect(hookManager.handlerCount("session.start")).toBe(1);
    });

    test("on() returns unsubscribe function", () => {
      const handler: HookHandler = () => {};
      const unsubscribe = hookManager.on("session.start", handler);

      expect(hookManager.handlerCount("session.start")).toBe(1);
      unsubscribe();
      expect(hookManager.handlerCount("session.start")).toBe(0);
    });

    test("multiple handlers for same event", () => {
      hookManager.on("tool.before", () => {});
      hookManager.on("tool.before", () => {});
      hookManager.on("tool.before", () => {});

      expect(hookManager.handlerCount("tool.before")).toBe(3);
    });

    test("handlers for different events", () => {
      hookManager.on("session.start", () => {});
      hookManager.on("session.end", () => {});
      hookManager.on("tool.before", () => {});

      expect(hookManager.handlerCount("session.start")).toBe(1);
      expect(hookManager.handlerCount("session.end")).toBe(1);
      expect(hookManager.handlerCount("tool.before")).toBe(1);
    });

    test("off() removes all handlers for an event", () => {
      hookManager.on("session.start", () => {});
      hookManager.on("session.start", () => {});

      hookManager.off("session.start");
      expect(hookManager.hasHandlers("session.start")).toBe(false);
    });

    test("clear() removes all handlers", () => {
      hookManager.on("session.start", () => {});
      hookManager.on("session.end", () => {});
      hookManager.on("tool.before", () => {});

      hookManager.clear();

      expect(hookManager.hasHandlers("session.start")).toBe(false);
      expect(hookManager.hasHandlers("session.end")).toBe(false);
      expect(hookManager.hasHandlers("tool.before")).toBe(false);
    });

    test("hasHandlers returns false for unregistered events", () => {
      expect(hookManager.hasHandlers("session.error")).toBe(false);
    });

    test("handlerCount returns 0 for unregistered events", () => {
      expect(hookManager.handlerCount("tool.error")).toBe(0);
    });
  });

  describe("Event Emission", () => {
    test("emit calls registered handlers", async () => {
      let handlerCalled = false;

      hookManager.on("session.start", () => {
        handlerCalled = true;
      });

      await hookManager.emit("session.start", {
        sessionId: "test-session",
        agentType: "claude",
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(handlerCalled).toBe(true);
    });

    test("emit passes context to handlers", async () => {
      let receivedContext: HookContext | null = null;

      hookManager.on("tool.before", (ctx) => {
        receivedContext = ctx;
      });

      const context: HookContext = {
        sessionId: "session-123",
        agentType: "opencode",
        timestamp: "2026-01-31T10:00:00Z",
        data: { toolName: "read", toolInput: { path: "/test" } },
      };

      await hookManager.emit("tool.before", context);

      expect(receivedContext).not.toBeNull();
      expect(receivedContext!.sessionId).toBe("session-123");
      expect(receivedContext!.agentType).toBe("opencode");
      expect(receivedContext!.data).toEqual({ toolName: "read", toolInput: { path: "/test" } });
    });

    test("emit calls handlers in order", async () => {
      const callOrder: number[] = [];

      hookManager.on("message.before", () => {
        callOrder.push(1);
      });
      hookManager.on("message.before", () => {
        callOrder.push(2);
      });
      hookManager.on("message.before", () => {
        callOrder.push(3);
      });

      await hookManager.emit("message.before", {
        sessionId: "test",
        agentType: "copilot",
        timestamp: new Date().toISOString(),
        data: { content: "test", role: "user" },
      });

      expect(callOrder).toEqual([1, 2, 3]);
    });

    test("emit returns continue: true when no handlers", async () => {
      const result = await hookManager.emit("subagent.start", {
        sessionId: "test",
        agentType: "claude",
        timestamp: new Date().toISOString(),
        data: {},
      });

      expect(result.continue).toBe(true);
    });

    test("emit handles async handlers", async () => {
      let resolved = false;

      hookManager.on("session.end", async () => {
        await new Promise((r) => setTimeout(r, 10));
        resolved = true;
      });

      await hookManager.emit("session.end", {
        sessionId: "test",
        agentType: "claude",
        timestamp: new Date().toISOString(),
        data: { reason: "completed" },
      });

      expect(resolved).toBe(true);
    });
  });

  describe("Handler Results", () => {
    test("handler can return continue: false to stop chain", async () => {
      let secondHandlerCalled = false;

      hookManager.on("tool.before", (): HookResult => {
        return { continue: false };
      });
      hookManager.on("tool.before", () => {
        secondHandlerCalled = true;
      });

      const result = await hookManager.emit("tool.before", {
        sessionId: "test",
        agentType: "claude",
        timestamp: new Date().toISOString(),
        data: { toolName: "bash", toolInput: {} },
      });

      expect(result.continue).toBe(false);
      expect(secondHandlerCalled).toBe(false);
    });

    test("handler can modify data for next handler", async () => {
      let receivedData: Record<string, unknown> = {};

      hookManager.on("message.after", (): HookResult => {
        return { modifiedData: { extra: "value" } };
      });
      hookManager.on("message.after", (ctx) => {
        receivedData = ctx.data as Record<string, unknown>;
      });

      await hookManager.emit("message.after", {
        sessionId: "test",
        agentType: "opencode",
        timestamp: new Date().toISOString(),
        data: { content: "hello", role: "assistant" },
      });

      expect(receivedData.extra).toBe("value");
      expect(receivedData.content).toBe("hello");
    });

    test("handler can return error to abort", async () => {
      hookManager.on("permission.request", (): HookResult => {
        return { error: "Access denied" };
      });

      const result = await hookManager.emit("permission.request", {
        sessionId: "test",
        agentType: "copilot",
        timestamp: new Date().toISOString(),
        data: { toolName: "bash", toolInput: { command: "rm -rf /" } },
      });

      expect(result.continue).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("thrown error is caught and returned", async () => {
      hookManager.on("session.error", () => {
        throw new Error("Handler failed");
      });

      const result = await hookManager.emit("session.error", {
        sessionId: "test",
        agentType: "claude",
        timestamp: new Date().toISOString(),
        data: { error: "something went wrong" },
      });

      expect(result.continue).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error instanceof Error && result.error.message).toBe("Handler failed");
    });
  });

  describe("All Event Types", () => {
    const eventTypes: UnifiedHookEvent[] = [
      "session.start",
      "session.end",
      "session.error",
      "tool.before",
      "tool.after",
      "tool.error",
      "message.before",
      "message.after",
      "permission.request",
      "subagent.start",
      "subagent.end",
    ];

    test("all 11 event types can be registered", () => {
      for (const eventType of eventTypes) {
        hookManager.on(eventType, () => {});
      }

      for (const eventType of eventTypes) {
        expect(hookManager.hasHandlers(eventType)).toBe(true);
      }
    });

    test("all 11 event types can be emitted", async () => {
      const emitted: string[] = [];

      for (const eventType of eventTypes) {
        hookManager.on(eventType, () => {
          emitted.push(eventType);
        });
      }

      for (const eventType of eventTypes) {
        await hookManager.emit(eventType, {
          sessionId: "test",
          agentType: "claude",
          timestamp: new Date().toISOString(),
          data: {},
        });
      }

      expect(emitted).toEqual(eventTypes);
    });
  });

  describe("Factory Function", () => {
    test("createHookManager returns HookManager instance", () => {
      const manager = createHookManager();
      expect(manager).toBeInstanceOf(HookManager);
    });
  });

  describe("Client Integration", () => {
    test("applyToClaudeClient registers hooks", () => {
      // Create a mock Claude client with registerHooks method
      const mockClient = {
        agentType: "claude" as const,
        registerHooks: mock(() => {}),
        createSession: async () => ({} as any),
        resumeSession: async () => null,
        on: () => () => {},
        registerTool: () => {},
        start: async () => {},
        stop: async () => {},
      };

      hookManager.on("session.start", () => {});
      hookManager.on("tool.before", () => {});
      hookManager.on("session.end", () => {});

      hookManager.applyToClaudeClient(mockClient as unknown as ClaudeAgentClient);

      expect(mockClient.registerHooks).toHaveBeenCalled();
    });

    test("applyToOpenCodeClient registers event handlers", () => {
      const eventHandlers: Array<[string, Function]> = [];
      const mockClient = {
        agentType: "opencode" as const,
        on: (event: string, handler: Function) => {
          eventHandlers.push([event, handler]);
          return () => {};
        },
        createSession: async () => ({} as any),
        resumeSession: async () => null,
        registerTool: () => {},
        start: async () => {},
        stop: async () => {},
      };

      hookManager.on("session.start", () => {});
      hookManager.on("tool.after", () => {});

      hookManager.applyToOpenCodeClient(mockClient as unknown as OpenCodeClient);

      expect(eventHandlers.length).toBeGreaterThan(0);
    });

    test("applyToCopilotClient registers event handlers", () => {
      const eventHandlers: Array<[string, Function]> = [];
      const mockClient = {
        agentType: "copilot" as const,
        on: (event: string, handler: Function) => {
          eventHandlers.push([event, handler]);
          return () => {};
        },
        createSession: async () => ({} as any),
        resumeSession: async () => null,
        registerTool: () => {},
        setPermissionHandler: () => {},
        start: async () => {},
        stop: async () => {},
      };

      hookManager.on("subagent.start", () => {});
      hookManager.on("subagent.end", () => {});

      hookManager.applyToCopilotClient(mockClient as unknown as CopilotClient);

      expect(eventHandlers.length).toBeGreaterThan(0);
    });
  });
});
