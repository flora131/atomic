---
source_url: https://github.com/oven-sh/bun/tree/main/src/install
fetched_at: 2026-04-17
fetch_method: html-parse (GitHub raw + playwright)
topic: Bun global install bin shim behavior - Windows vs macOS/Linux
---

# Bun `bun install -g` Bin Behavior

## Key Source Files

- `src/install/bin.zig` — `Linker.linkBinOrCreateShim()`, `createWindowsShim()`, `createSymlink()`
- `src/install/windows-shim/BinLinkingShim.zig` — Windows `.bunx` file format encoder
- `src/install/windows-shim/bun_shim_impl.zig` — The pre-compiled `bun_shim_impl.exe` embedded into bun
- `src/install/PackageManager/PackageManagerOptions.zig` — `openGlobalBinDir()`, env var resolution

## Windows: What gets created in `%USERPROFILE%\.bun\bin\` (or `$BUN_INSTALL\bin\`)

For a package with `"bin": { "copilot": "npm-loader.js" }`, Bun creates TWO files:

1. **`copilot.exe`** — a copy of `bun_shim_impl.exe` (embedded compiled shim, ~13 KB). This is what Windows sees as an executable on PATH.
2. **`copilot.bunx`** — a binary metadata file encoding:
   - The relative path to the target `.js` file (in UTF-16)
   - A "shebang" record indicating how to launch it

For `.js` files, the shebang is set to `"bun run"` (i.e., `run_with_bun`). When `copilot.exe` is invoked, it reads `copilot.bunx` from the same directory and calls `CreateProcessW` to spawn `bun run <path-to-npm-loader.js>`.

**No `.cmd`, `.ps1`, or `.bat` files** are created by Bun. This is explicitly designed to avoid the `Terminate batch job (Y/N)` problem that npm/yarn cmd-shims cause.

Source lines in `bin.zig`:
```
// Line 715-786 createWindowsShim():
abs_bunx_file = abs_dest + ".bunx"   → writes BinLinkingShim metadata
abs_exe_file  = abs_dest + ".exe"    → writes embedded bun_shim_impl.exe binary
```

BunExtensions map (`BinLinkingShim.zig` ~line 100):
```zig
.{ ".js",  .run_with_bun }   → shebang = "bun run"
.{ ".mjs", .run_with_bun }
.{ ".cjs", .run_with_bun }
.{ ".ts",  .run_with_bun }
.{ ".cmd", .run_with_cmd }   → shebang = "cmd /c"
.{ ".bat", .run_with_cmd }
.{ ".ps1", .run_with_powershell } → shebang = "powershell -ExecutionPolicy Bypass -File"
```

## macOS and Linux: What gets created in `~/.bun/bin/`

The non-Windows path in `bin.zig` calls `createSymlink()` (line ~597):
- Creates a **symlink** named after the bin entry (e.g., `copilot`) pointing to the actual JS file in `node_modules` (global store)
- Also calls `chmod 0777` on the target to make it executable
- Normalizes `\r\n` shebangs to `\n` in the target file (`tryNormalizeShebang`)

The symlink points to the actual target file — Bun does NOT create a wrapper shell script. Execution relies on the shebang line in the JS file (e.g., `#!/usr/bin/env bun` or `#!/usr/bin/env node`).

## Env Vars That Override the Bin Directory

From `PackageManagerOptions.zig` `openGlobalBinDir()`:

1. `$BUN_INSTALL_BIN` — direct override of bin directory (highest priority)
2. `bunfig.toml` `global_bin_dir` field
3. `$BUN_INSTALL/bin` — if `$BUN_INSTALL` is set
4. `$XDG_CACHE_HOME/.bun/bin` OR `$HOME/.bun/bin` — default fallback

On Windows, the same logic applies: `$BUN_INSTALL\bin` or `$USERPROFILE\.bun\bin`.

Global package store dir (NOT the bin dir): `$BUN_INSTALL_GLOBAL_DIR` > `$BUN_INSTALL/install/global` > `$XDG_CACHE_HOME/.bun/install/global` > `$HOME/.bun/install/global`

## Summary for PATH Helper

When writing a cross-platform helper to locate `copilot` binary:

- **Windows**: Look for `copilot.exe` (not `copilot` or `copilot.bunx`) in the bin dir. The `.exe` is the launcher.
- **macOS/Linux**: Look for `copilot` (symlink, no extension) in the bin dir.
- **Bin dir resolution**: Check `$BUN_INSTALL_BIN` first, then `$BUN_INSTALL/bin`, then `$HOME/.bun/bin` (or `$XDG_CACHE_HOME/.bun/bin`).
- Do not rely solely on hardcoded `~/.bun/bin` — use the env var chain above. The bin dir is always on PATH after normal Bun install.
