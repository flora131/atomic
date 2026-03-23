/**
 * Workflow Package - Manage local @bastani/atomic-workflows SDK packages
 *
 * Instead of installing the SDK globally, we create a local node package in
 * each workflows directory (~/.atomic/workflows/ and .atomic/workflows/) so
 * user workflow .ts files can import from the SDK via standard node_modules
 * resolution.
 */

import { mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

const WORKFLOW_PACKAGE_JSON = {
  name: "atomic-workflows",
  private: true,
  type: "module",
};

const WORKFLOW_GITIGNORE = "node_modules/\n";

/**
 * Ensure a workflows directory has the required package scaffolding:
 * - package.json (created if missing)
 * - .gitignore  (created if missing)
 *
 * Does NOT run `bun add` — call {@link installWorkflowSdk} for that.
 */
export async function ensureWorkflowPackageScaffold(workflowsDir: string): Promise<void> {
  await mkdir(workflowsDir, { recursive: true });

  const pkgPath = join(workflowsDir, "package.json");
  if (!existsSync(pkgPath)) {
    await Bun.write(pkgPath, JSON.stringify(WORKFLOW_PACKAGE_JSON, null, 2) + "\n");
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

  const sdkSpec = `@bastani/atomic-workflows@${version}`;
  const result = Bun.spawnSync(["bun", "add", sdkSpec], {
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

  const result = Bun.spawnSync(["bun", "remove", "@bastani/atomic-workflows"], {
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
 * @param workflowsDir     - The workflows directory (e.g. ~/.atomic/workflows)
 * @param localPackagePath - Absolute path to the local workflow-sdk package
 * @returns true if the install succeeded, false otherwise
 */
export async function installWorkflowSdkFromLocal(
  workflowsDir: string,
  localPackagePath: string,
): Promise<boolean> {
  await ensureWorkflowPackageScaffold(workflowsDir);

  const result = Bun.spawnSync(["bun", "add", localPackagePath], {
    cwd: workflowsDir,
    stdout: "ignore",
    stderr: "pipe",
  });

  return result.exitCode === 0;
}
