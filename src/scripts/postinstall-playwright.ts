import { runCommand, resolveBunExecutable } from "@/lib/spawn.ts";

const PLAYWRIGHT_CLI_PACKAGE = "@playwright/cli@latest";

export async function installPlaywrightCli(): Promise<void> {
  const failures: string[] = [];

  const bunPath = resolveBunExecutable();
  if (bunPath) {
    const bunInstall = await runCommand([bunPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE]);
    if (bunInstall.success) {
      return;
    }
    failures.push(`bun: ${bunInstall.details || "No output."}`);
  }

  const npmPath = Bun.which("npm");
  if (npmPath) {
    const npmInstall = await runCommand([npmPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE]);
    if (npmInstall.success) {
      return;
    }
    failures.push(`npm: ${npmInstall.details || "No output."}`);
  }

  if (failures.length === 0) {
    throw new Error("Neither bun nor npm is available to install @playwright/cli.");
  }

  throw new Error(`Failed to install ${PLAYWRIGHT_CLI_PACKAGE}: ${failures.join(" | ")}`);
}
