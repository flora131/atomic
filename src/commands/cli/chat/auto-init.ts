import { join } from "path";
import { readdir } from "fs/promises";
import type { AgentType } from "@/services/telemetry/types.ts";
import { AGENT_CONFIG, type SourceControlType } from "@/services/config/index.ts";
import { hasProjectOnboardingFiles } from "@/commands/cli/init.ts";
import { pathExists } from "@/services/system/copy.ts";
import {
  getTemplateAgentFolder,
  isManagedScmSkillName,
} from "@/services/config/atomic-global-config.ts";
import { getConfigRoot } from "@/services/config/config-path.ts";
import { getSelectedScm } from "@/services/config/atomic-config.ts";
import { isTrustedWorkspacePath } from "@/services/config/settings.ts";

const SCM_PREFIX_BY_TYPE: Record<SourceControlType, "gh-" | "sl-"> = {
  github: "gh-",
  sapling: "sl-",
};

function getScmPrefix(scmType: SourceControlType): "gh-" | "sl-" {
  return SCM_PREFIX_BY_TYPE[scmType];
}

async function listManagedScmSkillNames(skillsDir: string): Promise<Set<string>> {
  if (!(await pathExists(skillsDir))) {
    return new Set();
  }

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return new Set(
      entries
        .filter((entry) => entry.isDirectory() && isManagedScmSkillName(entry.name))
        .map((entry) => entry.name)
    );
  } catch {
    return new Set();
  }
}

export async function hasProjectScmSkills(
  agentType: AgentType,
  projectRoot: string
): Promise<boolean> {
  const skillsDir = join(projectRoot, AGENT_CONFIG[agentType].folder, "skills");
  if (!(await pathExists(skillsDir))) return false;

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries.some(
      (entry) => entry.isDirectory() && isManagedScmSkillName(entry.name)
    );
  } catch {
    return false;
  }
}

export async function hasProjectScmSkillsInSync(
  agentType: AgentType,
  scmType: SourceControlType,
  projectRoot: string,
  configRoot: string = getConfigRoot()
): Promise<boolean> {
  const sourceSkillsDir = join(configRoot, getTemplateAgentFolder(agentType), "skills");
  const projectSkillsDir = join(projectRoot, AGENT_CONFIG[agentType].folder, "skills");

  const [sourceManagedSkills, projectManagedSkills] = await Promise.all([
    listManagedScmSkillNames(sourceSkillsDir),
    listManagedScmSkillNames(projectSkillsDir),
  ]);

  const selectedPrefix = getScmPrefix(scmType);
  const expectedManagedSkills = Array.from(sourceManagedSkills).filter((name) =>
    name.startsWith(selectedPrefix)
  );

  if (expectedManagedSkills.length === 0) {
    return false;
  }

  for (const skillName of expectedManagedSkills) {
    if (!projectManagedSkills.has(skillName)) {
      return false;
    }
  }

  return true;
}

interface AutoInitCheckOptions {
  selectedScm?: SourceControlType | null;
  configRoot?: string;
}

export async function shouldAutoInitChat(
  agentType: AgentType,
  projectRoot: string = process.cwd(),
  options: AutoInitCheckOptions = {}
): Promise<boolean> {
  if (!(await isTrustedWorkspacePath(projectRoot, agentType))) {
    return true;
  }

  if (!(await hasProjectOnboardingFiles(agentType, projectRoot))) {
    return true;
  }

  const selectedScm = options.selectedScm ?? (await getSelectedScm(projectRoot));
  if (!selectedScm) {
    return !(await hasProjectScmSkills(agentType, projectRoot));
  }

  const configRoot = options.configRoot ?? getConfigRoot();
  return !(await hasProjectScmSkillsInSync(agentType, selectedScm, projectRoot, configRoot));
}
