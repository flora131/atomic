/**
 * Integration tests for AskUserQuestion HITL (Human-in-the-Loop) behavior
 *
 * These tests verify that the AskUserQuestion tool correctly pauses execution
 * and emits permission.requested events across all SDK clients, even when
 * using bypass permission mode.
 *
 * The AskUserQuestion tool is a special HITL mechanism that:
 * 1. Pauses agent execution to ask the user a question
 * 2. Emits a permission.requested event with question data
 * 3. Waits for user response before continuing
 * 4. Should work regardless of permission mode (bypass, auto, prompt, deny)
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import type { Query, SDKMessage, Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, PermissionRequestedEventData } from "../../src/sdk/types.ts";

// Track permission events
let permissionEvents: AgentEvent<"permission.requested">[] = [];
let canUseToolCallback: ((toolName: string, toolInput: Record<string, unknown>, options: { signal: AbortSignal; toolUseID: string }) => Promise<{ behavior: "allow" | "deny"; updatedInput?: Record<string, unknown> }>) | null = null;

// Mock the Claude Agent SDK
const mockQuery = mock((params: { prompt: string; options: Options }) => {
  // Capture the canUseTool callback if provided
  if (params.options.canUseTool) {
    canUseToolCallback = params.options.canUseTool;
  }

  const messages: SDKMessage[] = [];
  let closed = false;

  const queryInstance = {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) {
        yield msg;
      }
    },
    next: async () => ({ done: true, value: undefined }),
    return: async () => ({ done: true, value: undefined }),
    throw: async () => ({ done: true, value: undefined }),
    close: () => {
      closed = true;
    },
    interrupt: async () => {},
    setPermissionMode: async () => {},
    setModel: async () => {},
    setMaxThinkingTokens: async () => {},
    supportedCommands: async () => [],
    supportedModels: async () => [],
    mcpServerStatus: async () => [],
    accountInfo: async () => ({}),
    rewindFiles: async () => ({ canRewind: false }),
    setMcpServers: async () => ({ added: [], removed: [], errors: [] }),
    streamInput: async () => {},
    _messages: messages,
    _closed: () => closed,
  } as unknown as Query & { _messages: SDKMessage[]; _closed: () => boolean };

  return queryInstance;
});

const mockCreateSdkMcpServer = mock(() => ({
  type: "sdk" as const,
  name: "mock-server",
  server: {},
}));

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
}));

// Import after mocking
import { ClaudeAgentClient } from "../../src/sdk/claude-client.ts";

describe("AskUserQuestion HITL Integration", () => {
  describe("Claude SDK", () => {
    let client: ClaudeAgentClient;

    beforeEach(() => {
      client = new ClaudeAgentClient();
      permissionEvents = [];
      canUseToolCallback = null;
      mockQuery.mockClear();
    });

    afterEach(async () => {
      await client.stop();
    });

    test("permission.requested event is emitted when AskUserQuestion tool is called", async () => {
      await client.start();

      // Register event handler for permission.requested
      client.on("permission.requested", (event) => {
        permissionEvents.push(event as AgentEvent<"permission.requested">);
      });

      // Create session with bypass mode
      const session = await client.createSession({ permissionMode: "bypass" });
      expect(session).toBeDefined();

      // Verify canUseTool callback was captured
      expect(canUseToolCallback).not.toBeNull();

      // Simulate AskUserQuestion tool call via canUseTool callback
      if (canUseToolCallback) {
        const abortController = new AbortController();
        const toolInput = {
          questions: [
            {
              header: "Color",
              question: "What is your favorite color?",
              options: [
                { label: "Red", description: "The color of fire" },
                { label: "Blue", description: "The color of sky" },
              ],
              multiSelect: false,
            },
          ],
        };

        // Call the canUseTool callback - this should emit permission.requested
        const resultPromise = canUseToolCallback(
          "AskUserQuestion",
          toolInput,
          { signal: abortController.signal, toolUseID: "test-tool-use-1" }
        );

        // Wait a tick for the event to be emitted
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify permission.requested event was emitted
        expect(permissionEvents.length).toBe(1);
        const event = permissionEvents[0]!;
        expect(event.type).toBe("permission.requested");
        expect(event.data.toolName).toBe("AskUserQuestion");
        expect(event.data.question).toBe("What is your favorite color?");
        expect(event.data.header).toBe("Color");
        expect(event.data.options.length).toBe(2);
        expect(event.data.respond).toBeInstanceOf(Function);

        // Simulate user response
        if (event.data.respond) {
          event.data.respond("Red");
        }

        // Wait for the promise to resolve
        const result = await resultPromise;
        expect(result.behavior).toBe("allow");
        expect(result.updatedInput).toBeDefined();
      }
    });

    test("AskUserQuestion works in default permission mode", async () => {
      await client.start();

      client.on("permission.requested", (event) => {
        permissionEvents.push(event as AgentEvent<"permission.requested">);
      });

      // Create session with default (prompt) permission mode
      const session = await client.createSession({ permissionMode: "prompt" });
      expect(session).toBeDefined();
      expect(canUseToolCallback).not.toBeNull();

      if (canUseToolCallback) {
        const abortController = new AbortController();
        const toolInput = {
          questions: [
            {
              question: "Do you want to continue?",
              options: [
                { label: "Yes" },
                { label: "No" },
              ],
            },
          ],
        };

        const resultPromise = canUseToolCallback(
          "AskUserQuestion",
          toolInput,
          { signal: abortController.signal, toolUseID: "test-tool-use-2" }
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(permissionEvents.length).toBe(1);
        const event = permissionEvents[0]!;
        expect(event.data.question).toBe("Do you want to continue?");

        // Respond to continue
        if (event.data.respond) {
          event.data.respond("Yes");
        }

        const result = await resultPromise;
        expect(result.behavior).toBe("allow");
      }
    });

    test("AskUserQuestion works in auto permission mode", async () => {
      await client.start();

      client.on("permission.requested", (event) => {
        permissionEvents.push(event as AgentEvent<"permission.requested">);
      });

      const session = await client.createSession({ permissionMode: "auto" });
      expect(session).toBeDefined();
      expect(canUseToolCallback).not.toBeNull();

      if (canUseToolCallback) {
        const abortController = new AbortController();
        const toolInput = {
          questions: [
            {
              question: "Select a framework:",
              options: [
                { label: "React" },
                { label: "Vue" },
                { label: "Angular" },
              ],
            },
          ],
        };

        const resultPromise = canUseToolCallback(
          "AskUserQuestion",
          toolInput,
          { signal: abortController.signal, toolUseID: "test-tool-use-3" }
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        // AskUserQuestion should still emit event even in auto mode
        expect(permissionEvents.length).toBe(1);

        if (permissionEvents[0]!.data.respond) {
          permissionEvents[0]!.data.respond("React");
        }

        const result = await resultPromise;
        expect(result.behavior).toBe("allow");
      }
    });

    test("multiSelect option is correctly passed through", async () => {
      await client.start();

      client.on("permission.requested", (event) => {
        permissionEvents.push(event as AgentEvent<"permission.requested">);
      });

      const session = await client.createSession({ permissionMode: "bypass" });
      expect(session).toBeDefined();

      if (canUseToolCallback) {
        const abortController = new AbortController();
        const toolInput = {
          questions: [
            {
              question: "Select features to enable:",
              options: [
                { label: "TypeScript" },
                { label: "ESLint" },
                { label: "Prettier" },
              ],
              multiSelect: true,
            },
          ],
        };

        const resultPromise = canUseToolCallback(
          "AskUserQuestion",
          toolInput,
          { signal: abortController.signal, toolUseID: "test-tool-use-4" }
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(permissionEvents.length).toBe(1);
        expect(permissionEvents[0]!.data.multiSelect).toBe(true);

        // Respond with multiple selections
        if (permissionEvents[0]!.data.respond) {
          permissionEvents[0]!.data.respond(["TypeScript", "ESLint"]);
        }

        const result = await resultPromise;
        expect(result.behavior).toBe("allow");
        expect((result.updatedInput as Record<string, unknown>).answers).toBeDefined();
      }
    });

    test("non-AskUserQuestion tools auto-approve in bypass mode", async () => {
      await client.start();

      client.on("permission.requested", (event) => {
        permissionEvents.push(event as AgentEvent<"permission.requested">);
      });

      const session = await client.createSession({ permissionMode: "bypass" });
      expect(session).toBeDefined();

      if (canUseToolCallback) {
        const abortController = new AbortController();

        // Test a regular tool (not AskUserQuestion)
        const result = await canUseToolCallback(
          "Bash",
          { command: "ls -la" },
          { signal: abortController.signal, toolUseID: "test-tool-use-5" }
        );

        // Regular tools should auto-approve without emitting permission.requested
        expect(permissionEvents.length).toBe(0);
        expect(result.behavior).toBe("allow");
      }
    });

    test("respond callback resolves with user answer", async () => {
      await client.start();

      let capturedRespond: ((answer: string | string[]) => void) | undefined;

      client.on("permission.requested", (event) => {
        const data = event.data as PermissionRequestedEventData;
        capturedRespond = data.respond;
      });

      const session = await client.createSession({ permissionMode: "bypass" });

      if (canUseToolCallback) {
        const abortController = new AbortController();
        const toolInput = {
          questions: [
            {
              question: "Choose an option:",
              options: [{ label: "A" }, { label: "B" }],
            },
          ],
        };

        const resultPromise = canUseToolCallback(
          "AskUserQuestion",
          toolInput,
          { signal: abortController.signal, toolUseID: "test-tool-use-6" }
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(capturedRespond).toBeDefined();

        // Simulate user selecting option B
        capturedRespond!("B");

        const result = await resultPromise;
        expect(result.behavior).toBe("allow");
        expect((result.updatedInput as Record<string, unknown>).answers).toEqual({
          "Choose an option:": "B",
        });
      }
    });

    test("empty questions array defaults to yes/no options", async () => {
      await client.start();

      client.on("permission.requested", (event) => {
        permissionEvents.push(event as AgentEvent<"permission.requested">);
      });

      const session = await client.createSession({ permissionMode: "bypass" });

      if (canUseToolCallback) {
        const abortController = new AbortController();
        const toolInput = {
          questions: [
            {
              question: "Continue?",
              // No options provided
            },
          ],
        };

        const resultPromise = canUseToolCallback(
          "AskUserQuestion",
          toolInput,
          { signal: abortController.signal, toolUseID: "test-tool-use-7" }
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(permissionEvents.length).toBe(1);
        // Should have default Yes/No options
        const lastEvent = permissionEvents[0]!;
        expect(lastEvent.data.options.length).toBe(2);
        expect(lastEvent.data.options[0]!.label).toBe("Yes");
        expect(lastEvent.data.options[1]!.label).toBe("No");

        if (permissionEvents[0]!.data.respond) {
          permissionEvents[0]!.data.respond("yes");
        }

        await resultPromise;
      }
    });
  });

  describe("Permission Event Structure", () => {
    test("permission.requested event has correct structure", async () => {
      const client = new ClaudeAgentClient();
      await client.start();

      let receivedEvent: AgentEvent<"permission.requested"> | null = null;

      client.on("permission.requested", (event) => {
        receivedEvent = event as AgentEvent<"permission.requested">;
      });

      await client.createSession({ permissionMode: "bypass" });

      if (canUseToolCallback) {
        const abortController = new AbortController();
        const toolInput = {
          questions: [
            {
              header: "Test Header",
              question: "Test question?",
              options: [{ label: "Option 1", description: "Desc 1" }],
              multiSelect: false,
            },
          ],
        };

        const resultPromise = canUseToolCallback(
          "AskUserQuestion",
          toolInput,
          { signal: abortController.signal, toolUseID: "test-tool-use-8" }
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(receivedEvent).not.toBeNull();
        expect(receivedEvent!.type).toBe("permission.requested");
        expect(receivedEvent!.sessionId).toBeDefined();
        expect(receivedEvent!.timestamp).toBeDefined();
        expect(receivedEvent!.data.requestId).toBeDefined();
        expect(receivedEvent!.data.toolName).toBe("AskUserQuestion");
        expect(receivedEvent!.data.question).toBe("Test question?");
        expect(receivedEvent!.data.header).toBe("Test Header");
        expect(receivedEvent!.data.options).toHaveLength(1);
        expect(receivedEvent!.data.options[0]!.label).toBe("Option 1");
        expect(receivedEvent!.data.options[0]!.description).toBe("Desc 1");
        expect(receivedEvent!.data.multiSelect).toBe(false);
        expect(typeof receivedEvent!.data.respond).toBe("function");

        receivedEvent!.data.respond!("Option 1");
        await resultPromise;
      }

      await client.stop();
    });
  });
});
