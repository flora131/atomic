#!/usr/bin/env bun

import { resolve } from "path";
import {
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "@/services/config/atomic-global-config.ts";
import { getConfigRoot } from "@/services/config/config-path.ts";
import {
  ensurePlaywrightPackageManagers,
  deployPlaywrightSkill,
  installPlaywrightCli,
} from "@/scripts/postinstall-playwright.ts";
import {
  ensureUv,
  installCocoindexCode,
  writeCocoindexGlobalSettings,
} from "@/scripts/postinstall-uv.ts";
import {
  installWorkflowSdkFromLocal,
  getGlobalWorkflowsDir,
  getLocalWorkflowsDir,
  getLocalSdkPackagePath,
  getRelativeSdkPath,
} from "@/services/config/workflow-package.ts";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnPostinstallStep(step: string, error: unknown): void {
  console.warn(`[atomic] Warning: ${step}: ${formatErrorMessage(error)}`);
}

async function syncAndVerifyConfigs(configRoot: string): Promise<void> {
  await syncAtomicGlobalAgentConfigs(configRoot);
  if (!(await hasAtomicGlobalAgentConfigs())) {
    throw new Error("Missing synced global config entries in provider home roots");
  }
}

async function main(): Promise<void> {
  const configRoot = getConfigRoot();

  // Phase 1: ensure package managers are available (needed by later steps)
  const pmResults = await Promise.allSettled([
    ensurePlaywrightPackageManagers(),
    ensureUv(),
  ]);

  const pmLabels = [
    "failed to ensure bun/npm",
    "failed to ensure uv",
  ];

  for (let i = 0; i < pmResults.length; i++) {
    const result = pmResults[i];
    if (result && result.status === "rejected") {
      warnPostinstallStep(pmLabels[i] ?? `pm step ${i}`, result.reason);
    }
  }

  // Phase 2: all remaining steps in parallel
  const results = await Promise.allSettled([
    syncAndVerifyConfigs(configRoot),
    deployPlaywrightSkill(configRoot),
    (async () => {
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
    })(),
    installCocoindexCode(),
    writeCocoindexGlobalSettings(),
    installPlaywrightCli(),
  ]);

  // Report warnings for any failures (non-fatal)
  const labels = [
    "failed to sync/verify provider home-root configs",
    "failed to deploy Playwright SKILL.md",
    "failed to install workflow SDK",
    "failed to install cocoindex-code",
    "failed to write cocoindex global settings",
    "failed to install @playwright/cli",
  ];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === "rejected") {
      warnPostinstallStep(labels[i] ?? `step ${i}`, result.reason);
    }
  }
}

await main();
