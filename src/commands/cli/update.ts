/**
 * Update command — upgrades atomic to the latest version via bun and
 * reinstalls global skills.
 *
 * Usage:
 *   atomic update
 */

import { COLORS } from "@/theme/colors.ts";
import { VERSION } from "@/version.ts";
import { installGlobalSkills } from "@/services/system/skills.ts";

export async function updateCommand(): Promise<number> {
  const bunPath = Bun.which("bun");
  if (!bunPath) {
    console.error(`${COLORS.red}Error: bun is not installed.${COLORS.reset}`);
    console.error("Install bun: https://bun.sh");
    return 1;
  }

  console.log(`Current version: ${VERSION}`);
  console.log("Updating atomic...\n");

  // Upgrade the package
  const proc = Bun.spawn([bunPath, "add", "-g", "atomic@latest"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`\n${COLORS.red}Failed to update atomic (exit ${exitCode}).${COLORS.reset}`);
    return 1;
  }

  // Reinstall global skills
  console.log("\nUpdating skills...");
  try {
    await installGlobalSkills();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`\n${COLORS.yellow}Warning: failed to install skills: ${message}${COLORS.reset}`);
  }

  console.log(`\n${COLORS.green}Update complete.${COLORS.reset}`);
  return 0;
}
