import type { RetryConfig } from "@/services/workflows/graph/contracts/core.ts";
import type { GraphConfig } from "@/services/workflows/graph/contracts/runtime.ts";

export const BACKGROUND_COMPACTION_THRESHOLD = 0.45;
export const BUFFER_EXHAUSTION_THRESHOLD = 0.6;

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

export const DEFAULT_GRAPH_CONFIG: Partial<GraphConfig> = {
  maxConcurrency: 1,
  contextWindowThreshold: BACKGROUND_COMPACTION_THRESHOLD * 100,
  autoCheckpoint: true,
};
