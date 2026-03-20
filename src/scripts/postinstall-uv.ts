import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

function decodeSpawnOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

function runCommand(cmd: string[]): { success: boolean; details: string } {
  try {
    const result = Bun.spawnSync({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = decodeSpawnOutput(result.stderr);
    const stdout = decodeSpawnOutput(result.stdout);
    return {
      success: result.success,
      details: stderr.length > 0 ? stderr : stdout,
    };
  } catch (error) {
    return {
      success: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function prependPath(directory: string): void {
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const currentPath = process.env.PATH ?? "";
  const entries = currentPath.split(pathDelimiter);
  if (!entries.includes(directory)) {
    process.env.PATH = directory + pathDelimiter + currentPath;
  }
}

export function ensureUv(): void {
  if (Bun.which("uv")) {
    return;
  }

  if (process.platform === "win32") {
    const powerShellPath = Bun.which("powershell") ?? Bun.which("pwsh");
    if (!powerShellPath) {
      throw new Error(
        "Neither powershell nor pwsh is available to install uv.",
      );
    }
    runCommand([
      powerShellPath,
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "irm https://astral.sh/uv/install.ps1 | iex",
    ]);
  } else {
    const shell = Bun.which("bash") ?? Bun.which("sh");
    if (!shell) {
      throw new Error("Neither bash nor sh is available to install uv.");
    }
    runCommand([
      shell,
      "-lc",
      "curl -LsSf https://astral.sh/uv/install.sh | sh",
    ]);
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (homeDir) {
    prependPath(join(homeDir, ".local", "bin"));
  }

  if (!Bun.which("uv")) {
    throw new Error(
      "uv was not found after installation. Install manually from https://docs.astral.sh/uv/",
    );
  }
}

export function installCocoindexCode(): void {
  const uvPath = Bun.which("uv");
  if (!uvPath) {
    throw new Error(
      "uv is not available. Skipping cocoindex-code installation.",
    );
  }

  const result = runCommand([
    uvPath,
    "tool",
    "install",
    "--upgrade",
    "cocoindex-code",
    "--prerelease",
    "explicit",
    "--with",
    "cocoindex>=1.0.0a24",
  ]);

  if (!result.success) {
    throw new Error(`Failed to install cocoindex-code: ${result.details}`);
  }
}

const COCOINDEX_GLOBAL_SETTINGS = `embedding:
  model: lightonai/LateOn-Code-edge
  provider: sentence-transformers
`;

export async function writeCocoindexGlobalSettings(): Promise<void> {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error(
      "Could not determine home directory for cocoindex settings.",
    );
  }

  const settingsDir = join(homeDir, ".cocoindex_code");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(
    join(settingsDir, "global_settings.yml"),
    COCOINDEX_GLOBAL_SETTINGS,
    "utf-8",
  );
}
