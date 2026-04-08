/**
 * Install bundled workflow templates to the global ~/.atomic/workflows/ directory.
 *
 * Copies workflow files from a source directory (e.g., the extracted config archive)
 * to the user's global workflows directory. Existing workflow directories are
 * preserved to avoid overwriting user customizations. Shared infrastructure
 * files (package.json, tsconfig.json, .gitignore) are always updated to ensure
 * SDK compatibility.
 *
 * Layout: .atomic/workflows/<workflow_name>/<agent>/index.ts
 */

import { join } from "path";
import { readdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { ensureDir, copyFile, copyDir, pathExists } from "@/services/system/copy.ts";
import { AGENTS, WORKFLOWS_GITIGNORE } from "@bastani/atomic-workflows";

const AGENT_DIRS = new Set<string>(AGENTS);

/**
 * Install global workflow templates from a config data directory.
 *
 * @param configDataDir - The extracted config data directory (e.g., ~/.local/share/atomic)
 *                        containing `.atomic/workflows/` as a subdirectory.
 * @returns The number of new workflow agent directories copied (0 if source dir doesn't exist).
 */
export async function installGlobalWorkflows(configDataDir: string): Promise<number> {
  const srcDir = join(configDataDir, ".atomic", "workflows");
  const destDir = join(homedir(), ".atomic", "workflows");

  if (!(await pathExists(srcDir))) {
    return 0;
  }

  await ensureDir(destDir);

  // Always write the canonical .gitignore to the destination
  await writeFile(join(destDir, ".gitignore"), WORKFLOWS_GITIGNORE);

  // Enumerate the source directory and classify each entry:
  //  - Files at the root (package.json, tsconfig.json, etc.) → always overwrite
  //  - Workflow directories (hello, ralph, etc.) → per-agent skip-if-exists
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isFile()) {
      // Root files (package.json, tsconfig.json, etc.) — always overwrite
      await copyFile(srcPath, destPath);
    }
  }

  // Copy per-workflow directories, preserving existing agent implementations
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const workflowSrc = join(srcDir, entry.name);
    const workflowDest = join(destDir, entry.name);
    await ensureDir(workflowDest);

    try {
      const workflowEntries = await readdir(workflowSrc, { withFileTypes: true });
      for (const sub of workflowEntries) {
        const subSrc = join(workflowSrc, sub.name);
        const subDest = join(workflowDest, sub.name);

        if (sub.isFile()) {
          // Files within a workflow dir — always overwrite
          await copyFile(subSrc, subDest);
        } else if (sub.isDirectory() && AGENT_DIRS.has(sub.name)) {
          // Agent directories — skip if already exists (user may have customized)
          if (!(await pathExists(subDest))) {
            await copyDir(subSrc, subDest);
            copied++;
          }
        } else if (sub.isDirectory()) {
          // Non-agent directories (e.g., helpers/) — always update
          await copyDir(subSrc, subDest);
        }
      }
    } catch {
      // Workflow directory unreadable — skip silently
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
