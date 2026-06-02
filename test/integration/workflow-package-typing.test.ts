import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const repoRoot = resolve(import.meta.dir, "../..");
const workflowsPackage = join(repoRoot, "packages", "workflows");

describe("standalone workflow package typing", () => {
  test("type-checks import { defineWorkflow, Type } from @bastani/workflows without a local shim", () => {
    const fixtureRoot = join(tmpdir(), `atomic-workflow-types-${randomUUID()}`);

    try {
      mkdirSync(join(fixtureRoot, "src"), { recursive: true });
      mkdirSync(join(fixtureRoot, "node_modules", "@bastani"), { recursive: true });
      symlinkSync(workflowsPackage, join(fixtureRoot, "node_modules", "@bastani", "workflows"), "dir");

      writeFileSync(
        join(fixtureRoot, "package.json"),
        JSON.stringify(
          {
            name: "standalone-workflow-typing-fixture",
            private: true,
            type: "module",
            dependencies: {
              "@bastani/workflows": "file:../../packages/workflows",
            },
            devDependencies: {
              typescript: "^6.0.3",
            },
          },
          null,
          2,
        ),
      );

      writeFileSync(
        join(fixtureRoot, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              strict: true,
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              noEmit: true,
              skipLibCheck: false,
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ),
      );

      writeFileSync(
        join(fixtureRoot, "src", "workflow.ts"),
        `import { defineWorkflow, run, Type } from "@bastani/workflows";

const workflow = defineWorkflow("Standalone Typing Fixture")
  .description("Verifies package export types without declare module shims")
  .input("message", Type.String())
  .input("count", Type.Number({ default: 1 }))
  .run(async (ctx) => {
    const message: string = ctx.inputs.message;
    const count: number = ctx.inputs.count;
    await ctx.task("echo", { prompt: message, output: "echo.md" });
    const chained = await ctx.chain([
      { name: "first", prompt: message },
      { name: "second", prompt: String(count) },
    ]);
    return { summary: chained.at(-1)?.text ?? "" };
  })
  .compile();

run(workflow, { message: "hello" });
run(workflow, { message: "hello", count: 2 });
// @ts-expect-error message has no default and remains required.
run(workflow, {});

export default workflow;
`,
      );

      const options: ExecFileSyncOptionsWithStringEncoding = {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
      };
      try {
        execFileSync("bun", [join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", fixtureRoot], options);
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string };
        assert.fail([failure.message, failure.stdout, failure.stderr].filter(Boolean).join("\n"));
      }

      assert.ok(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
