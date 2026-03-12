import { join } from "path";
import { mkdir, readdir } from "fs/promises";
import { copyFile, pathExists } from "@/services/system/copy.ts";
import { getOppositeScriptExtension } from "@/services/system/detect.ts";
import type { SourceControlType } from "@/services/config/index.ts";

export const SCM_PREFIX_BY_TYPE: Record<SourceControlType, "gh-" | "sl-"> = {
  github: "gh-",
  sapling: "sl-",
};

export function getScmPrefix(scmType: SourceControlType): "gh-" | "sl-" {
  return SCM_PREFIX_BY_TYPE[scmType];
}

export function isManagedScmEntry(name: string): boolean {
  return name.startsWith("gh-") || name.startsWith("sl-");
}

export interface ReconcileScmVariantsOptions {
  scmType: SourceControlType;
  agentFolder: string;
  skillsSubfolder: string;
  targetDir: string;
  configRoot: string;
}

export async function reconcileScmVariants(options: ReconcileScmVariantsOptions): Promise<void> {
  const { agentFolder, skillsSubfolder, targetDir, configRoot } = options;
  const srcDir = join(configRoot, agentFolder, skillsSubfolder);
  const destDir = join(targetDir, agentFolder, skillsSubfolder);

  if (!(await pathExists(srcDir)) || !(await pathExists(destDir))) {
    return;
  }

  const sourceEntries = await readdir(srcDir, { withFileTypes: true });
  const managedEntries = sourceEntries.filter((entry) => isManagedScmEntry(entry.name));

  if (process.env.DEBUG === "1" && managedEntries.length > 0) {
    console.log(
      `[DEBUG] Preserving existing managed SCM variants in ${destDir}: ${managedEntries
        .map((entry) => entry.name)
        .join(", ")}`
    );
  }
}

interface CopyDirPreservingOptions {
  exclude?: string[];
}

async function copyDirPreserving(
  src: string,
  dest: string,
  options: CopyDirPreservingOptions = {}
): Promise<void> {
  const { exclude = [] } = options;

  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });
  const oppositeExt = getOppositeScriptExtension();

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (exclude.includes(entry.name)) continue;
    if (entry.name.endsWith(oppositeExt)) continue;

    if (entry.isDirectory()) {
      await copyDirPreserving(srcPath, destPath, options);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

export interface SyncProjectScmSkillsOptions {
  scmType: SourceControlType;
  sourceSkillsDir: string;
  targetSkillsDir: string;
}

export async function syncProjectScmSkills(options: SyncProjectScmSkillsOptions): Promise<number> {
  const { scmType, sourceSkillsDir, targetSkillsDir } = options;
  const selectedPrefix = getScmPrefix(scmType);

  if (!(await pathExists(sourceSkillsDir))) {
    return 0;
  }

  await mkdir(targetSkillsDir, { recursive: true });

  const entries = await readdir(sourceSkillsDir, { withFileTypes: true });
  let copiedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(selectedPrefix)) continue;

    const srcPath = join(sourceSkillsDir, entry.name);
    const destPath = join(targetSkillsDir, entry.name);
    await copyDirPreserving(srcPath, destPath);
    copiedCount += 1;
  }

  return copiedCount;
}
