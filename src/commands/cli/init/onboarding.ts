import { join } from "node:path";
import { AGENT_CONFIG, type AgentKey } from "../../../services/config/index.ts";
import { pathExists } from "../../../services/system/copy.ts";
import { syncJsonFile } from "../../../lib/merge.ts";

export async function applyManagedOnboardingFiles(
  agentKey: AgentKey,
  projectRoot: string,
  configRoot: string,
): Promise<void> {
  const onboardingFiles = AGENT_CONFIG[agentKey].onboarding_files;

  for (const managedFile of onboardingFiles) {
    const sourcePath = join(configRoot, managedFile.source);
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const destinationPath = join(projectRoot, managedFile.destination);
    await syncJsonFile(sourcePath, destinationPath, managedFile.merge);
  }
}

export async function hasProjectOnboardingFiles(
  agentKey: AgentKey,
  projectRoot: string,
): Promise<boolean> {
  const onboardingFiles = AGENT_CONFIG[agentKey].onboarding_files;
  if (onboardingFiles.length === 0) {
    return true;
  }

  const checks = await Promise.all(
    onboardingFiles.map((managedFile) =>
      pathExists(join(projectRoot, managedFile.destination))
    ),
  );
  return checks.every(Boolean);
}
