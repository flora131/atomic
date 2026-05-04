/**
 * Emit the gitignored `src/lib/runtime-scripts/*.script.js` bundles so
 * `tsc` resolves the same file in every environment.
 *
 * Without this, typecheck behavior diverges between fresh checkouts
 * (CI) and post-build local trees: the ambient `*.script.js` declaration
 * provides a default export, while the real bundle does not — flipping
 * the load-bearing `@ts-expect-error` in `runtime-assets.ts` between
 * "used" and "unused" (TS2578).
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitRuntimeScriptBundles } from "../../atomic/script/build-assets.ts";

const SDK_PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE_ROOT = join(SDK_PKG_ROOT, "../..");

await emitRuntimeScriptBundles(WORKSPACE_ROOT);
