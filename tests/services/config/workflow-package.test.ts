import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  installWorkflowSdk,
  installWorkflowSdkFromLocal,
  removeWorkflowSdk,
} from "@/services/config/workflow-package.ts";

let tempDir: string;
let savedBunInstall: string | undefined;
let savedHome: string | undefined;
let savedPath: string | undefined;
let savedUserProfile: string | undefined;

async function createFallbackBunExecutable(rootDir: string): Promise<string> {
  const bunInstallDir = join(rootDir, "bun-home");
  const bunBinDir = join(bunInstallDir, "bin");
  const bunExecutable = join(
    bunBinDir,
    process.platform === "win32" ? "bun.exe" : "bun",
  );

  await mkdir(bunBinDir, { recursive: true });
  await writeFile(bunExecutable, "");
  process.env.BUN_INSTALL = bunInstallDir;

  return bunExecutable;
}

describe("workflow package bun resolution", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "workflow-package-test-"));
    savedBunInstall = process.env.BUN_INSTALL;
    savedHome = process.env.HOME;
    savedPath = process.env.PATH;
    savedUserProfile = process.env.USERPROFILE;
    process.env.PATH = "/usr/bin";
  });

  afterEach(async () => {
    if (savedBunInstall === undefined) {
      delete process.env.BUN_INSTALL;
    } else {
      process.env.BUN_INSTALL = savedBunInstall;
    }

    if (savedPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = savedPath;
    }

    if (savedHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = savedHome;
    }

    if (savedUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = savedUserProfile;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  test("installWorkflowSdk uses bun from the default install dir when PATH is stale", async () => {
    const bunExecutable = await createFallbackBunExecutable(tempDir);
    const workflowsDir = join(tempDir, "workflows");

    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
    } as ReturnType<typeof Bun.spawnSync>);

    const installed = await installWorkflowSdk(workflowsDir, "1.2.3");

    expect(installed).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith(
      [bunExecutable, "add", "@bastani/atomic-workflows@1.2.3"],
      expect.objectContaining({ cwd: workflowsDir }),
    );

    const packageJson = JSON.parse(
      await readFile(join(workflowsDir, "package.json"), "utf8"),
    ) as { name: string };
    expect(packageJson.name).toBe("atomic-workflows");
    expect(whichSpy).toHaveBeenCalledWith("bun");
  });

  test("installWorkflowSdkFromLocal also uses the resolved bun executable", async () => {
    const bunExecutable = await createFallbackBunExecutable(tempDir);
    const workflowsDir = join(tempDir, "local-workflows");
    const localSdkDir = join(tempDir, "workflow-sdk");
    await mkdir(localSdkDir, { recursive: true });

    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
    } as ReturnType<typeof Bun.spawnSync>);

    const installed = await installWorkflowSdkFromLocal(workflowsDir, localSdkDir);

    expect(installed).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith(
      [bunExecutable, "install"],
      expect.objectContaining({ cwd: workflowsDir }),
    );

    const packageJson = JSON.parse(
      await readFile(join(workflowsDir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.["@bastani/atomic-workflows"]).toBe(localSdkDir);
    expect(whichSpy).toHaveBeenCalledWith("bun");
  });

  test("installWorkflowSdk warns when bun cannot be resolved", async () => {
    const workflowsDir = join(tempDir, "missing-bun-workflows");
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    using warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const installed = await installWorkflowSdk(workflowsDir, "1.2.3");

    expect(installed).toBe(false);
    expect(whichSpy).toHaveBeenCalledWith("bun");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Could not resolve Bun executable");
    expect(warnSpy.mock.calls[0]?.[0]).toContain(workflowsDir);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Check PATH or BUN_INSTALL");
  });

  test("removeWorkflowSdk warns when bun cannot be resolved", async () => {
    const workflowsDir = join(tempDir, "remove-missing-bun-workflows");
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(join(workflowsDir, "package.json"), "{}\n");
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    using warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const removed = await removeWorkflowSdk(workflowsDir);

    expect(removed).toBe(false);
    expect(whichSpy).toHaveBeenCalledWith("bun");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Could not resolve Bun executable");
    expect(warnSpy.mock.calls[0]?.[0]).toContain(workflowsDir);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Check PATH or BUN_INSTALL");
  });
});
