import { afterEach, beforeEach, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverWorkflows } from "../../packages/workflows/src/extension/discovery.js";
import type { WorkflowDefinition } from "../../packages/workflows/src/shared/types.js";
import { defineWorkflow } from "../../packages/workflows/src/workflows/define-workflow.js";
import { resolveWorkflowImport, validateWorkflowImportGraph } from "../../packages/workflows/src/workflows/import-resolver.js";
import { createRegistry } from "../../packages/workflows/src/workflows/registry.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "workflow-imports-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function workflowSource(name: string, body: string): string {
  return [
    `import { defineWorkflow } from "@bastani/workflows";`,
    `export default defineWorkflow(${JSON.stringify(name)})`,
    body,
  ].join("\n");
}

function manualWorkflow(name: string, imports?: Record<string, unknown>): WorkflowDefinition {
  return {
    __piWorkflow: true,
    name,
    normalizedName: name,
    description: "",
    inputs: {},
    ...(imports !== undefined ? { imports: imports as WorkflowDefinition["imports"] } : {}),
    run: async () => ({}),
  };
}

describe("workflow import resolver", () => {
  test("resolves compiled workflow definition imports without registry registration", () => {
    const child = defineWorkflow("shared-child")
      .run(async (ctx) => {
        await ctx.task("child", { prompt: "child" });
        return { ok: true };
      })
      .compile();
    const parent = defineWorkflow("parent")
      .import(child)
      .run(async () => ({}))
      .compile();
    const registry = createRegistry([parent]);

    const diagnostics = validateWorkflowImportGraph({ registry, roots: [parent] });
    const resolved = resolveWorkflowImport(parent, "shared-child", { registry });

    assert.deepEqual(diagnostics, []);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.resolved.definition, child);
      assert.equal(resolved.resolved.alias, "shared-child");
    }
  });

  test("resolves compiled workflow definition imports with local aliases", () => {
    const child = defineWorkflow("shared-child")
      .run(async (ctx) => {
        await ctx.task("child", { prompt: "child" });
        return { ok: true };
      })
      .compile();
    const parent = defineWorkflow("parent")
      .import(child, { as: "research" })
      .run(async () => ({}))
      .compile();
    const registry = createRegistry([parent]);

    const diagnostics = validateWorkflowImportGraph({ registry, roots: [parent] });
    const resolved = resolveWorkflowImport(parent, "research", { registry });

    assert.deepEqual(diagnostics, []);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.resolved.definition, child);
      assert.equal(resolved.resolved.alias, "research");
    }
  });

  test("reports undeclared aliases", () => {
    const parent = defineWorkflow("parent")
      .run(async (ctx) => {
        await ctx.task("parent", { prompt: "parent" });
        return {};
      })
      .compile();
    const resolved = resolveWorkflowImport(parent, "ghost", { registry: createRegistry([parent]) });

    assert.equal(resolved.ok, false);
    if (!resolved.ok) {
      assert.equal(resolved.diagnostic.code, "IMPORT_UNRESOLVED");
      assert.match(resolved.diagnostic.message, /alias is not declared/);
    }
  });

  test("reports invalid raw import declarations", () => {
    const parent = manualWorkflow("invalid-parent", {
      child: { definition: { not: "a workflow" } },
    });
    const diagnostics = validateWorkflowImportGraph({ registry: createRegistry([parent]), roots: [parent] });

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.code, "IMPORT_INVALID");
    assert.match(diagnostics[0]?.message ?? "", /definition must be a compiled workflow definition/);
  });

  test("reports circular imports with chain text", () => {
    const parent = manualWorkflow("cycle-parent");
    const child = manualWorkflow("cycle-child");
    const parentWithImport = { ...parent, imports: { child: { definition: child } } } as WorkflowDefinition;
    const childWithImport = { ...child, imports: { parent: { definition: parentWithImport } } } as WorkflowDefinition;
    const cyclicParent = { ...parentWithImport, imports: { child: { definition: childWithImport } } } as WorkflowDefinition;

    const diagnostics = validateWorkflowImportGraph({ registry: createRegistry([cyclicParent]), roots: [cyclicParent] });

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.code, "IMPORT_CIRCULAR");
    assert.match(diagnostics[0]?.message ?? "", /cycle-parent -> cycle-child -> cycle-parent/);
  });
});

describe("discoverWorkflows import diagnostics", () => {
  async function writeProjectWorkflow(filename: string, content: string): Promise<string> {
    const dir = join(tmpRoot, "cwd", ".atomic", "workflows");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, filename);
    await writeFile(filePath, content, "utf8");
    return filePath;
  }

  test("static TS module imports register local child workflow definitions", async () => {
    await writeProjectWorkflow(
      "child.ts",
      workflowSource(
        "discover-module-child",
        `.output("answer", { type: "text", required: true })\n  .run(async (ctx) => { await ctx.task("child", { prompt: "child" }); return { answer: "ok" }; })\n  .compile();`,
      ),
    );
    await writeProjectWorkflow(
      "parent.ts",
      [
        `import { defineWorkflow } from "@bastani/workflows";`,
        `import child from "./child.js";`,
        ``,
        `export default defineWorkflow("discover-module-parent")`,
        `  .import(child)`,
        `  .run(async (ctx) => { await ctx.workflow("discover-module-child", { outputs: ["answer"] }); return {}; })`,
        `  .compile();`,
      ].join("\n"),
    );

    const result = await discoverWorkflows({
      cwd: join(tmpRoot, "cwd"),
      homeDir: join(tmpRoot, "home"),
      includeBundled: false,
    });

    const parent = result.registry.get("discover-module-parent");
    assert.notEqual(parent, undefined);
    assert.equal(parent?.imports?.["discover-module-child"] !== undefined, true);
    assert.equal(result.errors.filter((error) => error.code.startsWith("IMPORT_")).length, 0);
  });

  test("legacy source syntax fails during module import", async () => {
    await writeProjectWorkflow(
      "parent.ts",
      workflowSource(
        "legacy-source-parent",
        `.import("ghost", { workflow: "missing-child" })\n  .run(async (ctx) => { await ctx.task("parent", { prompt: "parent" }); return {}; })\n  .compile();`,
      ),
    );

    const result = await discoverWorkflows({
      cwd: join(tmpRoot, "cwd"),
      homeDir: join(tmpRoot, "home"),
      includeBundled: false,
    });

    assert.equal(result.registry.has("legacy-source-parent"), false);
    const failure = result.errors.find((error) => error.code === "IMPORT_FAILED");
    assert.notEqual(failure, undefined);
    assert.match(failure?.message ?? "", /import definition must be a compiled workflow definition/);
  });

  test("static TS module imports can register builtin workflow definitions", async () => {
    await writeProjectWorkflow(
      "parent.ts",
      [
        `import { defineWorkflow } from "@bastani/workflows";`,
        `import deepResearchCodebase from "@bastani/workflows/builtin/deep-research-codebase";`,
        `import { goal, ralph } from "@bastani/workflows/builtin";`,
        ``,
        `export default defineWorkflow("builtin-module-parent")`,
        `  .import(deepResearchCodebase)`,
        `  .import(goal)`,
        `  .import(ralph, { as: "planner" })`,
        `  .run(async (ctx) => { await ctx.task("parent", { prompt: "parent" }); return {}; })`,
        `  .compile();`,
      ].join("\n"),
    );

    const result = await discoverWorkflows({
      cwd: join(tmpRoot, "cwd"),
      homeDir: join(tmpRoot, "home"),
      includeBundled: false,
    });

    const parent = result.registry.get("builtin-module-parent");
    assert.notEqual(parent, undefined);
    assert.equal(parent?.imports?.["deep-research-codebase"] !== undefined, true);
    assert.equal(parent?.imports?.["goal"] !== undefined, true);
    assert.equal(parent?.imports?.["planner"] !== undefined, true);
    assert.equal(result.errors.filter((error) => error.code.startsWith("IMPORT_")).length, 0);
  });
});
