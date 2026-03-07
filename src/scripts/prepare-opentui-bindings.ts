#!/usr/bin/env bun

import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_PLATFORMS = [
  "darwin-x64",
  "darwin-arm64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
] as const;

type PackageJson = {
  dependencies?: Record<string, string>;
};

type RegistryMetadata = {
  dist?: {
    tarball?: string;
  };
};

function getOpenTuiVersion(packageJson: PackageJson): string {
  const requestedVersion = packageJson.dependencies?.["@opentui/core"];
  if (!requestedVersion) {
    throw new Error("package.json is missing the @opentui/core dependency");
  }

  return requestedVersion.replace(/^[~^]/, "");
}

async function hasExtractedBinding(destinationDir: string): Promise<boolean> {
  try {
    const bindingEntry = join(destinationDir, "index.ts");
    await stat(bindingEntry);
    return true;
  } catch {
    return false;
  }
}

async function fetchRegistryMetadata(packageName: string, version: string): Promise<RegistryMetadata> {
  const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${version}`;
  const response = await fetch(metadataUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${packageName}@${version} metadata (${response.status})`);
  }

  return (await response.json()) as RegistryMetadata;
}

async function downloadTarball(tarballUrl: string, tarballPath: string): Promise<void> {
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${tarballUrl} (${response.status})`);
  }

  const tarballBuffer = Buffer.from(await response.arrayBuffer());
  await Bun.write(tarballPath, tarballBuffer);
}

async function extractTarball(tarballPath: string, destinationDir: string): Promise<void> {
  const extract = Bun.spawn(
    ["tar", "-xzf", tarballPath, "-C", destinationDir, "--strip-components=1"],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await extract.exited;
  if (exitCode !== 0) {
    throw new Error(`tar extraction failed for ${tarballPath} (exit ${exitCode})`);
  }
}

async function ensurePlatformBinding(projectRoot: string, version: string, platform: string): Promise<void> {
  const packageName = `@opentui/core-${platform}`;
  const destinationDir = resolve(projectRoot, "node_modules", "@opentui", `core-${platform}`);

  if (await hasExtractedBinding(destinationDir)) {
    console.log(`[prepare-opentui-bindings] already present: ${packageName}`);
    return;
  }

  await mkdir(destinationDir, { recursive: true });

  const tempRoot = await mkdtemp(join(tmpdir(), "atomic-opentui-binding-"));
  const tarballPath = join(tempRoot, `opentui-core-${platform}-${version}.tgz`);

  try {
    console.log(`[prepare-opentui-bindings] fetching ${packageName}@${version}`);
    const metadata = await fetchRegistryMetadata(packageName, version);
    const tarballUrl = metadata.dist?.tarball;
    if (!tarballUrl) {
      throw new Error(`Registry metadata for ${packageName}@${version} did not include a dist.tarball`);
    }

    await downloadTarball(tarballUrl, tarballPath);
    await extractTarball(tarballPath, destinationDir);

    if (!(await hasExtractedBinding(destinationDir))) {
      throw new Error(`Extracted ${packageName}@${version}, but ${destinationDir}/index.ts is missing`);
    }

    console.log(`[prepare-opentui-bindings] installed ${packageName}@${version}`);
  } catch (error) {
    await rm(destinationDir, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const packageJsonPath = resolve(projectRoot, "package.json");
  const packageJson = (await Bun.file(packageJsonPath).json()) as PackageJson;
  const version = getOpenTuiVersion(packageJson);

  console.log(`[prepare-opentui-bindings] ensuring foreign OpenTUI bindings for ${version}`);

  for (const platform of DEFAULT_PLATFORMS) {
    await ensurePlatformBinding(projectRoot, version, platform);
  }
}

await main();
