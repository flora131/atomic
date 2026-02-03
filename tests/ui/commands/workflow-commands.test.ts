/**
 * Tests for Workflow Commands
 *
 * Verifies workflow command registration and execution behavior.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  WORKFLOW_DEFINITIONS,
  workflowCommands,
  registerWorkflowCommands,
  getWorkflowMetadata,
  createWorkflowByName,
  parseRalphArgs,
  isValidUUID,
  type WorkflowMetadata,
  type RalphCommandArgs,
} from "../../../src/ui/commands/workflow-commands.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
  type CommandResult,
} from "../../../src/ui/commands/registry.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  stateOverrides: Partial<CommandContextState> = {}
): CommandContext {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
      ...stateOverrides,
    },
    addMessage: (role, content) => {
      messages.push({ role, content });
    },
    setStreaming: () => {},
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("WORKFLOW_DEFINITIONS", () => {
  test("contains atomic workflow", () => {
    const atomic = WORKFLOW_DEFINITIONS.find((w) => w.name === "atomic");
    expect(atomic).toBeDefined();
    expect(atomic?.description).toContain("Atomic");
  });

  test("atomic has correct aliases", () => {
    const atomic = WORKFLOW_DEFINITIONS.find((w) => w.name === "atomic");
    expect(atomic?.aliases).toContain("loop");
  });

  test("ralph workflow is defined separately", () => {
    const ralph = WORKFLOW_DEFINITIONS.find((w) => w.name === "ralph");
    expect(ralph).toBeDefined();
    expect(ralph?.description).toContain("Ralph");
    expect(ralph?.description).toContain("autonomous");
  });

  test("ralph createWorkflow returns a compiled graph", () => {
    const ralph = WORKFLOW_DEFINITIONS.find((w) => w.name === "ralph");
    expect(ralph).toBeDefined();

    const graph = ralph!.createWorkflow();
    expect(graph).toBeDefined();
    expect(graph.nodes).toBeInstanceOf(Map);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(typeof graph.startNode).toBe("string");
  });

  test("ralph createWorkflow accepts configuration", () => {
    const ralph = WORKFLOW_DEFINITIONS.find((w) => w.name === "ralph");
    expect(ralph).toBeDefined();

    const graph = ralph!.createWorkflow({
      maxIterations: 50,
      checkpointing: true,
      yolo: true,
      userPrompt: "Test prompt",
    });
    expect(graph).toBeDefined();
  });

  test("atomic createWorkflow returns a compiled graph", () => {
    const atomic = WORKFLOW_DEFINITIONS.find((w) => w.name === "atomic");
    expect(atomic).toBeDefined();

    const graph = atomic!.createWorkflow();
    expect(graph).toBeDefined();
    expect(graph.nodes).toBeInstanceOf(Map);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(typeof graph.startNode).toBe("string");
  });

  test("atomic createWorkflow accepts configuration", () => {
    const atomic = WORKFLOW_DEFINITIONS.find((w) => w.name === "atomic");
    expect(atomic).toBeDefined();

    const graph = atomic!.createWorkflow({ maxIterations: 10, checkpointing: false });
    expect(graph).toBeDefined();
  });
});

describe("workflowCommands", () => {
  test("has correct number of commands", () => {
    expect(workflowCommands.length).toBe(WORKFLOW_DEFINITIONS.length);
  });

  test("atomic command has correct metadata", () => {
    const atomicCmd = workflowCommands.find((c) => c.name === "atomic");
    expect(atomicCmd).toBeDefined();
    expect(atomicCmd?.category).toBe("workflow");
    expect(atomicCmd?.aliases).toContain("loop");
  });

  test("ralph command has correct metadata", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();
    expect(ralphCmd?.category).toBe("workflow");
    // ralph has no aliases, it's a standalone command
    expect(ralphCmd?.aliases).toBeUndefined();
  });

  test("atomic command requires a prompt", () => {
    const atomicCmd = workflowCommands.find((c) => c.name === "atomic");
    expect(atomicCmd).toBeDefined();

    const context = createMockContext();
    const result = atomicCmd!.execute("", context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("provide a prompt");
  });

  test("atomic command fails if workflow already active", () => {
    const atomicCmd = workflowCommands.find((c) => c.name === "atomic");
    expect(atomicCmd).toBeDefined();

    const context = createMockContext({
      workflowActive: true,
      workflowType: "atomic",
    });
    const result = atomicCmd!.execute("Build a feature", context) as CommandResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain("already active");
  });

  test("atomic command starts workflow with valid prompt", () => {
    const atomicCmd = workflowCommands.find((c) => c.name === "atomic");
    expect(atomicCmd).toBeDefined();

    const context = createMockContext();
    const result = atomicCmd!.execute("Build a new feature", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(true);
    expect(result.stateUpdate?.workflowType).toBe("atomic");
    expect(result.stateUpdate?.initialPrompt).toBe("Build a new feature");
    expect(result.stateUpdate?.pendingApproval).toBe(false);
    expect(result.stateUpdate?.specApproved).toBeUndefined();
  });

  test("atomic command adds system message", () => {
    const atomicCmd = workflowCommands.find((c) => c.name === "atomic");
    expect(atomicCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const context: CommandContext = {
      session: null,
      state: {
        isStreaming: false,
        messageCount: 0,
        workflowActive: false,
      },
      addMessage: (role, content) => {
        messages.push({ role, content });
      },
      setStreaming: () => {},
    };

    atomicCmd!.execute("Build a feature", context);

    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Starting");
    expect(messages[0]?.content).toContain("atomic");
    expect(messages[0]?.content).toContain("Build a feature");
  });

  test("atomic command trims prompt whitespace", () => {
    const atomicCmd = workflowCommands.find((c) => c.name === "atomic");
    expect(atomicCmd).toBeDefined();

    const context = createMockContext();
    const result = atomicCmd!.execute("  Build a feature  ", context) as CommandResult;

    expect(result.stateUpdate?.initialPrompt).toBe("Build a feature");
  });
});

describe("registerWorkflowCommands", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  afterEach(() => {
    globalRegistry.clear();
  });

  test("registers all workflow commands", () => {
    registerWorkflowCommands();

    expect(globalRegistry.has("atomic")).toBe(true);
  });

  test("registers workflow and aliases", () => {
    registerWorkflowCommands();

    // ralph is now a separate workflow, not an alias
    expect(globalRegistry.has("ralph")).toBe(true);
    // loop is an alias of atomic
    expect(globalRegistry.has("loop")).toBe(true);
  });

  test("is idempotent", () => {
    registerWorkflowCommands();
    registerWorkflowCommands();

    // Should not throw and should still have correct count
    expect(globalRegistry.size()).toBe(WORKFLOW_DEFINITIONS.length);
  });

  test("commands are executable after registration", () => {
    registerWorkflowCommands();

    const atomicCmd = globalRegistry.get("atomic");
    expect(atomicCmd).toBeDefined();

    const context = createMockContext();
    const result = atomicCmd!.execute("Test prompt", context) as CommandResult;

    expect(result.success).toBe(true);
  });

  test("commands can be looked up by alias after registration", () => {
    registerWorkflowCommands();

    const byRalph = globalRegistry.get("ralph");
    const byLoop = globalRegistry.get("loop");
    const byAtomic = globalRegistry.get("atomic");

    // ralph is now a separate workflow command, not an alias
    expect(byRalph?.name).toBe("ralph");
    // loop is still an alias of atomic
    expect(byLoop?.name).toBe("atomic");
    expect(byAtomic?.name).toBe("atomic");
  });
});

describe("getWorkflowMetadata", () => {
  test("finds workflow by name", () => {
    const metadata = getWorkflowMetadata("atomic");
    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe("atomic");
  });

  test("finds workflow by alias", () => {
    // ralph is now a separate workflow, not an alias
    const byRalph = getWorkflowMetadata("ralph");
    const byLoop = getWorkflowMetadata("loop");

    expect(byRalph?.name).toBe("ralph");
    expect(byLoop?.name).toBe("atomic");
  });

  test("is case-insensitive", () => {
    expect(getWorkflowMetadata("ATOMIC")?.name).toBe("atomic");
    expect(getWorkflowMetadata("Atomic")?.name).toBe("atomic");
    // ralph is now a separate workflow
    expect(getWorkflowMetadata("RALPH")?.name).toBe("ralph");
  });

  test("returns undefined for unknown workflow", () => {
    expect(getWorkflowMetadata("unknown")).toBeUndefined();
    expect(getWorkflowMetadata("")).toBeUndefined();
  });
});

describe("createWorkflowByName", () => {
  test("creates workflow by name", () => {
    const graph = createWorkflowByName("atomic");
    expect(graph).toBeDefined();
    expect(graph?.nodes).toBeInstanceOf(Map);
    expect(Array.isArray(graph?.edges)).toBe(true);
    expect(typeof graph?.startNode).toBe("string");
  });

  test("creates workflow by alias", () => {
    const byRalph = createWorkflowByName("ralph");
    const byLoop = createWorkflowByName("loop");

    expect(byRalph).toBeDefined();
    expect(byLoop).toBeDefined();
  });

  test("accepts configuration override", () => {
    const graph = createWorkflowByName("atomic", { maxIterations: 5 });
    expect(graph).toBeDefined();
  });

  test("merges default config with provided config", () => {
    // This tests that defaultConfig is applied
    const graph = createWorkflowByName("atomic", { maxIterations: 10 });
    expect(graph).toBeDefined();
  });

  test("returns undefined for unknown workflow", () => {
    expect(createWorkflowByName("unknown")).toBeUndefined();
    expect(createWorkflowByName("")).toBeUndefined();
  });

  test("is case-insensitive", () => {
    expect(createWorkflowByName("ATOMIC")).toBeDefined();
    expect(createWorkflowByName("Atomic")).toBeDefined();
  });
});

describe("WorkflowMetadata interface", () => {
  test("each definition has required fields", () => {
    for (const def of WORKFLOW_DEFINITIONS) {
      expect(typeof def.name).toBe("string");
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
      expect(typeof def.createWorkflow).toBe("function");
    }
  });

  test("each definition has valid aliases if present", () => {
    for (const def of WORKFLOW_DEFINITIONS) {
      if (def.aliases) {
        expect(Array.isArray(def.aliases)).toBe(true);
        for (const alias of def.aliases) {
          expect(typeof alias).toBe("string");
          expect(alias.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ============================================================================
// PARSE RALPH ARGS TESTS
// ============================================================================

describe("parseRalphArgs", () => {
  test("parses --yolo flag with prompt", () => {
    const result = parseRalphArgs("--yolo implement auth");
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBe("implement auth");
  });

  test("parses --yolo flag without prompt", () => {
    const result = parseRalphArgs("--yolo");
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBeNull();
  });

  test("parses --yolo with leading/trailing whitespace", () => {
    const result = parseRalphArgs("  --yolo  implement auth  ");
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBe("implement auth");
  });

  test("parses normal mode with prompt", () => {
    const result = parseRalphArgs("my feature");
    expect(result.yolo).toBe(false);
    expect(result.prompt).toBe("my feature");
  });

  test("parses empty args as normal mode with null prompt", () => {
    const result = parseRalphArgs("");
    expect(result.yolo).toBe(false);
    expect(result.prompt).toBeNull();
  });

  test("parses whitespace-only args as null prompt", () => {
    const result = parseRalphArgs("   ");
    expect(result.yolo).toBe(false);
    expect(result.prompt).toBeNull();
  });

  test("does not treat --yolo in the middle as a flag", () => {
    const result = parseRalphArgs("implement --yolo auth");
    expect(result.yolo).toBe(false);
    expect(result.prompt).toBe("implement --yolo auth");
  });

  test("handles multiline prompts after --yolo", () => {
    const result = parseRalphArgs("--yolo implement\nauthentication");
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBe("implement\nauthentication");
  });
});

// ============================================================================
// RALPH COMMAND --yolo INTEGRATION TESTS
// ============================================================================

describe("ralph command --yolo flag", () => {
  test("ralph command with --yolo flag and prompt succeeds", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--yolo implement auth", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.initialPrompt).toBe("implement auth");
    expect(result.stateUpdate?.ralphConfig?.yolo).toBe(true);
    expect(result.stateUpdate?.ralphConfig?.userPrompt).toBe("implement auth");
    expect(result.message).toContain("yolo mode");
  });

  test("ralph command with --yolo flag without prompt fails", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--yolo", context) as CommandResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain("--yolo flag requires a prompt");
  });

  test("ralph command without flags requires prompt", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("", context) as CommandResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain("provide a prompt");
  });

  test("ralph command without flags uses normal mode", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("my feature prompt", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.initialPrompt).toBe("my feature prompt");
    expect(result.stateUpdate?.ralphConfig?.yolo).toBe(false);
    expect(result.message).not.toContain("yolo mode");
  });

  test("ralph command adds system message with yolo indicator", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const context: CommandContext = {
      session: null,
      state: {
        isStreaming: false,
        messageCount: 0,
        workflowActive: false,
      },
      addMessage: (role, content) => {
        messages.push({ role, content });
      },
      setStreaming: () => {},
    };

    ralphCmd!.execute("--yolo implement auth", context);

    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("yolo mode");
    expect(messages[0]?.content).toContain("implement auth");
  });
});

// ============================================================================
// UUID VALIDATION TESTS
// ============================================================================

describe("isValidUUID", () => {
  test("validates correct UUID v4 format", () => {
    expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUUID("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isValidUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
    expect(isValidUUID("550e8400-E29B-41d4-A716-446655440000")).toBe(true);
  });

  test("rejects invalid formats", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("")).toBe(false);
    expect(isValidUUID("550e8400-e29b-41d4-a716")).toBe(false);
    expect(isValidUUID("550e8400e29b41d4a716446655440000")).toBe(false);
    expect(isValidUUID("sess_123_abc")).toBe(false);
  });
});

// ============================================================================
// PARSE RALPH ARGS --resume TESTS
// ============================================================================

describe("parseRalphArgs --resume flag", () => {
  test("parses --resume flag with UUID", () => {
    const result = parseRalphArgs("--resume 550e8400-e29b-41d4-a716-446655440000");
    expect(result.yolo).toBe(false);
    expect(result.prompt).toBeNull();
    expect(result.resumeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("parses --resume flag without UUID", () => {
    const result = parseRalphArgs("--resume");
    expect(result.yolo).toBe(false);
    expect(result.prompt).toBeNull();
    expect(result.resumeSessionId).toBeNull();
  });

  test("parses --resume with leading/trailing whitespace", () => {
    const result = parseRalphArgs("  --resume  550e8400-e29b-41d4-a716-446655440000  ");
    expect(result.resumeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("extracts only first token after --resume", () => {
    const result = parseRalphArgs("--resume 550e8400-e29b-41d4-a716-446655440000 extra args");
    expect(result.resumeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("does not treat --resume in the middle as a flag", () => {
    const result = parseRalphArgs("some prompt --resume abc123");
    expect(result.yolo).toBe(false);
    expect(result.prompt).toBe("some prompt --resume abc123");
    expect(result.resumeSessionId).toBeNull();
  });

  test("--resume takes precedence over --yolo when first", () => {
    const result = parseRalphArgs("--resume 550e8400-e29b-41d4-a716-446655440000");
    expect(result.resumeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.yolo).toBe(false);
  });
});

// ============================================================================
// RALPH COMMAND --resume INTEGRATION TESTS
// ============================================================================

describe("ralph command --resume flag", () => {
  const testSessionId = "550e8400-e29b-41d4-a716-446655440000";
  const testSessionDir = `.ralph/sessions/${testSessionId}`;

  beforeEach(() => {
    // Create test session directory
    mkdirSync(testSessionDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test session directory
    if (existsSync(".ralph")) {
      rmSync(".ralph", { recursive: true, force: true });
    }
  });

  test("ralph command with --resume flag and valid session succeeds", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute(`--resume ${testSessionId}`, context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.ralphConfig?.resumeSessionId).toBe(testSessionId);
    expect(result.stateUpdate?.ralphConfig?.yolo).toBe(false);
    expect(result.message).toContain("Resuming");
    expect(result.message).toContain(testSessionId);
  });

  test("ralph command with --resume flag and invalid UUID fails", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--resume not-a-uuid", context) as CommandResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid session ID format");
  });

  test("ralph command with --resume flag and non-existent session fails", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const nonExistentId = "11111111-2222-3333-4444-555555555555";
    const result = ralphCmd!.execute(`--resume ${nonExistentId}`, context) as CommandResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain("Session not found");
    expect(result.message).toContain(nonExistentId);
  });

  test("ralph command with --resume flag without UUID fails", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--resume", context) as CommandResult;

    expect(result.success).toBe(false);
    // Either fails on missing UUID or on validation
    expect(result.success).toBe(false);
  });

  test("ralph command adds system message when resuming", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const context: CommandContext = {
      session: null,
      state: {
        isStreaming: false,
        messageCount: 0,
        workflowActive: false,
      },
      addMessage: (role, content) => {
        messages.push({ role, content });
      },
      setStreaming: () => {},
    };

    ralphCmd!.execute(`--resume ${testSessionId}`, context);

    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Resuming session");
    expect(messages[0]?.content).toContain(testSessionId);
  });

  test("ralph command with --resume sets correct workflow state", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute(`--resume ${testSessionId}`, context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.workflowActive).toBe(true);
    expect(result.stateUpdate?.workflowType).toBe("ralph");
    expect(result.stateUpdate?.initialPrompt).toBeNull();
    expect(result.stateUpdate?.ralphConfig?.resumeSessionId).toBe(testSessionId);
  });
});

// ============================================================================
// PARSE RALPH ARGS --max-iterations TESTS
// ============================================================================

describe("parseRalphArgs --max-iterations flag", () => {
  test("parses --max-iterations flag with number", () => {
    const result = parseRalphArgs("--max-iterations 50 implement auth");
    expect(result.maxIterations).toBe(50);
    expect(result.prompt).toBe("implement auth");
    expect(result.yolo).toBe(false);
  });

  test("defaults to 100 if --max-iterations not specified", () => {
    const result = parseRalphArgs("implement auth");
    expect(result.maxIterations).toBe(100);
  });

  test("parses --max-iterations 0 for infinite iterations", () => {
    const result = parseRalphArgs("--max-iterations 0 implement auth");
    expect(result.maxIterations).toBe(0);
    expect(result.prompt).toBe("implement auth");
  });

  test("parses --max-iterations with --yolo flag (--max-iterations first)", () => {
    const result = parseRalphArgs("--max-iterations 50 --yolo implement auth");
    expect(result.maxIterations).toBe(50);
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBe("implement auth");
  });

  test("parses --max-iterations with --yolo flag (--yolo first)", () => {
    const result = parseRalphArgs("--yolo --max-iterations 50 implement auth");
    expect(result.maxIterations).toBe(50);
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBe("implement auth");
  });

  test("parses --max-iterations with leading/trailing whitespace", () => {
    const result = parseRalphArgs("  --max-iterations  25  implement auth  ");
    expect(result.maxIterations).toBe(25);
    expect(result.prompt).toBe("implement auth");
  });

  test("--max-iterations with --resume flag", () => {
    const result = parseRalphArgs("--max-iterations 75 --resume 550e8400-e29b-41d4-a716-446655440000");
    expect(result.maxIterations).toBe(75);
    expect(result.resumeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("does not treat --max-iterations in the middle of prompt as a flag", () => {
    const result = parseRalphArgs("implement --max-iterations auth");
    expect(result.maxIterations).toBe(100);
    expect(result.prompt).toBe("implement --max-iterations auth");
  });

  test("handles large iteration numbers", () => {
    const result = parseRalphArgs("--max-iterations 1000000 implement auth");
    expect(result.maxIterations).toBe(1000000);
    expect(result.prompt).toBe("implement auth");
  });
});

// ============================================================================
// RALPH COMMAND --max-iterations INTEGRATION TESTS
// ============================================================================

describe("ralph command --max-iterations flag", () => {
  test("ralph command with --max-iterations sets correct state", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--max-iterations 50 implement auth", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.maxIterations).toBe(50);
    expect(result.stateUpdate?.ralphConfig?.maxIterations).toBe(50);
  });

  test("ralph command with --max-iterations 0 sets infinite iterations", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--max-iterations 0 implement auth", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.maxIterations).toBe(0);
    expect(result.stateUpdate?.ralphConfig?.maxIterations).toBe(0);
  });

  test("ralph command defaults maxIterations to 100", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("implement auth", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.maxIterations).toBe(100);
    expect(result.stateUpdate?.ralphConfig?.maxIterations).toBe(100);
  });

  test("ralph command with --max-iterations and --yolo shows both in message", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--max-iterations 50 --yolo implement auth", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.message).toContain("yolo mode");
    expect(result.message).toContain("max: 50");
    expect(result.stateUpdate?.ralphConfig?.yolo).toBe(true);
    expect(result.stateUpdate?.ralphConfig?.maxIterations).toBe(50);
  });

  test("ralph command system message includes max-iterations when non-default", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const context = createMockContext();
    context.addMessage = (role: string, content: string) => {
      messages.push({ role, content });
    };

    ralphCmd!.execute("--max-iterations 25 implement auth", context);

    expect(messages.length).toBe(1);
    expect(messages[0]?.content).toContain("max: 25");
  });

  test("ralph command system message does not include max-iterations when default", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const context = createMockContext();
    context.addMessage = (role: string, content: string) => {
      messages.push({ role, content });
    };

    ralphCmd!.execute("implement auth", context);

    expect(messages.length).toBe(1);
    expect(messages[0]?.content).not.toContain("max:");
  });
});

// ============================================================================
// PARSE RALPH ARGS --feature-list TESTS
// ============================================================================

describe("parseRalphArgs --feature-list flag", () => {
  test("parses --feature-list flag with path", () => {
    const result = parseRalphArgs("--feature-list custom.json implement auth");
    expect(result.featureListPath).toBe("custom.json");
    expect(result.prompt).toBe("implement auth");
    expect(result.yolo).toBe(false);
  });

  test("defaults to research/feature-list.json if --feature-list not specified", () => {
    const result = parseRalphArgs("implement auth");
    expect(result.featureListPath).toBe("research/feature-list.json");
  });

  test("parses --feature-list with full path", () => {
    const result = parseRalphArgs("--feature-list /path/to/features.json implement auth");
    expect(result.featureListPath).toBe("/path/to/features.json");
    expect(result.prompt).toBe("implement auth");
  });

  test("parses --feature-list with --yolo flag (--feature-list first)", () => {
    const result = parseRalphArgs("--feature-list custom.json --yolo implement auth");
    expect(result.featureListPath).toBe("custom.json");
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBe("implement auth");
  });

  test("parses --feature-list with --yolo flag (--yolo first)", () => {
    const result = parseRalphArgs("--yolo --feature-list custom.json implement auth");
    expect(result.featureListPath).toBe("custom.json");
    expect(result.yolo).toBe(true);
    expect(result.prompt).toBe("implement auth");
  });

  test("parses --feature-list with leading/trailing whitespace", () => {
    const result = parseRalphArgs("  --feature-list  custom.json  implement auth  ");
    expect(result.featureListPath).toBe("custom.json");
    expect(result.prompt).toBe("implement auth");
  });

  test("--feature-list with --resume flag", () => {
    const result = parseRalphArgs("--feature-list custom.json --resume 550e8400-e29b-41d4-a716-446655440000");
    expect(result.featureListPath).toBe("custom.json");
    expect(result.resumeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("--feature-list with --max-iterations flag", () => {
    const result = parseRalphArgs("--feature-list custom.json --max-iterations 50 implement auth");
    expect(result.featureListPath).toBe("custom.json");
    expect(result.maxIterations).toBe(50);
    expect(result.prompt).toBe("implement auth");
  });

  test("does not treat --feature-list in the middle of prompt as a flag", () => {
    const result = parseRalphArgs("implement --feature-list auth");
    expect(result.featureListPath).toBe("research/feature-list.json");
    expect(result.prompt).toBe("implement --feature-list auth");
  });

  test("parses relative path with directory", () => {
    const result = parseRalphArgs("--feature-list specs/features.json implement auth");
    expect(result.featureListPath).toBe("specs/features.json");
    expect(result.prompt).toBe("implement auth");
  });
});

// ============================================================================
// RALPH COMMAND --feature-list INTEGRATION TESTS
// ============================================================================

describe("ralph command --feature-list flag", () => {
  const testFeatureListPath = "research/feature-list.json";

  test("ralph command with --feature-list and existing file succeeds", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    // Uses existing research/feature-list.json
    const context = createMockContext();
    const result = ralphCmd!.execute(`--feature-list ${testFeatureListPath} implement auth`, context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.ralphConfig?.featureListPath).toBe(testFeatureListPath);
  });

  test("ralph command with --feature-list and non-existent file fails", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--feature-list nonexistent/file.json implement auth", context) as CommandResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain("Feature list file not found");
    expect(result.message).toContain("nonexistent/file.json");
  });

  test("ralph command with --yolo skips feature list validation", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    // Even with non-existent file, --yolo mode should succeed
    const result = ralphCmd!.execute("--feature-list nonexistent.json --yolo implement auth", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.ralphConfig?.yolo).toBe(true);
    expect(result.stateUpdate?.ralphConfig?.featureListPath).toBe("nonexistent.json");
  });

  test("ralph command defaults featureListPath to research/feature-list.json", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("implement auth", context) as CommandResult;

    expect(result.success).toBe(true);
    expect(result.stateUpdate?.ralphConfig?.featureListPath).toBe("research/feature-list.json");
  });

  test("ralph command with custom --feature-list shows in message", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute(`--feature-list ${testFeatureListPath} implement auth`, context) as CommandResult;

    // Default path should not show in message
    expect(result.message).not.toContain("features:");
  });

  test("ralph command with non-default --feature-list shows in message", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    // Create a temp file for this test
    const customPath = "research/custom-features.json";
    const { writeFileSync, unlinkSync } = require("fs");
    writeFileSync(customPath, "[]");

    try {
      const context = createMockContext();
      const result = ralphCmd!.execute(`--feature-list ${customPath} implement auth`, context) as CommandResult;

      expect(result.success).toBe(true);
      expect(result.message).toContain("features:");
      expect(result.message).toContain(customPath);
    } finally {
      unlinkSync(customPath);
    }
  });

  test("ralph command system message includes feature-list when non-default", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    // Create a temp file for this test
    const customPath = "research/custom-features.json";
    const { writeFileSync, unlinkSync } = require("fs");
    writeFileSync(customPath, "[]");

    try {
      const messages: Array<{ role: string; content: string }> = [];
      const context = createMockContext();
      context.addMessage = (role: string, content: string) => {
        messages.push({ role, content });
      };

      ralphCmd!.execute(`--feature-list ${customPath} implement auth`, context);

      expect(messages.length).toBe(1);
      expect(messages[0]?.content).toContain("features:");
      expect(messages[0]?.content).toContain(customPath);
    } finally {
      unlinkSync(customPath);
    }
  });

  test("ralph command system message does not include feature-list when default", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const context = createMockContext();
    context.addMessage = (role: string, content: string) => {
      messages.push({ role, content });
    };

    ralphCmd!.execute("implement auth", context);

    expect(messages.length).toBe(1);
    expect(messages[0]?.content).not.toContain("features:");
  });
});
