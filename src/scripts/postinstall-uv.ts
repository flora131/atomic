import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { runCommand, prependPath, getHomeDir } from "@/lib/spawn.ts";

export async function ensureUv(): Promise<void> {
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
    await runCommand([
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
    await runCommand([
      shell,
      "-lc",
      "curl -LsSf https://astral.sh/uv/install.sh | sh",
    ]);
  }

  const homeDir = getHomeDir();
  if (homeDir) {
    prependPath(join(homeDir, ".local", "bin"));
  }

  if (!Bun.which("uv")) {
    throw new Error(
      "uv was not found after installation. Install manually from https://docs.astral.sh/uv/",
    );
  }
}

export async function installCocoindexCode(): Promise<void> {
  const uvPath = Bun.which("uv");
  if (!uvPath) {
    throw new Error(
      "uv is not available. Skipping cocoindex-code installation.",
    );
  }

  const result = await runCommand([
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
  const homeDir = getHomeDir();
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
