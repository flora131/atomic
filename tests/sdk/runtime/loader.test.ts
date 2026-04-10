/**
 * Tests for WorkflowLoader — covering paths not exercised by discovery.test.ts:
 * - Bun.plugin SDK resolver (loads a workflow from a tempdir outside the
 *   atomic repo and verifies `atomic/workflows` resolution)
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
// SDK resolver — proves workflow files can `import "@bastani/atomic/workflows"` from
// any location on disk, without a `package.json` or `node_modules`.
// ---------------------------------------------------------------------------

describe("WorkflowLoader — atomic/* SDK resolution", () => {
  test("loads a workflow that imports `atomic/workflows` from outside the repo", async () => {
    // Place the workflow file in a tempdir well outside `<atomic>/.atomic/`,
    // so resolution cannot accidentally rely on a parent `node_modules/atomic`
    // symlink. Only the Bun resolver plugin can satisfy this import.
    const workflowDir = join(tempDir, "ext", "wf-name", "claude");
    await mkdir(workflowDir, { recursive: true });
    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({ name: "ext" })
  .run(async () => {})
  .compile();
`,
    );

    const result = await WorkflowLoader.loadWorkflow({
      name: "ext",
      agent: "claude",
      path: filePath,
      source: "local",
    });

    if (!result.ok) {
      // Surface the failure cause so the test report is actionable.
      throw new Error(
        `loadWorkflow failed at stage "${result.stage}": ${result.message}\n` +
          `error=${result.error instanceof Error ? result.error.stack : String(result.error)}`,
      );
    }
    expect(result.value.definition.__brand).toBe("WorkflowDefinition");
    expect(result.value.definition.name).toBe("ext");
  });

  test("resolves third-party specifiers from atomic's own node_modules", async () => {
    // A workflow file that imports a bare specifier (`zod`) atomic ships as
    // a transitive dep. If the loader's `Bun.resolveSync` delegation is
    // working, this import should succeed even though the workflow lives
    // outside the atomic repo and has no `node_modules` of its own.
    const workflowDir = join(tempDir, "tp", "wf", "claude");
    await mkdir(workflowDir, { recursive: true });
    const filePath = join(workflowDir, "index.ts");
    await writeFile(
      filePath,
      `
import { defineWorkflow } from "@bastani/atomic/workflows";
import { z } from "zod";

// Touch the import so tree-shaking / minifiers don't drop it.
const schema = z.object({ name: z.string() });

export default defineWorkflow({ name: schema.parse({ name: "tp" }).name })
  .run(async () => {})
  .compile();
`,
    );

    const result = await WorkflowLoader.loadWorkflow({
      name: "tp",
      agent: "claude",
      path: filePath,
      source: "local",
    });

    if (!result.ok) {
      throw new Error(
        `loadWorkflow failed at stage "${result.stage}": ${result.message}`,
      );
    }
    expect(result.value.definition.name).toBe("tp");
  });
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
  .run(async () => {})
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
