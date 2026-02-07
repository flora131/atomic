/**
 * Tests for ChatApp Command Execution
 *
 * Verifies that slash commands are properly parsed, looked up, and executed.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  globalRegistry,
  parseSlashCommand,
  type CommandDefinition,
  type CommandContext,
  type CommandResult,
  type CommandContextState,
} from "../../src/ui/commands/index.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  options: {
    session?: object | null;
    stateOverrides?: Partial<CommandContextState>;
    onAddMessage?: (role: string, content: string) => void;
    onSetStreaming?: (streaming: boolean) => void;
    onSendMessage?: (content: string) => void;
  } = {}
): CommandContext & { sentMessages: string[] } {
  const sentMessages: string[] = [];
  return {
    session: (options.session as CommandContext["session"]) ?? null,
    state: {
      isStreaming: false,
      messageCount: 0,
      ...options.stateOverrides,
    },
    addMessage: options.onAddMessage ?? (() => {}),
    setStreaming: options.onSetStreaming ?? (() => {}),
    sendMessage: (content: string) => {
      sentMessages.push(content);
      if (options.onSendMessage) {
        options.onSendMessage(content);
      }
    },
    sendSilentMessage: (content: string) => {
      sentMessages.push(content);
      if (options.onSendMessage) {
        options.onSendMessage(content);
      }
    },
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    sentMessages,
  };
}

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  globalRegistry.clear();
});

afterEach(() => {
  globalRegistry.clear();
});

// ============================================================================
// PARSE SLASH COMMAND TESTS
// ============================================================================

describe("parseSlashCommand", () => {
  test("parses simple command without args", () => {
    const result = parseSlashCommand("/help");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("help");
    expect(result.args).toBe("");
    expect(result.raw).toBe("/help");
  });

  test("parses command with single arg", () => {
    const result = parseSlashCommand("/theme dark");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("theme");
    expect(result.args).toBe("dark");
  });

  test("parses command with multiple args", () => {
    const result = parseSlashCommand("/atomic Build a login feature");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("atomic");
    expect(result.args).toBe("Build a login feature");
  });

  test("handles leading/trailing whitespace", () => {
    const result = parseSlashCommand("  /help  ");

    expect(result.isCommand).toBe(true);
    expect(result.name).toBe("help");
    expect(result.args).toBe("");
  });

  test("returns isCommand: false for non-slash input", () => {
    const result = parseSlashCommand("hello world");

    expect(result.isCommand).toBe(false);
    expect(result.name).toBe("");
    expect(result.args).toBe("");
    expect(result.raw).toBe("hello world");
  });

  test("returns isCommand: false for empty input", () => {
    const result = parseSlashCommand("");

    expect(result.isCommand).toBe(false);
  });

  test("lowercases command name", () => {
    const result = parseSlashCommand("/HELP");

    expect(result.name).toBe("help");
  });

  test("preserves argument case", () => {
    const result = parseSlashCommand("/atomic Build Feature");

    expect(result.args).toBe("Build Feature");
  });

  test("handles multiple spaces in args", () => {
    const result = parseSlashCommand("/atomic Build   a   feature");

    expect(result.args).toBe("Build   a   feature");
  });
});

// ============================================================================
// COMMAND LOOKUP TESTS
// ============================================================================

describe("Command lookup", () => {
  beforeEach(() => {
    // Register test commands
    globalRegistry.register({
      name: "help",
      description: "Show help",
      category: "builtin",
      aliases: ["h", "?"],
      execute: () => ({ success: true, message: "Help!" }),
    });

    globalRegistry.register({
      name: "atomic",
      description: "Start atomic workflow",
      category: "workflow",
      aliases: ["ralph", "loop"],
      execute: (args) => ({
        success: true,
        message: `Starting workflow: ${args}`,
        stateUpdate: { workflowActive: true, workflowType: "atomic" },
      }),
    });

    globalRegistry.register({
      name: "clear",
      description: "Clear messages",
      category: "builtin",
      execute: () => ({ success: true }),
    });
  });

  test("finds command by name", () => {
    const command = globalRegistry.get("help");

    expect(command).toBeDefined();
    expect(command?.name).toBe("help");
  });

  test("finds command by alias", () => {
    const byH = globalRegistry.get("h");
    const byQuestion = globalRegistry.get("?");

    expect(byH?.name).toBe("help");
    expect(byQuestion?.name).toBe("help");
  });

  test("returns undefined for unknown command", () => {
    const command = globalRegistry.get("unknown");

    expect(command).toBeUndefined();
  });

  test("lookup is case-insensitive", () => {
    const upper = globalRegistry.get("HELP");
    const mixed = globalRegistry.get("HeLp");

    expect(upper?.name).toBe("help");
    expect(mixed?.name).toBe("help");
  });
});

// ============================================================================
// COMMAND EXECUTION TESTS
// ============================================================================

describe("Command execution", () => {
  let executedArgs: string | null = null;
  let executedContext: CommandContext | null = null;

  beforeEach(() => {
    executedArgs = null;
    executedContext = null;

    globalRegistry.register({
      name: "test-cmd",
      description: "Test command",
      category: "custom",
      execute: (args, context) => {
        executedArgs = args;
        executedContext = context;
        return { success: true, message: "Executed!" };
      },
    });

    globalRegistry.register({
      name: "failing-cmd",
      description: "Command that fails",
      category: "custom",
      execute: () => ({ success: false, message: "Failed!" }),
    });

    globalRegistry.register({
      name: "state-update-cmd",
      description: "Command with state update",
      category: "custom",
      execute: () => ({
        success: true,
        stateUpdate: {
          workflowActive: true,
          workflowType: "test",
          pendingApproval: true,
        },
      }),
    });

    globalRegistry.register({
      name: "async-cmd",
      description: "Async command",
      category: "custom",
      execute: async (args) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { success: true, message: `Async: ${args}` };
      },
    });

    globalRegistry.register({
      name: "throwing-cmd",
      description: "Command that throws",
      category: "custom",
      execute: () => {
        throw new Error("Command error!");
      },
    });
  });

  test("executes command with args", async () => {
    const command = globalRegistry.get("test-cmd");
    const context = createMockContext({ stateOverrides: { messageCount: 5 } });

    const result = await command!.execute("my args", context);

    expect(executedArgs).toBe("my args");
    expect(executedContext).toBe(context);
    expect(result.success).toBe(true);
    expect(result.message).toBe("Executed!");
  });

  test("handles failed command result", async () => {
    const command = globalRegistry.get("failing-cmd");
    const context = createMockContext();

    const result = await command!.execute("", context);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Failed!");
  });

  test("returns state updates", async () => {
    const command = globalRegistry.get("state-update-cmd");
    const context = createMockContext();

    const result = await command!.execute("", context);

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(true);
    expect(result.stateUpdate?.workflowType).toBe("test");
    expect(result.stateUpdate?.pendingApproval).toBe(true);
  });

  test("handles async commands", async () => {
    const command = globalRegistry.get("async-cmd");
    const context = createMockContext();

    const result = await command!.execute("async arg", context);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Async: async arg");
  });

  test("handles command that throws", async () => {
    const command = globalRegistry.get("throwing-cmd");
    const context = createMockContext();

    // Command execution should throw - ChatApp wraps this in try/catch
    let thrownError: Error | null = null;
    try {
      await command!.execute("", context);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toBe("Command error!");
  });
});

// ============================================================================
// COMMAND CONTEXT TESTS
// ============================================================================

describe("CommandContext", () => {
  test("addMessage callback receives role and content", () => {
    const messages: Array<{ role: string; content: string }> = [];

    globalRegistry.register({
      name: "msg-cmd",
      description: "Command that adds message",
      category: "custom",
      execute: (_, context) => {
        context.addMessage("system", "Command output");
        return { success: true };
      },
    });

    const context = createMockContext({
      onAddMessage: (role, content) => {
        messages.push({ role, content });
      },
    });

    const command = globalRegistry.get("msg-cmd");
    command!.execute("", context);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe("Command output");
  });

  test("setStreaming callback updates streaming state", () => {
    let streamingState = false;

    globalRegistry.register({
      name: "stream-cmd",
      description: "Command that sets streaming",
      category: "custom",
      execute: (_, context) => {
        context.setStreaming(true);
        return { success: true };
      },
    });

    const context = createMockContext({
      onSetStreaming: (streaming) => {
        streamingState = streaming;
      },
    });

    const command = globalRegistry.get("stream-cmd");
    command!.execute("", context);

    expect(streamingState).toBe(true);
  });

  test("context provides workflow state", () => {
    let receivedState: any = null;

    globalRegistry.register({
      name: "state-cmd",
      description: "Command that reads state",
      category: "custom",
      execute: (_, context) => {
        receivedState = context.state;
        return { success: true };
      },
    });

    const context = createMockContext({
      stateOverrides: {
        messageCount: 10,
        workflowActive: true,
        workflowType: "atomic",
        pendingApproval: true,
      },
    });

    const command = globalRegistry.get("state-cmd");
    command!.execute("", context);

    expect(receivedState.isStreaming).toBe(false);
    expect(receivedState.messageCount).toBe(10);
    expect(receivedState.workflowActive).toBe(true);
    expect(receivedState.workflowType).toBe("atomic");
    expect(receivedState.pendingApproval).toBe(true);
  });
});

// ============================================================================
// INTEGRATION FLOW TESTS
// ============================================================================

describe("Command execution flow", () => {
  test("full flow: parse → lookup → execute → result", async () => {
    const messages: string[] = [];

    globalRegistry.register({
      name: "workflow",
      description: "Start workflow",
      category: "workflow",
      execute: (args, context) => {
        context.addMessage("system", `Starting: ${args}`);
        return {
          success: true,
          stateUpdate: { workflowActive: true, workflowType: "test" },
        };
      },
    });

    // 1. Parse input
    const parsed = parseSlashCommand("/workflow Build feature");
    expect(parsed.isCommand).toBe(true);
    expect(parsed.name).toBe("workflow");
    expect(parsed.args).toBe("Build feature");

    // 2. Look up command
    const command = globalRegistry.get(parsed.name);
    expect(command).toBeDefined();

    // 3. Execute with context
    const context = createMockContext({
      stateOverrides: { workflowActive: false },
      onAddMessage: (_, content) => messages.push(content),
    });

    const result = await command!.execute(parsed.args, context);

    // 4. Verify results
    expect(result.success).toBe(true);
    expect(messages).toContain("Starting: Build feature");
    expect(result.stateUpdate?.workflowActive).toBe(true);
  });

  test("handles unknown command gracefully", () => {
    const parsed = parseSlashCommand("/unknown-cmd");
    expect(parsed.isCommand).toBe(true);

    const command = globalRegistry.get(parsed.name);
    expect(command).toBeUndefined();

    // In real implementation, ChatApp would show error message
  });

  test("handles command with alias", async () => {
    globalRegistry.register({
      name: "help",
      description: "Help",
      category: "builtin",
      aliases: ["h"],
      execute: () => ({ success: true, message: "Help text" }),
    });

    const parsed = parseSlashCommand("/h");
    const command = globalRegistry.get(parsed.name);

    expect(command?.name).toBe("help");

    const context = createMockContext();

    const result = await command!.execute("", context);
    expect(result.message).toBe("Help text");
  });
});
