import { describe, test, expect } from "bun:test";
import { contextCommand } from "../../../src/ui/commands/builtin-commands.ts";
import type { CommandContext } from "../../../src/ui/commands/registry.ts";
import type { Session, ContextUsage, ModelDisplayInfo } from "../../../src/sdk/types.ts";

/**
 * Test suite for /context command fixes
 * Verifies all 6 reported issues are resolved
 */

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("contextCommand - Bug Fixes", () => {
  test("Issue 1 & 2: Works before first message with model metadata", async () => {
    // Simulate state before first message: no session, but SDK is initialized
    const context = createMockContext({
      session: null,
      getModelDisplayInfo: async () => ({
        model: "claude-sonnet-4",
        tier: "Claude Code",
        contextWindow: 200000,
      }),
      getClientSystemToolsTokens: () => 5000,
    });

    const result = await contextCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.contextInfo).toBeDefined();
    expect(result.contextInfo!.maxTokens).toBe(200000);
    expect(result.contextInfo!.systemTools).toBe(5000);
    expect(result.contextInfo!.maxTokens).toBeGreaterThan(0);
  });

  test("Issue 3: Uses session context window when model metadata is missing", async () => {
    const mockSession: Session = {
      id: "test-session",
      send: async () => ({ type: "text", content: "" }),
      stream: async function* () {},
      summarize: async () => {},
      getContextUsage: async (): Promise<ContextUsage> => ({
        inputTokens: 8000,
        outputTokens: 1000,
        maxTokens: 128000,
        usagePercentage: 7,
      }),
      getSystemToolsTokens: () => 3000,
      destroy: async () => {},
    };

    // Simulate missing model metadata context window
    const context = createMockContext({
      session: mockSession,
      getModelDisplayInfo: async () => ({
        model: "unknown",
        tier: "Unknown",
        // contextWindow is undefined
      }),
    });

    const result = await contextCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.contextInfo).toBeDefined();
    expect(result.contextInfo!.maxTokens).toBe(128000);
    expect(result.contextInfo!.systemTools).toBe(3000);
  });

  test("Issue 4 & 5: Model change properly reflected", async () => {
    // Simulate model change: session has old context, but getModelDisplayInfo returns new
    const mockSession: Session = {
      id: "test-session",
      send: async () => ({ type: "text", content: "" }),
      stream: async function* () {},
      summarize: async () => {},
      getContextUsage: async (): Promise<ContextUsage> => ({
        inputTokens: 10000,
        outputTokens: 2000,
        maxTokens: 100000, // Old model's context window
        usagePercentage: 12,
      }),
      getSystemToolsTokens: () => 4000,
      destroy: async () => {},
    };

    const context = createMockContext({
      session: mockSession,
      getModelDisplayInfo: async () => ({
        model: "gpt-5.2-codex",
        tier: "OpenCode",
        contextWindow: 128000, // New model's context window
      }),
    });

    const result = await contextCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.contextInfo).toBeDefined();
    // Should use new model's context window, not old session's
    expect(result.contextInfo!.maxTokens).toBe(128000);
    expect(result.contextInfo!.model).toBe("gpt-5.2-codex");
  });

  test("Issue 6: After /clear, context still works", async () => {
    // After /clear, session is null but SDK client is still initialized
    const context = createMockContext({
      session: null,
      getModelDisplayInfo: async () => ({
        model: "claude-sonnet-4",
        tier: "Claude Code",
        contextWindow: 200000,
      }),
      getClientSystemToolsTokens: () => 5000,
    });

    const result = await contextCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.contextInfo).toBeDefined();
    expect(result.contextInfo!.maxTokens).toBe(200000);
    // After clear, messages should be 0
    expect(result.contextInfo!.messages).toBe(0);
    // But systemTools should still be available from client
    expect(result.contextInfo!.systemTools).toBe(5000);
  });

  test("Session usage preferred over model metadata when both available", async () => {
    // When session has usage data, it should be used for token counts
    // but maxTokens should prefer model metadata (which might be updated)
    const mockSession: Session = {
      id: "test-session",
      send: async () => ({ type: "text", content: "" }),
      stream: async function* () {},
      summarize: async () => {},
      getContextUsage: async (): Promise<ContextUsage> => ({
        inputTokens: 15000,
        outputTokens: 3000,
        maxTokens: 200000,
        usagePercentage: 9,
      }),
      getSystemToolsTokens: () => 6000,
      destroy: async () => {},
    };

    const context = createMockContext({
      session: mockSession,
      getModelDisplayInfo: async () => ({
        model: "claude-opus-4.5",
        tier: "Claude Code",
        contextWindow: 200000,
      }),
    });

    const result = await contextCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.contextInfo).toBeDefined();
    // Should use model metadata for maxTokens
    expect(result.contextInfo!.maxTokens).toBe(200000);
    // Should use session data for usage
    expect(result.contextInfo!.systemTools).toBe(6000);
    // messages = (inputTokens - systemTools) + outputTokens
    expect(result.contextInfo!.messages).toBe((15000 - 6000) + 3000);
  });

  test("Buffer calculation never divides by zero", async () => {
    const mockSession: Session = {
      id: "test-session",
      send: async () => ({ type: "text", content: "" }),
      stream: async function* () {},
      summarize: async () => {},
      getContextUsage: async (): Promise<ContextUsage> => ({
        inputTokens: 5000,
        outputTokens: 1000,
        maxTokens: 200000,
        usagePercentage: 3,
      }),
      getSystemToolsTokens: () => 2000,
      destroy: async () => {},
    };

    const context = createMockContext({
      session: mockSession,
      getModelDisplayInfo: async () => ({
        model: "claude-sonnet-4",
        tier: "Claude Code",
        contextWindow: 200000,
      }),
    });

    const result = await contextCommand.execute("", context);

    expect(result.success).toBe(true);
    expect(result.contextInfo).toBeDefined();
    expect(result.contextInfo!.buffer).toBeGreaterThan(0);
    expect(result.contextInfo!.buffer).toBeLessThan(result.contextInfo!.maxTokens);
    // Buffer should be roughly 55% of maxTokens (1 - 0.45 threshold)
    expect(result.contextInfo!.buffer).toBeGreaterThan(result.contextInfo!.maxTokens * 0.5);
    expect(result.contextInfo!.buffer).toBeLessThan(result.contextInfo!.maxTokens * 0.6);
  });

  test("FreeSpace calculation is correct", async () => {
    const mockSession: Session = {
      id: "test-session",
      send: async () => ({ type: "text", content: "" }),
      stream: async function* () {},
      summarize: async () => {},
      getContextUsage: async (): Promise<ContextUsage> => ({
        inputTokens: 10000,
        outputTokens: 2000,
        maxTokens: 100000,
        usagePercentage: 12,
      }),
      getSystemToolsTokens: () => 5000,
      destroy: async () => {},
    };

    const context = createMockContext({
      session: mockSession,
      getModelDisplayInfo: async () => ({
        model: "test-model",
        tier: "Test",
        contextWindow: 100000,
      }),
    });

    const result = await contextCommand.execute("", context);

    expect(result.success).toBe(true);
    const info = result.contextInfo!;
    
    // Verify the calculation: freeSpace = maxTokens - systemTools - messages - buffer
    const expectedMessages = (10000 - 5000) + 2000; // 7000
    const expectedFreeSpace = 100000 - 5000 - expectedMessages - info.buffer;
    
    expect(info.messages).toBe(expectedMessages);
    expect(info.freeSpace).toBe(expectedFreeSpace);
    expect(info.freeSpace).toBeGreaterThanOrEqual(0);
  });
});
