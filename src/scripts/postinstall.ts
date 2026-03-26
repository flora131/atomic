#!/usr/bin/env bun

import { resolve } from "path";
import {
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "@/services/config/atomic-global-config.ts";
import { getConfigRoot } from "@/services/config/config-path.ts";
import { deployPlaywrightSkill } from "@/scripts/postinstall-playwright.ts";
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

  // All steps are independent — run them in parallel
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
  ]);

  // Report warnings for any failures (non-fatal)
  const labels = [
    "failed to sync/verify provider home-root configs",
    "failed to deploy Playwright SKILL.md",
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
