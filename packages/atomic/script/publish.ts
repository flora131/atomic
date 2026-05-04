import { existsSync } from "node:fs";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "../src/lib/workspace-paths.ts";
import { TARGETS } from "./targets.ts";

const WORKSPACE_ROOT = findRepoRoot(import.meta.dir);
const CLI_PKG_ROOT = join(WORKSPACE_ROOT, "packages", "atomic");

export async function synthesizeWrapper(outDir: string, opts: { version: string }): Promise<void> {
  const { version } = opts;
  await mkdir(join(outDir, "bin"), { recursive: true });
  await copyFile(join(CLI_PKG_ROOT, "bin", "atomic"),             join(outDir, "bin", "atomic"));
  await copyFile(join(CLI_PKG_ROOT, "script", "postinstall.mjs"), join(outDir, "postinstall.mjs"));
  await copyFile(join(WORKSPACE_ROOT, "LICENSE"),                  join(outDir, "LICENSE"));
  await writeFile(join(outDir, "package.json"), JSON.stringify({
    name: "@bastani/atomic",
    version,
    description: "Configuration management CLI for coding agents",
    bin: { atomic: "./bin/atomic" },
    files: ["bin", "postinstall.mjs", "LICENSE"],
    scripts: { postinstall: "node ./postinstall.mjs" },
    optionalDependencies: Object.fromEntries(
      TARGETS.map((t) => [`@bastani/atomic-${t.name}`, version]),
    ),
    engines: { node: ">=20" },
    license: "MIT",
  }, null, 2) + "\n");
}

if (import.meta.main) {
  const version = (await Bun.file(join(WORKSPACE_ROOT, "package.json")).json()).version;
  const tag = process.env.NPM_TAG ?? (version.includes("-") ? "next" : "latest");

  // `NPM_REGISTRY` is set by the validate workflow to point at a throwaway
  // verdaccio. In that mode we skip --provenance (OIDC-only), pass the
  // override registry, and tolerate missing per-platform dist dirs (the
  // PR-time validate job only builds the host target).
  const registry = process.env.NPM_REGISTRY;
  const extraArgs: string[] = [];
  if (registry) extraArgs.push(`--registry=${registry}`);
  if (process.env.GITHUB_ACTIONS === "true" && !registry) extraArgs.push("--provenance");

  // 1. Synthesize wrapper.
  const wrapperOut = join(CLI_PKG_ROOT, "dist", "wrapper");
  await synthesizeWrapper(wrapperOut, { version });

  // 2. Publish per-platform packages, then the wrapper. We tolerate
  //    "version already published" (E409 / EPUBLISHCONFLICT) so a flake
  //    mid-loop is recoverable on rerun without a version bump — npm
  //    rejects same-version republishes as a hard error otherwise. Real
  //    failures (auth, network, validation) surface as a final aggregated
  //    throw after the loop completes.
  const failures: { pkg: string; reason: string }[] = [];
  const targets = [
    ...TARGETS.map((t) => ({
      label: t.name,
      cwd: join(CLI_PKG_ROOT, "dist", t.name),
      requireDist: true,
    })),
    { label: "wrapper", cwd: wrapperOut, requireDist: false },
  ];

  for (const target of targets) {
    if (target.requireDist && !existsSync(target.cwd)) {
      if (registry) {
        console.log(`[publish] skipping ${target.label} — dist dir missing (validate mode)`);
        continue;
      }
      failures.push({ pkg: target.label, reason: `missing dist dir: ${target.cwd}` });
      continue;
    }
    const result = Bun.spawnSync(
      ["npm", "publish", "--access", "public", "--tag", tag, ...extraArgs],
      { cwd: target.cwd, stdout: "inherit", stderr: "pipe" },
    );
    const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : "";
    if (stderr) process.stderr.write(stderr);
    if (result.exitCode === 0) continue;
    if (isAlreadyPublished(stderr)) {
      console.log(`[publish] ${target.label}@${version} already published — skipping`);
      continue;
    }
    failures.push({ pkg: target.label, reason: `npm publish exited ${result.exitCode}` });
  }

  if (failures.length > 0) {
    const summary = failures.map((f) => `  - ${f.pkg}: ${f.reason}`).join("\n");
    throw new Error(`[publish] ${failures.length} package(s) failed:\n${summary}`);
  }
}

function isAlreadyPublished(stderr: string): boolean {
  // npm surfaces same-version republishes as either:
  //   - exit + "EPUBLISHCONFLICT" / "previously published"
  //   - HTTP 409 ("403 Forbidden" on some registries with same body)
  // Match conservatively on the textual signals.
  return /EPUBLISHCONFLICT|previously published|cannot publish over/i.test(stderr);
}
