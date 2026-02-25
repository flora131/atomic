#!/usr/bin/env bun

import {
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "../utils/atomic-global-config";
import { getConfigRoot } from "../utils/config-path";
import { deployPlaywrightSkill, installPlaywrightCli } from "./postinstall-playwright";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnPostinstallStep(step: string, error: unknown): void {
  console.warn(`[atomic] Warning: ${step}: ${formatErrorMessage(error)}`);
}

async function verifyAtomicGlobalConfigSync(): Promise<void> {
  if (!(await hasAtomicGlobalAgentConfigs())) {
    throw new Error("Missing synced global config entries in ~/.atomic");
  }
}

async function main(): Promise<void> {
  const configRoot = getConfigRoot();

  try {
    await syncAtomicGlobalAgentConfigs(configRoot);
  } catch (error) {
    warnPostinstallStep("failed to sync ~/.atomic global configs", error);
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

  try {
    await verifyAtomicGlobalConfigSync();
  } catch (error) {
    warnPostinstallStep("failed to verify ~/.atomic global config sync", error);
  }
}

await main();
