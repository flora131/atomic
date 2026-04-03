import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { runCommand, getHomeDir, resolveUvExecutable } from "@/lib/spawn.ts";

export async function installCocoindexCode(): Promise<void> {
  const uvPath = resolveUvExecutable();
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
