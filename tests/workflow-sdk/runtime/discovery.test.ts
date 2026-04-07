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
} from "@bastani/atomic-workflows";

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
    const workflowDir = join(tempDir, ".atomic", "workflows", "copilot", "my-unique-test-wf");
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
    const dir = join(tempDir, ".atomic", "workflows", "copilot", uniqueName);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const results = await discoverWorkflows(tempDir, "copilot");
    const local = results.find((r) => r.name === uniqueName);
    expect(local).toBeDefined();
    expect(local!.source).toBe("local");
  });

  test("local workflows override global with same name", async () => {
    const dir = join(tempDir, ".atomic", "workflows", "copilot", "hello");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "export default {};");

    const results = await discoverWorkflows(tempDir, "copilot");
    const hello = results.find((r) => r.name === "hello");
    expect(hello).toBeDefined();
    expect(hello!.source).toBe("local");
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
    expect(def.sessions).toHaveLength(1);
  });
});
