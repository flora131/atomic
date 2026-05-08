import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { TelemetrySink } from "../../runtime/executor.ts";

export type { TelemetrySink } from "../../runtime/executor.ts";

/**
 * Returns a TelemetrySink that appends JSON-lines to
 * ~/.atomic/sessions/<runId>/telemetry.jsonl with mode 0o600 (RFC §5.11).
 *
 * @param runId  - Unique workflow run identifier; becomes the directory name.
 * @param baseDir - Override the base directory (default: ~/.atomic/sessions).
 *                  Pass a tmpdir in tests to avoid touching the real home dir.
 */
export function getProductionTelemetrySink(
  runId: string,
  baseDir: string = join(homedir(), ".atomic", "sessions"),
): TelemetrySink {
  const path = join(baseDir, runId, "telemetry.jsonl");

  let dirReady: Promise<void> | null = null;
  const ensureDir = (): Promise<void> => {
    dirReady ??= fs.mkdir(dirname(path), { recursive: true }).then(() => undefined);
    return dirReady;
  };

  return {
    emit(event: string, payload: Record<string, unknown>): void {
      const line = JSON.stringify({ ts: Date.now(), event, payload }) + "\n";
      ensureDir()
        .then(() => fs.appendFile(path, line, { mode: 0o600, encoding: "utf8" }))
        .catch((err: unknown) => {
          console.warn(`[telemetry] append to ${path} failed: ${String(err)}`);
        });
    },
  };
}
