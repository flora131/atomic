#!/usr/bin/env bun
/*
 * Issue #1222 package acceptance test: prove that the temporary bundled pi-tui
 * fallback is self-contained in the packed @bastani/atomic tarball. The test
 * packs the package, inspects the .tgz for the patched pi-tui package and its
 * runtime dependency closure, installs the tarball into an external Bun
 * consumer, and imports @bastani/atomic without access to the monorepo's
 * hoisted node_modules.
 *
 * Usage:
 *   bun run scripts/verify-bundled-pi-tui-install.ts
 *   SKIP_BUILD=1 bun run scripts/verify-bundled-pi-tui-install.ts
 *   KEEP_FIXTURE=1 bun run scripts/verify-bundled-pi-tui-install.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
	bundledPackageJsonTarPath,
	bundledPackageTarPath,
	bundledPiTuiExpectedRuntimePackages,
	bundledPiTuiPatchedRendererMarker,
	bundledPiTuiRootPackageName,
} from "./bundled-pi-tui-config.js";

const codingAgentRoot = resolve(import.meta.dir, "..");
const distIndexPath = join(codingAgentRoot, "dist", "index.js");
const skipBuild = process.env["SKIP_BUILD"] === "1";
const keepFixture = process.env["KEEP_FIXTURE"] === "1";

const REQUIRED_PACKAGE_JSON_PATHS = bundledPiTuiExpectedRuntimePackages.map((packageName) =>
	bundledPackageJsonTarPath(packageName),
);
const PATCHED_TUI_PATH = bundledPackageTarPath(bundledPiTuiRootPackageName, "dist/tui.js");

interface CommandResult {
	readonly status: number;
	readonly output: string;
}

interface TarEntry {
	readonly name: string;
	readonly body: Buffer;
}

function run(command: string, args: readonly string[], cwd: string): CommandResult {
	const result = spawnSync(command, [...args], { cwd, encoding: "utf8", env: process.env });
	return {
		status: result.status ?? 1,
		output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
	};
}

function fail(message: string): never {
	console.error(`\n❌ ${message}`);
	process.exit(1);
}

function readNullTerminated(buffer: Buffer, start: number, length: number): string {
	const slice = buffer.subarray(start, start + length);
	const nullIndex = slice.indexOf(0);
	const end = nullIndex >= 0 ? nullIndex : slice.length;
	return slice.subarray(0, end).toString("utf8");
}

function readOctal(buffer: Buffer, start: number, length: number): number {
	const raw = readNullTerminated(buffer, start, length).trim();
	return raw.length === 0 ? 0 : Number.parseInt(raw, 8);
}

function stripTrailingNulls(value: string): string {
	return value.replace(/\0.*$/u, "");
}

function parseTarGz(tarballPath: string): TarEntry[] {
	const tar = gunzipSync(readFileSync(tarballPath));
	const entries: TarEntry[] = [];
	let offset = 0;
	let pendingLongName: string | undefined;

	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;

		const name = readNullTerminated(header, 0, 100);
		const size = readOctal(header, 124, 12);
		const typeflag = readNullTerminated(header, 156, 1);
		const prefix = readNullTerminated(header, 345, 155);
		const bodyStart = offset + 512;
		const bodyEnd = bodyStart + size;
		const body = Buffer.from(tar.subarray(bodyStart, bodyEnd));
		offset = bodyStart + Math.ceil(size / 512) * 512;

		if (typeflag === "L") {
			pendingLongName = stripTrailingNulls(body.toString("utf8"));
			continue;
		}

		const tarName = pendingLongName ?? (prefix.length > 0 ? `${prefix}/${name}` : name);
		pendingLongName = undefined;
		entries.push({ name: tarName, body });
	}

	return entries;
}

function requireTarEntry(entries: readonly TarEntry[], path: string): TarEntry {
	const entry = entries.find((candidate) => candidate.name === path);
	if (!entry) fail(`Packed tarball is missing required entry: ${path}`);
	return entry;
}

function requirePatchedRendererMarker(source: string, label: string): void {
	if (!source.includes(bundledPiTuiPatchedRendererMarker)) {
		fail(`${label} does not contain the temporary #1222 patched renderer marker.`);
	}
}

function verifyTarballContents(tarballPath: string): void {
	const entries = parseTarGz(tarballPath);
	for (const packageJsonPath of REQUIRED_PACKAGE_JSON_PATHS) {
		requireTarEntry(entries, packageJsonPath);
	}

	const tuiEntry = requireTarEntry(entries, PATCHED_TUI_PATH);
	requirePatchedRendererMarker(tuiEntry.body.toString("utf8"), `Packed ${PATCHED_TUI_PATH}`);

	console.log("• Tarball contains patched pi-tui plus bundled runtime deps.");
}

function installedPackagePath(atomicRoot: string, tarEntryPath: string): string {
	return join(atomicRoot, ...tarEntryPath.replace(/^package\//u, "").split("/"));
}

function verifyInstalledBundledFiles(consumerDir: string): void {
	const atomicRoot = join(consumerDir, "node_modules", "@bastani", "atomic");
	for (const packageJsonPath of REQUIRED_PACKAGE_JSON_PATHS) {
		const installedPath = installedPackagePath(atomicRoot, packageJsonPath);
		if (!existsSync(installedPath)) {
			fail(`Installed consumer is missing bundled dependency entry: ${installedPath}`);
		}
	}

	const installedTuiPath = installedPackagePath(atomicRoot, PATCHED_TUI_PATH);
	requirePatchedRendererMarker(readFileSync(installedTuiPath, "utf8"), `Installed consumer ${installedTuiPath}`);
}

const packageVersion = (JSON.parse(readFileSync(join(codingAgentRoot, "package.json"), "utf8")) as { version?: string }).version;
console.log(`Verifying bundled pi-tui fallback for @bastani/atomic@${packageVersion ?? "?"}\n`);

const workRoot = mkdtempSync(join(tmpdir(), "atomic-bundled-pi-tui-"));
console.log(`• Fixture root: ${workRoot}`);

try {
	if (!skipBuild) {
		console.log("• Building @bastani/atomic (set SKIP_BUILD=1 to reuse current dist)...");
		const build = run("bun", ["run", "build"], codingAgentRoot);
		if (build.status !== 0) {
			console.error(build.output);
			fail("Build failed.");
		}
	} else {
		console.log("• SKIP_BUILD=1 — reusing current dist.");
	}

	if (!existsSync(distIndexPath)) {
		fail(`Missing ${distIndexPath}; run bun run --cwd packages/coding-agent build first or omit SKIP_BUILD=1.`);
	}

	// `bun pm pack` is what materializes the bundled pi-tui closure: it fires the package's
	// `prepack` (materialize) and `postpack` (--clean) lifecycle hooks, so we deliberately do not
	// run the non-clean materialize ourselves here — only the explicit `--clean` below as a belt-and-
	// suspenders cleanup. A Bun version that changes pack lifecycle behavior would break both this
	// verifier and `npm publish` (which relies on the same prepack/postpack hooks).
	console.log("• Packing @bastani/atomic with bun pm pack...");
	const pack = run("bun", ["pm", "pack", "--destination", workRoot], codingAgentRoot);
	const explicitCleanup = run("bun", ["run", "scripts/materialize-bundled-pi-tui.ts", "--clean"], codingAgentRoot);
	if (explicitCleanup.status !== 0) {
		console.error(explicitCleanup.output);
		fail("Bundled pi-tui cleanup failed after pack attempt.");
	}
	if (pack.status !== 0) {
		console.error(pack.output);
		fail("bun pm pack failed.");
	}

	const tarball = readdirSync(workRoot).find((fileName) => fileName.endsWith(".tgz"));
	if (!tarball) fail("No .tgz produced by bun pm pack.");
	const tarballPath = join(workRoot, tarball);
	console.log(`• Tarball: ${tarballPath}`);
	verifyTarballContents(tarballPath);

	const consumerDir = join(workRoot, "consumer");
	rmSync(consumerDir, { recursive: true, force: true });
	mkdirSync(consumerDir, { recursive: true });
	writeFileSync(
		join(consumerDir, "package.json"),
		JSON.stringify(
			{
				name: "atomic-bundled-pi-tui-consumer",
				private: true,
				type: "module",
				dependencies: { "@bastani/atomic": `file:${tarballPath}` },
			},
			null,
			2,
		),
		"utf8",
	);

	console.log("• Installing tarball into isolated Bun consumer...");
	const install = run("bun", ["install", "--no-progress"], consumerDir);
	if (install.status !== 0) {
		console.error(install.output);
		fail("Isolated consumer bun install failed.");
	}
	verifyInstalledBundledFiles(consumerDir);

	console.log("• Importing @bastani/atomic from isolated consumer...");
	const importCheck = run("bun", ["-e", "await import('@bastani/atomic'); console.log('import ok')"], consumerDir);
	if (importCheck.status !== 0) {
		console.error(importCheck.output);
		fail("Isolated consumer import failed.");
	}
	console.log(importCheck.output.trim());
	console.log("\n✓ Bundled pi-tui fallback tarball installed and imported successfully.");
} finally {
	if (!keepFixture) {
		rmSync(workRoot, { recursive: true, force: true });
	} else {
		console.log(`• KEEP_FIXTURE=1 — left fixtures at ${workRoot}`);
	}
}
