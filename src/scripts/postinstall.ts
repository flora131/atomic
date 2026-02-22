#!/usr/bin/env bun

import {
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "../utils/atomic-global-config";
import { getConfigRoot } from "../utils/config-path";

async function verifyAtomicGlobalConfigSync(): Promise<void> {
  if (!(await hasAtomicGlobalAgentConfigs())) {
    throw new Error("Missing synced global config entries in ~/.atomic");
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
