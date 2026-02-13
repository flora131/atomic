/**
 * E2E tests for Sub-agent invocation /debugger
 *
 * These tests verify that when running /debugger:
 * 1. Run /debugger 'fix TypeError in parser.ts'
 * 2. Verify agent spawned with debugging prompt
 * 3. Verify agent has access to Edit, Write tools
 * 4. Verify agent can analyze and fix issue
 *
 * Reference: Feature - E2E test: Sub-agent invocation /debugger
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
import type {
  Session,
  SessionConfig,
  AgentMessage,
  EventType,
  EventHandler,
  ToolDefinition,
  ContextUsage,
  AgentEvent,
  CodingAgentClient,
} from "../../src/sdk/types.ts";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
  CommandContextState,
  SpawnSubagentOptions,
  SpawnSubagentResult,
} from "../../src/ui/commands/registry.ts";
import {
  BUILTIN_AGENTS,
  getBuiltinAgent,
  createAgentCommand,
  registerBuiltinAgents,
} from "../../src/ui/commands/agent-commands.ts";
import { globalRegistry } from "../../src/ui/commands/registry.ts";

// ============================================================================
// TEST HELPERS - Mock Subagent Infrastructure
// ============================================================================

/**
 * Record of a sub-agent spawn for verification.
 */
interface SubagentSpawnRecord {
  /** System prompt passed to sub-agent */
  systemPrompt: string;
  /** Message/task passed to sub-agent */
  message: string;
  /** Tools made available to sub-agent */
  tools: string[] | undefined;
  /** Model specified for sub-agent */
  model: "sonnet" | "opus" | "haiku" | undefined;
  /** Timestamp of spawn */
  timestamp: string;
}

/**
 * Mock sub-agent session for tracking spawned agents.
 */
interface MockSubagentSession extends Session {
  /** Spawn records for verification */
  spawnRecords: SubagentSpawnRecord[];
  /** Last result returned */
  lastResult: SpawnSubagentResult | null;
}

/**
 * Create a mock sub-agent session.
 */
function createMockSubagentSession(id: string): MockSubagentSession {
  const spawnRecords: SubagentSpawnRecord[] = [];

  const session: MockSubagentSession = {
    id,
    spawnRecords,
    lastResult: null,

    async send(message: string): Promise<AgentMessage> {
      return {
        type: "text",
        content: `Debugged: ${message}`,
        role: "assistant",
      };
    },

    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: "Debugging...", role: "assistant" };
      yield { type: "text", content: `Result for: ${message}`, role: "assistant" };
    },

    async summarize(): Promise<void> {},

    async getContextUsage(): Promise<ContextUsage> {
      return {
        inputTokens: 100,
        outputTokens: 50,
        maxTokens: 200000,
        usagePercentage: 0.075,
      };
    },

    getSystemToolsTokens() { return 0; },

    async destroy(): Promise<void> {},
  };

  return session;
}

/**
 * Create a mock command context with sub-agent spawn tracking.
 */
function createMockCommandContext(options?: {
  session?: Session | null;
  state?: Partial<CommandContextState>;
}): CommandContext & {
  spawnRecords: SubagentSpawnRecord[];
  messages: Array<{ role: string; content: string }>;
  sentMessages: string[];
  lastSpawnOptions: SpawnSubagentOptions | null;
} {
  const spawnRecords: SubagentSpawnRecord[] = [];
  const messages: Array<{ role: string; content: string }> = [];
  const sentMessages: string[] = [];
  let lastSpawnOptions: SpawnSubagentOptions | null = null;

  const defaultState: CommandContextState = {
    isStreaming: false,
    messageCount: 0,
  };

  return {
    session: options?.session ?? null,
    state: { ...defaultState, ...options?.state },
    spawnRecords,
    messages,
    sentMessages,
    lastSpawnOptions,

    addMessage(role: "user" | "assistant" | "system", content: string): void {
      messages.push({ role, content });
    },

    setStreaming(streaming: boolean): void {
      this.state.isStreaming = streaming;
    },

    sendMessage(content: string): void {
      sentMessages.push(content);
    },

    sendSilentMessage(content: string): void {
      sentMessages.push(content);
    },

    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    updateWorkflowState: () => {},

    async spawnSubagent(
      opts: SpawnSubagentOptions
    ): Promise<SpawnSubagentResult> {
      lastSpawnOptions = opts;

      // Record the spawn
      const record: SubagentSpawnRecord = {
        systemPrompt: opts.systemPrompt,
        message: opts.message,
        tools: opts.tools,
        model: opts.model,
        timestamp: new Date().toISOString(),
      };
      spawnRecords.push(record);

      // Simulate successful execution
      return {
        success: true,
        output: `Sub-agent executed with message: ${opts.message}`,
      };
    },
  };
}

/**
 * Create a mock SDK client for sub-agent testing.
 */
function createMockSubagentClient(): CodingAgentClient & {
  sessions: Map<string, MockSubagentSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
} {
  const sessions = new Map<string, MockSubagentSession>();
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  let isRunning = false;

  return {
    agentType: "claude",
    sessions,
    eventHandlers,

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `mock-${Date.now()}`;
      const session = createMockSubagentSession(sessionId);
      sessions.set(sessionId, session);

      return session;
    },

    async resumeSession(sessionId: string): Promise<Session | null> {
      return sessions.get(sessionId) ?? null;
    },

    on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
      let handlers = eventHandlers.get(eventType);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(eventType, handlers);
      }
      handlers.add(handler as EventHandler<EventType>);

      return () => {
        handlers?.delete(handler as EventHandler<EventType>);
      };
    },

    registerTool(_tool: ToolDefinition): void {},

    async start(): Promise<void> {
      isRunning = true;
    },

    async stop(): Promise<void> {
      isRunning = false;
      sessions.clear();
      eventHandlers.clear();
    },

    async getModelDisplayInfo() {
      return { model: "Mock Model", tier: "Test" };
    },
    getSystemToolsTokens() { return null; },
  };
}

// ============================================================================
// E2E TEST: Sub-agent invocation /debugger
// ============================================================================

describe("E2E test: Sub-agent invocation /debugger", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "atomic-subagent-debugger-e2e-")
    );
    process.chdir(tmpDir);

    // Clear registry before each test to avoid conflicts
    globalRegistry.clear();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }

    // Clear registry after each test
    globalRegistry.clear();
  });

  // ============================================================================
  // 1. Run /debugger 'fix TypeError in parser.ts'
  // ============================================================================

  describe("1. Run /debugger 'fix TypeError in parser.ts'", () => {
    test("debugger agent exists in BUILTIN_AGENTS", () => {
      const debuggerAgent = BUILTIN_AGENTS.find(
        (agent) => agent.name === "debugger"
      );

      expect(debuggerAgent).toBeDefined();
      expect(debuggerAgent?.name).toBe("debugger");
    });

    test("getBuiltinAgent returns debugger agent", () => {
      const agent = getBuiltinAgent("debugger");

      expect(agent).toBeDefined();
      expect(agent?.name).toBe("debugger");
    });

    test("debugger command can be created from agent definition", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const command = createAgentCommand(agent!);

      expect(command.name).toBe("debugger");
      expect(command.category).toBe("agent");
      expect(typeof command.execute).toBe("function");
    });

    test("registerBuiltinAgents registers debugger command", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();
      expect(command?.name).toBe("debugger");
      expect(command?.category).toBe("agent");
    });

    test("/debugger command executes with arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute(
        "fix TypeError in parser.ts",
        context
      );

      expect(result.success).toBe(true);
    });

    test("/debugger sends message with user arguments appended", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("fix TypeError in parser.ts", context);

      // Should have spawned a subagent with the argument as message
      expect(context.spawnRecords.length).toBeGreaterThan(0);
      expect(context.spawnRecords[0]!.message).toContain("fix TypeError in parser.ts");
    });

    test("/debugger appends user request section to prompt", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("fix undefined error in handler", context);

      // Subagent should have system prompt and user message
      const spawnRecord = context.spawnRecords[0]!;
      expect(spawnRecord.systemPrompt).toBeDefined();
      expect(spawnRecord.message).toContain("fix undefined error in handler");
    });

    test("/debugger handles empty arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("", context);

      expect(result.success).toBe(true);
      // Should still spawn subagent with default message
      expect(context.spawnRecords.length).toBeGreaterThan(0);
    });

    test("/debugger handles complex error descriptions", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const complexError =
        "TypeError: Cannot read property 'map' of undefined at parser.ts:42 in parseTokens()";
      await command!.execute(complexError, context);

      const spawnRecord = context.spawnRecords[0]!;
      expect(spawnRecord.message).toContain(complexError);
      expect(spawnRecord.message).toContain("parser.ts:42");
      expect(spawnRecord.message).toContain("parseTokens");
    });
  });

  // ============================================================================
  // 2. Verify agent spawned with debugging prompt
  // ============================================================================

  describe("2. Verify agent spawned with debugging prompt", () => {
    test("debugger has comprehensive system prompt", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Verify key sections exist in prompt
      expect(prompt).toContain("tasked with debugging and identifying errors");
      expect(prompt).toContain("Available tools");
      expect(prompt).toContain("Debugging process");
      expect(prompt).toContain("For each issue, provide");
      expect(prompt).toContain("Focus on documenting the underlying issue");
    });

    test("system prompt describes debugging role", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      expect(prompt.toLowerCase()).toContain("debug");
      expect(prompt.toLowerCase()).toContain("error");
      expect(prompt).toContain("test failures");
    });

    test("system prompt includes debugging process steps", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe debugging process steps
      expect(prompt).toContain("Capture error message");
      expect(prompt).toContain("Identify reproduction steps");
      expect(prompt).toContain("Isolate the failure location");
      expect(prompt).toContain("debugging report");
      expect(prompt).toContain("Form and test hypotheses");
      expect(prompt).toContain("Inspect variable states");
      expect(prompt).toContain("Analyze error messages and logs");
      expect(prompt).toContain("Check recent code changes");
    });

    test("system prompt includes debug report format", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe expected debug report structure
      expect(prompt).toContain("Root cause explanation");
      expect(prompt).toContain("Evidence supporting the diagnosis");
      expect(prompt).toContain("Suggested code fix");
      expect(prompt).toContain("Testing approach");
      expect(prompt).toContain("Prevention recommendations");
    });

    test("system prompt describes tool usage for debugging", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should explain how to use available tools for debugging
      expect(prompt).toContain("DeepWiki");
      expect(prompt).toContain("WebFetch");
      expect(prompt).toContain("WebSearch");
      expect(prompt).toContain("ask_question");
    });

    test("sendMessage includes full system prompt", async () => {
      registerBuiltinAgents();

      const agent = getBuiltinAgent("debugger");
      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("test query", context);

      // Subagent should be spawned with the full system prompt
      const spawnRecord = context.spawnRecords[0]!;
      expect(spawnRecord.systemPrompt).toContain("tasked with debugging and identifying errors");
      expect(spawnRecord.systemPrompt).toContain(agent!.prompt);
    });

    test("system prompt covers common debugging patterns", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe common debugging patterns
      expect(prompt).toContain("Analyze error messages and logs");
      expect(prompt).toContain("Form and test hypotheses");
      expect(prompt).toContain("Inspect variable states");
      expect(prompt).toContain("Add strategic debug logging");
    });

    test("debugger agent description is specific to debugging", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const description = agent!.description;

      expect(description).toContain("Debugging");
      expect(description).toContain("errors");
      expect(description).toContain("test failures");
    });

    test("debugger has correct source field", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      expect(agent?.source).toBe("builtin");
    });
  });

  // ============================================================================
  // 3. Verify agent has access to Edit, Write tools
  // ============================================================================

  describe("3. Verify agent has access to Edit, Write tools", () => {
    test("debugger has tools array defined", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();
      expect(agent?.tools).toBeDefined();
      expect(Array.isArray(agent?.tools)).toBe(true);
    });

    test("debugger has Edit tool", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("Edit");
    });

    test("debugger has Write tool", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("Write");
    });

    test("debugger has Bash tool", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("Bash");
    });

    test("debugger has Task tool for sub-investigations", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("Task");
    });

    test("debugger has AskUserQuestion tool for clarifications", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("AskUserQuestion");
    });

    test("debugger has Glob tool", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("Glob");
    });

    test("debugger has Grep tool", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("Grep");
    });

    test("debugger has Read tool", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("Read");
    });

    test("debugger has WebFetch tool for documentation", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("WebFetch");
    });

    test("debugger has WebSearch tool for error lookup", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toContain("WebSearch");
    });

    test("debugger has exactly 16 tools", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.tools).toHaveLength(16);
    });

    test("debugger tools match expected set", () => {
      const agent = getBuiltinAgent("debugger");
      const expectedTools = [
        "Bash",
        "Task",
        "AskUserQuestion",
        "Edit",
        "Glob",
        "Grep",
        "NotebookEdit",
        "NotebookRead",
        "Read",
        "TodoWrite",
        "Write",
        "ListMcpResourcesTool",
        "ReadMcpResourceTool",
        "mcp__deepwiki__ask_question",
        "WebFetch",
        "WebSearch",
      ];

      expect(agent?.tools).toEqual(expectedTools);
    });

    test("debugger HAS Edit tool (unlike read-only agents)", () => {
      // Unlike codebase-analyzer and codebase-locator which are read-only,
      // debugger needs Edit to fix issues
      const agent = getBuiltinAgent("debugger");
      const locatorAgent = getBuiltinAgent("codebase-locator");
      const analyzerAgent = getBuiltinAgent("codebase-analyzer");

      expect(agent?.tools).toContain("Edit");
      expect(locatorAgent?.tools).not.toContain("Edit");
      expect(analyzerAgent?.tools).not.toContain("Edit");
    });

    test("debugger HAS Write tool (unlike read-only agents)", () => {
      // Unlike codebase-analyzer and codebase-locator which are read-only,
      // debugger needs Write to create fix files if needed
      const agent = getBuiltinAgent("debugger");
      const locatorAgent = getBuiltinAgent("codebase-locator");
      const analyzerAgent = getBuiltinAgent("codebase-analyzer");

      expect(agent?.tools).toContain("Write");
      expect(locatorAgent?.tools).not.toContain("Write");
      expect(analyzerAgent?.tools).not.toContain("Write");
    });

    test("system prompt mentions fix implementation guidance", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      expect(prompt).toContain("Suggested code fix");
      expect(prompt).toContain("file:line references");
    });

    test("system prompt mentions evidence-based diagnosis", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      expect(prompt).toContain("Evidence supporting the diagnosis");
      expect(prompt).toContain("root causes");
    });

    test("system prompt mentions external research tools", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      expect(prompt).toContain("DeepWiki");
      expect(prompt).toContain("external library documentation");
    });
  });

  // ============================================================================
  // 4. Verify agent can analyze and fix issue
  // ============================================================================

  describe("4. Verify agent can analyze and fix issue", () => {
    test("command execute returns success result", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("fix TypeError in parser.ts", context);

      expect(result.success).toBe(true);
    });

    test("command execute does not return error message on success", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("debug test failure", context);

      expect(result.success).toBe(true);
      // Success result may not have message field or has empty message
      expect(result.message).toBeUndefined();
    });

    test("command spawns subagent", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("fix auth issue", context);

      // Subagent should be spawned
      expect(context.spawnRecords).toHaveLength(1);
      expect(context.spawnRecords[0]!).toBeTruthy();
    });

    test("result includes user request in spawn message", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("fix the TypeError Cannot read property of undefined", context);

      const spawnRecord = context.spawnRecords[0]!;
      expect(spawnRecord.message).toContain("TypeError");
      expect(spawnRecord.message).toContain("Cannot read property of undefined");
    });

    test("multiple invocations each return independent results", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context1 = createMockCommandContext();
      const result1 = await command!.execute("fix error 1", context1);

      const context2 = createMockCommandContext();
      const result2 = await command!.execute("fix error 2", context2);

      // Both should succeed
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Each context has its own spawn record
      expect(context1.spawnRecords[0]!.message).toContain("fix error 1");
      expect(context2.spawnRecords[0]!.message).toContain("fix error 2");
    });

    test("command result type is CommandResult", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result: CommandResult = await command!.execute("test", context);

      // Verify result matches CommandResult interface
      expect(typeof result.success).toBe("boolean");
      expect(
        result.message === undefined || typeof result.message === "string"
      ).toBe(true);
    });

    test("prompt includes search strategies for debugging", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should include strategies for finding and fixing issues
      expect(prompt).toContain("stack trace");
      expect(prompt).toContain("root cause");
      expect(prompt).toContain("error message");
    });

    test("debugger uses opus model for deep analysis", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      // Debugger uses opus for maximum debugging capability
      expect(agent?.model).toBe("opus");
    });
  });

  // ============================================================================
  // 5. Verify agent uses sonnet model
  // ============================================================================

  describe("5. Verify agent uses opus model", () => {
    test("debugger has model field defined", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();
      expect(agent?.model).toBeDefined();
    });

    test("debugger model is set to opus", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.model).toBe("opus");
    });

    test("opus model is highest capability tier", () => {
      const modelTiers: Record<string, number> = {
        haiku: 1, // fastest, lowest capability
        sonnet: 2, // balanced
        opus: 3, // highest capability
      };

      const agent = getBuiltinAgent("debugger");
      expect(agent?.model).toBe("opus");
      expect(modelTiers[agent!.model!]).toBe(3);
    });

    test("debugger uses opus for deep debugging capability", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      expect(agent?.description).toContain("Debugging specialist");
      expect(agent?.model).toBe("opus");
    });

    test("debugger uses same model as analyzer (opus)", () => {
      const debuggerAgent = getBuiltinAgent("debugger");
      const analyzerAgent = getBuiltinAgent("codebase-analyzer");

      // Both use opus for deep analysis capability
      expect(analyzerAgent?.model).toBe("opus");
      expect(debuggerAgent?.model).toBe("opus");
    });

    test("debugger uses same model as locator (opus)", () => {
      const debuggerAgent = getBuiltinAgent("debugger");
      const locatorAgent = getBuiltinAgent("codebase-locator");

      expect(locatorAgent?.model).toBe("opus");
      expect(debuggerAgent?.model).toBe("opus");
    });

    test("agent definition preserves model in command", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const command = createAgentCommand(agent!);

      expect(agent?.model).toBe("opus");
      expect(command.name).toBe("debugger");
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration: Full /debugger workflow", () => {
    test("complete flow: register, lookup, execute, verify", async () => {
      // 1. Register builtin agents
      registerBuiltinAgents();

      // 2. Lookup command
      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();
      expect(command?.category).toBe("agent");

      // 3. Execute with typical user input
      const context = createMockCommandContext();
      const result = await command!.execute("fix TypeError in parser.ts", context);

      // 4. Verify result
      expect(result.success).toBe(true);
      expect(context.spawnRecords).toHaveLength(1);

      // 5. Verify spawn record content
      const spawnRecord = context.spawnRecords[0]!;
      expect(spawnRecord.systemPrompt).toContain("tasked with debugging and identifying errors");
      expect(spawnRecord.message).toContain("fix TypeError in parser.ts");
    });

    test("agent command works with session context", async () => {
      registerBuiltinAgents();

      const mockSession = createMockSubagentSession("test-session");
      const context = createMockCommandContext({
        session: mockSession,
        state: { isStreaming: false, messageCount: 5 },
      });

      const command = globalRegistry.get("debugger");
      const result = await command!.execute("fix failing tests", context);

      expect(result.success).toBe(true);
      expect(context.spawnRecords).toHaveLength(1);
    });

    test("agent command description matches expected format", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      // Description should describe the agent's purpose
      expect(command?.description).toContain("Debugging");
      expect(command?.description).toContain("specialist");
    });

    test("agent is not hidden in command registry", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      expect(command).toBeDefined();

      // Agent commands should be visible for autocomplete
      expect(command?.hidden).toBeFalsy();
    });

    test("agent appears in registry.all() results", () => {
      registerBuiltinAgents();

      const allCommands = globalRegistry.all();
      const debuggerCommand = allCommands.find(
        (cmd) => cmd.name === "debugger"
      );

      expect(debuggerCommand).toBeDefined();
      expect(debuggerCommand?.category).toBe("agent");
    });

    test("agent appears in registry.search() results", () => {
      registerBuiltinAgents();

      const searchResults = globalRegistry.search("debug");
      const debuggerInResults = searchResults.some(
        (cmd) => cmd.name === "debugger"
      );

      expect(debuggerInResults).toBe(true);
    });

    test("multiple user queries work sequentially", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      const context = createMockCommandContext();

      // Query 1
      await command!.execute("fix syntax error", context);
      expect(context.spawnRecords[0]!.message).toContain("fix syntax error");

      // Query 2 (same context, appends)
      await command!.execute("fix runtime error", context);
      expect(context.spawnRecords[1]!.message).toContain("fix runtime error");

      // Query 3
      await command!.execute("fix type error", context);
      expect(context.spawnRecords[2]!.message).toContain("fix type error");

      expect(context.spawnRecords).toHaveLength(3);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    test("handles whitespace-only arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      const context = createMockCommandContext();

      const result = await command!.execute("   ", context);

      expect(result.success).toBe(true);
      // Should spawn subagent with default message (whitespace trimmed)
      expect(context.spawnRecords).toHaveLength(1);
    });

    test("handles very long arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      const context = createMockCommandContext();

      const longArg = "a".repeat(10000);
      const result = await command!.execute(longArg, context);

      expect(result.success).toBe(true);
      expect(context.spawnRecords[0]!.message).toContain(longArg);
    });

    test("handles special characters in arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      const context = createMockCommandContext();

      const specialArgs = "fix error at <file>:42 & 'test' | $PATH";
      const result = await command!.execute(specialArgs, context);

      expect(result.success).toBe(true);
      expect(context.spawnRecords[0]!.message).toContain(specialArgs);
    });

    test("handles newlines in arguments (stack traces)", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      const context = createMockCommandContext();

      const stackTrace = `TypeError: Cannot read property 'x' of undefined
    at parseTokens (parser.ts:42)
    at parse (parser.ts:100)
    at main (index.ts:10)`;
      const result = await command!.execute(stackTrace, context);

      expect(result.success).toBe(true);
      expect(context.spawnRecords[0]!.message).toContain("parser.ts:42");
      expect(context.spawnRecords[0]!.message).toContain("parseTokens");
    });

    test("case-insensitive command lookup", () => {
      registerBuiltinAgents();

      // Registry uses lowercase internally
      const command1 = globalRegistry.get("debugger");
      const command2 = globalRegistry.get("DEBUGGER");
      const command3 = globalRegistry.get("Debugger");

      expect(command1).toBeDefined();
      expect(command2).toBeDefined();
      expect(command3).toBeDefined();
    });

    test("repeated registrations are idempotent", () => {
      registerBuiltinAgents();
      const initialCount = globalRegistry.size();

      // Calling again should not add duplicates
      registerBuiltinAgents();
      const finalCount = globalRegistry.size();

      expect(finalCount).toBe(initialCount);
    });

    test("getBuiltinAgent is case-insensitive", () => {
      const agent1 = getBuiltinAgent("debugger");
      const agent2 = getBuiltinAgent("DEBUGGER");
      const agent3 = getBuiltinAgent("Debugger");

      expect(agent1).toBeDefined();
      expect(agent2).toBeDefined();
      expect(agent3).toBeDefined();
      expect(agent1?.name).toBe(agent2?.name);
      expect(agent2?.name).toBe(agent3?.name);
    });

    test("handles error message with file path and line numbers", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("debugger");
      const context = createMockCommandContext();

      const errorWithPath =
        "fix error at /home/user/project/src/parser.ts:42:15";
      const result = await command!.execute(errorWithPath, context);

      expect(result.success).toBe(true);
      expect(context.spawnRecords[0]!.message).toContain("/home/user/project/src/parser.ts:42:15");
    });
  });

  // ============================================================================
  // Agent Definition Completeness
  // ============================================================================

  describe("Agent definition completeness", () => {
    test("debugger has all required fields", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      // Required fields
      expect(agent?.name).toBe("debugger");
      expect(typeof agent?.description).toBe("string");
      expect(agent?.description.length).toBeGreaterThan(0);
      expect(typeof agent?.prompt).toBe("string");
      expect(agent?.prompt.length).toBeGreaterThan(0);
      expect(agent?.source).toBe("builtin");
    });

    test("debugger description is informative", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const desc = agent!.description;
      expect(desc.length).toBeGreaterThan(30); // Reasonably descriptive
      expect(desc).toContain("Debugging");
    });

    test("debugger prompt is comprehensive", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;
      expect(prompt.length).toBeGreaterThan(1000); // Comprehensive prompt
    });

    test("debugger source is builtin", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent?.source).toBe("builtin");
    });

    test("debugger description mentions unexpected behavior", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const desc = agent!.description;
      expect(desc).toContain("unexpected behavior");
    });
  });

  // ============================================================================
  // Comparison with other agents
  // ============================================================================

  describe("Comparison with other codebase agents", () => {
    test("debugger is distinct from analyzer in purpose", () => {
      const debuggerAgent = getBuiltinAgent("debugger");
      const analyzerAgent = getBuiltinAgent("codebase-analyzer");

      expect(debuggerAgent).toBeDefined();
      expect(analyzerAgent).toBeDefined();

      // Debugger focuses on fixing issues
      expect(debuggerAgent?.description).toContain("errors");
      expect(debuggerAgent?.description).toContain("test failures");

      // Analyzer focuses on understanding code
      expect(analyzerAgent?.description).toContain("Analyzes");
      expect(analyzerAgent?.description).toContain("detailed information");
    });

    test("debugger is distinct from locator in purpose", () => {
      const debuggerAgent = getBuiltinAgent("debugger");
      const locatorAgent = getBuiltinAgent("codebase-locator");

      expect(debuggerAgent).toBeDefined();
      expect(locatorAgent).toBeDefined();

      // Debugger focuses on fixing issues
      expect(debuggerAgent?.description).toContain("Debugging");

      // Locator focuses on finding files
      expect(locatorAgent?.description).toContain("Locates");
    });

    test("debugger has more tools than read-only agents", () => {
      const debuggerAgent = getBuiltinAgent("debugger");
      const analyzerAgent = getBuiltinAgent("codebase-analyzer");
      const locatorAgent = getBuiltinAgent("codebase-locator");

      // Debugger has full toolset including MCP tools (16 tools total)
      expect(debuggerAgent?.tools?.length).toBe(16);

      // Analyzer and locator are read-only (6 tools)
      expect(analyzerAgent?.tools?.length).toBe(6);
      expect(locatorAgent?.tools?.length).toBe(6);

      // Debugger has more tools
      expect(debuggerAgent?.tools?.length).toBeGreaterThan(
        analyzerAgent?.tools?.length ?? 0
      );
    });

    test("debugger uses opus model tier", () => {
      const debuggerAgent = getBuiltinAgent("debugger");
      const analyzerAgent = getBuiltinAgent("codebase-analyzer");
      const locatorAgent = getBuiltinAgent("codebase-locator");
      const patternAgent = getBuiltinAgent("codebase-pattern-finder");

      // Verify model distribution across agents
      expect(locatorAgent?.model).toBe("opus"); // Simple/fast
      expect(patternAgent?.model).toBe("opus"); // Balanced
      expect(debuggerAgent?.model).toBe("opus"); // Powerful
      expect(analyzerAgent?.model).toBe("opus"); // Powerful
    });

    test("debugger is only agent with Task tool", () => {
      const agents = [
        getBuiltinAgent("debugger"),
        getBuiltinAgent("codebase-analyzer"),
        getBuiltinAgent("codebase-locator"),
        getBuiltinAgent("codebase-pattern-finder"),
        getBuiltinAgent("codebase-online-researcher"),
        getBuiltinAgent("codebase-research-analyzer"),
        getBuiltinAgent("codebase-research-locator"),
      ];

      const agentsWithTask = agents.filter(
        (agent) => agent?.tools?.includes("Task")
      );

      // Only debugger should have Task tool
      expect(agentsWithTask.length).toBe(1);
      expect(agentsWithTask[0]?.name).toBe("debugger");
    });

    test("debugger is only agent with AskUserQuestion tool", () => {
      const agents = [
        getBuiltinAgent("debugger"),
        getBuiltinAgent("codebase-analyzer"),
        getBuiltinAgent("codebase-locator"),
        getBuiltinAgent("codebase-pattern-finder"),
        getBuiltinAgent("codebase-online-researcher"),
        getBuiltinAgent("codebase-research-analyzer"),
        getBuiltinAgent("codebase-research-locator"),
      ];

      const agentsWithAsk = agents.filter(
        (agent) => agent?.tools?.includes("AskUserQuestion")
      );

      // Only debugger should have AskUserQuestion tool
      expect(agentsWithAsk.length).toBe(1);
      expect(agentsWithAsk[0]?.name).toBe("debugger");
    });
  });

  // ============================================================================
  // Debug Report Format Tests
  // ============================================================================

  describe("Debug report format", () => {
    test("prompt includes debug report template", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should include guidance for debug report content
      expect(prompt).toContain("Root cause explanation");
      expect(prompt).toContain("Evidence supporting the diagnosis");
      expect(prompt).toContain("Suggested code fix");
      expect(prompt).toContain("Testing approach");
      expect(prompt).toContain("Prevention recommendations");
    });

    test("prompt includes error investigation guidance", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe error investigation approaches
      expect(prompt).toContain("error message");
      expect(prompt).toContain("stack trace");
      expect(prompt).toContain("reproduction steps");
      expect(prompt).toContain("failure location");
      expect(prompt).toContain("test failures");
    });

    test("prompt includes location format guidance", () => {
      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should guide on file:line format
      expect(prompt).toContain("file");
      expect(prompt).toContain("line");
    });
  });
});
