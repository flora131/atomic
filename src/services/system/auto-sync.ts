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
 * grouped into two parallel phases:
 *
 *   Phase 1 (parallel — no inter-dependencies):
 *     1. Node.js / npm           (installed via fnm, no system pkg-mgr)
 *     2. tmux / psmux            (terminal multiplexer for `chat` / `workflow`)
 *     3. global agent configs    (file copies — no network)
 *
 *   Phase 2 (parallel — all need npm from Phase 1):
 *     4. @playwright/cli         (npm install -g)
 *     5. @llamaindex/liteparse   (npm install -g)
 *     6. global skills           (npx skills add ...)
 *
 * Steps within each phase run concurrently; phases run sequentially.
 * Failures are collected and reported as a summary at the end, but never
 * abort the run — partial setup matches the production installer's
 * "best-effort" semantics. The marker is written after every run (success
 * or partial) so we don't re-attempt the whole setup on every subsequent
 * launch.
 */

import { join } from "path";
import { homedir } from "os";
import { VERSION } from "@/version.ts";
import { COLORS } from "@/theme/colors.ts";
import {
  ensureNpmInstalled,
  ensureTmuxInstalled,
  upgradePlaywrightCli,
  upgradeLiteparse,
} from "@/lib/spawn.ts";
import { installGlobalAgents } from "@/services/system/agents.ts";
import { installGlobalSkills } from "@/services/system/skills.ts";
import { runSteps, printSummary } from "@/services/system/install-ui.ts";
import { displayBlockBanner } from "@/theme/logo.ts";

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

  // Steps are split into two parallel phases:
  //
  //  Phase 1 — core tools + file copies (no inter-dependencies):
  //    npm is installed via fnm (not a system package manager), so it
  //    won't contend with tmux's apt-get/dnf install. Agent config
  //    copies are pure file I/O with no network or npm dependency.
  //
  //  Phase 2 — npm-dependent tasks (run after Phase 1):
  //    @playwright/cli, @llamaindex/liteparse, and `npx skills` all
  //    need npm/npx. They install independent packages, so they can
  //    run concurrently.
  //
  // Each step's failure is caught inside `runSteps` (not thrown), so
  // subsequent steps still run even if one fails — matches install.sh's
  // best-effort contract.
  const results = await runSteps([
    // Phase 1 — parallel
    [
      { label: "Node.js / npm",        fn: () => ensureNpmInstalled({ quiet: true }) },
      { label: "tmux / psmux",         fn: () => ensureTmuxInstalled({ quiet: true }) },
      { label: "global agent configs", fn: installGlobalAgents },
    ],
    // Phase 2 — parallel, after Phase 1
    [
      { label: "@playwright/cli",       fn: upgradePlaywrightCli },
      { label: "@llamaindex/liteparse", fn: upgradeLiteparse },
      { label: "global skills",         fn: installGlobalSkills },
    ],
  ]);

  // Always write the marker — partial setup is the production-installer
  // contract. Re-running the bootstrap installer or `bun update -g
  // @bastani/atomic` is the recovery path for a failed setup.
  await markSynced();

  displayBlockBanner();
  printSummary(results);

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.log(
      `\n  ${COLORS.dim}Re-run \`bun install -g @bastani/atomic\` after resolving the issues to retry.${COLORS.reset}\n`,
    );
  } else {
    console.log(
      `\n  ${COLORS.dim}Learn more at ${COLORS.reset}${COLORS.blue}https://deepwiki.com/flora131/atomic${COLORS.reset}\n`,
    );
  }
}
