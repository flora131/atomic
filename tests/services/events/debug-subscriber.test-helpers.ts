import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const STREAM_DEBUG_ENV_KEYS = ["DEBUG", "LOG_DIR"] as const;

export function useDebugSubscriberTestEnv(): {
  readonly testDir: string;
} {
  let testDir = "";
  let previousEnv: Partial<Record<(typeof STREAM_DEBUG_ENV_KEYS)[number], string | undefined>> =
    {};

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "atomic-debug-test-"));
    previousEnv = {};
    for (const key of STREAM_DEBUG_ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of STREAM_DEBUG_ENV_KEYS) {
      const previousValue = previousEnv[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
    await rm(testDir, { recursive: true, force: true });
  });

  return {
    get testDir() {
      return testDir;
    },
  };
}
