import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  installWorkflowSdk,
  installWorkflowSdkFromLocal,
  removeWorkflowSdk,
} from "@/services/config/workflow-package.ts";

let tempDir: string;

describe("workflow package npm resolution", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "workflow-package-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("installWorkflowSdk calls npm install with the SDK spec", async () => {
    const workflowsDir = join(tempDir, "workflows");

    using whichSpy = spyOn(Bun, "which").mockReturnValue("/usr/local/bin/npm");
    using spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
    } as ReturnType<typeof Bun.spawnSync>);

    const installed = await installWorkflowSdk(workflowsDir, "1.2.3");

    expect(installed).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith(
      ["/usr/local/bin/npm", "install", "@bastani/atomic-workflows@1.2.3"],
      expect.objectContaining({ cwd: workflowsDir }),
    );

    const packageJson = JSON.parse(
      await readFile(join(workflowsDir, "package.json"), "utf8"),
    ) as { name: string };
    expect(packageJson.name).toBe("atomic-workflows");
    expect(whichSpy).toHaveBeenCalledWith("npm");
  });

  test("installWorkflowSdkFromLocal calls npm install after writing dependency", async () => {
    const workflowsDir = join(tempDir, "local-workflows");
    const localSdkDir = join(tempDir, "workflow-sdk");
    await mkdir(localSdkDir, { recursive: true });

    using whichSpy = spyOn(Bun, "which").mockReturnValue("/usr/local/bin/npm");
    using spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
    } as ReturnType<typeof Bun.spawnSync>);

    const installed = await installWorkflowSdkFromLocal(workflowsDir, localSdkDir);

    expect(installed).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith(
      ["/usr/local/bin/npm", "install"],
      expect.objectContaining({ cwd: workflowsDir }),
    );

    const packageJson = JSON.parse(
      await readFile(join(workflowsDir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.["@bastani/atomic-workflows"]).toBe(localSdkDir);
    expect(whichSpy).toHaveBeenCalledWith("npm");
  });

  test("installWorkflowSdk warns when npm cannot be resolved", async () => {
    const workflowsDir = join(tempDir, "missing-npm-workflows");

    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    using warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const installed = await installWorkflowSdk(workflowsDir, "1.2.3");

    expect(installed).toBe(false);
    expect(whichSpy).toHaveBeenCalledWith("npm");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Could not resolve npm");
    expect(warnSpy.mock.calls[0]?.[0]).toContain(workflowsDir);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Ensure Node.js is installed");
  });

  test("installWorkflowSdk preserves existing workflow files", async () => {
    const workflowsDir = join(tempDir, "preserve-existing-workflows");
    const workflowFile = join(workflowsDir, "existing-workflow.ts");
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(workflowFile, "export const workflow = 'keep me';\n");

    using spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
    } as ReturnType<typeof Bun.spawnSync>);

    const installed = await installWorkflowSdk(workflowsDir, "1.2.3");

    expect(installed).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(workflowFile)).toBe(true);
    expect(await readFile(workflowFile, "utf8")).toBe("export const workflow = 'keep me';\n");
  });

  test("installWorkflowSdkFromLocal preserves existing helper files while refreshing dependencies", async () => {
    const workflowsDir = join(tempDir, "preserve-local-workflows");
    const helperFile = join(workflowsDir, "shared-lib.ts");
    const localSdkDir = join(tempDir, "workflow-sdk");
    await mkdir(join(workflowsDir, "node_modules"), { recursive: true });
    await mkdir(localSdkDir, { recursive: true });
    await writeFile(helperFile, "export const helper = () => 'still here';\n");
    await writeFile(join(workflowsDir, "bun.lock"), "stale lock\n");

    using spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
    } as ReturnType<typeof Bun.spawnSync>);

    const installed = await installWorkflowSdkFromLocal(workflowsDir, localSdkDir);

    expect(installed).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(helperFile)).toBe(true);
    expect(await readFile(helperFile, "utf8")).toBe("export const helper = () => 'still here';\n");
  });

  test("removeWorkflowSdk warns when npm cannot be resolved", async () => {
    const workflowsDir = join(tempDir, "remove-missing-npm-workflows");
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, "package.json"), "{}\n");

    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    using warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const removed = await removeWorkflowSdk(workflowsDir);

    expect(removed).toBe(false);
    expect(whichSpy).toHaveBeenCalledWith("npm");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Could not resolve npm");
    expect(warnSpy.mock.calls[0]?.[0]).toContain(workflowsDir);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Ensure Node.js is installed");
  });
});
