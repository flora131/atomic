/**
 * Regression fixture for RFC issue-898 iteration-1 bug.
 *
 * Run as: bun <this-file>
 * argv does NOT contain "_orchestrator-entry", so auto-dispatch must NOT call
 * ensureRuntimePluginSupport(), and Bun.plugin({ onResolve: { filter: /.*\/ } })
 * must NOT be installed. If it were, the sync require() below throws:
 *   TypeError: require() async module ... is unsupported
 *
 * Exit code: 0 = regression absent (gating fix holds), non-zero = regression present.
 */
await import("../auto-dispatch.ts");

try {
  require("../../components/layout.ts");
  process.exit(0);
} catch (err) {
  process.stderr.write(
    `[regression] sync require of layout.ts threw: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
