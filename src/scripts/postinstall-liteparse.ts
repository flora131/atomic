import { runCommand } from "@/lib/spawn.ts";

const LITEPARSE_PACKAGE = "@llamaindex/liteparse@latest";

export async function installLiteparseCli(): Promise<void> {
  const npmPath = Bun.which("npm");
  if (npmPath) {
    const npmInstall = await runCommand([npmPath, "install", "-g", LITEPARSE_PACKAGE], { inherit: true });
    if (npmInstall.success) {
      return;
    }
    throw new Error(`Failed to install ${LITEPARSE_PACKAGE}: npm: ${npmInstall.details || "install failed"}`);
  }

  throw new Error("npm is not available to install @llamaindex/liteparse.");
}
