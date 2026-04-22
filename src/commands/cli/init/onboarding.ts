import { join } from "node:path";
import { homedir } from "node:os";
import { AGENT_CONFIG, type AgentKey } from "../../../services/config/index.ts";
import { pathExists } from "../../../services/system/copy.ts";
import { syncJsonFile } from "../../../lib/merge.ts";

/**
 * Resolve an onboarding destination path. A leading `~/` is expanded to
 * the user's home directory so providers can target global config roots
 * (e.g. `~/.claude/settings.json`); anything else resolves against the
 * project root.
 */
function resolveDestination(destination: string, projectRoot: string): string {
  if (destination === "~" || destination.startsWith("~/")) {
    return join(homedir(), destination.slice(1));
  }
  return join(projectRoot, destination);
}

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

    const destinationPath = resolveDestination(
      managedFile.destination,
      projectRoot,
    );
    await syncJsonFile(
      sourcePath,
      destinationPath,
      managedFile.merge,
      managedFile.excludeConfigKeys ?? [],
    );
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
      pathExists(resolveDestination(managedFile.destination, projectRoot))
    ),
  );
  return checks.every(Boolean);
}
