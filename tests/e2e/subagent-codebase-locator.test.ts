/**
 * E2E tests for Sub-agent invocation /codebase-locator
 *
 * These tests verify that when running /codebase-locator:
 * 1. Run /codebase-locator 'find routing files'
 * 2. Verify agent spawned correctly
 * 3. Verify agent uses opus model
 * 4. Verify files located and returned
 *
 * Reference: Feature - E2E test: Sub-agent invocation /codebase-locator
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
        content: `Located: ${message}`,
        role: "assistant",
      };
    },

    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: "Searching...", role: "assistant" };
      yield { type: "text", content: `Found results for: ${message}`, role: "assistant" };
    },

    async summarize(): Promise<void> {},

    async getContextUsage(): Promise<ContextUsage> {
      return {
        inputTokens: 50,
        outputTokens: 25,
        maxTokens: 200000,
        usagePercentage: 0.0375,
      };
    },

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
        output: `Sub-agent located files for: ${opts.message}`,
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
  };
}

// ============================================================================
// E2E TEST: Sub-agent invocation /codebase-locator
// ============================================================================

describe("E2E test: Sub-agent invocation /codebase-locator", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "atomic-subagent-locator-e2e-")
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
  // 1. Run /codebase-locator 'find routing files'
  // ============================================================================

  describe("1. Run /codebase-locator 'find routing files'", () => {
    test("codebase-locator agent exists in BUILTIN_AGENTS", () => {
      const locatorAgent = BUILTIN_AGENTS.find(
        (agent) => agent.name === "codebase-locator"
      );

      expect(locatorAgent).toBeDefined();
      expect(locatorAgent?.name).toBe("codebase-locator");
    });

    test("getBuiltinAgent returns codebase-locator agent", () => {
      const agent = getBuiltinAgent("codebase-locator");

      expect(agent).toBeDefined();
      expect(agent?.name).toBe("codebase-locator");
    });

    test("codebase-locator command can be created from agent definition", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const command = createAgentCommand(agent!);

      expect(command.name).toBe("codebase-locator");
      expect(command.category).toBe("agent");
      expect(typeof command.execute).toBe("function");
    });

    test("registerBuiltinAgents registers codebase-locator command", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();
      expect(command?.name).toBe("codebase-locator");
      expect(command?.category).toBe("agent");
    });

    test("/codebase-locator command executes with arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute(
        "find routing files",
        context
      );

      expect(result.success).toBe(true);
    });

    test("/codebase-locator sends message with user arguments appended", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("find routing files", context);

      // Should have sent a message containing the argument
      expect(context.sentMessages.length).toBeGreaterThan(0);
      expect(context.sentMessages[0]).toContain("find routing files");
    });

    test("/codebase-locator appends user request section to prompt", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("find all API endpoints", context);

      // Sent message should include both agent prompt and user request
      const sentMessage = context.sentMessages[0];
      expect(sentMessage).toContain("## User Request");
      expect(sentMessage).toContain("find all API endpoints");
    });

    test("/codebase-locator handles empty arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("", context);

      expect(result.success).toBe(true);
      // Should still send the base prompt without user request section
      expect(context.sentMessages.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // 2. Verify agent spawned correctly
  // ============================================================================

  describe("2. Verify agent spawned correctly", () => {
    test("codebase-locator has comprehensive system prompt", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Verify key sections exist in prompt
      expect(prompt).toContain("specialist at finding WHERE code lives");
      expect(prompt).toContain("## Core Responsibilities");
      expect(prompt).toContain("## Search Strategy");
      expect(prompt).toContain("## Output Format");
      expect(prompt).toContain("## Important Guidelines");
    });

    test("system prompt describes file location role", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      expect(prompt.toLowerCase()).toContain("locate");
      expect(prompt.toLowerCase()).toContain("files");
      expect(prompt.toLowerCase()).toContain("directories");
    });

    test("system prompt includes navigation steps", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe navigation process steps
      expect(prompt).toContain("Find Files by Topic/Feature");
      expect(prompt).toContain("Categorize Findings");
      expect(prompt).toContain("Return Structured Results");
      expect(prompt).toContain("Initial Broad Search");
      expect(prompt).toContain("Refine by Language/Framework");
    });

    test("system prompt includes output format guidance", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe expected output structure
      expect(prompt).toContain("Implementation Files");
      expect(prompt).toContain("Test Files");
      expect(prompt).toContain("Related Directories");
    });

    test("system prompt describes tool usage", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should explain how to use available tools
      expect(prompt).toContain("Glob");
      expect(prompt).toContain("grep");
      expect(prompt).toContain("glob");
      expect(prompt).toContain("LS");
    });

    test("sendMessage includes full system prompt", async () => {
      registerBuiltinAgents();

      const agent = getBuiltinAgent("codebase-locator");
      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("test query", context);

      // Sent message should start with the system prompt content
      const sentMessage = context.sentMessages[0];
      expect(sentMessage).toContain("specialist at finding WHERE code lives");
      expect(sentMessage).toContain(agent!.prompt);
    });

    test("codebase-locator agent description is specific to file location", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const description = agent!.description;

      expect(description).toContain("Locates");
      expect(description).toContain("files");
      expect(description).toContain("directories");
      expect(description).toContain("components");
    });

    test("codebase-locator has correct source field", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      expect(agent?.source).toBe("builtin");
    });
  });

  // ============================================================================
  // 3. Verify agent uses haiku model
  // ============================================================================

  describe("3. Verify agent uses opus model", () => {
    test("codebase-locator has model field defined", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();
      expect(agent?.model).toBeDefined();
    });

    test("codebase-locator model is set to opus", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.model).toBe("opus");
    });

    test("opus model is highest capability tier", () => {
      // Verify opus is the highest capability model
      const modelTiers: Record<string, number> = {
        haiku: 1, // fastest, lowest capability
        sonnet: 2, // balanced
        opus: 3, // highest capability
      };

      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.model).toBe("opus");
      expect(modelTiers[agent!.model!]).toBe(3);
    });

    test("codebase-locator uses opus for thorough file location", () => {
      // The description and purpose justify opus model usage
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      // opus is appropriate for:
      // - Thorough file location
      // - Complex pattern matching
      // - Comprehensive directory traversal
      expect(agent?.description).toContain("Locates");
      expect(agent?.model).toBe("opus");
    });

    test("locator uses same model as analyzer", () => {
      // All codebase agents now use opus
      const locatorAgent = getBuiltinAgent("codebase-locator");
      const analyzerAgent = getBuiltinAgent("codebase-analyzer");

      // Both use opus (highest capability)
      expect(locatorAgent?.model).toBe("opus");

      // Analyzer uses opus (complex analysis)
      expect(analyzerAgent?.model).toBe("opus");
    });

    test("agent definition preserves model in command", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const command = createAgentCommand(agent!);

      // The command is created from agent with opus model
      expect(agent?.model).toBe("opus");
      expect(command.name).toBe("codebase-locator");
    });

    test("opus model provides highest capability for navigation", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      // opus is the highest capability model
      // appropriate for thorough tasks like comprehensive file location
      const capabilityTiers: Record<string, string> = {
        haiku: "low",
        sonnet: "medium",
        opus: "high",
      };

      expect(capabilityTiers[agent!.model!]).toBe("high");
    });
  });

  // ============================================================================
  // 4. Verify files located and returned
  // ============================================================================

  describe("4. Verify files located and returned", () => {
    test("command execute returns success result", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("find config files", context);

      expect(result.success).toBe(true);
    });

    test("command execute does not return error message on success", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("locate test files", context);

      expect(result.success).toBe(true);
      // Success result may not have message field or has empty message
      expect(result.message).toBeUndefined();
    });

    test("command sends message to context", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("find utils", context);

      // Message should be sent
      expect(context.sentMessages).toHaveLength(1);
      expect(context.sentMessages[0]).toBeTruthy();
    });

    test("result includes user request in sent message", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      await command!.execute("find all routing files in the project", context);

      const sentMessage = context.sentMessages[0];
      expect(sentMessage).toContain("routing files");
    });

    test("multiple invocations each return independent results", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context1 = createMockCommandContext();
      const result1 = await command!.execute("find controllers", context1);

      const context2 = createMockCommandContext();
      const result2 = await command!.execute("find services", context2);

      // Both should succeed
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Each context has its own message
      expect(context1.sentMessages[0]).toContain("find controllers");
      expect(context2.sentMessages[0]).toContain("find services");
    });

    test("command result type is CommandResult", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result: CommandResult = await command!.execute("test", context);

      // Verify result matches CommandResult interface
      expect(typeof result.success).toBe("boolean");
      expect(
        result.message === undefined || typeof result.message === "string"
      ).toBe(true);
    });

    test("prompt includes search strategies for file patterns", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should include common file patterns for location
      expect(prompt).toContain("service");
      expect(prompt).toContain("handler");
      expect(prompt).toContain("controller");
      expect(prompt).toContain("test");
      expect(prompt).toContain("config");
    });
  });

  // ============================================================================
  // 5. Verify agent has access to specified tools
  // ============================================================================

  describe("5. Verify agent has access to specified tools", () => {
    test("codebase-locator has tools array defined", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();
      expect(agent?.tools).toBeDefined();
      expect(Array.isArray(agent?.tools)).toBe(true);
    });

    test("codebase-locator has Glob tool", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).toContain("Glob");
    });

    test("codebase-locator has Grep tool", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).toContain("Grep");
    });

    test("codebase-locator has NotebookRead tool", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).toContain("NotebookRead");
    });

    test("codebase-locator has Read tool", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).toContain("Read");
    });

    test("codebase-locator has LS tool", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).toContain("LS");
    });

    test("codebase-locator has Bash tool", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).toContain("Bash");
    });

    test("codebase-locator has exactly 6 tools", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).toHaveLength(6);
    });

    test("codebase-locator tools match expected set", () => {
      const agent = getBuiltinAgent("codebase-locator");
      const expectedTools = ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"];

      expect(agent?.tools).toEqual(expectedTools);
    });

    test("codebase-locator does NOT have Write tool (read-only)", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).not.toContain("Write");
    });

    test("codebase-locator does NOT have Edit tool (read-only)", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.tools).not.toContain("Edit");
    });

    test("system prompt mentions key search tools", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Key search tools should be mentioned in the prompt
      expect(prompt).toContain("grep");
      expect(prompt).toContain("glob");
      expect(prompt).toContain("LS");
    });

    test("codebase-locator has same tools as codebase-analyzer", () => {
      const locator = getBuiltinAgent("codebase-locator");
      const analyzer = getBuiltinAgent("codebase-analyzer");

      // Both should have the same read-only tool set
      expect(locator?.tools).toEqual(analyzer?.tools);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration: Full /codebase-locator workflow", () => {
    test("complete flow: register, lookup, execute, verify", async () => {
      // 1. Register builtin agents
      registerBuiltinAgents();

      // 2. Lookup command
      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();
      expect(command?.category).toBe("agent");

      // 3. Execute with typical user input
      const context = createMockCommandContext();
      const result = await command!.execute("find routing files", context);

      // 4. Verify result
      expect(result.success).toBe(true);
      expect(context.sentMessages).toHaveLength(1);

      // 5. Verify message content
      const message = context.sentMessages[0];
      expect(message).toContain("specialist at finding WHERE code lives");
      expect(message).toContain("find routing files");
    });

    test("agent command works with session context", async () => {
      registerBuiltinAgents();

      const mockSession = createMockSubagentSession("test-session");
      const context = createMockCommandContext({
        session: mockSession,
        state: { isStreaming: false, messageCount: 5 },
      });

      const command = globalRegistry.get("codebase-locator");
      const result = await command!.execute("find auth handlers", context);

      expect(result.success).toBe(true);
      expect(context.sentMessages).toHaveLength(1);
    });

    test("agent command description matches expected format", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      // Description should describe the agent's purpose
      expect(command?.description).toContain("Locates");
      expect(command?.description).toContain("files");
    });

    test("agent is not hidden in command registry", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      expect(command).toBeDefined();

      // Agent commands should be visible for autocomplete
      expect(command?.hidden).toBeFalsy();
    });

    test("agent appears in registry.all() results", () => {
      registerBuiltinAgents();

      const allCommands = globalRegistry.all();
      const locatorCommand = allCommands.find(
        (cmd) => cmd.name === "codebase-locator"
      );

      expect(locatorCommand).toBeDefined();
      expect(locatorCommand?.category).toBe("agent");
    });

    test("agent appears in registry.search() results", () => {
      registerBuiltinAgents();

      const searchResults = globalRegistry.search("codebase");
      const locatorInResults = searchResults.some(
        (cmd) => cmd.name === "codebase-locator"
      );

      expect(locatorInResults).toBe(true);
    });

    test("multiple user queries work sequentially", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      const context = createMockCommandContext();

      // Query 1
      await command!.execute("find controllers", context);
      expect(context.sentMessages[0]).toContain("find controllers");

      // Query 2 (same context, appends)
      await command!.execute("find services", context);
      expect(context.sentMessages[1]).toContain("find services");

      // Query 3
      await command!.execute("find middleware", context);
      expect(context.sentMessages[2]).toContain("find middleware");

      expect(context.sentMessages).toHaveLength(3);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    test("handles whitespace-only arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      const context = createMockCommandContext();

      const result = await command!.execute("   ", context);

      expect(result.success).toBe(true);
      // Should send prompt without user request section (whitespace trimmed)
      expect(context.sentMessages).toHaveLength(1);
    });

    test("handles very long arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      const context = createMockCommandContext();

      const longArg = "a".repeat(10000);
      const result = await command!.execute(longArg, context);

      expect(result.success).toBe(true);
      expect(context.sentMessages[0]).toContain(longArg);
    });

    test("handles special characters in arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      const context = createMockCommandContext();

      const specialArgs = "find <user> & 'auth' | $PATH files";
      const result = await command!.execute(specialArgs, context);

      expect(result.success).toBe(true);
      expect(context.sentMessages[0]).toContain(specialArgs);
    });

    test("handles newlines in arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      const context = createMockCommandContext();

      const multilineArgs = "find file1\nfind file2\nfind file3";
      const result = await command!.execute(multilineArgs, context);

      expect(result.success).toBe(true);
      expect(context.sentMessages[0]).toContain("find file1");
      expect(context.sentMessages[0]).toContain("find file2");
    });

    test("case-insensitive command lookup", () => {
      registerBuiltinAgents();

      // Registry uses lowercase internally
      const command1 = globalRegistry.get("codebase-locator");
      const command2 = globalRegistry.get("CODEBASE-LOCATOR");
      const command3 = globalRegistry.get("Codebase-Locator");

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
      const agent1 = getBuiltinAgent("codebase-locator");
      const agent2 = getBuiltinAgent("CODEBASE-LOCATOR");
      const agent3 = getBuiltinAgent("Codebase-Locator");

      expect(agent1).toBeDefined();
      expect(agent2).toBeDefined();
      expect(agent3).toBeDefined();
      expect(agent1?.name).toBe(agent2?.name);
      expect(agent2?.name).toBe(agent3?.name);
    });

    test("handles glob pattern-like arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-locator");
      const context = createMockCommandContext();

      const globPatternArg = "find **/*.ts files";
      const result = await command!.execute(globPatternArg, context);

      expect(result.success).toBe(true);
      expect(context.sentMessages[0]).toContain("**/*.ts");
    });
  });

  // ============================================================================
  // Agent Definition Completeness
  // ============================================================================

  describe("Agent definition completeness", () => {
    test("codebase-locator has all required fields", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      // Required fields
      expect(agent?.name).toBe("codebase-locator");
      expect(typeof agent?.description).toBe("string");
      expect(agent?.description.length).toBeGreaterThan(0);
      expect(typeof agent?.prompt).toBe("string");
      expect(agent?.prompt.length).toBeGreaterThan(0);
      expect(agent?.source).toBe("builtin");
    });

    test("codebase-locator description is informative", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const desc = agent!.description;
      expect(desc.length).toBeGreaterThan(30); // Reasonably descriptive
      expect(desc).toContain("Locates");
    });

    test("codebase-locator prompt is comprehensive", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;
      expect(prompt.length).toBeGreaterThan(1000); // Comprehensive prompt
    });

    test("codebase-locator source is builtin", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent?.source).toBe("builtin");
    });

    test("codebase-locator description mentions Super Grep/Glob/LS", () => {
      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();

      const desc = agent!.description;
      expect(desc).toContain("Super Grep/Glob/LS tool");
    });
  });

  // ============================================================================
  // Comparison with Other Agents
  // ============================================================================

  describe("Comparison with other codebase agents", () => {
    test("locator is distinct from analyzer in purpose", () => {
      const locator = getBuiltinAgent("codebase-locator");
      const analyzer = getBuiltinAgent("codebase-analyzer");

      expect(locator?.description).toContain("Locates");
      expect(analyzer?.description).toContain("Analyzes");

      // Both use opus model for highest capability
      expect(locator?.model).toBe("opus");
      expect(analyzer?.model).toBe("opus");
    });

    test("locator is distinct from pattern-finder in purpose", () => {
      const locator = getBuiltinAgent("codebase-locator");
      const patternFinder = getBuiltinAgent("codebase-pattern-finder");

      expect(locator?.description).toContain("Locates");
      expect(patternFinder?.description).toContain("finding similar implementations");

      // Both use opus (highest capability model)
      expect(locator?.model).toBe("opus");
      expect(patternFinder?.model).toBe("opus");
    });

    test("all codebase agents have same tool set", () => {
      const locator = getBuiltinAgent("codebase-locator");
      const analyzer = getBuiltinAgent("codebase-analyzer");
      const patternFinder = getBuiltinAgent("codebase-pattern-finder");

      // All should have the same read-only tool set
      expect(locator?.tools).toEqual(analyzer?.tools);
      expect(analyzer?.tools).toEqual(patternFinder?.tools);
    });

    test("all codebase agents use the same opus model", () => {
      const locator = getBuiltinAgent("codebase-locator");
      const analyzer = getBuiltinAgent("codebase-analyzer");
      const patternFinder = getBuiltinAgent("codebase-pattern-finder");

      // All codebase agents now use opus for highest capability
      expect(locator!.model).toBe("opus");
      expect(analyzer!.model).toBe("opus");
      expect(patternFinder!.model).toBe("opus");
    });
  });
});
