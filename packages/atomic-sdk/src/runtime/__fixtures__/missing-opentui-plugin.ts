/**
 * Fixture: simulates a capsule built without externalizing `@opentui/*`.
 * Throws a synthetic error whose shape matches Bun's ResolveMessage for a
 * missing @opentui/core-* native package.
 */
const err: Error & { specifier: string } = Object.assign(
  new Error(
    "Cannot find module '@opentui/core-linux-x64/index.ts' from '/tmp/wf.mjs'",
  ),
  { specifier: "@opentui/core-linux-x64" },
);
err.name = "ResolveMessage";
throw err;
