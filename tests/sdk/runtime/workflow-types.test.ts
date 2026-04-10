import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm, readlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { existsSync, lstatSync } from "fs";
import { setupWorkflowTypes } from "@/services/system/workflows.ts";

describe("setupWorkflowTypes", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-wf-types-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates @bastani/atomic symlink in node_modules", async () => {
    await setupWorkflowTypes(tempDir);

    const symlinkPath = join(tempDir, "node_modules", "@bastani", "atomic");
    expect(existsSync(symlinkPath)).toBe(true);

    const stats = lstatSync(symlinkPath);
    expect(stats.isSymbolicLink()).toBe(true);

    // Symlink target should contain a package.json with name @bastani/atomic
    const pkgJson = JSON.parse(
      await readFile(join(symlinkPath, "package.json"), "utf-8"),
    );
    expect(pkgJson.name).toBe("@bastani/atomic");
  });

  test("generates tsconfig.json without paths when symlink succeeds", async () => {
    await setupWorkflowTypes(tempDir);

    const tsconfig = JSON.parse(
      await readFile(join(tempDir, "tsconfig.json"), "utf-8"),
    );

    expect(tsconfig.compilerOptions.moduleResolution).toBe("bundler");
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.paths).toBeUndefined();
    expect(tsconfig.include).toBeArrayOfSize(4);
  });

  test("is idempotent — second call replaces stale symlinks", async () => {
    await setupWorkflowTypes(tempDir);
    await setupWorkflowTypes(tempDir);

    const symlinkPath = join(tempDir, "node_modules", "@bastani", "atomic");
    expect(existsSync(symlinkPath)).toBe(true);

    const stats = lstatSync(symlinkPath);
    expect(stats.isSymbolicLink()).toBe(true);
  });

  test("symlink target points to the package root", async () => {
    await setupWorkflowTypes(tempDir);

    const symlinkPath = join(tempDir, "node_modules", "@bastani", "atomic");
    const target = await readlink(symlinkPath);

    // The target should contain src/sdk/workflows.ts (the SDK barrel)
    const workflowsSrc = join(target, "src", "sdk", "workflows.ts");
    expect(existsSync(workflowsSrc)).toBe(true);
  });

  test("tsconfig include globs cover all agent directories", async () => {
    await setupWorkflowTypes(tempDir);

    const tsconfig = JSON.parse(
      await readFile(join(tempDir, "tsconfig.json"), "utf-8"),
    );

    const includes: string[] = tsconfig.include;
    expect(includes).toContain("**/claude/**/*.ts");
    expect(includes).toContain("**/copilot/**/*.ts");
    expect(includes).toContain("**/opencode/**/*.ts");
    expect(includes).toContain("**/helpers/**/*.ts");
  });
});
