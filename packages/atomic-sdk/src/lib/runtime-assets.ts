/**
 * Resolved paths to runtime sibling assets (RFC §5.1).
 *
 * `tmuxConfPath` resolves to:
 *
 *  - **Compiled binary**: a `/$bunfs/…` virtual-filesystem path materialised
 *    out to `~/.atomic/runtime/<sdk-version>/tmux.conf` so spawned OS
 *    processes (tmux, psmux) can read it.
 *  - **Dev / installed package**: the absolute on-disk source path.
 *
 * `with { type: "file" }` is the only correct mechanism for asset
 * resolution under `bun build --compile`. Do NOT use `import.meta.dir`
 * inside this module.
 *
 * ### Bunfs materialization
 *
 * In a compiled binary, `with { type: "file" }` returns a `/$bunfs/…`
 * path that is accessible to Bun APIs but NOT to spawned OS processes —
 * `tmux -f /$bunfs/.../tmux.conf` fails with ENOENT. Mirrors the tarball
 * treatment in `packages/atomic/src/lib/embedded-assets.ts`.
 *
 * To bridge that gap we copy the asset to a stable on-disk cache the
 * first time this module loads in a compiled binary. Subsequent loads
 * see an existing destination and skip the write. In dev /
 * installed-package runtime the import already resolves to a real
 * on-disk path, so the helper is a no-op.
 *
 * ### What used to live here
 *
 * Earlier versions of atomic also exported pre-bundled executor helper
 * scripts for hidden argv subcommands. Daemon mode removed those entrypoints;
 * this module now materializes only static runtime assets such as tmux.conf
 * for legacy executor tests.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import sdkPackageJson from "../../package.json";
import { isCompiledBinaryRuntime } from "./runtime-env.ts";

import tmuxConfAsset from "../runtime/tmux.conf" with { type: "file" };

const SDK_VERSION = sdkPackageJson.version;

/**
 * Cache root for materialized runtime assets.
 *
 * Lives under `~/.atomic/runtime/<sdk-version>/` rather than the platform
 * cache dir (`~/.cache`, `~/Library/Caches`, `%LOCALAPPDATA%\…\Cache`):
 *
 *  - `~/.cache` and friends are routinely wiped by users / cleanup tools.
 *    A wipe between atomic runs would force a re-extract on next launch
 *    — recoverable, but a needless cost.
 *  - All other atomic state already lives under `~/.atomic` (sessions/,
 *    tmp/, bin/, .synced-version), so keeping runtime assets there gives
 *    operators a single directory to inspect when debugging.
 *
 * Versioning the path lets two atomic versions share the same machine
 * without their assets stomping each other; a stale version directory
 * is a few KB and harmless.
 */
export function runtimeAssetsCacheDir(home: string = homedir()): string {
  return join(home, ".atomic", "runtime", SDK_VERSION);
}

/**
 * Copy a `/$bunfs/…` asset to a real on-disk path so spawned OS
 * subprocesses can read it. Returns `bundledPath` unchanged in dev /
 * installed-package runtime.
 *
 * Async because `/$bunfs/` paths are NOT readable via OS-level syscalls
 * (`copyfile(2)`, `open(2)`, …) — they only work through Bun's
 * `Bun.file()` API, which is async-only. Module-level evaluation uses
 * top-level await to keep the public API a plain `string` constant.
 *
 * Idempotent: when the destination already exists we skip the write.
 * The cache key includes the SDK version so an upgrade transparently
 * invalidates the cache without us having to hash file contents on
 * every startup.
 */
export async function materializeRuntimeAsset(
  bundledPath: string,
  cacheDir: string = runtimeAssetsCacheDir(),
): Promise<string> {
  if (!isCompiledBinaryRuntime(bundledPath)) return bundledPath;

  const dest = join(cacheDir, basename(bundledPath));
  if (existsSync(dest)) return dest;

  mkdirSync(dirname(dest), { recursive: true });
  // `copyFileSync` and friends fail with ENOENT against `/$bunfs/` source
  // paths — Bun's virtual FS is only exposed through `Bun.file()` /
  // `Bun.write()`. Mirrors `packages/atomic/src/lib/embedded-assets.ts`.
  await Bun.write(dest, await Bun.file(bundledPath).bytes());
  return dest;
}

/** Resolved path to the tmux.conf runtime asset. */
export const tmuxConfPath: string = await materializeRuntimeAsset(tmuxConfAsset);
