import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  createDefaultConfig,
  readAtomicConfig,
  writeAtomicConfig,
} from "../src/utils/atomic-config";
import {
  createSaplingProvider,
  getProvider,
  type ProviderName,
  type SaplingOptions,
  type AtomicConfig,
} from "../src/providers";

let lastTestDir: string | null = null;

export async function runInitCommand(opts: {
  provider: ProviderName;
  saplingPrWorkflow?: SaplingOptions["prWorkflow"];
}): Promise<void> {
  const testDir = await mkdtemp(join(tmpdir(), "atomic-init-integration-"));
  lastTestDir = testDir;

  // Prerequisite behavior for these integration tests:
  // - If provider prereqs are missing, reject (test expects rejection)
  // - Allow tests to inject commandExists via globalThis.commandExists
  if (opts.provider === "sapling") {
    const injectedCommandExists = (globalThis as any).commandExists;
    const commandExistsFn =
      typeof injectedCommandExists === "function"
        ? (injectedCommandExists as (cmd: string) => Promise<boolean>)
        : undefined;

    const provider = createSaplingProvider(
      { prWorkflow: opts.saplingPrWorkflow ?? "stack" },
      commandExistsFn
    );
    const prereqs = await provider.checkPrerequisites();
    if (!prereqs.satisfied) {
      throw new Error("Sapling CLI prerequisites missing");
    }
  } else {
    const provider = getProvider(opts.provider);
    const prereqs = await provider.checkPrerequisites();
    if (!prereqs.satisfied) {
      throw new Error(`${provider.displayName} prerequisites missing`);
    }
  }

  const config = createDefaultConfig(opts.provider, {
    sapling:
      opts.provider === "sapling"
        ? { prWorkflow: opts.saplingPrWorkflow ?? "stack" }
        : undefined,
  });

  await writeAtomicConfig(config, testDir);
}

export async function readConfigYaml(): Promise<AtomicConfig> {
  if (!lastTestDir) {
    throw new Error("readConfigYaml called before runInitCommand");
  }

  const config = await readAtomicConfig(lastTestDir);
  if (!config) {
    throw new Error("Expected .atomic/config.yaml to exist after init");
  }
  return config;
}

export async function cleanupLastInitTestDir(): Promise<void> {
  if (!lastTestDir) return;
  const dir = lastTestDir;
  lastTestDir = null;
  await rm(dir, { recursive: true, force: true });
}
