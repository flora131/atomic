/// <reference path="../../packages/coding-agent/src/utils/highlight-js-lib-index.d.ts" />

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultResourceLoader } from "../../packages/coding-agent/src/core/resource-loader.js";
import { SettingsManager } from "../../packages/coding-agent/src/core/settings-manager.js";
import { getBuiltinPackagePaths } from "../../packages/coding-agent/src/core/builtin-packages.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const expectedBuiltinPackages = [
  resolve("packages/workflows"),
  resolve("packages/subagents"),
  resolve("packages/mcp"),
  resolve("packages/web-access"),
  resolve("packages/intercom"),
];

describe("coding-agent builtin resources", () => {
  test("discovers bundled companion packages in development", () => {
    assert.deepEqual(getBuiltinPackagePaths(), expectedBuiltinPackages);
  });

  test("exposes package workflow resources to extensions", async () => {
    const cwd = tempDir("atomic-workflow-package-cwd-");
    const agentDir = tempDir("atomic-workflow-package-agent-");
    const packageDir = join(cwd, "workflow-package");
    const workflowsDir = join(packageDir, "workflow");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "workflow-package", atomic: { extensions: ["./index.ts"] } }),
      "utf-8",
    );
    writeFileSync(
      join(workflowsDir, "custom.ts"),
      "export default { __piWorkflow: true, name: 'Custom', normalizedName: 'custom', inputs: {}, run: async (ctx) => { await ctx.task('validation-smoke', { prompt: 'validation smoke' }); return {}; } };\n",
      "utf-8",
    );
    writeFileSync(
      join(packageDir, "index.ts"),
      [
        "export default function(pi) {",
        "  const resources = pi.getWorkflowResources?.() ?? [];",
        "  pi.registerCommand('workflow-resource-count', {",
        "    description: `workflow resources: ${resources.filter((r) => r.enabled).length}` ,",
        "    handler() {},",
        "  });",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const settingsManager = SettingsManager.inMemory();
    settingsManager.setPackages([packageDir]);
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, builtinPackagePaths: [] });

    await loader.reload();

    const extensions = loader.getExtensions();
    assert.deepEqual(extensions.errors, []);
    const command = extensions.extensions[0]?.commands.get("workflow-resource-count");
    assert.equal(command?.description, "workflow resources: 1");
  }, 20_000);

  test("loads builtin pi package resources", async () => {
    const cwd = tempDir("atomic-builtin-packages-cwd-");
    const agentDir = tempDir("atomic-builtin-packages-agent-");
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      builtinPackagePaths: expectedBuiltinPackages,
    });

    await loader.reload();

    const extensions = loader.getExtensions();
    assert.deepEqual(extensions.errors, []);

    const extensionPaths = extensions.extensions.map((extension) => extension.path.replace(/\\/g, "/"));
    for (const suffix of [
      "packages/workflows/src/extension/index.ts",
      "packages/subagents/src/extension/index.ts",
      "packages/mcp/index.ts",
      "packages/web-access/index.ts",
      "packages/intercom/index.ts",
    ]) {
      assert.ok(
        extensionPaths.some((extensionPath) => extensionPath.endsWith(suffix)),
        `expected builtin extension path ending in ${suffix}`,
      );
    }

    const skillNames = new Set(loader.getSkills().skills.map((skill) => skill.name));
    for (const skillName of ["workflow", "subagent", "intercom"]) {
      assert.ok(skillNames.has(skillName), `expected builtin skill ${skillName}`);
    }
  }, 20_000);
});
