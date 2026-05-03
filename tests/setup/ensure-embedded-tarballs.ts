import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../../packages/atomic/src/lib/workspace-paths.ts";

const root = findRepoRoot(import.meta.dir);
const requiredTarballs = [
  ".claude.tar",
  ".opencode.tar",
  ".github.tar",
  ".agents/skills.tar",
].map((p) => join(root, p));
const requiredScripts = [
  "packages/atomic-sdk/src/lib/runtime-scripts/cc-debounce.script.js",
  "packages/atomic-sdk/src/lib/runtime-scripts/orchestrator-entry.script.js",
].map((p) => join(root, p));

if (
  requiredTarballs.some((p) => !existsSync(p)) ||
  requiredScripts.some((p) => !existsSync(p))
) {
  const { bundleEmbeddedAssets, emitRuntimeScriptBundles } = await import(
    "../../packages/atomic/script/build-assets.ts"
  );
  await bundleEmbeddedAssets(root);
  await emitRuntimeScriptBundles(root);
}
