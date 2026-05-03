import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../version.ts";   // inlined by `bun build --compile`
import type { EmbeddedAssetKind } from "@bastani/atomic-sdk/services/config/definitions";
import { isCompiledBinaryRuntime } from "@bastani/atomic-sdk/lib/runtime-env";

import claudeAssetsBundle   from "../../../../.claude.tar"          with { type: "file" };
import opencodeAssetsBundle from "../../../../.opencode.tar"        with { type: "file" };
import githubAssetsBundle   from "../../../../.github.tar"          with { type: "file" };
import skillsBundle         from "../../../../.agents/skills.tar"   with { type: "file" };

export const BUNDLES: Record<EmbeddedAssetKind, string> = {
  claude:   claudeAssetsBundle,
  opencode: opencodeAssetsBundle,
  github:   githubAssetsBundle,
  skills:   skillsBundle,
};

function cacheRoot(): string {
  switch (platform()) {
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "atomic", "Cache");
    case "darwin":
      return join(homedir(), "Library", "Caches", "atomic");
    default:
      return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "atomic");
  }
}

export async function getEmbeddedAsset(kind: EmbeddedAssetKind): Promise<string> {
  const tarPath = BUNDLES[kind];
  if (!tarPath) {
    throw new Error(
      `embedded-assets: bundle '${kind}' missing. Run 'bun packages/atomic/script/build-assets.ts' or rely on the test preload hook.`,
    );
  }

  const finalDir = join(cacheRoot(), VERSION, kind);
  if (existsSync(join(finalDir, ".extracted"))) return finalDir;

  const stagingDir = join(cacheRoot(), VERSION, `.${kind}.staging.${process.pid}.${Date.now()}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  // In a compiled binary the asset paths live under Bun's virtual FS
  // (/$bunfs/...) which is accessible to Bun APIs but NOT to OS subprocesses
  // like `tar`. Materialise the tar to a real temp file first so the OS can
  // read it; clean up afterwards.
  const inBunfs = isCompiledBinaryRuntime(tarPath);
  const tarPathForOs = inBunfs
    ? join(tmpdir(), `.atomic-${kind}-${process.pid}-${Date.now()}.tar`)
    : tarPath;
  if (inBunfs) {
    await Bun.write(tarPathForOs, await Bun.file(tarPath).bytes());
  }

  const proc = Bun.spawn(["tar", "-xf", tarPathForOs, "-C", stagingDir], { stderr: "pipe" });
  const exitCode = await proc.exited;
  if (inBunfs) await rm(tarPathForOs, { force: true });
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    await rm(stagingDir, { recursive: true, force: true });
    throw new Error(`getEmbeddedAsset: tar failed for ${kind} (exit ${exitCode}): ${stderr}`);
  }
  await writeFile(join(stagingDir, ".extracted"), VERSION);

  await rm(finalDir, { recursive: true, force: true });
  await rename(stagingDir, finalDir);
  return finalDir;
}
