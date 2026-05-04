/**
 * Emit the gitignored tarballs and runtime-script bundles that
 * `packages/atomic/src/lib/embedded-assets.ts` and
 * `packages/atomic-sdk/src/lib/runtime-assets.ts` import via
 * `with { type: "file" }` so `bun run dev` works on a fresh checkout.
 *
 * Idempotent: skips emission when every required artifact is already
 * present, mirroring `tests/setup/ensure-embedded-tarballs.ts`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../src/lib/workspace-paths.ts";
import { bundleEmbeddedAssets, emitRuntimeScriptBundles } from "./build-assets.ts";

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

const tarballsMissing = requiredTarballs.some((p) => !existsSync(p));
const scriptsMissing = requiredScripts.some((p) => !existsSync(p));

if (tarballsMissing) await bundleEmbeddedAssets(root);
if (scriptsMissing) await emitRuntimeScriptBundles(root);
