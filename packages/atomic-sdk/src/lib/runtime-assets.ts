/**
 * Resolved paths to runtime sibling assets (RFC §5.1).
 *
 * Each export holds the path that `with { type: "file" }` resolves to:
 *
 *  - **Compiled binary**: a `/$bunfs/…` virtual-filesystem path.
 *  - **Dev / installed package**: the absolute source path.
 *
 * `with { type: "file" }` is the only correct mechanism for asset resolution
 * under `bun build --compile`. Do NOT use `import.meta.dir` inside this module.
 *
 * The `.script.js` bundles under `runtime-scripts/` are emitted by
 * `emitRuntimeScriptBundles` (RFC §5.3) so a runtime asset import never
 * collides with a module import of the canonical `cc-debounce.ts` /
 * `orchestrator-entry.ts` source (RFC §5.6).
 */

import tmuxConfAsset          from "../runtime/tmux.conf"                           with { type: "file" };
// `with { type: "file" }` makes Bun return a path string at runtime, but TypeScript
// resolves the `.js` bundle as a module under `allowJs`. The suppression is
// intentional and load-bearing.
// @ts-expect-error see comment above
import ccDebounceAsset         from "./runtime-scripts/cc-debounce.script.js"        with { type: "file" };
// @ts-expect-error see comment above
import orchestratorEntryAsset  from "./runtime-scripts/orchestrator-entry.script.js" with { type: "file" };

/** Resolved path to the tmux.conf runtime asset. */
export const tmuxConfPath: string = tmuxConfAsset;

/** Resolved path to the cc-debounce runtime script. */
export const ccDebounceScriptPath: string = ccDebounceAsset;

/** Resolved path to the orchestrator-entry runtime script. */
export const orchestratorEntryPath: string = orchestratorEntryAsset;
