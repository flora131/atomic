/**
 * Integration tests for Claude SDK hook handlers
 *
 * Tests cover:
 * - SessionEnd telemetry hook functionality
 * - Default hook configuration
 * - SessionStart hook execution
 * - PreToolUse filtering hooks
 * - PostToolUse callback hooks
 * - Error handling in hooks
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  createSessionEndTelemetryHook,
  createDefaultClaudeHooks,
  createSessionStartHook,
  createPreToolUseHook,
  createPostToolUseHook,
} from "../../src/sdk/claude-hooks.ts";

/**
 * Helper to create a mock HookInput with required fields
 */
function createMockHookInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: "test-session-123",
    transcript_path: "/tmp/test-transcript.jsonl",
    cwd: "/home/test",
    ...overrides,
  };
}

describe("Claude SDK Hook Handlers", () => {
  beforeEach(() => {
    // Reset any mocks if needed
  });

  describe("createSessionEndTelemetryHook", () => {
    test("returns a function", () => {
      const hook = createSessionEndTelemetryHook();
      expect(typeof hook).toBe("function");
    });

    test("hook returns continue: true on success", async () => {
      const hook = createSessionEndTelemetryHook();
      const input = createMockHookInput();

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });

    test("hook returns continue: true when no transcript_path", async () => {
      const hook = createSessionEndTelemetryHook();
      const input = createMockHookInput({ transcript_path: undefined });

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });

    test("hook returns continue: true when transcript path does not exist", async () => {
      const hook = createSessionEndTelemetryHook();
      const input = createMockHookInput({
        transcript_path: "/nonexistent/path/transcript.jsonl",
      });

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });

    test("hook never throws errors", async () => {
      const hook = createSessionEndTelemetryHook();
      const input = createMockHookInput({
        transcript_path: "/some/invalid/path",
      });

      // Should not throw even with invalid input
      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });
  });

  describe("createDefaultClaudeHooks", () => {
    test("returns ClaudeHookConfig with SessionEnd hook", () => {
      const config = createDefaultClaudeHooks();

      expect(config).toBeDefined();
      expect(config.SessionEnd).toBeDefined();
      expect(Array.isArray(config.SessionEnd)).toBe(true);
      expect(config.SessionEnd!.length).toBe(1);
    });

    test("SessionEnd hook is callable", async () => {
      const config = createDefaultClaudeHooks();
      const hook = config.SessionEnd![0];

      expect(hook).toBeDefined();

      const input = createMockHookInput();

      const result = await hook!(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });
  });

  describe("createSessionStartHook", () => {
    test("returns a function", () => {
      const hook = createSessionStartHook();
      expect(typeof hook).toBe("function");
    });

    test("hook returns continue: true without callback", async () => {
      const hook = createSessionStartHook();
      const input = createMockHookInput();

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });

    test("hook executes callback with session ID", async () => {
      const onStart = mock(() => {});
      const hook = createSessionStartHook(onStart);
      const input = createMockHookInput({ session_id: "test-session-456" });

      await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStart).toHaveBeenCalledWith("test-session-456");
    });

    test("hook handles async callback", async () => {
      let callbackExecuted = false;
      const onStart = async (sessionId: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        callbackExecuted = true;
        expect(sessionId).toBe("test-session-789");
      };

      const hook = createSessionStartHook(onStart);
      const input = createMockHookInput({ session_id: "test-session-789" });

      await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(callbackExecuted).toBe(true);
    });

    test("hook returns continue: true on callback error", async () => {
      const onStart = () => {
        throw new Error("Callback error");
      };

      const hook = createSessionStartHook(onStart);
      const input = createMockHookInput();

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });
  });

  describe("createPreToolUseHook", () => {
    test("returns a function", () => {
      const hook = createPreToolUseHook();
      expect(typeof hook).toBe("function");
    });

    test("hook returns continue: true without filter", async () => {
      const hook = createPreToolUseHook();
      const input = createMockHookInput({
        tool_name: "bash",
        tool_input: { command: "ls" },
      });

      const result = await hook(input as never, "tool-use-123", {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });

    test("hook executes filter and returns result", async () => {
      const filter = mock(() => true);
      const hook = createPreToolUseHook(filter);
      const input = createMockHookInput({
        tool_name: "read",
        tool_input: { path: "/test" },
      });

      const result = await hook(input as never, "tool-use-456", {
        signal: new AbortController().signal,
      });

      expect(filter).toHaveBeenCalledTimes(1);
      expect(filter).toHaveBeenCalledWith("read", { path: "/test" });
      expect(result).toEqual({ continue: true });
    });

    test("hook returns continue: false when filter rejects", async () => {
      const filter = mock(() => false);
      const hook = createPreToolUseHook(filter);
      const input = createMockHookInput({
        tool_name: "bash",
        tool_input: { command: "rm -rf /" },
      });

      const result = await hook(input as never, "tool-use-789", {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: false });
    });

    test("hook handles async filter", async () => {
      const filter = async (toolName: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return toolName !== "dangerous_tool";
      };

      const hook = createPreToolUseHook(filter);
      const input = createMockHookInput({
        tool_name: "safe_tool",
        tool_input: {},
      });

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });

    test("hook returns continue: true on filter error", async () => {
      const filter = () => {
        throw new Error("Filter error");
      };

      const hook = createPreToolUseHook(filter);
      const input = createMockHookInput({
        tool_name: "bash",
        tool_input: {},
      });

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });
  });

  describe("createPostToolUseHook", () => {
    test("returns a function", () => {
      const hook = createPostToolUseHook();
      expect(typeof hook).toBe("function");
    });

    test("hook returns continue: true without callback", async () => {
      const hook = createPostToolUseHook();
      const input = createMockHookInput({
        tool_name: "bash",
        tool_result: "success",
      });

      const result = await hook(input as never, "tool-use-123", {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });

    test("hook executes callback with tool info", async () => {
      const onComplete = mock(() => {});
      const hook = createPostToolUseHook(onComplete);
      const input = createMockHookInput({
        tool_name: "read",
        tool_result: "file contents",
      });

      await hook(input as never, "tool-use-456", {
        signal: new AbortController().signal,
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith("read", "file contents");
    });

    test("hook handles async callback", async () => {
      let callbackExecuted = false;
      const onComplete = async (toolName: string, toolResult: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        callbackExecuted = true;
        expect(toolName).toBe("bash");
        expect(toolResult).toBe("output");
      };

      const hook = createPostToolUseHook(onComplete);
      const input = createMockHookInput({
        tool_name: "bash",
        tool_result: "output",
      });

      await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(callbackExecuted).toBe(true);
    });

    test("hook returns continue: true on callback error", async () => {
      const onComplete = () => {
        throw new Error("Callback error");
      };

      const hook = createPostToolUseHook(onComplete);
      const input = createMockHookInput({
        tool_name: "bash",
        tool_result: "output",
      });

      const result = await hook(input as never, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
    });
  });

  describe("Integration scenarios", () => {
    test("multiple hooks can be combined", () => {
      const config = createDefaultClaudeHooks();

      // Add additional hooks
      config.SessionStart = [createSessionStartHook(() => console.log("Session started"))];
      config.PreToolUse = [createPreToolUseHook((name) => name !== "dangerous")];
      config.PostToolUse = [createPostToolUseHook(() => console.log("Tool completed"))];

      expect(config.SessionEnd!.length).toBe(1);
      expect(config.SessionStart!.length).toBe(1);
      expect(config.PreToolUse!.length).toBe(1);
      expect(config.PostToolUse!.length).toBe(1);
    });

    test("hooks can be chained in array", async () => {
      const calls: string[] = [];

      const hook1 = createSessionStartHook(() => {
        calls.push("hook1");
      });
      const hook2 = createSessionStartHook(() => {
        calls.push("hook2");
      });

      const hooks = [hook1, hook2];
      const input = createMockHookInput();

      for (const hook of hooks) {
        await hook(input as never, undefined, { signal: new AbortController().signal });
      }

      expect(calls).toEqual(["hook1", "hook2"]);
    });
  });
});
