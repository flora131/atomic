/**
 * Tests for the workflow discovery/loading pipeline updates.
 *
 * Covers:
 * - extractWorkflowDefinition() brand detection on various module shapes
 * - loadWorkflowsFromDisk() integration with CompiledWorkflow modules
 * - Startup warnings for rejected workflows
 */

import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import {
  extractWorkflowDefinition,
  CUSTOM_WORKFLOW_SEARCH_PATHS,
  loadWorkflowsFromDisk,
} from "@/commands/tui/workflow-commands.ts";

// ============================================================================
// extractWorkflowDefinition() -- unit tests
// ============================================================================

describe("extractWorkflowDefinition", () => {
  const fakeDefinition: WorkflowDefinition = {
    name: "test-workflow",
    description: "A test workflow",
    version: "1.0.0",
    source: "builtin",
  };

  test("returns null for null input", () => {
    expect(extractWorkflowDefinition(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(extractWorkflowDefinition(undefined)).toBeNull();
  });

  test("returns null for non-object input (string)", () => {
    expect(extractWorkflowDefinition("hello")).toBeNull();
  });

  test("returns null for non-object input (number)", () => {
    expect(extractWorkflowDefinition(42)).toBeNull();
  });

  test("returns null for empty object", () => {
    expect(extractWorkflowDefinition({})).toBeNull();
  });

  test("returns null for object without __compiledWorkflow", () => {
    expect(
      extractWorkflowDefinition({
        name: "foo",
        description: "bar",
      }),
    ).toBeNull();
  });

  test("returns null when __compiledWorkflow is null", () => {
    expect(
      extractWorkflowDefinition({
        __compiledWorkflow: null,
      }),
    ).toBeNull();
  });

  test("returns null when __compiledWorkflow is a primitive", () => {
    expect(
      extractWorkflowDefinition({
        __compiledWorkflow: "not-an-object",
      }),
    ).toBeNull();
  });

  test("extracts definition from module-level __compiledWorkflow", () => {
    const mod = {
      __compiledWorkflow: fakeDefinition,
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(fakeDefinition);
  });

  test("extracts definition from default export with __compiledWorkflow", () => {
    const mod = {
      default: {
        __compiledWorkflow: fakeDefinition,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(fakeDefinition);
  });

  test("extracts definition from named export with __compiledWorkflow", () => {
    const mod = {
      myWorkflow: {
        __compiledWorkflow: fakeDefinition,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(fakeDefinition);
  });

  test("prefers module-level brand over default export brand", () => {
    const topLevel: WorkflowDefinition = {
      name: "top-level",
      description: "Top level definition",
    };
    const defaultLevel: WorkflowDefinition = {
      name: "default-level",
      description: "Default level definition",
    };
    const mod = {
      __compiledWorkflow: topLevel,
      default: {
        __compiledWorkflow: defaultLevel,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(topLevel);
  });

  test("prefers default export brand over named export brand", () => {
    const defaultDef: WorkflowDefinition = {
      name: "default-def",
      description: "From default",
    };
    const namedDef: WorkflowDefinition = {
      name: "named-def",
      description: "From named",
    };
    const mod = {
      default: {
        __compiledWorkflow: defaultDef,
      },
      someExport: {
        __compiledWorkflow: namedDef,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(defaultDef);
  });

  test("returns null when default export is not a CompiledWorkflow", () => {
    const mod = {
      default: { name: "plain-obj" },
    };
    expect(extractWorkflowDefinition(mod)).toBeNull();
  });

  test("handles module with only non-branded named exports", () => {
    const mod = {
      name: "my-workflow",
      description: "A workflow",
      version: "2.0.0",
    };
    expect(extractWorkflowDefinition(mod)).toBeNull();
  });

  test("extracts from first found named export when multiple exist", () => {
    const def1: WorkflowDefinition = {
      name: "first",
      description: "First",
    };
    const mod = {
      alpha: {
        __compiledWorkflow: def1,
      },
      beta: {
        __compiledWorkflow: {
          name: "second",
          description: "Second",
        },
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(["first", "second"]).toContain(result!.name);
  });
});

// ============================================================================
// loadWorkflowsFromDisk() -- integration tests with CompiledWorkflow
// ============================================================================

describe("loadWorkflowsFromDisk with CompiledWorkflow", () => {
  let tempDir: string;
  let originalPaths: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wf-loading-test-"));
    originalPaths = [...CUSTOM_WORKFLOW_SEARCH_PATHS];
    CUSTOM_WORKFLOW_SEARCH_PATHS.splice(
      0,
      CUSTOM_WORKFLOW_SEARCH_PATHS.length,
      tempDir,
    );
  });

  afterEach(async () => {
    CUSTOM_WORKFLOW_SEARCH_PATHS.splice(
      0,
      CUSTOM_WORKFLOW_SEARCH_PATHS.length,
      ...originalPaths,
    );
    await loadWorkflowsFromDisk();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("loads a CompiledWorkflow from a named export", async () => {
    const workflowFile = join(tempDir, "my-dsl-workflow.ts");
    await writeFile(
      workflowFile,
      `export const myWorkflow = {
        __compiledWorkflow: {
          name: "my-dsl-workflow",
          description: "A DSL-compiled workflow",
          version: "1.0.0",
          source: "builtin",
          conductorStages: [],
        },
      };`,
    );

    const loaded = await loadWorkflowsFromDisk();
    const found = loaded.find((w) => w.name === "my-dsl-workflow");
    expect(found).toBeDefined();
    expect(found!.description).toBe("A DSL-compiled workflow");
    expect(found!.version).toBe("1.0.0");
    expect(found!.source).toBe("local");
  });

  test("loads a CompiledWorkflow from a default export", async () => {
    const workflowFile = join(tempDir, "default-export-wf.ts");
    await writeFile(
      workflowFile,
      `const compiled = {
        __compiledWorkflow: {
          name: "default-export-wf",
          description: "Default-exported compiled workflow",
          version: "2.0.0",
        },
      };
      export default compiled;`,
    );

    const loaded = await loadWorkflowsFromDisk();
    const found = loaded.find((w) => w.name === "default-export-wf");
    expect(found).toBeDefined();
    expect(found!.description).toBe("Default-exported compiled workflow");
  });

  test("falls back to legacy loading for modules without __compiledWorkflow", async () => {
    const workflowFile = join(tempDir, "legacy-workflow.ts");
    await writeFile(
      workflowFile,
      `export const name = "legacy-wf";
      export const description = "A legacy workflow";
      export const version = "0.5.0";`,
    );

    const loaded = await loadWorkflowsFromDisk();
    const found = loaded.find((w) => w.name === "legacy-wf");
    expect(found).toBeDefined();
    expect(found!.description).toBe("A legacy workflow");
    expect(found!.version).toBe("0.5.0");
  });

  test("emits startup warnings for workflows that fail to import", async () => {
    const workflowFile = join(tempDir, "broken-workflow.ts");
    await writeFile(
      workflowFile,
      `throw new Error("Intentional load failure for testing");`,
    );

    const warnSpy = spyOn(console, "warn");
    try {
      await loadWorkflowsFromDisk();

      const warningCalls = warnSpy.mock.calls.map((args) => String(args[0]));
      const startupWarning = warningCalls.find(
        (msg) =>
          msg.includes("\u25cf Warning: Failed to load workflow:") &&
          msg.includes("broken-workflow"),
      );
      expect(startupWarning).toBeDefined();
      expect(startupWarning).toContain("\x1b[33m");
      expect(startupWarning).toContain("\x1b[0m");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("deduplicates compiled workflows by name", async () => {
    const file1 = join(tempDir, "aaa-workflow.ts");
    const file2 = join(tempDir, "zzz-workflow.ts");
    await writeFile(
      file1,
      `export const wf = {
        __compiledWorkflow: {
          name: "duplicate-name",
          description: "First version",
        },
      };`,
    );
    await writeFile(
      file2,
      `export const wf = {
        __compiledWorkflow: {
          name: "duplicate-name",
          description: "Second version",
        },
      };`,
    );

    const loaded = await loadWorkflowsFromDisk();
    const matches = loaded.filter((w) => w.name === "duplicate-name");
    expect(matches).toHaveLength(1);
  });

  test("compiled workflows with aliases register alias names in dedup set", async () => {
    const file1 = join(tempDir, "aliased-workflow.ts");
    const file2 = join(tempDir, "conflict-workflow.ts");
    await writeFile(
      file1,
      `export const wf = {
        __compiledWorkflow: {
          name: "primary",
          description: "Primary workflow",
          aliases: ["shortcut"],
        },
      };`,
    );
    await writeFile(
      file2,
      `export const name = "shortcut";
      export const description = "Conflicting workflow";`,
    );

    const loaded = await loadWorkflowsFromDisk();
    const shortcutMatch = loaded.find((w) => w.name === "shortcut");
    expect(shortcutMatch).toBeUndefined();
    const primaryMatch = loaded.find((w) => w.name === "primary");
    expect(primaryMatch).toBeDefined();
    expect(primaryMatch!.aliases).toContain("shortcut");
  });

  test("validates minSDKVersion on compiled workflows", async () => {
    const workflowFile = join(tempDir, "versioned-workflow.ts");
    await writeFile(
      workflowFile,
      `export const wf = {
        __compiledWorkflow: {
          name: "versioned-wf",
          description: "Versioned workflow",
          minSDKVersion: "invalid-version",
        },
      };`,
    );

    const warnSpy = spyOn(console, "warn");
    try {
      await loadWorkflowsFromDisk();

      const warningCalls = warnSpy.mock.calls.map((args) => String(args[0]));
      const versionWarning = warningCalls.find(
        (msg) =>
          msg.includes("versioned-wf") &&
          msg.includes("invalid minSDKVersion"),
      );
      expect(versionWarning).toBeDefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ============================================================================
// extractWorkflowDefinition edge cases with WorkflowDefinition structure
// ============================================================================

describe("extractWorkflowDefinition with real workflow structures", () => {
  test("extracts definition with conductorStages", () => {
    const definition: WorkflowDefinition = {
      name: "conductor-workflow",
      description: "Has conductor stages",
      conductorStages: [
        {
          id: "planner",
          name: "Planner",
          indicator: "Planning...",
          buildPrompt: () => "Plan this",
          parseOutput: (r: string) => ({ plan: r }),
        },
      ],
    };

    const mod = { __compiledWorkflow: definition };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(definition);
    expect(result!.conductorStages).toHaveLength(1);
    expect(result!.conductorStages![0]!.id).toBe("planner");
  });

  test("extracts definition with createConductorGraph function", () => {
    const definition: WorkflowDefinition = {
      name: "graph-workflow",
      description: "Has a conductor graph factory",
      createConductorGraph: () => ({
        nodes: new Map(),
        edges: [],
        startNode: "start",
        endNodes: new Set(["end"]),
        config: {},
      }),
    };

    const mod = { __compiledWorkflow: definition };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(definition);
    expect(typeof result!.createConductorGraph).toBe("function");
  });

  test("extracts definition with createState factory", () => {
    const definition: WorkflowDefinition = {
      name: "stateful-workflow",
      description: "Has state factory",
      createState: (params) => ({
        executionId: params.sessionId,
        lastUpdated: new Date().toISOString(),
        outputs: {},
      }),
    };

    const mod = { __compiledWorkflow: definition };
    const result = extractWorkflowDefinition(mod);
    expect(result).toBe(definition);
    expect(typeof result!.createState).toBe("function");
  });
});
