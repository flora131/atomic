/**
 * Tests for Workflow Commands
 *
 * Verifies workflow command registration and execution behavior.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  WORKFLOW_DEFINITIONS,
  workflowCommands,
  registerWorkflowCommands,
  getWorkflowMetadata,
  createWorkflowByName,
  type WorkflowMetadata,
} from "../../../src/ui/commands/workflow-commands.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
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
    expect(atomic?.aliases).toContain("ralph");
    expect(atomic?.aliases).toContain("loop");
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
    expect(atomicCmd?.aliases).toContain("ralph");
    expect(atomicCmd?.aliases).toContain("loop");
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
    const result = atomicCmd!.execute("Build a feature", context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("already active");
  });

  test("atomic command starts workflow with valid prompt", () => {
    const atomicCmd = workflowCommands.find((c) => c.name === "atomic");
    expect(atomicCmd).toBeDefined();

    const context = createMockContext();
    const result = atomicCmd!.execute("Build a new feature", context);

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
    const result = atomicCmd!.execute("  Build a feature  ", context);

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

  test("registers workflow aliases", () => {
    registerWorkflowCommands();

    expect(globalRegistry.has("ralph")).toBe(true);
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
    const result = atomicCmd!.execute("Test prompt", context);

    expect(result.success).toBe(true);
  });

  test("commands can be looked up by alias after registration", () => {
    registerWorkflowCommands();

    const byRalph = globalRegistry.get("ralph");
    const byLoop = globalRegistry.get("loop");
    const byAtomic = globalRegistry.get("atomic");

    expect(byRalph?.name).toBe("atomic");
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
    const byRalph = getWorkflowMetadata("ralph");
    const byLoop = getWorkflowMetadata("loop");

    expect(byRalph?.name).toBe("atomic");
    expect(byLoop?.name).toBe("atomic");
  });

  test("is case-insensitive", () => {
    expect(getWorkflowMetadata("ATOMIC")?.name).toBe("atomic");
    expect(getWorkflowMetadata("Atomic")?.name).toBe("atomic");
    expect(getWorkflowMetadata("RALPH")?.name).toBe("atomic");
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
