import { runCommand, resolveBunExecutable } from "@/lib/spawn.ts";

const LITEPARSE_PACKAGE = "@llamaindex/liteparse@latest";

export async function installLiteparseCli(): Promise<void> {
  const failures: string[] = [];

  const bunPath = resolveBunExecutable();
  if (bunPath) {
    const bunInstall = await runCommand([bunPath, "install", "-g", LITEPARSE_PACKAGE], { inherit: true });
    if (bunInstall.success) {
      return;
    }
    failures.push(`bun: ${bunInstall.details || "install failed"}`);
  }

  const npmPath = Bun.which("npm");
  if (npmPath) {
    const npmInstall = await runCommand([npmPath, "install", "-g", LITEPARSE_PACKAGE], { inherit: true });
    if (npmInstall.success) {
      return;
    }
    failures.push(`npm: ${npmInstall.details || "install failed"}`);
  }

  if (failures.length === 0) {
    throw new Error("Neither bun nor npm is available to install @llamaindex/liteparse.");
  }

  throw new Error(`Failed to install ${LITEPARSE_PACKAGE}: ${failures.join(" | ")}`);
}
