/**
 * Tests for the workflow discovery/loading pipeline updates.
 *
 * Covers:
 * - extractWorkflowDefinition() brand detection on various module shapes
 * - loadWorkflowsFromDisk() integration with CompiledWorkflow modules
 * - Startup warnings for rejected workflows
 */

import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import {
  extractWorkflowDefinition,
  CUSTOM_WORKFLOW_SEARCH_PATHS,
  loadWorkflowsFromDisk,
} from "@/commands/tui/workflow-commands.ts";
import {
  cleanupTempWorkflowFiles,
  importWorkflowModule,
} from "@/commands/tui/workflow-commands/workflow-files.ts";

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

  test("returns null for object without __compiledWorkflow brand", () => {
    expect(
      extractWorkflowDefinition({
        name: "foo",
        description: "bar",
      }),
    ).toBeNull();
  });

  test("returns null when __compiledWorkflow is present but name is missing", () => {
    expect(
      extractWorkflowDefinition({
        __compiledWorkflow: true,
      }),
    ).toBeNull();
  });

  test("returns null when __compiledWorkflow is present but name is not a string", () => {
    expect(
      extractWorkflowDefinition({
        __compiledWorkflow: true,
        name: 42,
      }),
    ).toBeNull();
  });

  test("extracts definition from module-level branded CompiledWorkflow", () => {
    const mod = {
      ...fakeDefinition,
      __compiledWorkflow: true as const,
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(result!.name).toBe(fakeDefinition.name);
  });

  test("extracts definition from default export with brand", () => {
    const mod = {
      default: {
        ...fakeDefinition,
        __compiledWorkflow: true as const,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(result!.name).toBe(fakeDefinition.name);
  });

  test("extracts definition from named export with brand", () => {
    const mod = {
      myWorkflow: {
        ...fakeDefinition,
        __compiledWorkflow: true as const,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(result!.name).toBe(fakeDefinition.name);
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
      ...topLevel,
      __compiledWorkflow: true as const,
      default: {
        ...defaultLevel,
        __compiledWorkflow: true as const,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result!.name).toBe("top-level");
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
        ...defaultDef,
        __compiledWorkflow: true as const,
      },
      someExport: {
        ...namedDef,
        __compiledWorkflow: true as const,
      },
    };
    const result = extractWorkflowDefinition(mod);
    expect(result!.name).toBe("default-def");
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
    const mod = {
      alpha: {
        name: "first",
        description: "First",
        __compiledWorkflow: true as const,
      },
      beta: {
        name: "second",
        description: "Second",
        __compiledWorkflow: true as const,
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
        name: "my-dsl-workflow",
        description: "A DSL-compiled workflow",
        version: "1.0.0",
        source: "builtin",
        conductorStages: [],
        __compiledWorkflow: true,
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
        name: "default-export-wf",
        description: "Default-exported compiled workflow",
        version: "2.0.0",
        __compiledWorkflow: true,
      };
      export default compiled;`,
    );

    const loaded = await loadWorkflowsFromDisk();
    const found = loaded.find((w) => w.name === "default-export-wf");
    expect(found).toBeDefined();
    expect(found!.description).toBe("Default-exported compiled workflow");
  });

  test("fails to load module without __compiledWorkflow brand", async () => {
    const workflowFile = join(tempDir, "legacy-workflow.ts");
    await writeFile(
      workflowFile,
      `export const name = "legacy-wf";
      export const description = "A legacy workflow";
      export const version = "0.5.0";`,
    );

    const warnSpy = spyOn(console, "warn");
    try {
      const loaded = await loadWorkflowsFromDisk();
      const found = loaded.find((w) => w.name === "legacy-wf");
      expect(found).toBeUndefined();

      const warningCalls = warnSpy.mock.calls.map((args) => String(args[0]));
      const startupWarning = warningCalls.find(
        (msg) =>
          msg.includes("Warning: Failed to load workflow:") &&
          msg.includes("legacy-workflow"),
      );
      expect(startupWarning).toBeDefined();
    } finally {
      warnSpy.mockRestore();
    }
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
        name: "duplicate-name",
        description: "First version",
        __compiledWorkflow: true,
      };`,
    );
    await writeFile(
      file2,
      `export const wf = {
        name: "duplicate-name",
        description: "Second version",
        __compiledWorkflow: true,
      };`,
    );

    const loaded = await loadWorkflowsFromDisk();
    const matches = loaded.filter((w) => w.name === "duplicate-name");
    expect(matches).toHaveLength(1);
  });

  test("validates minSDKVersion on compiled workflows", async () => {
    const workflowFile = join(tempDir, "versioned-workflow.ts");
    await writeFile(
      workflowFile,
      `export const wf = {
        name: "versioned-wf",
        description: "Versioned workflow",
        minSDKVersion: "invalid-version",
        __compiledWorkflow: true,
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
    const mod = {
      name: "conductor-workflow",
      description: "Has conductor stages",
      __compiledWorkflow: true as const,
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

    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(result!.conductorStages).toHaveLength(1);
    expect(result!.conductorStages![0]!.id).toBe("planner");
  });

  test("extracts definition with createConductorGraph function", () => {
    const mod = {
      name: "graph-workflow",
      description: "Has a conductor graph factory",
      __compiledWorkflow: true as const,
      createConductorGraph: () => ({
        nodes: new Map(),
        edges: [],
        startNode: "start",
        endNodes: new Set(["end"]),
        config: {},
      }),
    };

    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(typeof result!.createConductorGraph).toBe("function");
  });

  test("extracts definition with createState factory", () => {
    const mod = {
      name: "stateful-workflow",
      description: "Has state factory",
      __compiledWorkflow: true as const,
      createState: (params: { sessionId: string }) => ({
        executionId: params.sessionId,
        lastUpdated: new Date().toISOString(),
        outputs: {},
      }),
    };

    const result = extractWorkflowDefinition(mod);
    expect(result).not.toBeNull();
    expect(typeof result!.createState).toBe("function");
  });
});

describe("importWorkflowModule", () => {
  let tempDir: string;
  let savedBunInstall: string | undefined;
  let savedPath: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wf-import-test-"));
    savedBunInstall = process.env.BUN_INSTALL;
    savedPath = process.env.PATH;
    process.env.PATH = "/usr/bin";
  });

  afterEach(async () => {
    cleanupTempWorkflowFiles();

    if (savedBunInstall === undefined) {
      delete process.env.BUN_INSTALL;
    } else {
      process.env.BUN_INSTALL = savedBunInstall;
    }

    if (savedPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = savedPath;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  test("uses bun from the default install dir when PATH has not been refreshed yet", async () => {
    const workflowFile = join(tempDir, "fallback-workflow.ts");
    await writeFile(
      workflowFile,
      `export default {
        name: "fallback-workflow",
        description: "Loaded via bun fallback",
        __compiledWorkflow: true,
      };`,
    );

    const bunInstallDir = join(tempDir, "bun-home");
    const bunBinDir = join(bunInstallDir, "bin");
    const bunExecutable = join(
      bunBinDir,
      process.platform === "win32" ? "bun.exe" : "bun",
    );
    await mkdir(bunBinDir, { recursive: true });
    await writeFile(
      bunExecutable,
      process.platform === "win32"
        ? "@echo off\r\ncopy /Y \"%2\" \"%4\" >NUL\r\n"
        : "#!/bin/sh\ncp \"$2\" \"$4\"\n",
    );
    if (process.platform !== "win32") {
      await chmod(bunExecutable, 0o755);
    }
    process.env.BUN_INSTALL = bunInstallDir;

    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );

    const mod = await importWorkflowModule(workflowFile);

    expect((mod.default as { name: string }).name).toBe("fallback-workflow");
    expect(process.env.PATH?.split(delimiter)[0]).toBe(bunBinDir);
    expect(whichSpy).toHaveBeenCalledWith("bun");
  });
});
