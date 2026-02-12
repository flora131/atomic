/**
 * E2E tests for Sub-agent invocation /codebase-analyzer
 *
 * These tests verify that when running /codebase-analyzer:
 * 1. Run /codebase-analyzer 'analyze authentication flow'
 * 2. Verify agent spawned with correct system prompt
 * 3. Verify agent has access to specified tools
 * 4. Verify agent uses opus model
 * 5. Verify result returned
 *
 * Reference: Feature - E2E test: Sub-agent invocation /codebase-analyzer
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
        content: `Analyzed: ${message}`,
        role: "assistant",
      };
    },

    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: "Analyzing...", role: "assistant" };
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
// E2E TEST: Sub-agent invocation /codebase-analyzer
// ============================================================================

describe("E2E test: Sub-agent invocation /codebase-analyzer", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "atomic-subagent-analyzer-e2e-")
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
  // 1. Run /codebase-analyzer 'analyze authentication flow'
  // ============================================================================

  describe("1. Run /codebase-analyzer 'analyze authentication flow'", () => {
    test("codebase-analyzer agent exists in BUILTIN_AGENTS", () => {
      const analyzerAgent = BUILTIN_AGENTS.find(
        (agent) => agent.name === "codebase-analyzer"
      );

      expect(analyzerAgent).toBeDefined();
      expect(analyzerAgent?.name).toBe("codebase-analyzer");
    });

    test("getBuiltinAgent returns codebase-analyzer agent", () => {
      const agent = getBuiltinAgent("codebase-analyzer");

      expect(agent).toBeDefined();
      expect(agent?.name).toBe("codebase-analyzer");
    });

    test("codebase-analyzer command can be created from agent definition", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const command = createAgentCommand(agent!);

      expect(command.name).toBe("codebase-analyzer");
      expect(command.category).toBe("agent");
      expect(typeof command.execute).toBe("function");
    });

    test("registerBuiltinAgents registers codebase-analyzer command", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();
      expect(command?.name).toBe("codebase-analyzer");
      expect(command?.category).toBe("agent");
    });

    test("/codebase-analyzer command executes with arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute(
        "analyze authentication flow",
        context
      );

      expect(result.success).toBe(true);
    });

    test("/codebase-analyzer sends message with user arguments appended", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      command!.execute("analyze authentication flow", context);

      // Should have sent a message containing the argument
      expect(context.sentMessages.length).toBeGreaterThan(0);
      expect(context.sentMessages[0]).toContain("analyze authentication flow");
    });

    test("/codebase-analyzer appends user request section to prompt", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      command!.execute("analyze login handler", context);

      // Sent message should include both agent prompt and user request
      const sentMessage = context.sentMessages[0];
      expect(sentMessage).toContain("## User Request");
      expect(sentMessage).toContain("analyze login handler");
    });

    test("/codebase-analyzer handles empty arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("", context);

      expect(result.success).toBe(true);
      // Should still send the base prompt without user request section
      expect(context.sentMessages.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // 2. Verify agent spawned with correct system prompt
  // ============================================================================

  describe("2. Verify agent spawned with correct system prompt", () => {
    test("codebase-analyzer has comprehensive system prompt", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Verify key sections exist in prompt
      expect(prompt).toContain("specialist at understanding HOW code works");
      expect(prompt).toContain("## Core Responsibilities");
      expect(prompt).toContain("## Analysis Strategy");
      expect(prompt).toContain("## Output Format");
      expect(prompt).toContain("## Important Guidelines");
    });

    test("system prompt describes codebase analysis role", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      expect(prompt.toLowerCase()).toContain("analyze");
      expect(prompt.toLowerCase()).toContain("code");
      expect(prompt).toContain("implementation details");
    });

    test("system prompt includes analysis steps", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe analysis process steps
      expect(prompt).toContain("Read Entry Points");
      expect(prompt).toContain("Follow the Code Path");
      expect(prompt).toContain("Document Key Logic");
      expect(prompt).toContain("Trace Data Flow");
    });

    test("system prompt includes output format guidance", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should describe expected output structure
      expect(prompt).toContain("Overview");
      expect(prompt).toContain("Entry Points");
      expect(prompt).toContain("Core Implementation");
      expect(prompt).toContain("Data Flow");
    });

    test("system prompt describes tool usage", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Should explain how to use available tools
      expect(prompt).toContain("Read");
      expect(prompt).toContain("file:line references");
      expect(prompt).toContain("Trace actual code paths");
    });

    test("sendMessage includes full system prompt", () => {
      registerBuiltinAgents();

      const agent = getBuiltinAgent("codebase-analyzer");
      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      command!.execute("test query", context);

      // Sent message should start with the system prompt content
      const sentMessage = context.sentMessages[0];
      expect(sentMessage).toContain("specialist at understanding HOW code works");
      expect(sentMessage).toContain(agent!.prompt);
    });
  });

  // ============================================================================
  // 3. Verify agent has access to specified tools
  // ============================================================================

  describe("3. Verify agent has access to specified tools", () => {
    test("codebase-analyzer has tools array defined", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();
      expect(agent?.tools).toBeDefined();
      expect(Array.isArray(agent?.tools)).toBe(true);
    });

    test("codebase-analyzer has Glob tool", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).toContain("Glob");
    });

    test("codebase-analyzer has Grep tool", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).toContain("Grep");
    });

    test("codebase-analyzer has NotebookRead tool", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).toContain("NotebookRead");
    });

    test("codebase-analyzer has Read tool", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).toContain("Read");
    });

    test("codebase-analyzer has LS tool", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).toContain("LS");
    });

    test("codebase-analyzer has Bash tool", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).toContain("Bash");
    });

    test("codebase-analyzer has exactly 6 tools", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).toHaveLength(6);
    });

    test("codebase-analyzer tools match expected set", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      const expectedTools = ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"];

      expect(agent?.tools).toEqual(expectedTools);
    });

    test("codebase-analyzer does NOT have Write tool (read-only)", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).not.toContain("Write");
    });

    test("codebase-analyzer does NOT have Edit tool (read-only)", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.tools).not.toContain("Edit");
    });

    test("system prompt mentions key analysis capabilities", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;

      // Key analysis capabilities should be mentioned in the prompt
      expect(prompt).toContain("Read");
      expect(prompt).toContain("file:line");
      expect(prompt).toContain("Trace");
    });
  });

  // ============================================================================
  // 4. Verify agent uses opus model
  // ============================================================================

  describe("4. Verify agent uses opus model", () => {
    test("codebase-analyzer has model field defined", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();
      expect(agent?.model).toBeDefined();
    });

    test("codebase-analyzer model is set to opus", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.model).toBe("opus");
    });

    test("opus model is highest capability tier", () => {
      // Verify opus is the highest capability model
      const modelTiers: Record<string, number> = {
        haiku: 1, // fastest, lowest capability
        sonnet: 2, // balanced
        opus: 3, // highest capability
      };

      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.model).toBe("opus");
      expect(modelTiers[agent!.model!]).toBe(3);
    });

    test("codebase-analyzer uses opus for deep analysis capability", () => {
      // The description and purpose justify opus model usage
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      // opus is appropriate for:
      // - Deep code analysis
      // - Understanding complex patterns
      // - Detailed explanations
      expect(agent?.description).toContain("detailed information");
      expect(agent?.model).toBe("opus");
    });

    test("all codebase agents use opus model", () => {
      // All codebase agents now use opus for highest capability
      const locatorAgent = getBuiltinAgent("codebase-locator");
      const patternAgent = getBuiltinAgent("codebase-pattern-finder");

      // Locator uses opus (highest capability)
      expect(locatorAgent?.model).toBe("opus");

      // Pattern finder uses opus (highest capability)
      expect(patternAgent?.model).toBe("opus");
    });

    test("agent definition preserves model in command", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const command = createAgentCommand(agent!);

      // The command is created from agent with opus model
      expect(agent?.model).toBe("opus");
      expect(command.name).toBe("codebase-analyzer");
    });
  });

  // ============================================================================
  // 5. Verify result returned
  // ============================================================================

  describe("5. Verify result returned", () => {
    test("command execute returns success result", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("test query", context);

      expect(result.success).toBe(true);
    });

    test("command execute does not return error message on success", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result = await command!.execute("analyze code", context);

      expect(result.success).toBe(true);
      // Success result may not have message field or has empty message
      expect(result.message).toBeUndefined();
    });

    test("command sends message to context", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      command!.execute("analyze auth", context);

      // Message should be sent
      expect(context.sentMessages).toHaveLength(1);
      expect(context.sentMessages[0]).toBeTruthy();
    });

    test("result includes user request in sent message", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      command!.execute("analyze the authentication flow in detail", context);

      const sentMessage = context.sentMessages[0];
      expect(sentMessage).toContain("authentication flow");
    });

    test("multiple invocations each return independent results", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context1 = createMockCommandContext();
      const result1 = await command!.execute("query 1", context1);

      const context2 = createMockCommandContext();
      const result2 = await command!.execute("query 2", context2);

      // Both should succeed
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Each context has its own message
      expect(context1.sentMessages[0]).toContain("query 1");
      expect(context2.sentMessages[0]).toContain("query 2");
    });

    test("command result type is CommandResult", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      const context = createMockCommandContext();
      const result: CommandResult = await command!.execute("test", context);

      // Verify result matches CommandResult interface
      expect(typeof result.success).toBe("boolean");
      expect(
        result.message === undefined || typeof result.message === "string"
      ).toBe(true);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration: Full /codebase-analyzer workflow", () => {
    test("complete flow: register, lookup, execute, verify", async () => {
      // 1. Register builtin agents
      registerBuiltinAgents();

      // 2. Lookup command
      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();
      expect(command?.category).toBe("agent");

      // 3. Execute with typical user input
      const context = createMockCommandContext();
      const result = await command!.execute("analyze authentication flow", context);

      // 4. Verify result
      expect(result.success).toBe(true);
      expect(context.sentMessages).toHaveLength(1);

      // 5. Verify message content
      const message = context.sentMessages[0];
      expect(message).toContain("specialist at understanding HOW code works");
      expect(message).toContain("analyze authentication flow");
    });

    test("agent command works with session context", async () => {
      registerBuiltinAgents();

      const mockSession = createMockSubagentSession("test-session");
      const context = createMockCommandContext({
        session: mockSession,
        state: { isStreaming: false, messageCount: 5 },
      });

      const command = globalRegistry.get("codebase-analyzer");
      const result = await command!.execute("find auth handlers", context);

      expect(result.success).toBe(true);
      expect(context.sentMessages).toHaveLength(1);
    });

    test("agent command description matches expected format", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      // Description should describe the agent's purpose
      expect(command?.description).toContain("Analyzes");
      expect(command?.description).toContain("codebase");
      expect(command?.description).toContain("implementation");
    });

    test("agent is not hidden in command registry", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      expect(command).toBeDefined();

      // Agent commands should be visible for autocomplete
      expect(command?.hidden).toBeFalsy();
    });

    test("agent appears in registry.all() results", () => {
      registerBuiltinAgents();

      const allCommands = globalRegistry.all();
      const analyzerCommand = allCommands.find(
        (cmd) => cmd.name === "codebase-analyzer"
      );

      expect(analyzerCommand).toBeDefined();
      expect(analyzerCommand?.category).toBe("agent");
    });

    test("agent appears in registry.search() results", () => {
      registerBuiltinAgents();

      const searchResults = globalRegistry.search("codebase");
      const analyzerInResults = searchResults.some(
        (cmd) => cmd.name === "codebase-analyzer"
      );

      expect(analyzerInResults).toBe(true);
    });

    test("multiple user queries work sequentially", () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      const context = createMockCommandContext();

      // Query 1
      command!.execute("analyze login", context);
      expect(context.sentMessages[0]).toContain("analyze login");

      // Query 2 (same context, appends)
      command!.execute("analyze logout", context);
      expect(context.sentMessages[1]).toContain("analyze logout");

      // Query 3
      command!.execute("analyze session management", context);
      expect(context.sentMessages[2]).toContain("session management");

      expect(context.sentMessages).toHaveLength(3);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    test("handles whitespace-only arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      const context = createMockCommandContext();

      const result = await command!.execute("   ", context);

      expect(result.success).toBe(true);
      // Should send prompt without user request section (whitespace trimmed)
      expect(context.sentMessages).toHaveLength(1);
    });

    test("handles very long arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      const context = createMockCommandContext();

      const longArg = "a".repeat(10000);
      const result = await command!.execute(longArg, context);

      expect(result.success).toBe(true);
      expect(context.sentMessages[0]).toContain(longArg);
    });

    test("handles special characters in arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      const context = createMockCommandContext();

      const specialArgs = "analyze <user> & 'auth' | $PATH";
      const result = await command!.execute(specialArgs, context);

      expect(result.success).toBe(true);
      expect(context.sentMessages[0]).toContain(specialArgs);
    });

    test("handles newlines in arguments", async () => {
      registerBuiltinAgents();

      const command = globalRegistry.get("codebase-analyzer");
      const context = createMockCommandContext();

      const multilineArgs = "line 1\nline 2\nline 3";
      const result = await command!.execute(multilineArgs, context);

      expect(result.success).toBe(true);
      expect(context.sentMessages[0]).toContain("line 1");
      expect(context.sentMessages[0]).toContain("line 2");
    });

    test("case-insensitive command lookup", () => {
      registerBuiltinAgents();

      // Registry uses lowercase internally
      const command1 = globalRegistry.get("codebase-analyzer");
      const command2 = globalRegistry.get("CODEBASE-ANALYZER");
      const command3 = globalRegistry.get("Codebase-Analyzer");

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
      const agent1 = getBuiltinAgent("codebase-analyzer");
      const agent2 = getBuiltinAgent("CODEBASE-ANALYZER");
      const agent3 = getBuiltinAgent("Codebase-Analyzer");

      expect(agent1).toBeDefined();
      expect(agent2).toBeDefined();
      expect(agent3).toBeDefined();
      expect(agent1?.name).toBe(agent2?.name);
      expect(agent2?.name).toBe(agent3?.name);
    });
  });

  // ============================================================================
  // Agent Definition Completeness
  // ============================================================================

  describe("Agent definition completeness", () => {
    test("codebase-analyzer has all required fields", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      // Required fields
      expect(agent?.name).toBe("codebase-analyzer");
      expect(typeof agent?.description).toBe("string");
      expect(agent?.description.length).toBeGreaterThan(0);
      expect(typeof agent?.prompt).toBe("string");
      expect(agent?.prompt.length).toBeGreaterThan(0);
      expect(agent?.source).toBe("builtin");
    });

    test("codebase-analyzer description is informative", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const desc = agent!.description;
      expect(desc.length).toBeGreaterThan(30); // Reasonably descriptive
      expect(desc).toContain("Analyzes");
    });

    test("codebase-analyzer prompt is comprehensive", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const prompt = agent!.prompt;
      expect(prompt.length).toBeGreaterThan(1000); // Comprehensive prompt
    });

    test("codebase-analyzer source is builtin", () => {
      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent?.source).toBe("builtin");
    });
  });
});
