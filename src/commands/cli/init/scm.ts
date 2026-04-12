import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { copyFile, pathExists, ensureDir } from "@/services/system/copy.ts";
import { getOppositeScriptExtension } from "@/services/system/detect.ts";
import {
  SCM_SKILLS_BY_TYPE,
  type AgentKey,
  type SourceControlType,
} from "@/services/config/index.ts";

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

  await ensureDir(dest);

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

  await ensureDir(targetSkillsDir);

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

/** Skills-CLI agent identifiers (match `npx skills -a <value>`). */
const SKILLS_AGENT_BY_KEY: Record<AgentKey, string> = {
  claude: "claude-code",
  opencode: "opencode",
  copilot: "github-copilot",
};

const SKILLS_REPO = "https://github.com/flora131/atomic.git";

export interface InstallLocalScmSkillsOptions {
  scmType: SourceControlType;
  agentKey: AgentKey;
  /** The directory to run `npx skills add` in (the project root). */
  cwd: string;
}

export interface InstallLocalScmSkillsResult {
  success: boolean;
  /** The explicit skill names that were requested (e.g. `["gh-commit", "gh-create-pr"]`). */
  skills: readonly string[];
  /** Non-empty when `success` is false. */
  details: string;
}

/**
 * Install the SCM skill variants (e.g. `gh-commit`, `gh-create-pr` for
 * GitHub) locally into the current project via `npx skills add`. The `-g`
 * flag is intentionally omitted so the skills are installed per-project
 * (in the given `cwd`).
 *
 * Each skill is passed explicitly with `--skill <name>` — the skills CLI
 * does not support glob patterns like `gh-*`, which would either fail or
 * fall back to installing the entire skill set.
 *
 * This is best-effort: callers should treat a failed result as a warning,
 * not as a fatal error.
 */
export async function installLocalScmSkills(
  options: InstallLocalScmSkillsOptions,
): Promise<InstallLocalScmSkillsResult> {
  const { scmType, agentKey, cwd } = options;

  const skills = SCM_SKILLS_BY_TYPE[scmType];

  const npxPath = Bun.which("npx");
  if (!npxPath) {
    return { success: false, skills, details: "npx not found on PATH" };
  }

  const agentFlag = SKILLS_AGENT_BY_KEY[agentKey];
  const skillFlags = skills.flatMap((skill) => ["--skill", skill]);

  try {
    const proc = Bun.spawn({
      cmd: [
        npxPath,
        "--yes",
        "skills",
        "add",
        SKILLS_REPO,
        ...skillFlags,
        "-a",
        agentFlag,
        "-y",
      ],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [stderr, stdout, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode === 0) {
      return { success: true, skills, details: "" };
    }
    const details = stderr.trim().length > 0 ? stderr.trim() : stdout.trim();
    return {
      success: false,
      skills,
      details: details || `exit code ${exitCode}`,
    };
  } catch (error) {
    return {
      success: false,
      skills,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
