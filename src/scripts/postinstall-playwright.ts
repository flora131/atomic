import { runCommand } from "@/lib/spawn.ts";

const PLAYWRIGHT_CLI_PACKAGE = "@playwright/cli@latest";

export async function installPlaywrightCli(): Promise<void> {
  if (Bun.which("playwright-cli")) {
    return;
  }

  const npmPath = Bun.which("npm");
  if (npmPath) {
    const npmInstall = await runCommand([npmPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE], { inherit: true });
    if (npmInstall.success) {
      return;
    }
    throw new Error(`Failed to install ${PLAYWRIGHT_CLI_PACKAGE}: npm: ${npmInstall.details || "install failed"}`);
  }

  throw new Error("npm is not available to install @playwright/cli.");
}
