/**
 * Install bundled workflow templates to the global ~/.atomic/workflows/ directory.
 *
 * Copies workflow files from a source directory (e.g., the extracted config archive)
 * to the user's global workflows directory. Existing per-agent workflow directories
 * are preserved to avoid overwriting user customizations. Shared infrastructure
 * files (package.json, tsconfig.json, .gitignore) and shared helpers are always
 * updated to ensure SDK compatibility.
 */

import { join } from "path";
import { readdir } from "fs/promises";
import { homedir } from "os";
import { ensureDir, copyFile, copyDir, pathExists } from "@/services/system/copy.ts";

const AGENT_DIRS = new Set(["copilot", "opencode", "claude"]);

/**
 * Install global workflow templates from a config data directory.
 *
 * @param configDataDir - The extracted config data directory (e.g., ~/.local/share/atomic)
 *                        containing `.atomic/workflows/` as a subdirectory.
 * @returns The number of new workflow directories copied (0 if source dir doesn't exist).
 */
export async function installGlobalWorkflows(configDataDir: string): Promise<number> {
  const srcDir = join(configDataDir, ".atomic", "workflows");
  const destDir = join(homedir(), ".atomic", "workflows");

  if (!(await pathExists(srcDir))) {
    return 0;
  }

  await ensureDir(destDir);

  // Enumerate the source directory and classify each entry:
  //  - Files at the root (package.json, tsconfig.json, etc.) → always overwrite
  //  - Agent directories (copilot, opencode, claude) → per-workflow skip-if-exists
  //  - Any other directories (shared helpers, utilities) → always overwrite
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
    if (entry.name === "node_modules") continue;

    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    } else if (entry.isDirectory() && !AGENT_DIRS.has(entry.name)) {
      // Shared directories — always update
      await copyDir(srcPath, destPath);
    }
  }

  // Copy per-agent workflow directories, skipping existing ones
  let copied = 0;
  for (const agent of AGENT_DIRS) {
    const agentSrc = join(srcDir, agent);
    if (!(await pathExists(agentSrc))) continue;

    const agentDest = join(destDir, agent);
    await ensureDir(agentDest);

    try {
      const agentEntries = await readdir(agentSrc, { withFileTypes: true });
      for (const entry of agentEntries) {
        if (!entry.isDirectory()) continue;
        const destWorkflow = join(agentDest, entry.name);
        if (!(await pathExists(destWorkflow))) {
          await copyDir(join(agentSrc, entry.name), destWorkflow);
          copied++;
        }
      }
    } catch {
      // Agent directory unreadable — skip silently
    }
  }

  // Install SDK dependency via bun (or npm fallback)
  try {
    const bunPath = Bun.which("bun");
    if (bunPath) {
      const proc = Bun.spawn([bunPath, "install"], { cwd: destDir, stdio: ["ignore", "ignore", "ignore"] });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        console.warn("Workflow dependency install exited with code", exitCode);
      }
    } else {
      const npmPath = Bun.which("npm");
      if (npmPath) {
        const proc = Bun.spawn([npmPath, "install"], { cwd: destDir, stdio: ["ignore", "ignore", "ignore"] });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          console.warn("Workflow dependency install exited with code", exitCode);
        }
      }
    }
  } catch {
    // Dependency install is best-effort
  }

  return copied;
}
