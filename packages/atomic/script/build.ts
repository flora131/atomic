import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../src/lib/workspace-paths.ts";
import { TARGETS, hostTarget, type BuildTarget } from "./targets.ts";
import { bundleEmbeddedAssets, emitRuntimeScriptBundles } from "./build-assets.ts";

const WORKSPACE_ROOT = findRepoRoot(import.meta.dir);
const CLI_PKG_ROOT = join(WORKSPACE_ROOT, "packages", "atomic");

function selectTargets(arg: string | undefined): readonly BuildTarget[] {
  if (arg === "--all") return TARGETS;
  const name = arg ?? hostTarget();
  return TARGETS.filter((t) => t.name === name);
}

await bundleEmbeddedAssets(WORKSPACE_ROOT);
await emitRuntimeScriptBundles(WORKSPACE_ROOT);

const arg = process.argv[2];
const requested = selectTargets(arg);

if (requested.length === 0) {
  console.error(
    `build: unknown target "${arg}". Use --all or one of: ${TARGETS.map((t) => t.name).join(", ")}`,
  );
  process.exit(1);
}

const version = (await Bun.file(join(WORKSPACE_ROOT, "package.json")).json()).version;

for (const t of requested) {
  const outdir = join(CLI_PKG_ROOT, "dist", t.name);
  await mkdir(join(outdir, "bin"), { recursive: true });

  const r = spawnSync("bun", [
    "build", "--compile", "--minify",
    "--target", t.bunTarget,
    "--outfile", join(outdir, "bin", `atomic${t.ext ?? ""}`),
    join(CLI_PKG_ROOT, "src", "cli.ts"),
  ], { stdio: "inherit", cwd: WORKSPACE_ROOT });
  if (r.status !== 0) process.exit(r.status ?? 1);

  await writeFile(join(outdir, "package.json"), JSON.stringify({
    name: `@bastani/atomic-${t.name}`,
    version,
    os: [t.os],
    cpu: [t.cpu],
    files: ["bin"],
    license: "MIT",
  }, null, 2) + "\n");
}
