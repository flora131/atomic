/**
 * Generate flat-named release binaries + a checksum manifest for
 * GitHub Releases consumption by the bootstrap installers
 * (install.ps1 / install.cmd / install.sh).
 *
 * Mirrors Claude Code's distribution layout:
 *
 *   release-assets/
 *     manifest.json                  // { version, platforms.<name>.checksum }
 *     atomic-linux-x64               // copied from dist/linux-x64/bin/atomic
 *     atomic-linux-arm64
 *     atomic-darwin-x64
 *     atomic-darwin-arm64
 *     atomic-windows-x64.exe
 *     atomic-windows-arm64.exe
 *
 * Run after the matrix `bun packages/atomic/script/build.ts <target>`
 * jobs have populated dist/ via download-artifact.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../src/lib/workspace-paths.ts";
import { TARGETS, type BuildTarget } from "./targets.ts";

interface PlatformEntry {
    readonly checksum: string;
}

interface Manifest {
    readonly version: string;
    readonly platforms: Record<string, PlatformEntry>;
}

export interface GenerateReleaseAssetsOptions {
    readonly version: string;
    readonly distRoot: string;
    readonly assetsRoot: string;
    readonly targets: readonly BuildTarget[];
    /** Logger; defaults to console.log. Tests inject a sink. */
    readonly log?: (msg: string) => void;
}

export interface GenerateReleaseAssetsResult {
    readonly manifest: Manifest;
    readonly assets: readonly string[];
}

function sha256(filePath: string): string {
    // Use Bun.CryptoHasher — Bun-native equivalent of node:crypto.createHash,
    // same API shape, avoids the node-compat shim.
    const hash = new Bun.CryptoHasher("sha256");
    hash.update(readFileSync(filePath));
    return hash.digest("hex");
}

export function generateReleaseAssets(
    opts: GenerateReleaseAssetsOptions,
): GenerateReleaseAssetsResult {
    const log = opts.log ?? ((msg: string) => console.log(msg));

    if (!existsSync(opts.assetsRoot)) {
        mkdirSync(opts.assetsRoot, { recursive: true });
    }

    const platforms: Record<string, PlatformEntry> = {};
    const assets: string[] = [];
    const missing: string[] = [];

    for (const target of opts.targets) {
        const sourceBinary = join(opts.distRoot, target.name, "bin", `atomic${target.ext ?? ""}`);
        if (!existsSync(sourceBinary)) {
            missing.push(`${target.name} (expected ${sourceBinary})`);
            continue;
        }
        const assetName = `atomic-${target.name}${target.ext ?? ""}`;
        const dest = join(opts.assetsRoot, assetName);
        copyFileSync(sourceBinary, dest);
        const checksum = sha256(dest);
        platforms[target.name] = { checksum };
        assets.push(assetName);
        log(`  ✓ ${assetName}  ${checksum}`);
    }

    if (missing.length > 0) {
        throw new Error(`release-assets: missing built binaries:\n  - ${missing.join("\n  - ")}`);
    }

    const manifest: Manifest = { version: opts.version, platforms };
    // The manifest's pretty-printed (one-field-per-line) shape is
    // load-bearing for install.cmd's `findstr`-based parser, which
    // can't tokenise JSON. Keep `JSON.stringify(..., null, 2)` and the
    // top-level `version` + `platforms.<name>.checksum` layout — see
    // install.cmd `:parse_manifest`. install.sh / install.ps1 use real
    // JSON parsers and are tolerant.
    writeFileSync(
        join(opts.assetsRoot, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
        "utf8",
    );
    log(`\n  ✓ manifest.json  (version ${opts.version}, ${Object.keys(platforms).length} platforms)`);
    return { manifest, assets };
}

// ── Entry point ────────────────────────────────────────────────────────────

if (import.meta.main) {
    const root = findRepoRoot(import.meta.dir);
    const cliPkgRoot = join(root, "packages", "atomic");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

    try {
        generateReleaseAssets({
            version: pkg.version,
            distRoot: join(cliPkgRoot, "dist"),
            assetsRoot: join(cliPkgRoot, "release-assets"),
            targets: TARGETS,
        });
    } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
    }
}
