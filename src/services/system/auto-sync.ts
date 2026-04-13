/**
 * Lazy first-run sync of tooling deps, bundled agents, and global skills.
 *
 * Why this exists: bun's package manager does NOT execute the top-level
 * package's `postinstall` script on `bun add -g` / `bun update -g` — see
 * `src/install/PackageManager/install_with_manager.zig` (the
 * `!manager.options.global` guard around root lifecycle scripts). So
 * there's no install-time hook we can register from `package.json`.
 *
 * Instead, we detect a fresh install or upgrade lazily on CLI startup by
 * comparing the bundled `VERSION` constant against a marker file at
 * `~/.atomic/.synced-version`. On a mismatch we run the same setup the
 * production bootstrap installers (`install.sh` / `install.ps1`) provide,
 * as a single parallel phase:
 *
 *     1. tmux / psmux            (terminal multiplexer for `chat` / `workflow`)
 *     2. global agent configs    (file copies — no network)
 *     3. @playwright/cli         (bun install -g)
 *     4. @llamaindex/liteparse   (bun install -g)
 *     5. global skills           (bunx skills add ...)
 *
 * All steps run concurrently using bun (already our runtime) for package
 * installs and `bunx` for CLI tools, avoiding a ~48 s Node.js/npm
 * download via fnm that previously gated Phase 2.
 *
 * Failures are collected and reported as a summary at the end, but never
 * abort the run — partial setup matches the production installer's
 * "best-effort" semantics. The marker is only written when every step
 * succeeds; on partial failure the next launch re-runs all steps (they
 * are idempotent, so re-running already-succeeded steps is harmless).
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { VERSION } from "../../version.ts";
import { COLORS } from "../../theme/colors.ts";
import {
  ensureTmuxInstalled,
  upgradePlaywrightCli,
  upgradeLiteparse,
} from "../../lib/spawn.ts";
import { installGlobalAgents } from "./agents.ts";
import { installGlobalSkills } from "./skills.ts";
import { runSteps, printSummary } from "./install-ui.ts";
import { displayBlockBanner } from "../../theme/logo.ts";

/** Path to the version marker. Honors ATOMIC_SETTINGS_HOME for tests. */
function syncMarkerPath(): string {
  const home = process.env.ATOMIC_SETTINGS_HOME ?? homedir();
  return join(home, ".atomic", ".synced-version");
}

/**
 * True when running from an installed package (under `node_modules/`),
 * false on a dev checkout. Avoids triggering a full global setup on every
 * `bun run dev` in the repo.
 */
function isInstalledPackage(): boolean {
  return import.meta.dir.includes("node_modules");
}

/**
 * Write the version marker. Best-effort: a failed write just means the
 * next launch will re-sync, which is wasteful but not broken.
 */
export async function markSynced(): Promise<void> {
  try {
    await Bun.write(syncMarkerPath(), VERSION);
  } catch {
    // Swallow — see docstring.
  }
}

/**
 * Sync tooling deps, bundled agents, and global skills if the marker
 * doesn't match the bundled VERSION. No-op in dev checkouts and when the
 * marker already matches the current version.
 */
export async function autoSyncIfStale(): Promise<void> {
  if (!isInstalledPackage()) return;

  let stored = "";
  const marker = Bun.file(syncMarkerPath());
  if (await marker.exists()) {
    stored = (await marker.text()).trim();
  }

  if (stored === VERSION) return;

  console.log(
    `\n  ${COLORS.dim}Setting up atomic ${COLORS.reset}${COLORS.bold}v${VERSION}${COLORS.reset}${COLORS.dim}…${COLORS.reset}`,
  );

  // All steps run in a single parallel phase. bun (already our runtime)
  // handles global package installs and `bunx` execution, so there is no
  // need to install Node.js/npm first — eliminating a ~48 s fnm download
  // that previously dominated the loading screen.
  //
  // Each step's failure is caught inside `runSteps` (not thrown), so
  // subsequent steps still run even if one fails — matches install.sh's
  // best-effort contract.
  const results = await runSteps([
    [
      { label: "tmux / psmux",         fn: () => ensureTmuxInstalled({ quiet: true }) },
      { label: "global agent configs", fn: installGlobalAgents },
      { label: "@playwright/cli",      fn: upgradePlaywrightCli },
      { label: "@llamaindex/liteparse", fn: upgradeLiteparse },
      { label: "global skills",        fn: installGlobalSkills },
    ],
  ]);

  const failures = results.filter((r) => !r.ok);

  // Only write the marker when every step succeeded. On partial failure
  // the next launch will re-run all steps — they're idempotent, so
  // re-running already-succeeded steps is cheap and harmless.
  if (failures.length === 0) {
    await markSynced();
  }

  displayBlockBanner();
  printSummary(results);

  if (failures.length > 0) {
    console.log(
      `\n  ${COLORS.dim}Setup will retry on next launch. To retry now, re-run your command.${COLORS.reset}\n`,
    );
  } else {
    console.log(
      `\n  ${COLORS.dim}Learn more at ${COLORS.reset}${COLORS.blue}https://deepwiki.com/flora131/atomic${COLORS.reset}\n`,
    );
  }
}
