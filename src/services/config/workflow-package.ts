/**
 * Workflow Package - Manage local @bastani/atomic-workflows SDK packages
 *
 * Instead of installing the SDK globally, we create a local node package in
 * each workflows directory (~/.atomic/workflows/ and .atomic/workflows/) so
 * user workflow .ts files can import from the SDK via standard node_modules
 * resolution.
 */

import { rm, unlink } from "fs/promises";
import { join, relative } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { resolveBunExecutable } from "@/lib/spawn.ts";
import { ensureDir } from "@/services/system/copy.ts";

const WORKFLOW_PACKAGE_JSON = {
  name: "atomic-workflows",
  private: true,
  type: "module",
};

const WORKFLOW_GITIGNORE = "node_modules/\n";

const WORKFLOW_TSCONFIG = {
  compilerOptions: {
    lib: ["ESNext", "DOM"],
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
  },
  include: ["*.ts"],
};

function warnBunResolutionFailure(action: string, workflowsDir: string): void {
  console.warn(
    `[workflow-package] Could not resolve Bun executable; skipped ${action} in ${workflowsDir}. Check PATH or BUN_INSTALL.`,
  );
}

/**
 * Read the installed version of @bastani/atomic-workflows from node_modules.
 * Returns null if the package is not installed or the version cannot be read.
 */
export async function getInstalledWorkflowSdkVersion(workflowsDir: string): Promise<string | null> {
  const pkgJsonPath = join(workflowsDir, "node_modules", "@bastani", "atomic-workflows", "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  try {
    const pkg = await Bun.file(pkgJsonPath).json();
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure a workflows directory has the required package scaffolding:
 * - package.json   (created if missing)
 * - tsconfig.json  (created if missing)
 * - .gitignore     (created if missing)
 *
 * Does NOT run `bun add` — call {@link installWorkflowSdk} for that.
 */
export async function ensureWorkflowPackageScaffold(workflowsDir: string): Promise<void> {
  await ensureDir(workflowsDir);

  const pkgPath = join(workflowsDir, "package.json");
  if (!existsSync(pkgPath)) {
    await Bun.write(pkgPath, JSON.stringify(WORKFLOW_PACKAGE_JSON, null, 2) + "\n");
  }

  const tsconfigPath = join(workflowsDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    await Bun.write(tsconfigPath, JSON.stringify(WORKFLOW_TSCONFIG, null, 2) + "\n");
  }

  const gitignorePath = join(workflowsDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await Bun.write(gitignorePath, WORKFLOW_GITIGNORE);
  }
}

/**
 * Install or update the @bastani/atomic-workflows SDK as a local dependency
 * in the given workflows directory.
 *
 * @param workflowsDir - The workflows directory (e.g. ~/.atomic/workflows or .atomic/workflows)
 * @param version      - The SDK version specifier (e.g. "0.4.27", "latest", "next")
 * @returns true if the install succeeded, false otherwise
 */
export async function installWorkflowSdk(
  workflowsDir: string,
  version: string,
): Promise<boolean> {
  await ensureWorkflowPackageScaffold(workflowsDir);
  const bunPath = resolveBunExecutable();
  if (!bunPath) {
    warnBunResolutionFailure("installing @bastani/atomic-workflows", workflowsDir);
    return false;
  }

  const sdkSpec = `@bastani/atomic-workflows@${version}`;
  const result = Bun.spawnSync([bunPath, "add", sdkSpec], {
    cwd: workflowsDir,
    stdout: "ignore",
    stderr: "pipe",
  });

  return result.exitCode === 0;
}

/**
 * Remove the SDK dependency and node_modules from a workflows directory,
 * preserving any user-authored .ts workflow files.
 *
 * @param workflowsDir - The workflows directory to clean
 * @returns true if clean-up succeeded or was a no-op, false on error
 */
export async function removeWorkflowSdk(workflowsDir: string): Promise<boolean> {
  if (!existsSync(workflowsDir)) return true;

  const pkgPath = join(workflowsDir, "package.json");
  if (!existsSync(pkgPath)) return true;
  const bunPath = resolveBunExecutable();
  if (!bunPath) {
    warnBunResolutionFailure("removing @bastani/atomic-workflows", workflowsDir);
    return false;
  }

  const result = Bun.spawnSync([bunPath, "remove", "@bastani/atomic-workflows"], {
    cwd: workflowsDir,
    stdout: "ignore",
    stderr: "ignore",
  });

  return result.exitCode === 0;
}

/**
 * Get the global workflows directory path (~/.atomic/workflows).
 */
export function getGlobalWorkflowsDir(): string {
  return join(homedir(), ".atomic", "workflows");
}

/**
 * Get the local (project-scoped) workflows directory path (.atomic/workflows).
 */
export function getLocalWorkflowsDir(projectDir: string = process.cwd()): string {
  return join(projectDir, ".atomic", "workflows");
}

/**
 * Install the @bastani/atomic-workflows SDK from a local package directory
 * (e.g. packages/workflow-sdk in the monorepo) into the given workflows directory.
 *
 * Uses the provided path directly (caller should pass an absolute path for global
 * installs or a relative path for local project installs).
 *
 * @param workflowsDir     - The workflows directory (e.g. ~/.atomic/workflows or .atomic/workflows)
 * @param localPackagePath - Path to the local workflow-sdk package (absolute or relative)
 * @returns true if the install succeeded, false otherwise
 */
export async function installWorkflowSdkFromLocal(
  workflowsDir: string,
  localPackagePath: string,
): Promise<boolean> {
  await ensureWorkflowPackageScaffold(workflowsDir);
  const bunPath = resolveBunExecutable();
  if (!bunPath) {
    warnBunResolutionFailure(
      "installing the local @bastani/atomic-workflows dependency",
      workflowsDir,
    );
    return false;
  }

  // Write the dependency directly into package.json instead of using `bun add`,
  // which can create duplicate JSON keys when run repeatedly with local paths.
  const pkgPath = join(workflowsDir, "package.json");
  try {
    const pkg = await Bun.file(pkgPath).json();
    pkg.dependencies = { ...pkg.dependencies, "@bastani/atomic-workflows": localPackagePath };
    await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } catch {
    const pkg = { ...WORKFLOW_PACKAGE_JSON, dependencies: { "@bastani/atomic-workflows": localPackagePath } };
    await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  // Remove stale lockfile and node_modules to avoid "symlink … file exists" errors
  // when bun install tries to recreate .bin/ symlinks from a prior run.
  const lockPath = join(workflowsDir, "bun.lock");
  const nodeModulesPath = join(workflowsDir, "node_modules");
  await Promise.all([
    unlink(lockPath).catch(() => {}),
    rm(nodeModulesPath, { recursive: true, force: true }).catch(() => {}),
  ]);

  const result = Bun.spawnSync([bunPath, "install"], {
    cwd: workflowsDir,
    stdout: "ignore",
    stderr: "pipe",
  });

  return result.exitCode === 0;
}

/**
 * Ensure the installed @bastani/atomic-workflows SDK version matches the
 * running CLI version in both local (.atomic/workflows/) and global
 * (~/.atomic/workflows/) directories. Installs or updates when there is a
 * mismatch or the SDK is missing entirely.
 *
 * @param cliVersion    - The current atomic CLI version (from VERSION)
 * @param installType   - How the CLI was installed ("source", "npm", or "binary")
 * @param configRoot    - Config root path (needed for source-mode local SDK resolution)
 */
export async function ensureWorkflowSdkVersion(
  cliVersion: string,
  installType: "source" | "npm" | "binary",
  configRoot: string,
): Promise<void> {
  const localDir = getLocalWorkflowsDir();
  const globalDir = getGlobalWorkflowsDir();

  const [localVersion, globalVersion] = await Promise.all([
    getInstalledWorkflowSdkVersion(localDir),
    getInstalledWorkflowSdkVersion(globalDir),
  ]);

  const localNeedsUpdate = localVersion !== cliVersion;
  const globalNeedsUpdate = globalVersion !== cliVersion;

  if (!localNeedsUpdate && !globalNeedsUpdate) return;

  const updates: Promise<boolean>[] = [];

  if (installType === "source") {
    const localSdkPath = getLocalSdkPackagePath(configRoot);
    if (localNeedsUpdate) {
      const relativeSdkPath = getRelativeSdkPath(localDir, localSdkPath);
      updates.push(installWorkflowSdkFromLocal(localDir, relativeSdkPath));
    }
    if (globalNeedsUpdate) {
      updates.push(installWorkflowSdkFromLocal(globalDir, localSdkPath));
    }
  } else {
    if (localNeedsUpdate) {
      updates.push(installWorkflowSdk(localDir, cliVersion));
    }
    if (globalNeedsUpdate) {
      updates.push(installWorkflowSdk(globalDir, cliVersion));
    }
  }

  await Promise.all(updates);
}

/**
 * Get the absolute path to the local workflow-sdk package in the monorepo.
 *
 * @param repoRoot - The root directory of the atomic monorepo
 * @returns Absolute path to packages/workflow-sdk
 */
export function getLocalSdkPackagePath(repoRoot: string): string {
  return join(repoRoot, "packages", "workflow-sdk");
}

/**
 * Get a relative path from a workflows directory to the local workflow-sdk package.
 *
 * Used for project-scoped `.atomic/workflows/` so the dependency stays portable
 * within the repo.
 *
 * @param workflowsDir - The workflows directory (e.g. /repo/.atomic/workflows)
 * @param sdkPath      - Absolute path to the workflow-sdk package
 * @returns Relative path like "../../packages/workflow-sdk"
 */
export function getRelativeSdkPath(workflowsDir: string, sdkPath: string): string {
  return relative(workflowsDir, sdkPath);
}
