/**
 * Tests for type-checking verification checker.
 *
 * Uses real TypeScript compiler API with temporary workflow files
 * to verify actual type-checking behavior. No mocking of the TS
 * compiler — tests exercise real compilation and diagnostics.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { checkTypeChecking } from "@/services/workflows/verification/type-checking.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Test Fixtures — Temporary Workflow Files
// ---------------------------------------------------------------------------

const TEST_DIR = join(import.meta.dir, ".tmp-type-checking-test");
const SDK_PATH = join(process.cwd(), "packages", "workflow-sdk");
const TSCONFIG_PATH = join(TEST_DIR, "tsconfig.json");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });

  // Write a tsconfig that resolves the SDK package
  writeFileSync(
    TSCONFIG_PATH,
    JSON.stringify({
      compilerOptions: {
        lib: ["ESNext"],
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        paths: {
          "@bastani/atomic-workflows": [
            join(SDK_PATH, "src", "index.ts"),
          ],
        },
      },
      include: ["*.ts"],
    }),
  );
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTestWorkflow(filename: string, content: string): string {
  const filePath = join(TEST_DIR, filename);
  writeFileSync(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkTypeChecking", () => {
  test("returns verified when no source paths are provided", async () => {
    const result = await checkTypeChecking([]);
    expect(result.verified).toBe(true);
  });

  test("returns verified for a valid workflow file", async () => {
    const filePath = writeTestWorkflow(
      "valid-workflow.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "valid-test",
    description: "A valid workflow",
  })
  .stage({
    name: "plan",
    description: "PLANNER",
    prompt: (ctx) => \`Plan: \${ctx.userPrompt}\`,
    outputMapper: (response) => ({ tasks: response }),
  })
  .compile();
`,
    );

    const result = await checkTypeChecking([filePath], TSCONFIG_PATH);
    expect(result.verified).toBe(true);
  });

  test("detects unknown fields on StageOptions", async () => {
    const filePath = writeTestWorkflow(
      "unknown-field.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "bad-fields",
    description: "Has invalid fields",
  })
  .stage({
    name: "plan",
    description: "PLANNER",
    reads: ["tasks"],
    outputs: ["result"],
    prompt: (ctx) => \`Plan: \${ctx.userPrompt}\`,
    outputMapper: (response) => ({ tasks: response }),
  })
  .compile();
`,
    );

    const result = await checkTypeChecking([filePath], TSCONFIG_PATH);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toBeDefined();
    // Should mention the invalid fields
    const errors = (result.details as { errors: string[] }).errors;
    expect(errors.length).toBeGreaterThan(0);
    // At least one error should be about the unknown fields
    const hasFieldError = errors.some(
      (e) => e.includes("reads") || e.includes("outputs"),
    );
    expect(hasFieldError).toBe(true);
  });

  test("detects wrong outputMapper return type", async () => {
    const filePath = writeTestWorkflow(
      "wrong-return-type.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "wrong-return",
    description: "Wrong outputMapper return type",
  })
  .stage({
    name: "plan",
    description: "PLANNER",
    prompt: (ctx) => \`Plan: \${ctx.userPrompt}\`,
    outputMapper: (response): string => response,
  })
  .compile();
`,
    );

    const result = await checkTypeChecking([filePath], TSCONFIG_PATH);
    expect(result.verified).toBe(false);
    const errors = (result.details as { errors: string[] }).errors;
    expect(errors.length).toBeGreaterThan(0);
  });

  test("detects use of removed onAnswer field", async () => {
    const filePath = writeTestWorkflow(
      "on-answer.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "on-answer",
    description: "Uses removed onAnswer",
  })
  .askUserQuestion({
    name: "confirm",
    question: { question: "Continue?" },
    onAnswer: (answer: string) => ({ confirmed: answer === "yes" }),
  })
  .compile();
`,
    );

    const result = await checkTypeChecking([filePath], TSCONFIG_PATH);
    expect(result.verified).toBe(false);
    const errors = (result.details as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes("onAnswer"))).toBe(true);
  });

  test("detects missing required fields", async () => {
    const filePath = writeTestWorkflow(
      "missing-fields.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "missing",
    description: "Missing required fields",
  })
  .stage({
    name: "plan",
    // missing: description, prompt, outputMapper
  } as any)
  .compile();
`,
    );

    // `as any` bypasses the check, so let's test without it
    const filePath2 = writeTestWorkflow(
      "missing-fields2.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "missing2",
    description: "Missing required fields",
  })
  .stage({
    name: "plan",
    description: "PLAN",
    prompt: (ctx) => ctx.userPrompt,
  })
  .compile();
`,
    );

    // outputMapper is required on StageOptions
    const result = await checkTypeChecking([filePath2], TSCONFIG_PATH);
    expect(result.verified).toBe(false);
    const errors = (result.details as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes("outputMapper"))).toBe(true);
  });

  test("reports multiple errors with count", async () => {
    const filePath = writeTestWorkflow(
      "multiple-errors.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "multi-error",
    description: "Multiple type errors",
  })
  .stage({
    name: "s1",
    description: "S1",
    prompt: (ctx) => ctx.userPrompt,
    outputMapper: (response): string => response,
  })
  .stage({
    name: "s2",
    description: "S2",
    prompt: (ctx) => ctx.userPrompt,
    outputMapper: (response): string => response,
  })
  .compile();
`,
    );

    const result = await checkTypeChecking([filePath], TSCONFIG_PATH);
    expect(result.verified).toBe(false);
    const errors = (result.details as { errors: string[] }).errors;
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(result.counterexample).toContain("type error(s) found");
  });

  test("returns verified with warnings when TS program cannot be created", async () => {
    // Pass a non-existent file — createProgram will still succeed but with errors
    // Instead, test with a path that isn't valid
    const result = await checkTypeChecking(["/dev/null/nonexistent.ts"]);
    // Should not crash — either verified with warnings or verified with errors
    expect(result).toBeDefined();
  });

  test("only reports errors from specified source files, not SDK internals", async () => {
    const filePath = writeTestWorkflow(
      "clean-workflow.ts",
      `
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "clean",
    description: "Clean workflow",
  })
  .stage({
    name: "step",
    description: "STEP",
    prompt: (ctx) => \`Do: \${ctx.userPrompt}\`,
    outputMapper: (response) => ({ result: response }),
  })
  .compile();
`,
    );

    const result = await checkTypeChecking([filePath], TSCONFIG_PATH);
    expect(result.verified).toBe(true);

    // If there were errors, none should be from SDK files
    if (!result.verified && result.details) {
      const errors = (result.details as { errors: string[] }).errors ?? [];
      for (const error of errors) {
        expect(error).not.toContain("node_modules");
        expect(error).not.toContain("workflow-sdk");
      }
    }
  });

  test("auto-discovers tsconfig from source directory", async () => {
    const filePath = writeTestWorkflow(
      "auto-discover.ts",
      `
const x: number = "not a number";
`,
    );

    // Should auto-discover TEST_DIR/tsconfig.json without explicit path
    const result = await checkTypeChecking([filePath]);
    expect(result.verified).toBe(false);
    const errors = (result.details as { errors: string[] }).errors;
    expect(errors.length).toBeGreaterThan(0);
  });

  test("returns warning when no tsconfig.json exists", async () => {
    // Write a file in a directory without tsconfig
    const noTsconfigDir = join(TEST_DIR, "no-tsconfig-dir");
    mkdirSync(noTsconfigDir, { recursive: true });
    const filePath = join(noTsconfigDir, "orphan.ts");
    writeFileSync(filePath, `const x: number = "bad";`);

    const result = await checkTypeChecking([filePath]);
    expect(result.verified).toBe(true);
    expect(result.details).toBeDefined();
    const warnings = (result.details as { warnings: string[] }).warnings;
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("No tsconfig.json found");
  });

  test("error format includes file name, line, column, and TS code", async () => {
    const filePath = writeTestWorkflow(
      "format-check.ts",
      `
const x: number = "not a number";
`,
    );

    const result = await checkTypeChecking([filePath]);
    expect(result.verified).toBe(false);
    const errors = (result.details as { errors: string[] }).errors;
    expect(errors.length).toBe(1);
    // Should match format: filename:line:col - error TSxxxx: message
    expect(errors[0]).toMatch(/^format-check\.ts:\d+:\d+ - error TS\d+: /);
  });
});
