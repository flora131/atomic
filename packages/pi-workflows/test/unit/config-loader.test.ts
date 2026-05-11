/**
 * Tests for src/extension/config-loader.ts
 *
 * Covers:
 *   - Missing files: no diagnostics, config null
 *   - Valid global config: loaded correctly
 *   - Valid project-local config: loaded correctly
 *   - Merge: project overrides global, workflows merged key-by-key
 *   - Invalid JSON: CONFIG_INVALID diagnostic
 *   - Invalid shape: CONFIG_INVALID diagnostic per bad field
 *   - Project-local candidate priority: first existing candidate wins
 *   - Explicit workflows map: parsed with path validation
 *   - Both scopes invalid: both diagnostics returned, config null
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadWorkflowConfig,
  type ConfigLoadResult,
  type ConfigDiagnostic,
  type WorkflowExtensionConfig,
} from "../../src/extension/config-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeDir(base: string, ...parts: string[]): Promise<string> {
  const full = join(base, ...parts);
  await mkdir(full, { recursive: true });
  return full;
}

async function writeJson(dir: string, filename: string, content: unknown): Promise<string> {
  const filePath = join(dir, filename);
  await writeFile(filePath, JSON.stringify(content), "utf8");
  return filePath;
}

async function writeBadJson(dir: string, filename: string): Promise<string> {
  const filePath = join(dir, filename);
  await writeFile(filePath, "{ this is not valid json }", "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Test suite setup — temp dirs for home and project
// ---------------------------------------------------------------------------

describe("loadWorkflowConfig — missing files", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("no config files → config null, no diagnostics", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.config).toBeNull();
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("loadWorkflowConfig — global config only", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const globalDir = await makeDir(tmpHome, ".pi", "agent", "extensions", "workflow");
    await writeJson(globalDir, "config.json", {
      maxDepth: 5,
      defaultConcurrency: 2,
      persistRuns: false,
    });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("global config loaded", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.config).not.toBeNull();
    expect(result.config!.maxDepth).toBe(5);
    expect(result.config!.defaultConcurrency).toBe(2);
    expect(result.config!.persistRuns).toBe(false);
  });
});

describe("loadWorkflowConfig — project-local config only (primary candidate)", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", {
      maxDepth: 3,
      resumeInFlight: "auto",
    });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("project-local (.pi/extensions) config loaded", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.config).not.toBeNull();
    expect(result.config!.maxDepth).toBe(3);
    expect(result.config!.resumeInFlight).toBe("auto");
  });
});

describe("loadWorkflowConfig — project-local config only (secondary candidate)", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    // Only the secondary candidate path exists
    const projDir = await makeDir(tmpProject, ".pi", "agent", "extensions", "workflow");
    await writeJson(projDir, "config.json", {
      statusFile: true,
    });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("project-local (.pi/agent/extensions) config loaded when primary absent", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.config).not.toBeNull();
    expect(result.config!.statusFile).toBe(true);
  });
});

describe("loadWorkflowConfig — primary candidate wins over secondary", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    // Both candidates exist — primary should win
    const primaryDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(primaryDir, "config.json", { maxDepth: 10 });
    const secondaryDir = await makeDir(tmpProject, ".pi", "agent", "extensions", "workflow");
    await writeJson(secondaryDir, "config.json", { maxDepth: 99 });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("primary candidate (.pi/extensions) used when both exist", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.config!.maxDepth).toBe(10);
  });
});

describe("loadWorkflowConfig — merge: project overrides global", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const globalDir = await makeDir(tmpHome, ".pi", "agent", "extensions", "workflow");
    await writeJson(globalDir, "config.json", {
      maxDepth: 4,
      persistRuns: true,
      resumeInFlight: "ask",
    });
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", {
      maxDepth: 2,
      statusFile: true,
    });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("project maxDepth overrides global maxDepth", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.config!.maxDepth).toBe(2);
  });

  test("global-only fields preserved after merge", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.config!.persistRuns).toBe(true);
    expect(result.config!.resumeInFlight).toBe("ask");
  });

  test("project-only fields present after merge", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.config!.statusFile).toBe(true);
  });
});

describe("loadWorkflowConfig — workflows map merge", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const globalDir = await makeDir(tmpHome, ".pi", "agent", "extensions", "workflow");
    await writeJson(globalDir, "config.json", {
      workflows: {
        "global-wf": { path: "/home/user/.pi/workflows/global.ts" },
        "shared-wf": { path: "/home/user/.pi/workflows/shared.ts" },
      },
    });
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", {
      workflows: {
        "proj-wf": { path: "./workflows/project.ts" },
        "shared-wf": { path: "./workflows/shared-override.ts" },
      },
    });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("workflows from both scopes merged", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(0);
    expect(result.config!.workflows).toBeDefined();
    expect(result.config!.workflows!["global-wf"]).toBeDefined();
    expect(result.config!.workflows!["proj-wf"]).toBeDefined();
  });

  test("project workflows override global on conflict", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.config!.workflows!["shared-wf"].path).toBe("./workflows/shared-override.ts");
  });

  test("global-only workflow preserved", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.config!.workflows!["global-wf"].path).toBe("/home/user/.pi/workflows/global.ts");
  });
});

describe("loadWorkflowConfig — invalid JSON", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const globalDir = await makeDir(tmpHome, ".pi", "agent", "extensions", "workflow");
    await writeBadJson(globalDir, "config.json");
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("invalid JSON produces CONFIG_INVALID diagnostic", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("CONFIG_INVALID");
    expect(result.diagnostics[0]!.level).toBe("error");
  });

  test("source path present in diagnostic", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics[0]!.source).toContain("config.json");
  });

  test("config null when only source is invalid", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.config).toBeNull();
  });

  test("diagnostic message references JSON parse error", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics[0]!.message).toContain("Invalid JSON");
  });
});

describe("loadWorkflowConfig — invalid shape (wrong field types)", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", { maxDepth: "not-a-number" });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("bad maxDepth type → CONFIG_INVALID", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("CONFIG_INVALID");
    expect(result.diagnostics[0]!.message).toContain("maxDepth");
  });
});

describe("loadWorkflowConfig — invalid resumeInFlight enum", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", { resumeInFlight: "maybe" });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("unknown resumeInFlight value → CONFIG_INVALID", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("CONFIG_INVALID");
    expect(result.diagnostics[0]!.message).toContain("resumeInFlight");
  });
});

describe("loadWorkflowConfig — invalid workflows entry (missing path)", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", {
      workflows: {
        "my-wf": { path: "" }, // empty path
      },
    });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("empty workflow path → CONFIG_INVALID", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("CONFIG_INVALID");
    expect(result.diagnostics[0]!.message).toContain("path");
  });
});

describe("loadWorkflowConfig — both scopes invalid", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const globalDir = await makeDir(tmpHome, ".pi", "agent", "extensions", "workflow");
    await writeBadJson(globalDir, "config.json");
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeBadJson(projDir, "config.json");
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("two CONFIG_INVALID diagnostics", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(2);
    for (const d of result.diagnostics) {
      expect(d.code).toBe("CONFIG_INVALID");
    }
  });

  test("config null when both sources invalid", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.config).toBeNull();
  });
});

describe("loadWorkflowConfig — one invalid, one valid", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const globalDir = await makeDir(tmpHome, ".pi", "agent", "extensions", "workflow");
    await writeBadJson(globalDir, "config.json"); // invalid global
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", { maxDepth: 6 }); // valid project
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("one diagnostic from global, config from project", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.config).not.toBeNull();
    expect(result.config!.maxDepth).toBe(6);
  });
});

describe("loadWorkflowConfig — workflows array rejected (not object)", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", { workflows: ["array-not-allowed"] });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("array workflows → CONFIG_INVALID", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("CONFIG_INVALID");
    expect(result.diagnostics[0]!.message).toContain("workflows");
  });
});

describe("loadWorkflowConfig — valid config with all fields", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    await writeJson(projDir, "config.json", {
      maxDepth: 4,
      defaultConcurrency: 4,
      persistRuns: true,
      statusFile: false,
      resumeInFlight: "never",
      workflows: {
        "my-workflow": { path: "./workflows/my-workflow.ts" },
      },
    });
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("all valid fields parsed correctly", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(0);
    const c = result.config!;
    expect(c.maxDepth).toBe(4);
    expect(c.defaultConcurrency).toBe(4);
    expect(c.persistRuns).toBe(true);
    expect(c.statusFile).toBe(false);
    expect(c.resumeInFlight).toBe("never");
    expect(c.workflows!["my-workflow"]!.path).toBe("./workflows/my-workflow.ts");
  });
});

describe("loadWorkflowConfig — config not top-level object", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), "pi-config-test-home-"));
    tmpProject = await mkdtemp(join(tmpdir(), "pi-config-test-proj-"));
    const projDir = await makeDir(tmpProject, ".pi", "extensions", "workflow");
    // Valid JSON but not an object
    await writeFile(join(projDir, "config.json"), JSON.stringify([1, 2, 3]), "utf8");
  });

  afterAll(async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpProject, { recursive: true, force: true });
  });

  test("array at root → CONFIG_INVALID", async () => {
    const result = await loadWorkflowConfig({ homeDir: tmpHome, projectRoot: tmpProject });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toBe("CONFIG_INVALID");
    expect(result.diagnostics[0]!.message).toContain("JSON object");
  });
});

describe("ConfigDiagnostic shape", () => {
  test("CONFIG_INVALID diagnostic has correct fields", () => {
    const diag: ConfigDiagnostic = {
      level: "error",
      code: "CONFIG_INVALID",
      message: "Invalid JSON in config file: Unexpected token",
      source: "/home/user/.pi/agent/extensions/workflow/config.json",
    };
    expect(diag.code).toBe("CONFIG_INVALID");
    expect(diag.level).toBe("error");
    expect(typeof diag.message).toBe("string");
    expect(diag.source).toContain("config.json");
  });
});
