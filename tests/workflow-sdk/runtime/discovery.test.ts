/**
 * Tests for workflow discovery and loading — error path coverage.
 */

import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { join } from "path";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import {
  discoverWorkflows,
  findWorkflow,
  loadWorkflowDefinition,
  WORKFLOWS_GITIGNORE,
} from "@bastani/atomic-workflows";
import { readFile } from "fs/promises";

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

describe("loadWorkflowDefinition", () => {
  test("throws friendly error when .compile() is not called", async () => {
    const workflowDir = join(tempDir, "missing-compile");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "${join(process.cwd(), "packages/workflow-sdk/src/index.ts")}";

export default defineWorkflow({ name: "test" })
  .session({ name: "s1", run: async () => {} });
// NOTE: .compile() is intentionally missing
`,
    );

    await expect(loadWorkflowDefinition(filePath)).rejects.toThrow(
      /not compiled/,
    );
    await expect(loadWorkflowDefinition(filePath)).rejects.toThrow(
      /\.compile\(\)/,
    );
  });

  test("throws generic error for invalid default export", async () => {
    const workflowDir = join(tempDir, "invalid-export");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(filePath, `export default { foo: "bar" };`);

    await expect(loadWorkflowDefinition(filePath)).rejects.toThrow(
      /does not export a valid WorkflowDefinition/,
    );
  });

  test("loads valid compiled workflow", async () => {
    const workflowDir = join(tempDir, "valid-workflow");
    await mkdir(workflowDir, { recursive: true });

    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "${join(process.cwd(), "packages/workflow-sdk/src/index.ts")}";

export default defineWorkflow({ name: "valid-test" })
  .session({ name: "s1", run: async () => {} })
  .compile();
`,
    );

    const def = await loadWorkflowDefinition(filePath);
    expect(def.__brand).toBe("WorkflowDefinition");
    expect(def.name).toBe("valid-test");
    expect(def.steps).toHaveLength(1);
    expect(def.steps[0]).toHaveLength(1);
  });
});
