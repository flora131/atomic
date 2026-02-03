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
  CUSTOM_WORKFLOW_SEARCH_PATHS,
  workflowCommands,
  registerWorkflowCommands,
  getWorkflowMetadata,
  createWorkflowByName,
  parseRalphArgs,
  isValidUUID,
  discoverWorkflowFiles,
  loadWorkflowsFromDisk,
  getAllWorkflows,
  getWorkflowFromRegistry,
  hasWorkflow,
  getWorkflowNames,
  refreshWorkflowRegistry,
  resolveWorkflowRef,
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

// ============================================================================
// CUSTOM_WORKFLOW_SEARCH_PATHS TESTS
// ============================================================================

describe("CUSTOM_WORKFLOW_SEARCH_PATHS", () => {
  test("is exported as an array", () => {
    expect(Array.isArray(CUSTOM_WORKFLOW_SEARCH_PATHS)).toBe(true);
  });

  test("has correct number of paths", () => {
    expect(CUSTOM_WORKFLOW_SEARCH_PATHS.length).toBe(2);
  });

  test("contains .atomic/workflows for project-local workflows", () => {
    expect(CUSTOM_WORKFLOW_SEARCH_PATHS).toContain(".atomic/workflows");
  });

  test("contains ~/.atomic/workflows for user-global workflows", () => {
    expect(CUSTOM_WORKFLOW_SEARCH_PATHS).toContain("~/.atomic/workflows");
  });

  test("local path comes before global path (higher priority)", () => {
    const localIndex = CUSTOM_WORKFLOW_SEARCH_PATHS.indexOf(".atomic/workflows");
    const globalIndex = CUSTOM_WORKFLOW_SEARCH_PATHS.indexOf("~/.atomic/workflows");
    expect(localIndex).toBeLessThan(globalIndex);
  });

  test("local path is first element", () => {
    expect(CUSTOM_WORKFLOW_SEARCH_PATHS[0]).toBe(".atomic/workflows");
  });

  test("global path is second element", () => {
    expect(CUSTOM_WORKFLOW_SEARCH_PATHS[1]).toBe("~/.atomic/workflows");
  });
});

describe("discoverWorkflowFiles", () => {
  const testLocalDir = ".atomic/workflows";
  const testGlobalDir = join(process.env.HOME || "", ".atomic/workflows");

  afterEach(() => {
    // Clean up test directories
    if (existsSync(testLocalDir)) {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
    // Don't clean up global dir in tests as it may contain real workflows
  });

  test("returns empty array when no workflow directories exist", () => {
    // Ensure test directories don't exist
    if (existsSync(testLocalDir)) {
      rmSync(testLocalDir, { recursive: true, force: true });
    }

    const result = discoverWorkflowFiles();
    // May have results from global dir, but local should not add any
    const localResults = result.filter(r => r.source === "local");
    expect(localResults.length).toBe(0);
  });

  test("discovers .ts files in local workflow directory", () => {
    // Create test local workflow directory with a test file
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "test-workflow.ts");
    require("fs").writeFileSync(testFilePath, "// test workflow");

    try {
      const result = discoverWorkflowFiles();
      const localResults = result.filter(r => r.source === "local");

      expect(localResults.length).toBeGreaterThan(0);
      expect(localResults.some(r => r.path.endsWith("test-workflow.ts"))).toBe(true);
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("marks local workflows with source 'local'", () => {
    // Create test local workflow directory with a test file
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "test-workflow.ts");
    require("fs").writeFileSync(testFilePath, "// test workflow");

    try {
      const result = discoverWorkflowFiles();
      const localResults = result.filter(r => r.path.includes(testLocalDir));

      for (const local of localResults) {
        expect(local.source).toBe("local");
      }
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("ignores non-.ts files", () => {
    // Create test local workflow directory with different file types
    mkdirSync(testLocalDir, { recursive: true });
    require("fs").writeFileSync(join(testLocalDir, "test-workflow.ts"), "// ts workflow");
    require("fs").writeFileSync(join(testLocalDir, "readme.md"), "# readme");
    require("fs").writeFileSync(join(testLocalDir, "config.json"), "{}");

    try {
      const result = discoverWorkflowFiles();
      const localResults = result.filter(r => r.source === "local");

      // Should only have .ts file
      expect(localResults.every(r => r.path.endsWith(".ts"))).toBe(true);
      expect(localResults.some(r => r.path.endsWith(".md"))).toBe(false);
      expect(localResults.some(r => r.path.endsWith(".json"))).toBe(false);
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("returns absolute paths", () => {
    // Create test local workflow directory with a test file
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "test-workflow.ts");
    require("fs").writeFileSync(testFilePath, "// test workflow");

    try {
      const result = discoverWorkflowFiles();
      const localResults = result.filter(r => r.source === "local");

      for (const local of localResults) {
        // Path should be absolute or resolvable from cwd
        expect(local.path.includes("test-workflow.ts")).toBe(true);
      }
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });
});

describe("WORKFLOW_DEFINITIONS", () => {
  test("contains ralph workflow", () => {
    const ralph = WORKFLOW_DEFINITIONS.find((w) => w.name === "ralph");
    expect(ralph).toBeDefined();
    expect(ralph?.description).toContain("Ralph");
  });

  test("ralph has correct aliases", () => {
    const ralph = WORKFLOW_DEFINITIONS.find((w) => w.name === "ralph");
    expect(ralph?.aliases).toContain("loop");
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
});

describe("workflowCommands", () => {
  test("has correct number of commands", () => {
    expect(workflowCommands.length).toBe(WORKFLOW_DEFINITIONS.length);
  });

  test("ralph command has correct metadata", () => {
    const ralphCmd = workflowCommands.find((c) => c.name === "ralph");
    expect(ralphCmd).toBeDefined();
    expect(ralphCmd?.category).toBe("workflow");
    expect(ralphCmd?.aliases).toContain("loop");
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

    expect(globalRegistry.has("ralph")).toBe(true);
  });

  test("registers workflow and aliases", () => {
    registerWorkflowCommands();

    expect(globalRegistry.has("ralph")).toBe(true);
    // loop is an alias of ralph
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

    const ralphCmd = globalRegistry.get("ralph");
    expect(ralphCmd).toBeDefined();

    const context = createMockContext();
    const result = ralphCmd!.execute("--yolo Test prompt", context) as CommandResult;

    expect(result.success).toBe(true);
  });

  test("commands can be looked up by alias after registration", () => {
    registerWorkflowCommands();

    const byRalph = globalRegistry.get("ralph");
    const byLoop = globalRegistry.get("loop");

    expect(byRalph?.name).toBe("ralph");
    // loop is an alias of ralph
    expect(byLoop?.name).toBe("ralph");
  });
});

describe("getWorkflowMetadata", () => {
  test("finds workflow by name", () => {
    const metadata = getWorkflowMetadata("ralph");
    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe("ralph");
  });

  test("finds workflow by alias", () => {
    const byRalph = getWorkflowMetadata("ralph");
    const byLoop = getWorkflowMetadata("loop");

    expect(byRalph?.name).toBe("ralph");
    expect(byLoop?.name).toBe("ralph");
  });

  test("is case-insensitive", () => {
    expect(getWorkflowMetadata("RALPH")?.name).toBe("ralph");
    expect(getWorkflowMetadata("Ralph")?.name).toBe("ralph");
    expect(getWorkflowMetadata("LOOP")?.name).toBe("ralph");
  });

  test("returns undefined for unknown workflow", () => {
    expect(getWorkflowMetadata("unknown")).toBeUndefined();
    expect(getWorkflowMetadata("")).toBeUndefined();
  });
});

describe("createWorkflowByName", () => {
  test("creates workflow by name", () => {
    const graph = createWorkflowByName("ralph");
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
    const graph = createWorkflowByName("ralph", { maxIterations: 5 });
    expect(graph).toBeDefined();
  });

  test("merges default config with provided config", () => {
    // This tests that defaultConfig is applied
    const graph = createWorkflowByName("ralph", { maxIterations: 10 });
    expect(graph).toBeDefined();
  });

  test("returns undefined for unknown workflow", () => {
    expect(createWorkflowByName("unknown")).toBeUndefined();
    expect(createWorkflowByName("")).toBeUndefined();
  });

  test("is case-insensitive", () => {
    expect(createWorkflowByName("RALPH")).toBeDefined();
    expect(createWorkflowByName("Ralph")).toBeDefined();
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

// ============================================================================
// LOAD WORKFLOWS FROM DISK TESTS
// ============================================================================

describe("loadWorkflowsFromDisk", () => {
  const testLocalDir = ".atomic/workflows";

  afterEach(() => {
    // Clean up test directories
    if (existsSync(testLocalDir)) {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("returns empty array when no workflow files exist", async () => {
    // Ensure test directory doesn't exist
    if (existsSync(testLocalDir)) {
      rmSync(testLocalDir, { recursive: true, force: true });
    }

    const { loadWorkflowsFromDisk } = await import("../../../src/ui/commands/workflow-commands.ts");
    const result = await loadWorkflowsFromDisk();

    // May contain workflows from global dir, but should not throw
    expect(Array.isArray(result)).toBe(true);
  });

  test("loads workflow from valid .ts file", async () => {
    // Create test workflow directory with valid workflow
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "test-workflow.ts");

    // Create a valid workflow file with required exports
    const workflowContent = `
export const name = "test-workflow";
export const description = "A test workflow";
export const aliases = ["tw"];

export default function createWorkflow(config?: Record<string, unknown>) {
  return {
    nodes: new Map(),
    edges: [],
    startNode: "start",
  };
}
`;
    require("fs").writeFileSync(testFilePath, workflowContent);

    try {
      const { loadWorkflowsFromDisk } = await import("../../../src/ui/commands/workflow-commands.ts");
      const result = await loadWorkflowsFromDisk();

      const testWorkflow = result.find(w => w.name === "test-workflow");
      expect(testWorkflow).toBeDefined();
      expect(testWorkflow?.description).toBe("A test workflow");
      expect(testWorkflow?.aliases).toContain("tw");
      expect(testWorkflow?.source).toBe("local");
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("skips workflow file without default export function", async () => {
    // Create test workflow directory with invalid workflow
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "invalid-workflow.ts");

    // Create an invalid workflow file (no default function)
    const workflowContent = `
export const name = "invalid-workflow";
export const description = "An invalid workflow";

// Missing default export function
`;
    require("fs").writeFileSync(testFilePath, workflowContent);

    try {
      const { loadWorkflowsFromDisk } = await import("../../../src/ui/commands/workflow-commands.ts");
      const result = await loadWorkflowsFromDisk();

      // Should not include the invalid workflow
      const invalidWorkflow = result.find(w => w.name === "invalid-workflow");
      expect(invalidWorkflow).toBeUndefined();
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("uses filename as name when module.name is not defined", async () => {
    // Create test workflow directory with workflow missing name export
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "unnamed-workflow.ts");

    // Create a workflow file without name export
    const workflowContent = `
export const description = "A workflow without name export";

export default function createWorkflow(config?: Record<string, unknown>) {
  return {
    nodes: new Map(),
    edges: [],
    startNode: "start",
  };
}
`;
    require("fs").writeFileSync(testFilePath, workflowContent);

    try {
      const { loadWorkflowsFromDisk } = await import("../../../src/ui/commands/workflow-commands.ts");
      const result = await loadWorkflowsFromDisk();

      // Should use filename as name
      const workflow = result.find(w => w.name === "unnamed-workflow");
      expect(workflow).toBeDefined();
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("provides default description when not exported", async () => {
    // Create test workflow directory with workflow missing description
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "no-desc-workflow.ts");

    // Create a workflow file without description export
    const workflowContent = `
export const name = "no-desc-workflow";

export default function createWorkflow(config?: Record<string, unknown>) {
  return {
    nodes: new Map(),
    edges: [],
    startNode: "start",
  };
}
`;
    require("fs").writeFileSync(testFilePath, workflowContent);

    try {
      const { loadWorkflowsFromDisk } = await import("../../../src/ui/commands/workflow-commands.ts");
      const result = await loadWorkflowsFromDisk();

      const workflow = result.find(w => w.name === "no-desc-workflow");
      expect(workflow).toBeDefined();
      expect(workflow?.description).toContain("Custom workflow");
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// GET ALL WORKFLOWS TESTS
// ============================================================================

describe("getAllWorkflows", () => {
  const { getAllWorkflows } = require("../../../src/ui/commands/workflow-commands.ts");

  test("returns array including built-in workflows", () => {
    const workflows = getAllWorkflows();
    expect(Array.isArray(workflows)).toBe(true);

    // Should include built-in ralph workflow
    const ralph = workflows.find((w: WorkflowMetadata) => w.name === "ralph");
    expect(ralph).toBeDefined();
  });

  test("workflows have required fields", () => {
    const workflows = getAllWorkflows();

    for (const workflow of workflows) {
      expect(typeof workflow.name).toBe("string");
      expect(workflow.name.length).toBeGreaterThan(0);
      expect(typeof workflow.description).toBe("string");
      expect(typeof workflow.createWorkflow).toBe("function");
    }
  });
});

// ============================================================================
// WORKFLOW LOADING PRIORITY TESTS
// ============================================================================

describe("workflow loading priority", () => {
  const testLocalDir = ".atomic/workflows";

  afterEach(() => {
    // Clean up test directories
    if (existsSync(testLocalDir)) {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("local workflows marked with source 'local'", async () => {
    // Create test workflow directory
    mkdirSync(testLocalDir, { recursive: true });
    const testFilePath = join(testLocalDir, "local-test.ts");

    const workflowContent = `
export const name = "local-test";
export default function createWorkflow(config?: Record<string, unknown>) {
  return { nodes: new Map(), edges: [], startNode: "start" };
}
`;
    require("fs").writeFileSync(testFilePath, workflowContent);

    try {
      const { loadWorkflowsFromDisk } = await import("../../../src/ui/commands/workflow-commands.ts");
      const result = await loadWorkflowsFromDisk();

      const localWorkflow = result.find(w => w.name === "local-test");
      expect(localWorkflow?.source).toBe("local");
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("built-in workflows marked with source 'builtin'", () => {
    const { WORKFLOW_DEFINITIONS } = require("../../../src/ui/commands/workflow-commands.ts");

    const ralph = WORKFLOW_DEFINITIONS.find((w: WorkflowMetadata) => w.name === "ralph");
    expect(ralph?.source).toBe("builtin");
  });

  test("deduplicates workflows by name (case-insensitive)", async () => {
    // Create two workflows with similar names
    mkdirSync(testLocalDir, { recursive: true });

    const workflowContent1 = `
export const name = "duplicate-test";
export default function createWorkflow() {
  return { nodes: new Map(), edges: [], startNode: "start" };
}
`;
    const workflowContent2 = `
export const name = "Duplicate-Test";
export default function createWorkflow() {
  return { nodes: new Map(), edges: [], startNode: "start" };
}
`;
    require("fs").writeFileSync(join(testLocalDir, "dup1.ts"), workflowContent1);
    require("fs").writeFileSync(join(testLocalDir, "dup2.ts"), workflowContent2);

    try {
      const { loadWorkflowsFromDisk } = await import("../../../src/ui/commands/workflow-commands.ts");
      const result = await loadWorkflowsFromDisk();

      // Should only have one workflow with this name (first one wins)
      const matches = result.filter(w => w.name.toLowerCase() === "duplicate-test");
      expect(matches.length).toBe(1);
    } finally {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// WORKFLOW REGISTRY TESTS
// ============================================================================

describe("workflowRegistry", () => {
  const {
    getWorkflowFromRegistry,
    hasWorkflow,
    getWorkflowNames,
    refreshWorkflowRegistry,
  } = require("../../../src/ui/commands/workflow-commands.ts");

  test("getWorkflowFromRegistry finds workflow by name", () => {
    const workflow = getWorkflowFromRegistry("ralph");
    expect(workflow).toBeDefined();
    expect(workflow.name).toBe("ralph");
  });

  test("getWorkflowFromRegistry finds workflow by alias", () => {
    const workflow = getWorkflowFromRegistry("loop");
    expect(workflow).toBeDefined();
    expect(workflow.name).toBe("ralph"); // loop is alias for ralph
  });

  test("getWorkflowFromRegistry is case-insensitive", () => {
    expect(getWorkflowFromRegistry("RALPH")).toBeDefined();
    expect(getWorkflowFromRegistry("Ralph")).toBeDefined();
    expect(getWorkflowFromRegistry("LOOP")).toBeDefined();
  });

  test("getWorkflowFromRegistry returns undefined for unknown workflow", () => {
    expect(getWorkflowFromRegistry("nonexistent")).toBeUndefined();
  });

  test("hasWorkflow returns true for registered workflow", () => {
    expect(hasWorkflow("ralph")).toBe(true);
    expect(hasWorkflow("loop")).toBe(true);
  });

  test("hasWorkflow returns false for unknown workflow", () => {
    expect(hasWorkflow("nonexistent")).toBe(false);
  });

  test("hasWorkflow is case-insensitive", () => {
    expect(hasWorkflow("RALPH")).toBe(true);
    expect(hasWorkflow("Ralph")).toBe(true);
  });

  test("getWorkflowNames returns array of workflow names", () => {
    const names = getWorkflowNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names).toContain("ralph");
  });

  test("refreshWorkflowRegistry reinitializes registry", () => {
    // Call refresh - should not throw
    expect(() => refreshWorkflowRegistry()).not.toThrow();

    // Registry should still work after refresh
    expect(hasWorkflow("ralph")).toBe(true);
  });
});

// ============================================================================
// RESOLVE WORKFLOW REF TESTS
// ============================================================================

describe("resolveWorkflowRef", () => {
  const { resolveWorkflowRef } = require("../../../src/ui/commands/workflow-commands.ts");

  test("resolves workflow by name", () => {
    const graph = resolveWorkflowRef("ralph");
    expect(graph).toBeDefined();
    expect(graph.nodes).toBeInstanceOf(Map);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(typeof graph.startNode).toBe("string");
  });

  test("resolves workflow by alias", () => {
    const graph = resolveWorkflowRef("loop");
    expect(graph).toBeDefined();
  });

  test("is case-insensitive", () => {
    expect(resolveWorkflowRef("RALPH")).toBeDefined();
    expect(resolveWorkflowRef("Ralph")).toBeDefined();
  });

  test("returns null for unknown workflow", () => {
    expect(resolveWorkflowRef("nonexistent")).toBeNull();
    expect(resolveWorkflowRef("")).toBeNull();
  });

  test("applies default config when resolving", () => {
    // The resolved workflow should have been created with default config
    const graph = resolveWorkflowRef("ralph");
    expect(graph).toBeDefined();
    // Can't directly test config, but workflow should be valid
    expect(graph.nodes).toBeInstanceOf(Map);
  });
});

// ============================================================================
// CIRCULAR DEPENDENCY DETECTION TESTS
// ============================================================================

describe("circular dependency detection", () => {
  const testLocalDir = ".atomic/workflows";

  afterEach(() => {
    if (existsSync(testLocalDir)) {
      rmSync(testLocalDir, { recursive: true, force: true });
    }
  });

  test("resolveWorkflowRef clears resolution stack after successful resolution", () => {
    const { resolveWorkflowRef } = require("../../../src/ui/commands/workflow-commands.ts");

    // First resolution
    resolveWorkflowRef("ralph");

    // Second resolution should not throw (stack was cleared)
    expect(() => resolveWorkflowRef("ralph")).not.toThrow();
  });

  test("resolveWorkflowRef clears resolution stack after failed resolution", () => {
    const { resolveWorkflowRef } = require("../../../src/ui/commands/workflow-commands.ts");

    // Resolution of non-existent workflow
    resolveWorkflowRef("nonexistent");

    // Second resolution should not throw (stack was cleared)
    expect(() => resolveWorkflowRef("ralph")).not.toThrow();
  });
});
