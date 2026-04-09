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
 * production bootstrap installers (`install.sh` / `install.ps1`) provide:
 *
 *   1. Node.js / npm           (gates everything that needs npm/npx)
 *   2. tmux / psmux            (terminal multiplexer for `chat` and `workflow`)
 *   3. @playwright/cli         (global npm package used by skills)
 *   4. @llamaindex/liteparse   (global npm package used by skills)
 *   5. global agent configs    (~/.claude/agents, ~/.opencode/agents, ~/.copilot/agents, lsp-config.json)
 *   6. global workflows        (~/.atomic/workflows/{hello,hello-parallel,ralph,...})
 *   7. global skills           (npx skills add ...)
 *
 * Each step runs sequentially. Failures are collected and reported as a
 * summary at the end, but never abort the run — partial setup matches the
 * production installer's "best-effort" semantics. The marker is written
 * after every run (success or partial) so we don't re-attempt the whole
 * setup on every subsequent launch.
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
import { installGlobalWorkflows } from "@/services/system/workflows.ts";
import { installGlobalSkills } from "@/services/system/skills.ts";
import { runSteps, printSummary } from "@/services/system/install-ui.ts";

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
    `\n  ${COLORS.dim}Setting up atomic ${COLORS.reset}${COLORS.bold}v${VERSION}${COLORS.reset}${COLORS.dim}…${COLORS.reset}\n`,
  );

  // Ordering notes:
  //  - Phase 1 (npm, tmux): core tools. npm comes first because
  //    @playwright/cli, @llamaindex/liteparse, and `npx skills` all need it.
  //    tmux/psmux is independent but installed sequentially to avoid
  //    contention with system package-manager locks (apt-get, dnf, etc).
  //  - Phase 2 (global npm packages): will fail loudly if Phase 1's npm
  //    install failed, which is fine — the spinner summary records their
  //    failure too.
  //  - Phase 3 (bundled atomic content): file copies + npx skills install.
  //
  // Each step's failure is caught inside `runSteps` (not thrown), so
  // subsequent steps still run even if one fails — matches install.sh's
  // best-effort contract.
  const results = await runSteps([
    { label: "Node.js / npm",      fn: () => ensureNpmInstalled({ quiet: true }) },
    { label: "tmux / psmux",       fn: () => ensureTmuxInstalled({ quiet: true }) },
    { label: "@playwright/cli",    fn: upgradePlaywrightCli },
    { label: "@llamaindex/liteparse", fn: upgradeLiteparse },
    { label: "global agent configs",  fn: installGlobalAgents },
    { label: "global workflows",      fn: installGlobalWorkflows },
    { label: "global skills",         fn: installGlobalSkills },
  ]);

  // Always write the marker — partial setup is the production-installer
  // contract. Re-running the bootstrap installer or `bun update -g
  // @bastani/atomic` is the recovery path for a failed setup.
  await markSynced();

  console.log();
  printSummary(results);

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.log(
      `\n  ${COLORS.dim}Re-run \`bun install -g @bastani/atomic\` after resolving the issues to retry.${COLORS.reset}\n`,
    );
  } else {
    console.log();
  }
}
