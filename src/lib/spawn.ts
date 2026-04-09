/**
 * Shared spawn utilities for postinstall and lifecycle scripts.
 *
 * Provides a thin async wrapper around Bun.spawn and a PATH-prepend helper,
 * eliminating duplication across postinstall-playwright, postinstall-liteparse, etc.
 */

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
 * Options for the user-facing ensure* installers.
 *
 * `quiet: true` captures subprocess output instead of streaming it to the
 * terminal, so a higher-level spinner UI (see auto-sync's `runSteps`) can
 * own the display. Failures collected in the captured buffer are thrown
 * out of the ensure* function so the spinner can mark the step red and
 * surface the captured tail in its summary.
 *
 * Default (`quiet: false`) preserves the historical inherit-stdout
 * behavior used by the ad-hoc fallbacks in chat.ts / workflow.ts.
 */
export interface EnsureOptions {
  quiet?: boolean;
}

/**
 * Ensure npm is installed, attempting to install Node.js via available system
 * package managers when missing.
 *
 * No-op when npm is already on PATH.
 */


async function installNodeViaFnm(quiet: boolean): Promise<boolean> {
  const inherit = !quiet;
  // Install fnm if not present.
  if (!Bun.which("fnm")) {
    let installed = false;
    // macOS: prefer Homebrew
    if (process.platform === "darwin" && Bun.which("brew")) {
      const brew = await runCommand(
        [Bun.which("brew")!, "install", "fnm"],
        { inherit },
      );
      installed = brew.success;
    }
    // Windows: prefer winget
    if (!installed && process.platform === "win32" && Bun.which("winget")) {
      const winget = await runCommand(
        [Bun.which("winget")!, "install", "Schniz.fnm"],
        { inherit },
      );
      if (winget.success) {
        // Refresh PATH — winget installs to a location on the user PATH.
        const userPath = process.env.LOCALAPPDATA
          ? join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links")
          : null;
        if (userPath) prependPath(userPath);
      }
      installed = winget.success;
    }
    // Linux / fallback: use the curl installer (requires a shell)
    if (!installed) {
      const shell = Bun.which("bash") ?? Bun.which("sh");
      if (!shell) return false;

      const curl = await runCommand(
        [shell, "-lc", "curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell"],
        { inherit },
      );
      if (!curl.success) return false;

      // Add fnm to PATH for the current session.
      const home = getHomeDir() ?? "/tmp";
      const fnmDir = process.env.FNM_DIR ?? join(home, ".local", "share", "fnm");
      prependPath(fnmDir);
      // Some systems install to ~/.fnm instead
      prependPath(join(home, ".fnm"));
    }
  }

  const fnmPath = Bun.which("fnm");
  if (!fnmPath) return false;

  // Install LTS Node.js via fnm.
  const fnmInstall = await runCommand(
    [fnmPath, "install", "--lts"],
    { inherit },
  );
  if (!fnmInstall.success) return false;

  // Activate the installed version by adding its bin dir to PATH.
  const envShell = process.platform === "win32" ? "cmd" : "bash";
  const envResult = Bun.spawnSync({
    cmd: [fnmPath, "env", "--shell", envShell],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (envResult.success) {
    const envOutput = envResult.stdout.toString();
    if (process.platform === "win32") {
      // cmd output: SET "PATH=C:\...\fnm_multishells\...;..."
      const pathMatch = envOutput.match(/SET "PATH=([^"]+?)"/i);
      if (pathMatch?.[1]) {
        const firstEntry = pathMatch[1].split(";")[0];
        if (firstEntry) prependPath(firstEntry);
      }
    } else {
      // bash output: export PATH="/.../fnm_multishells/...:..."
      const pathMatch = envOutput.match(/export PATH="([^"]+?):/);
      if (pathMatch?.[1]) {
        prependPath(pathMatch[1]);
      }
    }
  }

  return !!Bun.which("node");
}

export async function ensureNpmInstalled(options: EnsureOptions = {}): Promise<void> {
  const quiet = options.quiet ?? false;
  const inherit = !quiet;

  if (Bun.which("npm")) {
    return;
  }

  // Buffer captured failure output so a thrown error can surface the tail
  // through the spinner summary. Only populated when `quiet` is set.
  let capturedDetails = "";
  const record = (result: SpawnResult) => {
    if (quiet && !result.success && result.details) {
      capturedDetails = result.details;
    }
  };

  // Preferred: install via fnm (no root required, works on all platforms).
  if (await installNodeViaFnm(quiet)) {
    return;
  }

  if (process.platform === "win32") {
    // Fallback: direct Node.js installation via Windows package managers.
    if (Bun.which("winget")) {
      record(
        await runCommand(
          [
            "winget",
            "install",
            "--id",
            "OpenJS.NodeJS.LTS",
            "-e",
            "--silent",
            "--accept-source-agreements",
            "--accept-package-agreements",
          ],
          { inherit },
        ),
      );
    } else if (Bun.which("choco")) {
      record(
        await runCommand(
          ["choco", "install", "nodejs-lts", "-y", "--no-progress"],
          { inherit },
        ),
      );
    } else if (Bun.which("scoop")) {
      record(
        await runCommand(["scoop", "install", "nodejs-lts"], { inherit }),
      );
    }

    const programFiles = process.env.ProgramFiles;
    if (programFiles) {
      prependPath(join(programFiles, "nodejs"));
    }
    if (Bun.which("npm")) return;
    throw new Error(
      capturedDetails || "Could not install Node.js on Windows (no supported package manager found).",
    );
  }

  const shell = Bun.which("bash") ?? Bun.which("sh");
  if (!shell) {
    throw new Error("Neither bash nor sh is available to install Node.js.");
  }

  // Fallback: Homebrew, NodeSource, then system package managers.
  const installers = [
    'if command -v brew >/dev/null 2>&1; then brew install node && brew link --overwrite node 2>/dev/null; fi',
    'if command -v apt-get >/dev/null 2>&1; then SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"; $SUDO apt-get update && $SUDO apt-get install -y nodejs npm; fi',
    'if command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y nodejs npm; elif [ "$(id -u)" -eq 0 ]; then dnf install -y nodejs npm; fi; fi',
    'if command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y nodejs npm; elif [ "$(id -u)" -eq 0 ]; then yum install -y nodejs npm; fi; fi',
    'if command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Sy --noconfirm nodejs npm; elif [ "$(id -u)" -eq 0 ]; then pacman -Sy --noconfirm nodejs npm; fi; fi',
    'if command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper --non-interactive install nodejs npm; elif [ "$(id -u)" -eq 0 ]; then zypper --non-interactive install nodejs npm; fi; fi',
    'if command -v apk >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apk add --no-cache nodejs npm; elif [ "$(id -u)" -eq 0 ]; then apk add --no-cache nodejs npm; fi; fi',
  ];

  for (const script of installers) {
    if (Bun.which("npm")) {
      return;
    }
    record(await runCommand([shell, "-lc", script], { inherit }));
    if (Bun.which("npm")) {
      return;
    }
  }

  throw new Error(
    capturedDetails || "Could not install Node.js — no supported package manager succeeded.",
  );
}

/**
 * Upgrade npm to the latest version.
 * Falls back to installing Node.js/npm if it is not yet present.
 */
export async function upgradeNpm(): Promise<void> {
  const npmPath = Bun.which("npm");
  if (!npmPath) {
    await ensureNpmInstalled();
    return;
  }
  const result = await runCommand([npmPath, "install", "-g", "npm@latest"]);
  if (!result.success) {
    const hint =
      result.details?.includes("EACCES") || result.details?.includes("permission")
        ? "\nIf this is a permissions issue, try: sudo npm install -g npm@latest"
        : "";
    throw new Error(`npm self-upgrade failed: ${result.details}${hint}`);
  }
}

/**
 * Upgrade a global npm package to the latest version.
 */
export async function upgradeGlobalPackage(pkg: string): Promise<void> {
  const versionedPkg = pkg.includes("@latest") ? pkg : `${pkg}@latest`;
  const npmPath = Bun.which("npm");
  if (npmPath) {
    const result = await runCommand([npmPath, "install", "-g", versionedPkg]);
    if (result.success) return;
    throw new Error(`Failed to upgrade ${pkg}: npm: ${result.details}`);
  }
  throw new Error(`npm is not available to upgrade ${pkg}.`);
}

/** Upgrade @playwright/cli to the latest version globally. */
export async function upgradePlaywrightCli(): Promise<void> {
  return upgradeGlobalPackage("@playwright/cli");
}

/** Upgrade @llamaindex/liteparse to the latest version globally. */
export async function upgradeLiteparse(): Promise<void> {
  return upgradeGlobalPackage("@llamaindex/liteparse");
}

/**
 * Ensure a terminal multiplexer (tmux on Unix, psmux on Windows) is installed.
 * No-op when already present on PATH.
 *
 * When `quiet: true`, subprocess output is captured instead of inherited
 * so an outer spinner UI owns the display. On failure the captured tail
 * is re-thrown as the error message.
 */
export async function ensureTmuxInstalled(options: EnsureOptions = {}): Promise<void> {
  const quiet = options.quiet ?? false;
  const inherit = !quiet;

  // Check for any multiplexer binary
  if (Bun.which("tmux") || Bun.which("psmux") || Bun.which("pmux")) return;

  let capturedDetails = "";
  const record = (result: SpawnResult) => {
    if (quiet && !result.success && result.details) {
      capturedDetails = result.details;
    }
  };

  if (process.platform === "win32") {
    // Windows: install psmux
    const winget = Bun.which("winget");
    if (winget) {
      const result = await runCommand([winget, "install", "psmux", "--accept-source-agreements", "--accept-package-agreements"], { inherit });
      record(result);
      if (result.success && (Bun.which("psmux") || Bun.which("tmux"))) return;
    }

    const scoop = Bun.which("scoop");
    if (scoop) {
      await runCommand([scoop, "bucket", "add", "psmux", "https://github.com/psmux/scoop-psmux"], { inherit });
      const result = await runCommand([scoop, "install", "psmux"], { inherit });
      record(result);
      if (result.success && (Bun.which("psmux") || Bun.which("tmux"))) return;
    }

    const choco = Bun.which("choco");
    if (choco) {
      const result = await runCommand([choco, "install", "psmux", "-y", "--no-progress"], { inherit });
      record(result);
      if (result.success && (Bun.which("psmux") || Bun.which("tmux"))) return;
    }

    const cargo = Bun.which("cargo");
    if (cargo) {
      const result = await runCommand([cargo, "install", "psmux"], { inherit });
      record(result);
      if (result.success) {
        const home = getHomeDir();
        if (home) prependPath(join(home, ".cargo", "bin"));
        if (Bun.which("psmux") || Bun.which("tmux")) return;
      }
    }
    throw new Error(
      capturedDetails || "Could not install psmux — no supported Windows package manager succeeded.",
    );
  }

  // Unix / macOS
  if (process.platform === "darwin") {
    const brew = Bun.which("brew");
    if (brew) {
      const result = await runCommand([brew, "install", "tmux"], { inherit });
      record(result);
      if (result.success && Bun.which("tmux")) return;
    }
  }

  // Linux package managers
  const shell = Bun.which("bash") ?? Bun.which("sh");
  if (!shell) {
    throw new Error("Neither bash nor sh is available to install tmux.");
  }

  const managers: string[] = [
    "command -v apt-get >/dev/null 2>&1 && sudo apt-get update -qq && sudo apt-get install -y tmux",
    "command -v dnf >/dev/null 2>&1 && sudo dnf install -y tmux",
    "command -v yum >/dev/null 2>&1 && sudo yum install -y tmux",
    "command -v pacman >/dev/null 2>&1 && sudo pacman -Sy --noconfirm tmux",
    "command -v zypper >/dev/null 2>&1 && sudo zypper --non-interactive install tmux",
    "command -v apk >/dev/null 2>&1 && sudo apk add --no-cache tmux",
  ];

  for (const script of managers) {
    record(await runCommand([shell, "-lc", script], { inherit }));
    if (Bun.which("tmux")) return;
  }

  throw new Error(
    capturedDetails || "Could not install tmux — no supported package manager succeeded.",
  );
}

/**
 * Ensure bun is installed and available on PATH.
 * No-op when already present.
 */
export async function ensureBunInstalled(): Promise<void> {
  if (Bun.which("bun")) return;

  const home = getHomeDir();

  if (process.platform === "win32") {
    // Windows
    const winget = Bun.which("winget");
    if (winget) {
      const result = await runCommand([winget, "install", "Oven-sh.Bun", "--accept-source-agreements", "--accept-package-agreements"], { inherit: true });
      if (result.success) {
        if (home) prependPath(join(home, ".bun", "bin"));
        if (Bun.which("bun")) return;
      }
    }

    const scoop = Bun.which("scoop");
    if (scoop) {
      const result = await runCommand([scoop, "install", "bun"], { inherit: true });
      if (result.success && Bun.which("bun")) return;
    }

    const npmPath = Bun.which("npm");
    if (npmPath) {
      const result = await runCommand([npmPath, "install", "-g", "bun"], { inherit: true });
      if (result.success && Bun.which("bun")) return;
    }
    return;
  }

  // Unix / macOS
  const shell = Bun.which("bash") ?? Bun.which("sh");
  if (shell) {
    const result = await runCommand(
      [shell, "-lc", "curl -fsSL https://bun.sh/install | bash"],
      { inherit: true },
    );
    if (result.success) {
      if (home) prependPath(join(home, ".bun", "bin"));
      if (Bun.which("bun")) return;
    }
  }

  // macOS Homebrew fallback
  if (process.platform === "darwin") {
    const brew = Bun.which("brew");
    if (brew) {
      const result = await runCommand([brew, "install", "oven-sh/bun/bun"], { inherit: true });
      if (result.success && Bun.which("bun")) return;
    }
  }
}

/**
 * Ensure tmux/psmux is installed. Used as a ToolingStep in the update pipeline.
 * Does not attempt version upgrades — just ensures the tool exists.
 */
export async function upgradeTmux(): Promise<void> {
  await ensureTmuxInstalled();
}

/**
 * Upgrade bun to the latest version, or install if missing.
 */
export async function upgradeBun(): Promise<void> {
  const bunPath = Bun.which("bun");
  if (!bunPath) {
    await ensureBunInstalled();
    return;
  }
  const result = await runCommand([bunPath, "upgrade"]);
  if (!result.success) {
    throw new Error(`bun upgrade failed: ${result.details}`);
  }
}

// ---------------------------------------------------------------------------
// Shared tooling-setup helpers (used by postinstall and update commands)
// ---------------------------------------------------------------------------

export class ToolingSetupError extends Error {
  constructor(public readonly failures: string[]) {
    const list = failures.map((f) => `  - ${f}`).join("\n");
    super(
      `Tooling setup failed:\n${list}\n\n` +
      `Re-run \`bun install\` to retry, or install the failed tools manually.`,
    );
    this.name = "ToolingSetupError";
  }
}

export interface ToolingStep {
  label: string;
  fn: () => Promise<unknown>;
}

export function collectFailures(
  steps: ToolingStep[],
  results: PromiseSettledResult<unknown>[],
): string[] {
  const failures: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === "rejected") {
      const reason = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      const label = steps[i]?.label ?? `step ${i}`;
      failures.push(`${label}: ${reason}`);
    }
  }
  return failures;
}
