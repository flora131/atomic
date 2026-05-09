/**
 * E2e child fixture for the iteration-4 isolation pattern (issue-898 RFC §5.4).
 * Runs inside a Bun.spawn child so its process-global Bun.plugin() does not
 * leak into the parent `bun test` process.
 * Assertions exit with non-zero codes for the parent to surface.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeModuleIdForSpecifier } from "@opentui/core/runtime-plugin";
import { ensureRuntimePluginSupport } from "@opentui/core/runtime-plugin-support/configure";

ensureRuntimePluginSupport({ core: () => import("@opentui/core") });
const hostCore = await import("@opentui/core");
const coreRuntimeId = runtimeModuleIdForSpecifier("@opentui/core");

const dir = await mkdtemp(join(tmpdir(), "atomic-rtp-e2e-"));
const entry = join(dir, "fixture.ts");
await writeFile(
  entry,
  `import * as core from ${JSON.stringify(coreRuntimeId)};\nexport const probe = core;\n`,
  "utf8",
);

const result = await Bun.build({
  entrypoints: [entry],
  format: "esm",
  target: "bun",
  external: [coreRuntimeId],
  outdir: join(dir, "out"),
});
if (!result.success || result.outputs.length === 0) {
  process.stderr.write("build failed\n");
  process.exit(1);
}
const capsule = await import(result.outputs[0]!.path);
const capsuleCore = capsule.probe as typeof hostCore;
if (capsuleCore.BoxRenderable !== hostCore.BoxRenderable) {
  process.stderr.write("identity mismatch: BoxRenderable\n");
  process.exit(2);
}
if (capsuleCore.Box !== hostCore.Box) {
  process.stderr.write("identity mismatch: Box\n");
  process.exit(3);
}
process.exit(0);
