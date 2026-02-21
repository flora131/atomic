#!/usr/bin/env bun

import {
  getAtomicManagedConfigDirs,
  syncAtomicGlobalAgentConfigs,
} from "../utils/atomic-global-config";
import { getConfigRoot } from "../utils/config-path";
import { pathExists } from "../utils/copy";

async function verifyAtomicGlobalConfigSync(): Promise<void> {
  const managedDirs = getAtomicManagedConfigDirs();
  const checks = await Promise.all(managedDirs.map((dir) => pathExists(dir)));
  const missingDirs = managedDirs.filter((_, index) => !checks[index]);

  if (missingDirs.length > 0) {
    throw new Error(`Missing synced global config directories: ${missingDirs.join(", ")}`);
  }
}

async function main(): Promise<void> {
  try {
    await syncAtomicGlobalAgentConfigs(getConfigRoot());
    await verifyAtomicGlobalConfigSync();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[atomic] Warning: failed to sync ~/.atomic global configs: ${message}`);
  }
}

await main();
