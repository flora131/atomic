/**
 * Merge-copy bundled Atomic agents from the installed package into the
 * provider-native global roots.
 *
 * Mirrors `install_global_agents()` from the production install.sh /
 * install.ps1 bootstrap installers. The bundled agent definitions ship
 * with the npm package (see the `files` array in package.json) at:
 *
 *   <pkg-root>/.claude/agents      → ~/.claude/agents
 *   <pkg-root>/.opencode/agents    → ~/.opencode/agents
 *   <pkg-root>/.github/agents      → ~/.copilot/agents      (rename: github → copilot)
 *   <pkg-root>/.github/lsp.json    → ~/.copilot/lsp-config.json  (rename per atomic-global-config.ts)
 *
 * Copy semantics: files sharing a name with a bundled file are overwritten;
 * unrelated user-added files in those directories are preserved (the
 * `copyDir()` helper iterates source entries, so anything not in the
 * source is left untouched).
 */

import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  copyDir,
  copyFile,
  ensureDir,
  pathExists,
} from "@bastani/atomic-sdk/services/system/copy";
import { createCommonIgnoreFilter } from "@bastani/atomic-sdk/lib/common-ignore";
import type { ProviderConfigKind } from "@bastani/atomic-sdk/services/config/definitions";
import { getEmbeddedAsset } from "../../lib/embedded-assets.ts";

/** Honors ATOMIC_SETTINGS_HOME so tests can point at a temp dir. */
function homeRoot(): string {
  return process.env.ATOMIC_SETTINGS_HOME ?? homedir();
}

interface AgentSyncPair {
  /** Embedded-asset kind whose extracted tree is the source root. */
  kind: ProviderConfigKind;
  /** Destination path relative to home root. */
  dest: string;
}

const AGENT_DIR_PAIRS: AgentSyncPair[] = [
  { kind: "claude", dest: ".claude/agents" },
  { kind: "opencode", dest: ".opencode/agents" },
  { kind: "github", dest: ".copilot/agents" },
];

/**
 * Sync bundled agents and the copilot lsp-config to the provider global
 * roots. Throws on hard failures (a single sync failing); missing source
 * directories are warned about and skipped, not thrown.
 */
export async function installGlobalAgents(): Promise<void> {
  const home = homeRoot();

  const warnings: string[] = [];
  for (const { kind, dest } of AGENT_DIR_PAIRS) {
    const src = join(await getEmbeddedAsset(kind), "agents");
    const target = join(home, dest);

    if (!(await pathExists(src))) {
      warnings.push(`bundled agents missing at ${src} — skipping ${target}`);
      continue;
    }

    await copyDir(src, target, { ignoreFilter: createCommonIgnoreFilter() });
  }

  // Surface skipped sources via a non-fatal thrown error only if ALL sources
  // were missing. A partial miss (e.g. one provider folder absent in a dev
  // checkout) is normal and shouldn't mark the step as failed. The spinner
  // UI shows the thrown message beneath the failing row.
  if (warnings.length === AGENT_DIR_PAIRS.length) {
    throw new Error(warnings.join("\n"));
  }

  // Copilot's lsp.json is renamed to ~/.copilot/lsp-config.json on disk
  // (see atomic-global-config.ts for the in-binary rename rationale).
  const lspSrc = join(await getEmbeddedAsset("github"), "lsp.json");
  const lspDest = join(home, ".copilot", "lsp-config.json");
  if (await pathExists(lspSrc)) {
    await ensureDir(dirname(lspDest));
    await copyFile(lspSrc, lspDest);
  }
}
