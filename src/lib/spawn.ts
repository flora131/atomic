/**
 * Shared spawn utilities for postinstall and lifecycle scripts.
 *
 * Provides a thin async wrapper around Bun.spawn and a PATH-prepend helper,
 * eliminating duplication across postinstall-playwright, postinstall-uv, etc.
 */

import { existsSync } from "fs";
import { join } from "path";

export interface SpawnResult {
  success: boolean;
  details: string;
}

/**
 * Run a command asynchronously and collect its output.
 * Returns a result object instead of throwing on failure.
 */
export async function runCommand(cmd: string[]): Promise<SpawnResult> {
  try {
    const proc = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return {
      success: exitCode === 0,
      details: stderr.trim().length > 0 ? stderr.trim() : stdout.trim(),
    };
  } catch (error) {
    return {
      success: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Prepend a directory to the PATH environment variable (if not already present).
 */
export function prependPath(directory: string): void {
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const currentPath = process.env.PATH ?? "";
  const entries = currentPath.split(pathDelimiter);
  if (!entries.includes(directory)) {
    process.env.PATH = directory + pathDelimiter + currentPath;
  }
}

/**
 * Get the user's home directory from environment variables.
 */
export function getHomeDir(): string | undefined {
  return process.env.HOME ?? process.env.USERPROFILE;
}

/**
 * Get the path to Bun's binary directory.
 *
 * Prefer BUN_INSTALL/bin when Bun explicitly sets its install root; otherwise
 * fall back to the default ~/.bun/bin location.
 */
function getBunInstallRoot(): string | undefined {
  const bunInstallDir = process.env.BUN_INSTALL;
  if (bunInstallDir) {
    return bunInstallDir;
  }

  const home = getHomeDir();
  return home ? join(home, ".bun") : undefined;
}

export function getBunBinDir(): string | undefined {
  const bunInstallRoot = getBunInstallRoot();
  return bunInstallRoot ? join(bunInstallRoot, "bin") : undefined;
}

/**
 * Resolve Bun's executable path, falling back to Bun's default install
 * location when the current PATH has not been refreshed yet.
 */
export function resolveBunExecutable(): string | undefined {
  const bunPath = Bun.which("bun");
  if (bunPath) {
    return bunPath;
  }

  const bunBinDir = getBunBinDir();
  if (!bunBinDir) {
    return undefined;
  }

  const bunExecutable = join(
    bunBinDir,
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  if (!existsSync(bunExecutable)) {
    return undefined;
  }

  prependPath(bunBinDir);
  return bunExecutable;
}

/**
 * Get the path to bun's global install directory (where `bun install -g` places packages).
 */
export function getBunGlobalInstallDir(): string | undefined {
  const bunInstallRoot = getBunInstallRoot();
  return bunInstallRoot ? join(bunInstallRoot, "install", "global") : undefined;
}

/**
 * Run `bun pm trust <packages>` in bun's global install directory so that
 * lifecycle scripts of the specified globally installed packages are allowed to execute.
 */
export async function trustGlobalBunPackages(packages: string[]): Promise<SpawnResult> {
  if (packages.length === 0) {
    return { success: true, details: "no packages to trust" };
  }
  const bunPath = resolveBunExecutable();
  if (!bunPath) {
    return { success: false, details: "bun not found" };
  }
  const globalDir = getBunGlobalInstallDir();
  if (!globalDir) {
    return { success: false, details: "could not determine global install directory" };
  }
  try {
    const proc = Bun.spawn({
      cmd: [bunPath, "pm", "trust", ...packages],
      cwd: globalDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    // bun pm trust exits 1 when packages are already trusted or have no
    // scripts to run — treat that as success since the desired state is met.
    const alreadyTrusted = exitCode !== 0 && stderr.includes("already trusted");
    return {
      success: exitCode === 0 || alreadyTrusted,
      details: stderr.trim().length > 0 ? stderr.trim() : stdout.trim(),
    };
  } catch (error) {
    return {
      success: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
