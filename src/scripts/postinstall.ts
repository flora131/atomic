#!/usr/bin/env bun

import { resolve } from "path";
import {
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "@/services/config/atomic-global-config.ts";
import { getConfigRoot } from "@/services/config/config-path.ts";
import {
  deployPlaywrightSkill,
  ensurePlaywrightPackageManagers,
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
} from "@/services/config/workflow-package.ts";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnPostinstallStep(step: string, error: unknown): void {
  console.warn(`[atomic] Warning: ${step}: ${formatErrorMessage(error)}`);
}

async function verifyAtomicGlobalConfigSync(): Promise<void> {
  if (!(await hasAtomicGlobalAgentConfigs())) {
    throw new Error("Missing synced global config entries in provider home roots");
  }
}

async function main(): Promise<void> {
  const configRoot = getConfigRoot();

  try {
    await syncAtomicGlobalAgentConfigs(configRoot);
  } catch (error) {
    warnPostinstallStep("failed to sync provider home-root configs", error);
  }

  try {
    ensurePlaywrightPackageManagers();
  } catch (error) {
    warnPostinstallStep("failed to install missing package managers (bun/npm)", error);
  }

  try {
    ensureUv();
  } catch (error) {
    warnPostinstallStep("failed to install uv", error);
  }

  try {
    installCocoindexCode();
  } catch (error) {
    warnPostinstallStep("failed to install cocoindex-code via uv", error);
  }

  try {
    await writeCocoindexGlobalSettings();
  } catch (error) {
    warnPostinstallStep("failed to write cocoindex global settings", error);
  }

  try {
    await installPlaywrightCli();
  } catch (error) {
    warnPostinstallStep("failed to install @playwright/cli globally", error);
  }

  try {
    await deployPlaywrightSkill(configRoot);
  } catch (error) {
    warnPostinstallStep("failed to deploy Playwright SKILL.md", error);
  }

  // Install workflow SDK from local packages/workflow-sdk into ~/.atomic/workflows/
  try {
    const localSdkPath = resolve(import.meta.dir, "..", "..", "packages", "workflow-sdk");
    const globalWorkflowsDir = getGlobalWorkflowsDir();
    const installed = await installWorkflowSdkFromLocal(globalWorkflowsDir, localSdkPath);
    if (!installed) {
      console.warn("[atomic] Warning: failed to install workflow SDK from local package");
    }
  } catch (error) {
    warnPostinstallStep("failed to install workflow SDK", error);
  }

  try {
    await verifyAtomicGlobalConfigSync();
  } catch (error) {
    warnPostinstallStep("failed to verify provider home-root config sync", error);
  }
}

await main();
