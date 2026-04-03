/**
 * Shared spawn utilities for postinstall and lifecycle scripts.
 *
 * Provides a thin async wrapper around Bun.spawn and a PATH-prepend helper,
 * eliminating duplication across postinstall-playwright, postinstall-liteparse, etc.
 */

import { existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";

export interface SpawnResult {
  success: boolean;
  details: string;
}

export interface RunCommandOptions {
  /** When true, stdout/stderr are inherited so the user sees live output. */
  inherit?: boolean;
}

/**
 * Run a command asynchronously and collect its output.
 * Returns a result object instead of throwing on failure.
 *
 * When `inherit` is true, output streams directly to the terminal so the
 * user can follow installation progress in real time.
 */
export async function runCommand(cmd: string[], options?: RunCommandOptions): Promise<SpawnResult> {
  try {
    if (options?.inherit) {
      const proc = Bun.spawn({
        cmd,
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      });
      const exitCode = await proc.exited;
      return { success: exitCode === 0, details: "" };
    }

    const proc = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
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
 * Marker used by bun's own installer to identify its PATH block in shell
 * config files.  We reuse the same marker so we don't duplicate what the
 * installer already wrote and vice-versa.
 */
const BUN_SHELL_MARKER = "# bun";

/**
 * Ensure Bun's global bin directory is present in the user's shell profile
 * so that globally-installed packages (playwright-cli, lit, etc.) are
 * available in new terminal sessions.
 *
 * Appends the same block that Bun's official installer writes:
 *   # bun
 *   export BUN_INSTALL="$HOME/.bun"
 *   export PATH="$BUN_INSTALL/bin:$PATH"
 *
 * Skips files that already contain the marker.  On Windows, adds the
 * directory to the persistent user-level PATH via the registry.
 */
/**
 * @returns `true` when at least one shell profile was modified (caller
 *          should tell the user to open a new terminal or source it).
 */
export async function ensureBunBinInShellProfile(): Promise<boolean> {
  if (process.platform === "win32") {
    return ensureBunBinInWindowsPath();
  }
  return ensureBunBinInUnixProfiles();
}

function ensureBunBinInUnixProfiles(): boolean {
  const home = getHomeDir();
  if (!home) return false;

  const posixBlock = [
    "",
    BUN_SHELL_MARKER,
    'export BUN_INSTALL="$HOME/.bun"',
    'export PATH="$BUN_INSTALL/bin:$PATH"',
    "",
  ].join("\n");

  const fishBlock = [
    "",
    BUN_SHELL_MARKER,
    'set --export BUN_INSTALL "$HOME/.bun"',
    "set --export PATH $BUN_INSTALL/bin $PATH",
    "",
  ].join("\n");

  // .profile covers login shells (SSH, tmux, CI) where .bashrc's
  // non-interactive guard causes an early return before the bun block.
  const candidates: Array<{ path: string; block: string }> = [
    { path: join(home, ".profile"), block: posixBlock },
    { path: join(home, ".bashrc"), block: posixBlock },
    { path: join(home, ".zshrc"), block: posixBlock },
    { path: join(home, ".config", "fish", "config.fish"), block: fishBlock },
  ];

  let modified = false;
  for (const { path: configPath, block } of candidates) {
    if (!existsSync(configPath)) continue;
    try {
      const content = readFileSync(configPath, "utf-8");
      if (content.includes(BUN_SHELL_MARKER)) continue;
      appendFileSync(configPath, block, "utf-8");
      modified = true;
    } catch {
      // Non-fatal — the profile may be read-only.
    }
  }
  return modified;
}

async function ensureBunBinInWindowsPath(): Promise<boolean> {
  const bunBinDir = getBunBinDir();
  if (!bunBinDir) return false;

  const ps = Bun.which("powershell") ?? Bun.which("pwsh");
  if (!ps) return false;

  // Read current user-level PATH from the registry.
  const read = await runCommand([
    ps, "-NoProfile", "-Command",
    "[Environment]::GetEnvironmentVariable('Path', 'User')",
  ]);
  if (read.success && read.details.includes(".bun\\bin")) return false;

  // Prepend bun's bin directory to the user-level PATH.
  await runCommand([
    ps, "-NoProfile", "-Command",
    `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); ` +
    `if ($p) { $p = '${bunBinDir}' + ';' + $p } else { $p = '${bunBinDir}' }; ` +
    `[Environment]::SetEnvironmentVariable('Path', $p, 'User')`,
  ]);
  return true;
}

/**
 * Ensure Bun is installed, downloading it if necessary.
 *
 * For compiled-binary installs (e.g. devcontainer features) the PATH may not
 * include a standalone `bun` binary.  This function checks for one and, when
 * missing, runs the official Bun installer so that subsequent `bun add` /
 * `bun install` calls succeed.
 *
 * No-op when Bun is already resolvable.
 */
export async function ensureBunInstalled(): Promise<void> {
  if (resolveBunExecutable()) {
    return;
  }

  if (process.platform === "win32") {
    const powerShellPath = Bun.which("powershell") ?? Bun.which("pwsh");
    if (!powerShellPath) {
      throw new Error(
        "Neither powershell nor pwsh is available to install bun.",
      );
    }
    await runCommand([
      powerShellPath,
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression",
    ], { inherit: true });
  } else {
    const shell = Bun.which("bash") ?? Bun.which("sh");
    if (!shell) {
      throw new Error("Neither bash nor sh is available to install bun.");
    }
    await runCommand([shell, "-lc", "curl -fsSL https://bun.sh/install | bash"], { inherit: true });
  }

  const bunBinDir = getBunBinDir();
  if (bunBinDir) {
    prependPath(bunBinDir);
  }
}

/**
 * Ensure npm is installed, attempting to install Node.js via available system
 * package managers when missing.
 *
 * No-op when npm is already on PATH.
 */
export async function ensureNpmInstalled(): Promise<void> {
  if (Bun.which("npm")) {
    return;
  }

  if (process.platform === "win32") {
    if (Bun.which("winget")) {
      await runCommand([
        "winget",
        "install",
        "--id",
        "OpenJS.NodeJS.LTS",
        "-e",
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ], { inherit: true });
    } else if (Bun.which("choco")) {
      await runCommand(["choco", "install", "nodejs-lts", "-y", "--no-progress"], { inherit: true });
    } else if (Bun.which("scoop")) {
      await runCommand(["scoop", "install", "nodejs-lts"], { inherit: true });
    }

    const programFiles = process.env.ProgramFiles;
    if (programFiles) {
      prependPath(join(programFiles, "nodejs"));
    }
    return;
  }

  const shell = Bun.which("bash") ?? Bun.which("sh");
  if (!shell) {
    throw new Error("Neither bash nor sh is available to install npm.");
  }
  const installers = [
    "if command -v brew >/dev/null 2>&1; then brew install node; fi",
    "if command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then apt-get update && apt-get install -y nodejs npm; fi; fi",
    "if command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then dnf install -y nodejs npm; fi; fi",
    "if command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then yum install -y nodejs npm; fi; fi",
    "if command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Sy --noconfirm nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then pacman -Sy --noconfirm nodejs npm; fi; fi",
    "if command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper --non-interactive install nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then zypper --non-interactive install nodejs npm; fi; fi",
    "if command -v apk >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apk add --no-cache nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then apk add --no-cache nodejs npm; fi; fi",
  ];

  for (const script of installers) {
    if (Bun.which("npm")) {
      return;
    }
    await runCommand([shell, "-lc", script], { inherit: true });
    if (Bun.which("npm")) {
      return;
    }
  }
}

/**
 * Get the directory where uv installs its executables.
 * uv defaults to ~/.local/bin on Unix and %USERPROFILE%\.local\bin on Windows.
 */
function getUvBinDir(): string | undefined {
  const homeDir = getHomeDir();
  return homeDir ? join(homeDir, ".local", "bin") : undefined;
}

/**
 * Resolve uv's executable path, falling back to the default install location
 * when the current PATH has not been refreshed yet.
 */
export function resolveUvExecutable(): string | undefined {
  const uvPath = Bun.which("uv");
  if (uvPath) {
    return uvPath;
  }

  const uvBinDir = getUvBinDir();
  if (!uvBinDir) {
    return undefined;
  }

  const uvExecutable = join(
    uvBinDir,
    process.platform === "win32" ? "uv.exe" : "uv",
  );
  if (!existsSync(uvExecutable)) {
    return undefined;
  }

  prependPath(uvBinDir);
  return uvExecutable;
}

/**
 * Ensure uv (Python package manager) is installed, downloading it if
 * necessary via the official installer.
 *
 * No-op when uv is already on PATH.
 */
export async function ensureUvInstalled(): Promise<void> {
  if (resolveUvExecutable()) {
    return;
  }

  if (process.platform === "win32") {
    const powerShellPath = Bun.which("powershell") ?? Bun.which("pwsh");
    if (!powerShellPath) {
      throw new Error(
        "Neither powershell nor pwsh is available to install uv.",
      );
    }
    await runCommand([
      powerShellPath,
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "irm https://astral.sh/uv/install.ps1 | iex",
    ], { inherit: true });
  } else {
    const shell = Bun.which("bash") ?? Bun.which("sh");
    if (!shell) {
      throw new Error("Neither bash nor sh is available to install uv.");
    }
    await runCommand([
      shell,
      "-lc",
      "curl -LsSf https://astral.sh/uv/install.sh | sh",
    ], { inherit: true });
  }

  const uvBinDir = getUvBinDir();
  if (uvBinDir) {
    prependPath(uvBinDir);
  }

  if (!resolveUvExecutable()) {
    throw new Error(
      "uv was not found after installation. Install manually from https://docs.astral.sh/uv/",
    );
  }
}

/**
 * Resolve Bun's executable path, falling back to Bun's default install
 * location when the current PATH has not been refreshed yet.
 *
 * Always ensures Bun's bin directory (~/.bun/bin on Linux/macOS,
 * %USERPROFILE%\.bun\bin on Windows, or $BUN_INSTALL/bin when set) is on
 * PATH so that globally-installed bun packages (e.g. playwright-cli,
 * liteparse) are discoverable by child processes.
 */
export function resolveBunExecutable(): string | undefined {
  // Always prepend Bun's global bin directory so that packages installed
  // via `bun install -g` (playwright-cli, lit, etc.) are on PATH regardless
  // of how Bun itself was installed (system package, Homebrew, official
  // installer, etc.).
  const bunBinDir = getBunBinDir();
  if (bunBinDir) {
    prependPath(bunBinDir);
  }

  const bunPath = Bun.which("bun");
  if (bunPath) {
    return bunPath;
  }

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
      env: process.env,
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
