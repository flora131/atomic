/**
 * Tests for workflow discovery and loading — error path coverage.
 */

import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  discoverWorkflows,
  findWorkflow,
  WorkflowLoader,
  WORKFLOWS_GITIGNORE,
} from "@/sdk/workflows/index.ts";
import { readFile } from "node:fs/promises";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "atomic-discovery-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("findWorkflow", () => {
  test("returns null when workflow does not exist", async () => {
    const result = await findWorkflow("nonexistent", "copilot", tempDir);
    // May find global workflows but not one named "nonexistent"
    expect(result).toBeNull();
  });

  test("discovers workflow when index.ts exists", async () => {
    const workflowDir = join(tempDir, ".atomic", "workflows", "my-unique-test-wf", "copilot");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(join(workflowDir, "index.ts"), "export default {};");

    const result = await findWorkflow("my-unique-test-wf", "copilot", tempDir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-unique-test-wf");
    expect(result!.agent).toBe("copilot");
    expect(result!.source).toBe("local");
  });
});

describe("discoverWorkflows", () => {
  test("discovers local workflows", async () => {
    const uniqueName = `test-wf-${Date.now()}`;
    const dir = join(tempDir, ".atomic", "workflows", uniqueName, "copilot");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const results = await discoverWorkflows(tempDir, "copilot");
    const local = results.find((r) => r.name === uniqueName);
    expect(local).toBeDefined();
    expect(local!.source).toBe("local");
  });

  test("local workflows override global with same name", async () => {
    const dir = join(tempDir, ".atomic", "workflows", "hello", "copilot");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const results = await discoverWorkflows(tempDir, "copilot");
    const hello = results.find((r) => r.name === "hello");
    expect(hello).toBeDefined();
    expect(hello!.source).toBe("local");
  });
});

describe("discoverWorkflows — .gitignore filtering", () => {
  const workflowsDir = () => join(tempDir, ".atomic", "workflows");

  async function createWorkflow(root: string, name: string, agent: string = "copilot") {
    const dir = join(root, ".atomic", "workflows", name, agent);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");
  }

  test("skips node_modules via auto-generated .gitignore", async () => {
    await createWorkflow(tempDir, "real-workflow");
    await createWorkflow(tempDir, "node_modules");

    const results = await discoverWorkflows(tempDir, "copilot");
    const names = results.filter((r) => r.source === "local").map((r) => r.name);
    expect(names).toContain("real-workflow");
    expect(names).not.toContain("node_modules");
  });

  test("skips dist directory via auto-generated .gitignore", async () => {
    await createWorkflow(tempDir, "my-wf");
    await createWorkflow(tempDir, "dist");

    const results = await discoverWorkflows(tempDir, "copilot");
    const names = results.filter((r) => r.source === "local").map((r) => r.name);
    expect(names).toContain("my-wf");
    expect(names).not.toContain("dist");
  });

  test("skips build directory via auto-generated .gitignore", async () => {
    await createWorkflow(tempDir, "valid");
    await createWorkflow(tempDir, "build");

    const results = await discoverWorkflows(tempDir, "copilot");
    const names = results.filter((r) => r.source === "local").map((r) => r.name);
    expect(names).toContain("valid");
    expect(names).not.toContain("build");
  });

  test("regenerates .gitignore if missing and still filters correctly", async () => {
    await createWorkflow(tempDir, "wf-alpha");
    await createWorkflow(tempDir, "node_modules");
    // No .gitignore written — discovery should regenerate it

    const results = await discoverWorkflows(tempDir, "copilot");
    const names = results.filter((r) => r.source === "local").map((r) => r.name);
    expect(names).toContain("wf-alpha");
    expect(names).not.toContain("node_modules");

    // Verify the file was actually written
    const content = await readFile(join(workflowsDir(), ".gitignore"), "utf-8");
    expect(content).toBe(WORKFLOWS_GITIGNORE);
  });

  test("respects custom entries added to the workflows .gitignore", async () => {
    await createWorkflow(tempDir, "my-wf");
    await createWorkflow(tempDir, "tmp-scratch");
    // Write a custom .gitignore that adds an extra pattern
    await writeFile(
      join(workflowsDir(), ".gitignore"),
      WORKFLOWS_GITIGNORE + "tmp-scratch/\n",
    );

    const results = await discoverWorkflows(tempDir, "copilot");
    const names = results.filter((r) => r.source === "local").map((r) => r.name);
    expect(names).toContain("my-wf");
    expect(names).not.toContain("tmp-scratch");
  });

  test("always skips hidden directories regardless of .gitignore", async () => {
    await createWorkflow(tempDir, ".hidden-wf");
    await createWorkflow(tempDir, "visible-wf");

    const results = await discoverWorkflows(tempDir, "copilot");
    const names = results.filter((r) => r.source === "local").map((r) => r.name);
    expect(names).toContain("visible-wf");
    expect(names).not.toContain(".hidden-wf");
  });
});

describe("built-in workflow discovery", () => {
  test("discovers ralph workflow (builtin or global)", async () => {
    // Ralph is always available — either from built-in SDK modules or from
    // a previously-synced global directory. Both are valid discovery paths.
    const results = await discoverWorkflows(tempDir, "claude");
    const ralph = results.find((r) => r.name === "ralph");
    expect(ralph).toBeDefined();
    expect(ralph!.agent).toBe("claude");
    expect(["builtin", "global"]).toContain(ralph!.source);
  });

  test("discovers ralph for all agent types", async () => {
    const results = await discoverWorkflows(tempDir);
    const ralphAgents = results
      .filter((r) => r.name === "ralph")
      .map((r) => r.agent)
      .sort();
    expect(ralphAgents).toEqual(["claude", "copilot", "opencode"]);
  });

  test("built-in workflow is NOT shadowed by a local with the same name", async () => {
    // Builtin names are reserved — a user-defined local workflow must
    // never win at merge time, even when it exists on disk. This
    // protects SDK-shipped workflows from being silently overridden.
    const dir = join(tempDir, ".atomic", "workflows", "ralph", "claude");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const results = await discoverWorkflows(tempDir, "claude");
    const ralph = results.find((r) => r.name === "ralph");
    expect(ralph).toBeDefined();
    expect(ralph!.source).toBe("builtin");
  });

  test("reserved builtin names are dropped from unmerged discovery", async () => {
    // `--list` uses `{ merge: false }`, but reserved builtin names must
    // still filter out user-defined local/global workflows of the same
    // name so nothing shadowed ever appears in the list. Users should
    // see exactly one `ralph` entry — the SDK-shipped one — even if
    // they have a local copy sitting on disk under the reserved name.
    const dir = join(tempDir, ".atomic", "workflows", "ralph", "claude");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const results = await discoverWorkflows(tempDir, "claude", { merge: false });
    const ralphEntries = results.filter((r) => r.name === "ralph");
    expect(ralphEntries).toHaveLength(1);
    expect(ralphEntries[0]!.source).toBe("builtin");
  });

  test("reservation is name-based across all agents", async () => {
    // Ralph ships for every agent, so a local copilot ralph is reserved
    // even when discovery is filtered to copilot specifically. The
    // reservation lives at the NAME level, not the (name, agent) level,
    // so a user can never register any variant of a reserved name.
    const dir = join(tempDir, ".atomic", "workflows", "ralph", "copilot");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const merged = await discoverWorkflows(tempDir, "copilot");
    const mergedRalph = merged.filter((r) => r.name === "ralph");
    expect(mergedRalph).toHaveLength(1);
    expect(mergedRalph[0]!.source).toBe("builtin");

    const unmerged = await discoverWorkflows(tempDir, "copilot", {
      merge: false,
    });
    const unmergedRalph = unmerged.filter((r) => r.name === "ralph");
    expect(unmergedRalph).toHaveLength(1);
    expect(unmergedRalph[0]!.source).toBe("builtin");
  });

  test("findWorkflow never resolves a reserved name to a local entry", async () => {
    // Sanity check: the named-mode CLI path goes through `findWorkflow`,
    // which internally calls discoverWorkflows in merged mode. With
    // reserved-name filtering, a local ralph/claude must still resolve
    // to the builtin — never to the user's file.
    const dir = join(tempDir, ".atomic", "workflows", "ralph", "claude");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const resolved = await findWorkflow("ralph", "claude", tempDir);
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("builtin");
  });
});

describe("WorkflowLoader", () => {
  test("returns load error when .compile() is not called", async () => {
    const workflowDir = join(tempDir, "missing-compile");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({ name: "test" })
  .run(async () => {});
// NOTE: .compile() is intentionally missing
`,
    );

    const plan: WorkflowLoader.Plan = { name: "test", agent: "copilot", path: filePath, source: "local" };
    const result = await WorkflowLoader.loadWorkflow(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("load");
      expect(result.message).toMatch(/not compiled/);
      expect(result.message).toMatch(/\.compile\(\)/);
    }
  });

  test("returns load error for invalid default export", async () => {
    const workflowDir = join(tempDir, "invalid-export");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(filePath, `export default { foo: "bar" };`);

    const plan: WorkflowLoader.Plan = { name: "test", agent: "copilot", path: filePath, source: "local" };
    const result = await WorkflowLoader.loadWorkflow(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("load");
      expect(result.message).toMatch(/does not export a valid WorkflowDefinition/);
    }
  });

  test("loads valid compiled workflow", async () => {
    const workflowDir = join(tempDir, "valid-workflow");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({ name: "valid-test" })
  .run(async () => {})
  .compile();
`,
    );

    const plan: WorkflowLoader.Plan = { name: "valid-test", agent: "copilot", path: filePath, source: "local" };
    const result = await WorkflowLoader.loadWorkflow(plan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.definition.__brand).toBe("WorkflowDefinition");
      expect(result.value.definition.name).toBe("valid-test");
      expect(typeof result.value.definition.run).toBe("function");
    }
  });

  test("returns resolve error when file does not exist", async () => {
    const plan: WorkflowLoader.Plan = {
      name: "ghost",
      agent: "copilot",
      path: join(tempDir, "nonexistent", "index.ts"),
      source: "local",
    };

    const result = await WorkflowLoader.loadWorkflow(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("resolve");
      expect(result.message).toMatch(/not found/);
    }
  });

  test("individual stages can be called independently", async () => {
    const workflowDir = join(tempDir, "stage-test");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({ name: "stage-test" })
  .run(async () => {})
  .compile();
`,
    );

    const plan: WorkflowLoader.Plan = { name: "stage-test", agent: "copilot", path: filePath, source: "local" };

    // resolve
    const resolved = await WorkflowLoader.resolve(plan);
    expect(resolved.ok).toBe(true);

    // validate
    if (resolved.ok) {
      const validated = await WorkflowLoader.validate(resolved.value);
      expect(validated.ok).toBe(true);

      // load
      if (validated.ok) {
        const loaded = await WorkflowLoader.load(validated.value);
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
          expect(loaded.value.definition.name).toBe("stage-test");
        }
      }
    }
  });

  test("report callbacks are invoked during pipeline", async () => {
    const workflowDir = join(tempDir, "report-test");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({ name: "report-test" })
  .run(async () => {})
  .compile();
`,
    );

    const stages: string[] = [];
    const plan: WorkflowLoader.Plan = { name: "report-test", agent: "copilot", path: filePath, source: "local" };

    const result = await WorkflowLoader.loadWorkflow(plan, {
      start(stage) { stages.push(stage); },
    });

    expect(result.ok).toBe(true);
    expect(stages).toEqual(["resolve", "validate", "load"]);
  });
});
