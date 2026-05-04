/**
 * Runtime-environment detection helpers (RFC §5.3).
 *
 * Both functions accept a `dir` parameter instead of reading `import.meta.dir`
 * directly so that unit tests can supply arbitrary paths without patching
 * module globals.
 *
 * Two runtime cases are handled:
 *
 *  1. **Compiled binary** (`isCompiledBinaryRuntime`): `bun build --compile`
 *     packs all sources into a virtual filesystem exposed at `/$bunfs/` on
 *     POSIX (inferred `\$bunfs\` on Windows — RFC §9 open question, defensive
 *     cost is zero).
 *
 *  2. **Installed package** (`isInstalledPackage`): covers the standard
 *     `node_modules/` install path *and* the compiled-binary runtime, because
 *     both indicate production deployments where first-run setup should run.
 */

/**
 * True when `dir` lives inside a Bun-compiled binary's virtual filesystem.
 *
 * POSIX exposes bundled resources under `/$bunfs/`. Windows uses a different
 * shape: `<DRIVE>:\~BUN\root\...` (or forward-slash variant `<DRIVE>:/~BUN/root/...`).
 * See oven-sh/bun#25500 and oven-sh/bun#8476 — the upstream Single-File
 * Executable docs are the source of truth here.
 */
export function isCompiledBinaryRuntime(dir: string): boolean {
  if (dir.startsWith("/$bunfs/") || dir.startsWith("\\$bunfs\\")) return true;
  // Bun's Windows compiled-binary path shape is `<DRIVE>:\~BUN\root\...` per
  // oven-sh/bun#25500, but we've seen variants without a drive letter and
  // with both slash directions on different runner images. Match any path
  // segment of literal `~BUN` between path separators — the chance of a
  // real on-disk directory named exactly `~BUN` is negligible.
  return /[\\/]~BUN[\\/]/i.test(dir);
}

/**
 * True when `dir` indicates the CLI is running from an installed package —
 * either a standard `node_modules/` install or a Bun-compiled binary.
 */
export function isInstalledPackage(dir: string): boolean {
  return dir.includes("node_modules") || isCompiledBinaryRuntime(dir);
}
