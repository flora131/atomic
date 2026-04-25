/**
 * Shared spawn utilities for postinstall and lifecycle scripts.
 *
 * Provides a thin async wrapper around Bun.spawn and a PATH-prepend helper,
 * eliminating duplication across postinstall-playwright, postinstall-liteparse, etc.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
  const alreadyPresent = process.platform === "win32"
    ? entries.some((entry) => entry.toLowerCase() === directory.toLowerCase())
    : entries.includes(directory);
  if (!alreadyPresent) {
    process.env.PATH = directory + pathDelimiter + currentPath;
  }
}

export function resolveCommandFromCurrentPath(cmd: string): string | null {
  return Bun.which(cmd, { PATH: process.env.PATH ?? "" });
}

type MuxBinaryName = "tmux" | "psmux" | "pmux";

export function isMuxBinaryRequiredForPlatform(
  binary: MuxBinaryName,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32") {
    return binary === "psmux" || binary === "pmux";
  }
  return binary === "tmux";
}

export function hasRequiredMuxBinary(): boolean {
  const candidates: MuxBinaryName[] = ["psmux", "pmux", "tmux"];
  return candidates.some((candidate) =>
    isMuxBinaryRequiredForPlatform(candidate) &&
    resolveCommandFromCurrentPath(candidate)
  );
}

function prependPathIfDirectory(directory: string | undefined): void {
  if (!directory || !existsSync(directory)) return;
  prependPath(directory);
}

function prependWindowsMuxInstallPaths(): void {
  if (process.platform !== "win32") return;

  const home = getHomeDir();
  prependPathIfDirectory(
    process.env.SCOOP ? join(process.env.SCOOP, "shims") : undefined,
  );
  prependPathIfDirectory(home ? join(home, "scoop", "shims") : undefined);
  prependPathIfDirectory(
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links")
      : undefined,
  );
  prependPathIfDirectory(
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps")
      : undefined,
  );
  prependPathIfDirectory(
    process.env.ChocolateyInstall
      ? join(process.env.ChocolateyInstall, "bin")
      : undefined,
  );
  prependPathIfDirectory("C:\\ProgramData\\chocolatey\\bin");
  prependPathIfDirectory(home ? join(home, ".cargo", "bin") : undefined);
}

function mergePath(pathValue: string): void {
  const delimiter = process.platform === "win32" ? ";" : ":";
  for (const entry of pathValue.split(delimiter)) {
    const trimmed = entry.trim();
    if (trimmed) prependPath(trimmed);
  }
}

async function refreshWindowsPathFromRegistry(): Promise<void> {
  if (process.platform !== "win32") return;

  const shell = resolveCommandFromCurrentPath("powershell") ??
    resolveCommandFromCurrentPath("pwsh");
  if (!shell) return;

  const readRegistryPath =
    "$paths = @([Environment]::GetEnvironmentVariable('Path','Process'), " +
    "[Environment]::GetEnvironmentVariable('Path','User'), " +
    "[Environment]::GetEnvironmentVariable('Path','Machine')) | " +
    "Where-Object { $_ }; $paths -join ';'";

  const result = await runCommand([
    shell,
    "-NoProfile",
    "-Command",
    readRegistryPath,
  ]);
  if (result.success && result.details) {
    mergePath(result.details);
  }
}

async function refreshWindowsMuxPath(): Promise<void> {
  prependWindowsMuxInstallPaths();
  await refreshWindowsPathFromRegistry();
  prependWindowsMuxInstallPaths();
}

/**
 * Get the user's home directory.
 * Uses Node.js os.homedir() which handles cross-platform resolution
 * (HOME on Unix, USERPROFILE on Windows, and fallback to passwd on Linux).
 */
export function getHomeDir(): string {
  return homedir();
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
 * Install one or more global packages via a single `bun install -g` call.
 * Uses `--trust` to allow postinstall lifecycle scripts (required by
 * packages like @playwright/cli).
 *
 * Combining multiple packages into one invocation is important: Bun's
 * global linker is not safe to run concurrently — two parallel
 * `bun install -g` processes race to create the same symlinks in the
 * shared global store, causing EEXIST errors for transitive deps that
 * both packages (or the already-installed @bastani/atomic) share.
 */
export async function upgradeGlobalPackages(pkgs: string[]): Promise<void> {
  const bunPath = Bun.which("bun");
  if (!bunPath) {
    throw new Error(`bun is not available to install ${pkgs.join(", ")}.`);
  }
  const versioned = pkgs.map((p) => (p.includes("@latest") ? p : `${p}@latest`));
  const result = await runCommand([bunPath, "install", "-g", "--trust", ...versioned]);
  if (!result.success) {
    throw new Error(`Failed to install ${pkgs.join(", ")}: ${result.details}`);
  }
}

/** Upgrade @playwright/cli and @llamaindex/liteparse globally in one pass. */
export async function upgradeGlobalToolPackages(): Promise<void> {
  return upgradeGlobalPackages(["@playwright/cli", "@llamaindex/liteparse"]);
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

  // Check for the platform-native multiplexer binary.
  if (hasRequiredMuxBinary()) return;

  let capturedDetails = "";
  const record = (result: SpawnResult) => {
    if (quiet && !result.success && result.details) {
      capturedDetails = result.details;
    }
  };

  if (process.platform === "win32") {
    // Windows: install psmux
    const winget = resolveCommandFromCurrentPath("winget");
    if (winget) {
      const result = await runCommand([
        winget,
        "install",
        "--id",
        "marlocarlo.psmux",
        "--exact",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ], { inherit });
      record(result);
      if (result.success) {
        await refreshWindowsMuxPath();
        if (hasRequiredMuxBinary()) return;
      }
    }

    const scoop = resolveCommandFromCurrentPath("scoop");
    if (scoop) {
      await runCommand([scoop, "bucket", "add", "psmux", "https://github.com/psmux/scoop-psmux"], { inherit });
      const result = await runCommand([scoop, "install", "psmux"], { inherit });
      record(result);
      if (result.success) {
        await refreshWindowsMuxPath();
        if (hasRequiredMuxBinary()) return;
      }
    }

    const choco = resolveCommandFromCurrentPath("choco");
    if (choco) {
      const result = await runCommand([choco, "install", "psmux", "-y", "--no-progress"], { inherit });
      record(result);
      if (result.success) {
        await refreshWindowsMuxPath();
        if (hasRequiredMuxBinary()) return;
      }
    }

    const cargo = resolveCommandFromCurrentPath("cargo");
    if (cargo) {
      const result = await runCommand([cargo, "install", "psmux"], { inherit });
      record(result);
      if (result.success) {
        const home = getHomeDir();
        if (home) prependPath(join(home, ".cargo", "bin"));
        await refreshWindowsMuxPath();
        if (hasRequiredMuxBinary()) return;
      }
    }
    throw new Error(
      capturedDetails || "Could not install psmux — no supported Windows package manager succeeded.",
    );
  }

  // Unix / macOS
  if (process.platform === "darwin") {
    const brew = resolveCommandFromCurrentPath("brew");
    if (brew) {
      const result = await runCommand([brew, "install", "tmux"], { inherit });
      record(result);
      if (result.success && resolveCommandFromCurrentPath("tmux")) return;
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
    if (resolveCommandFromCurrentPath("tmux")) return;
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
