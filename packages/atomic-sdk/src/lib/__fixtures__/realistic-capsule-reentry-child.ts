/**
 * Harness for the realistic capsule re-entry e2e test (RFC §5.4).
 *
 * Argv: [bunBin, scriptPath, capsuleSourcePath, outdir1, outdir2, noWfSourcePath].
 *
 * Owns all `Bun.build()` calls so the parent `bun test` process never warms
 * loader-cache entries that would otherwise collide with this harness's
 * builds (root cause of the prior `bun test:coverage` flake).
 *
 * Builds two capsules from the same source into distinct outdirs, then
 * dynamic-imports each with `_orchestrator-entry` argv. The first import
 * exercises the install path; the second exercises the sentinel skip path.
 * `noWfSourcePath` has no WorkflowDefinition default, so each
 * `runOrchestratorEntry` throws `InvalidWorkflowError` — caught silently
 * by `auto-dispatch.ts` so the harness can continue.
 *
 * Requires `ATOMIC_DEBUG=1` in the environment for the log messages.
 */

const [, , capsuleSourcePath, outdir1, outdir2, noWfSourcePath] = Bun.argv;

if (!capsuleSourcePath || !outdir1 || !outdir2 || !noWfSourcePath) {
  process.stderr.write(
    `[harness] Missing args. Got: ${JSON.stringify(Bun.argv)}\n`,
  );
  process.exit(1);
}

// `@opentui/core` (bare + subpaths via Bun's subpath inheritance) plus every
// platform-native variant from @opentui/core/package.json#optionalDependencies.
// Mirrors the externalization the regex plugin used to do, but as a plain
// Bun.build `external` list.
const OPENTUI_CORE_EXTERNALS = [
  "@opentui/core",
  "@opentui/core-darwin-x64",
  "@opentui/core-darwin-arm64",
  "@opentui/core-linux-x64",
  "@opentui/core-linux-arm64",
  "@opentui/core-win32-x64",
  "@opentui/core-win32-arm64",
];

// Sequential builds: avoid intra-process bundler cache races on overlapping graphs.
async function buildCapsule(
  label: string,
  sourcePath: string,
  outdir: string,
): Promise<string> {
  const result = await Bun.build({
    entrypoints: [sourcePath],
    format: "esm",
    target: "bun",
    external: OPENTUI_CORE_EXTERNALS,
    outdir,
  });
  if (!result.success) {
    process.stderr.write(
      `[harness] ${label} build failed:\n${result.logs.map(String).join("\n")}\n`,
    );
    process.exit(1);
  }
  return result.outputs[0]!.path;
}

const capsulePath1 = await buildCapsule("capsule1", capsuleSourcePath, outdir1);
const capsulePath2 = await buildCapsule("capsule2", capsuleSourcePath, outdir2);

// Stable argv for `_orchestrator-entry`. `noWfSourcePath` has no
// WorkflowDefinition default, so each import triggers
// InvalidWorkflowError — caught silently by auto-dispatch.ts.
process.argv = [
  process.argv[0]!,
  process.argv[1]!,
  "_orchestrator-entry",
  "reentry-test",
  "claude",
  "e30=", // base64("{}")
  noWfSourcePath,
];

// First import: sentinel unset → install fires → logs "registered core loader".
await import(capsulePath1);

// Second import: distinct resolved path → fresh module instance → fresh TLA.
// Sentinel is now set → logs "skipped install (already present)".
await import(capsulePath2);

// If we reach here:
//   - No "OpenTUI Core runtime plugin support is already installed with a different
//     core runtime module." error was thrown (iteration-4 P0 is absent).
//   - The iteration-5/6 sentinel guard correctly short-circuited the second install.
process.exit(0);
