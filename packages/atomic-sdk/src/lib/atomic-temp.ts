import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ATOMIC_TEMP_ENV_KEYS = ["TMPDIR", "TMP", "TEMP"] as const;

export function atomicTempDir(homeDir: string = homedir()): string {
  return join(homeDir, ".atomic", "tmp");
}

export function ensureAtomicTempDir(dir: string = atomicTempDir()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    chmodSync(dir, 0o700);
  }
  return dir;
}

export function atomicTempEnv(dir: string = ensureAtomicTempDir()): Record<string, string> {
  return Object.fromEntries(ATOMIC_TEMP_ENV_KEYS.map((key) => [key, dir]));
}

export function atomicTempPath(
  prefix: string,
  extension: string,
  id: string = randomUUID(),
  dir: string = ensureAtomicTempDir(),
): string {
  return join(dir, `${prefix}-${id}${extension}`);
}

export function atomicContentTempPath(
  prefix: string,
  extension: string,
  content: string,
  dir: string = ensureAtomicTempDir(),
): string {
  const id = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return atomicTempPath(prefix, extension, id, dir);
}

export async function withAtomicTempEnv<T>(
  fn: () => Promise<T>,
  dir: string = ensureAtomicTempDir(),
): Promise<T> {
  const previous = Object.fromEntries(
    ATOMIC_TEMP_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ATOMIC_TEMP_ENV_KEYS) {
    process.env[key] = dir;
  }
  try {
    return await fn();
  } finally {
    for (const key of ATOMIC_TEMP_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
