/**
 * Tests for WorkflowLoader — covering paths not exercised by discovery.test.ts:
 * - validateSource for opencode and claude agents
 * - resolve / validate / load catch blocks
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { WorkflowLoader } from "@/sdk/workflows/index.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "atomic-loader-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
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
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";
${body}
export default defineWorkflow({ name: "${name}" })
  .run(async () => {})
  .compile();
`,
    );
    return filePath;
  }

  test("runs opencode source validation and returns warnings", async () => {
    // Intentionally references createOpencodeClient in code (not a comment)
    // so validateOpenCodeWorkflow emits a warning.
    const filePath = await writeCompiledWorkflow(
      join(tempDir, "opencode-wf"),
      "oc",
      `const _c = createOpencodeClient({ baseUrl: "http://wrong" })`,
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
    // References claudeQuery in code (not a comment) → warning.
    const filePath = await writeCompiledWorkflow(
      join(tempDir, "claude-wf"),
      "cl",
      `const _r = claudeQuery({ paneId: "x", prompt: "hi" })`,
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
    // Use a string literal containing the pattern so the file is importable
    // but the source-level regex validator still fires.
    const filePath = await writeCompiledWorkflow(
      join(tempDir, "warn-wf"),
      "warn",
      `const _s = "createOpencodeClient"`,
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
