/**
 * First-run tooling setup.
 *
 * Provides the shared 3-phase install sequence used by both:
 * - postinstall.ts  (source/npm installs, runs at `bun install` time)
 * - cli.ts          (binary installs, runs on first CLI invocation)
 *
 * Phase 1: package managers  (bun, npm, uv)
 * Phase 2: CLI tools         (playwright-cli, liteparse)
 * Phase 3: trust bun globals (@playwright/cli, @llamaindex/liteparse)
 *
 * For binary installs a version-stamped sentinel file prevents re-running on
 * every CLI invocation.  The sentinel is only written after all steps succeed.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import {
  ensureBunInstalled,
  ensureNpmInstalled,
  ensureUvInstalled,
  trustGlobalBunPackages,
} from "@/lib/spawn.ts";
import { getBinaryDataDir, type InstallationType } from "@/services/config/config-path.ts";

const SENTINEL_FILENAME = ".tooling-setup-done";

function getSentinelPath(): string {
  return join(getBinaryDataDir(), SENTINEL_FILENAME);
}

function isToolingSetupDone(cliVersion: string): boolean {
  const sentinelPath = getSentinelPath();
  if (!existsSync(sentinelPath)) {
    return false;
  }
  try {
    return readFileSync(sentinelPath, "utf-8").trim() === cliVersion;
  } catch {
    return false;
  }
}

function markToolingSetupDone(cliVersion: string): void {
  writeFileSync(getSentinelPath(), cliVersion, "utf-8");
}

function clearSentinel(): void {
  try {
    unlinkSync(getSentinelPath());
  } catch {
    // Already gone — fine.
  }
}

/** Describes which tooling steps failed during installation. */
export class ToolingSetupError extends Error {
  constructor(public readonly failures: string[]) {
    const list = failures.map((f) => `  - ${f}`).join("\n");
    super(
      `First-run tooling setup failed:\n${list}\n\n` +
      `Re-run the command to retry, or install the failed tools manually.`,
    );
    this.name = "ToolingSetupError";
  }
}

interface ToolingStep {
  label: string;
  fn: () => Promise<unknown>;
}

function collectFailures(
  steps: ToolingStep[],
  results: PromiseSettledResult<unknown>[],
): string[] {
  const failures: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === "rejected") {
      const reason = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      const label = steps[i]?.label ?? `step ${i}`;
      failures.push(`${label}: ${reason}`);
    }
  }
  return failures;
}

/**
 * Install all required package managers and CLI tools.
 *
 * Throws {@link ToolingSetupError} if any step fails, listing every failure
 * so the user knows exactly what went wrong.
 */
export async function installTooling(): Promise<void> {
  const failures: string[] = [];

  // Phase 1: package managers (needed by later steps)
  const pmSteps: ToolingStep[] = [
    { label: "bun", fn: ensureBunInstalled },
    { label: "npm", fn: ensureNpmInstalled },
    { label: "uv", fn: ensureUvInstalled },
  ];
  const pmResults = await Promise.allSettled(pmSteps.map((s) => s.fn()));
  failures.push(...collectFailures(pmSteps, pmResults));

  // Phase 2: CLI tools in parallel
  const { installPlaywrightCli } = await import("@/scripts/postinstall-playwright.ts");
  const { installLiteparseCli } = await import("@/scripts/postinstall-liteparse.ts");

  const toolSteps: ToolingStep[] = [
    { label: "@playwright/cli", fn: installPlaywrightCli },
    { label: "@llamaindex/liteparse", fn: installLiteparseCli },
  ];
  const toolResults = await Promise.allSettled(toolSteps.map((s) => s.fn()));
  failures.push(...collectFailures(toolSteps, toolResults));

  // Phase 3: trust lifecycle scripts for globally installed bun packages
  const trustResult = await trustGlobalBunPackages(["@playwright/cli", "@llamaindex/liteparse"]);
  if (!trustResult.success) {
    failures.push(`trust global bun packages: ${trustResult.details}`);
  }

  if (failures.length > 0) {
    throw new ToolingSetupError(failures);
  }
}

/**
 * Ensure all required tooling is installed for binary installs.
 *
 * No-op for source/npm installs (postinstall.ts handles those) or when the
 * sentinel file shows setup already completed for the current CLI version.
 *
 * Throws {@link ToolingSetupError} on failure.  The sentinel is cleared so
 * the next invocation will retry.
 */
export async function ensureFirstRunTooling(
  cliVersion: string,
  installType: InstallationType,
): Promise<void> {
  if (installType !== "binary") {
    return;
  }

  if (isToolingSetupDone(cliVersion)) {
    return;
  }

  clearSentinel();

  await installTooling();

  markToolingSetupDone(cliVersion);
}
