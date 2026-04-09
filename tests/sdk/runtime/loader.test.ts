/**
 * Tests for WorkflowLoader — covering paths not exercised by discovery.test.ts:
 * - installDeps (already-set spec, pkg rewrite + bun install subprocess)
 * - validateSource for opencode and claude agents
 * - resolve / validate / load catch blocks
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { WorkflowLoader } from "@/sdk/workflows.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "atomic-loader-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// installDeps
// ---------------------------------------------------------------------------

describe("WorkflowLoader.installDeps", () => {
  test("returns false when workflow directory has no package.json", async () => {
    const result = await WorkflowLoader.installDeps(tempDir);
    expect(result).toBe(false);
  });

  test("returns true without spawning install when spec already matches", async () => {
    // Construct a directory layout where repoRoot resolves to a real dir:
    //   <tempDir>/fake-repo/                 ← repoRoot (has package.json named "atomic")
    //   <tempDir>/fake-repo/level1/workflows ← workflowDir
    const repoRoot = join(tempDir, "fake-repo");
    const workflowDir = join(repoRoot, "level1", "workflows");
    await mkdir(workflowDir, { recursive: true });

    // The workflow's package.json must declare `atomic` with the exact spec
    // that installDeps would compute, so it takes the early-return branch.
    const desiredSpec = "file:../..";
    await writeFile(
      join(workflowDir, "package.json"),
      JSON.stringify(
        { name: "wf", version: "0.0.0", dependencies: { atomic: desiredSpec } },
        null,
        2,
      ),
    );

    const result = await WorkflowLoader.installDeps(workflowDir);
    expect(result).toBe(true);

    // No node_modules should be created because install was skipped.
    const nm = Bun.file(join(workflowDir, "node_modules", ".package-lock.json"));
    expect(await nm.exists()).toBe(false);
  });

  test(
    "rewrites package.json and runs bun install when spec differs",
    async () => {
      // Same structure as above, but with a wrong/missing spec so the full
      // install path executes. The fake repoRoot is a valid minimal package
      // that `bun install file:../..` can resolve.
      const repoRoot = join(tempDir, "fake-repo");
      const workflowDir = join(repoRoot, "level1", "workflows");
      await mkdir(workflowDir, { recursive: true });

      await writeFile(
        join(repoRoot, "package.json"),
        JSON.stringify({ name: "atomic", version: "0.0.1" }, null, 2),
      );

      await writeFile(
        join(workflowDir, "package.json"),
        JSON.stringify(
          { name: "wf", version: "0.0.0", dependencies: { atomic: "file:./wrong" } },
          null,
          2,
        ),
      );

      const result = await WorkflowLoader.installDeps(workflowDir);
      expect(result).toBe(true);

      // package.json should now reflect the computed spec.
      const updated = await Bun.file(join(workflowDir, "package.json")).json();
      expect(updated.dependencies.atomic).toBe("file:../..");
    },
    30_000, // bun install can be slow on first run
  );
});

// ---------------------------------------------------------------------------
// validateSource — provider switch coverage via the full pipeline
// ---------------------------------------------------------------------------

describe("WorkflowLoader.validate — agent provider validation", () => {
  async function writeCompiledWorkflow(
    dir: string,
    name: string,
    body: string = "",
  ): Promise<string> {
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows.ts")}";
${body}
export default defineWorkflow({ name: "${name}" })
  .session({ name: "s1", run: async () => {} })
  .compile();
`,
    );
    return filePath;
  }

  test("runs opencode source validation and returns warnings", async () => {
    // Intentionally references createOpencodeClient without a ctx.serverUrl
    // baseUrl so validateOpenCodeWorkflow emits a warning.
    const filePath = await writeCompiledWorkflow(
      join(tempDir, "opencode-wf"),
      "oc",
      `// createOpencodeClient({ baseUrl: "http://wrong" })`,
    );

    const plan: WorkflowLoader.Plan = {
      name: "oc",
      agent: "opencode",
      path: filePath,
      source: "local",
    };

    const resolved = await WorkflowLoader.resolve(plan);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const validated = await WorkflowLoader.validate(resolved.value);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(validated.value.warnings.length).toBeGreaterThan(0);
    expect(validated.value.warnings.some((w) => w.rule.startsWith("opencode/"))).toBe(true);
  });

  test("runs claude source validation and returns warnings", async () => {
    // References claudeQuery without createClaudeSession → warning.
    const filePath = await writeCompiledWorkflow(
      join(tempDir, "claude-wf"),
      "cl",
      `// claudeQuery({ paneId: "x", prompt: "hi" })`,
    );

    const plan: WorkflowLoader.Plan = {
      name: "cl",
      agent: "claude",
      path: filePath,
      source: "local",
    };

    const resolved = await WorkflowLoader.resolve(plan);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const validated = await WorkflowLoader.validate(resolved.value);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(validated.value.warnings.some((w) => w.rule.startsWith("claude/"))).toBe(true);
  });

  test("report.warn is invoked when validation produces warnings", async () => {
    const filePath = await writeCompiledWorkflow(
      join(tempDir, "warn-wf"),
      "warn",
      `// createOpencodeClient({ baseUrl: "nope" })`,
    );

    const plan: WorkflowLoader.Plan = {
      name: "warn",
      agent: "opencode",
      path: filePath,
      source: "local",
    };

    let warnedWith: WorkflowLoader.ValidationWarning[] | null = null;
    const result = await WorkflowLoader.loadWorkflow(plan, {
      warn(warnings) {
        warnedWith = warnings;
      },
    });

    expect(result.ok).toBe(true);
    expect(warnedWith).not.toBeNull();
    expect(warnedWith!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Catch-block coverage
// ---------------------------------------------------------------------------

describe("WorkflowLoader — error path coverage", () => {
  test("validate stage returns a structured error when source file disappears", async () => {
    // Create the file, resolve it (so resolve.ok === true), then delete it
    // before validate() reads the source. This triggers the validate catch.
    const workflowDir = join(tempDir, "vanishing");
    await mkdir(workflowDir, { recursive: true });
    const filePath = join(workflowDir, "index.ts");
    await writeFile(filePath, `export default {};`);

    const plan: WorkflowLoader.Plan = {
      name: "vanishing",
      agent: "copilot",
      path: filePath,
      source: "local",
    };

    const resolved = await WorkflowLoader.resolve(plan);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    await rm(filePath);

    const validated = await WorkflowLoader.validate(resolved.value);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.stage).toBe("validate");
    expect(typeof validated.message).toBe("string");
  });

  test("load stage returns a structured error when workflow has a syntax error", async () => {
    const workflowDir = join(tempDir, "syntax-error");
    await mkdir(workflowDir, { recursive: true });
    const filePath = join(workflowDir, "index.ts");
    // Deliberately malformed TypeScript — `import()` will throw at parse time.
    await writeFile(filePath, `export default function( {;`);

    const plan: WorkflowLoader.Plan = {
      name: "syntax-error",
      agent: "copilot",
      path: filePath,
      source: "local",
    };

    const result = await WorkflowLoader.loadWorkflow(plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("load");
    expect(typeof result.message).toBe("string");
    expect(result.error).toBeDefined();
  });
});
