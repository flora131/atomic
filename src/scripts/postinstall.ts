#!/usr/bin/env bun

import { resolve } from "path";
import {
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "@/services/config/atomic-global-config.ts";
import { getConfigRoot } from "@/services/config/config-path.ts";
import { installTooling, ToolingSetupError } from "@/services/config/first-run-tooling.ts";
import {
  installWorkflowSdkFromLocal,
  getGlobalWorkflowsDir,
  getLocalWorkflowsDir,
  getLocalSdkPackagePath,
  getRelativeSdkPath,
} from "@/services/config/workflow-package.ts";

function warnPostinstallStep(step: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[atomic] Warning: ${step}: ${message}`);
}

async function syncAndVerifyConfigs(configRoot: string): Promise<void> {
  await syncAtomicGlobalAgentConfigs(configRoot);
  if (!(await hasAtomicGlobalAgentConfigs())) {
    throw new Error("Missing synced global config entries in provider home roots");
  }
}

async function installLocalWorkflowSdk(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "..", "..");
  const localSdkPath = getLocalSdkPackagePath(repoRoot);

  // Global ~/.atomic/workflows/ — use absolute path
  const globalWorkflowsDir = getGlobalWorkflowsDir();
  const globalInstalled = await installWorkflowSdkFromLocal(globalWorkflowsDir, localSdkPath);
  if (!globalInstalled) {
    throw new Error("failed to install workflow SDK from local package into global dir");
  }

  // Local .atomic/workflows/ — use relative path so it stays portable within the repo
  const localWorkflowsDir = getLocalWorkflowsDir(repoRoot);
  const relativeSdkPath = getRelativeSdkPath(localWorkflowsDir, localSdkPath);
  const localInstalled = await installWorkflowSdkFromLocal(localWorkflowsDir, relativeSdkPath);
  if (!localInstalled) {
    throw new Error("failed to install workflow SDK from local package into local dir");
  }
}

async function main(): Promise<void> {
  const configRoot = getConfigRoot();

  // Shared 3-phase tooling install (package managers → CLI tools → trust).
  // In postinstall context, warn on failures instead of aborting — devs can
  // fix manually.
  try {
    await installTooling();
  } catch (error) {
    if (error instanceof ToolingSetupError) {
      for (const failure of error.failures) {
        warnPostinstallStep("tooling setup", new Error(failure));
      }
    } else {
      warnPostinstallStep("tooling setup", error);
    }
  }

  // Source-specific steps: sync configs and install local workflow SDK
  const results = await Promise.allSettled([
    syncAndVerifyConfigs(configRoot),
    installLocalWorkflowSdk(),
  ]);

  const labels = [
    "failed to sync/verify provider home-root configs",
    "failed to install workflow SDK",
  ];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === "rejected") {
      warnPostinstallStep(labels[i] ?? `step ${i}`, result.reason);
    }
  }
}

await main();
