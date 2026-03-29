---
date: 2026-03-20 15:44:05 PDT
researcher: Claude Code
git_commit: 3da7c0c62940fcdc526e285a82f66c4e9320d1e9
branch: flora131/feature/windows-arm64
repository: atomic
topic: "Windows ARM64 support — build, install, and runtime gaps (issues #388, #389)"
tags: [research, codebase, windows, arm64, build, installer, bun-ffi, opentui, cross-compilation]
status: complete
last_updated: 2026-03-29
last_updated_by: Claude Code
last_updated_note: "UPDATE 3: Bun issue #21869 confirmed fixed — baseline binary works on ARM64 Windows. CI updated: Windows binaries (standard + baseline) now built natively on `windows-latest` in the `build-windows` job, not cross-compiled from `ubuntu-latest`. `release` job downloads both `binaries` and `binaries-windows` artifacts."
---

# Research: Windows ARM64 Support

## Research Question

Document the full scope of changes needed to add Windows ARM64 support to the Atomic CLI, covering: (1) the publish workflow gap where `atomic-windows-arm64.exe` is never built/released (issue #388), (2) the `bun:ffi` / TinyCC runtime crash when running natively on ARM64 (issue #389), (3) the build script (`build-binary.ts`) changes needed for arch inference and `process.platform`/`process.arch` defines, (4) the `install.ps1` installer behavior on ARM64, and (5) whether Bun v1.3.10's new native ARM64 Windows support changes the recommended approach.

## Summary

Two issues block Windows ARM64 users from using Atomic CLI:

1. **Issue #388 (build gap):** `install.ps1` correctly detects ARM64 and requests `atomic-windows-arm64.exe`, but no such artifact is ever built or published — resulting in a 404 download error.

2. **Issue #389 (runtime crash):** Even if the ARM64 binary were built, OpenTUI's native renderer uses `bun:ffi`'s `dlopen()` which requires TinyCC. TinyCC has no ARM64 Windows backend, so `bun:ffi` is disabled on `bun-win32-arm64` — causing a fatal crash at startup.

**Bun v1.3.10 context:** Bun v1.3.10 (released Feb 26, 2026) added native ARM64 Windows support — install, run, and cross-compile standalone executables targeting `bun-windows-arm64`. However, this does NOT resolve the TinyCC/FFI limitation. TinyCC still lacks an ARM64 Windows backend, meaning `bun:ffi` `dlopen()` remains broken on native ARM64 binaries. This is tracked in [Bun #28055](https://github.com/oven-sh/bun/issues/28055) (Open, no milestone).

**Previous finding (from online research, Bun v1.2.19 era):** The x64-under-Prism emulation approach was **unreliable for Bun binaries**. Windows ARM64's Prism emulation does NOT support AVX/AVX2 instructions. Bun's standard x64 builds require AVX. Even `x86_64_baseline` builds crashed because AVX instructions leaked through Bun's internal Highway SIMD code paths. Multiple Bun GitHub issues documented this ([#21869](https://github.com/oven-sh/bun/issues/21869), [#10148](https://github.com/oven-sh/bun/issues/10148)).

**CRITICAL UPDATE (March 20, 2026 — new research):** The x64-baseline Prism path is now **likely viable** with Bun >= v1.3.11. Two key changes landed:

1. **[PR #27121](https://github.com/oven-sh/bun/pull/27121)** (merged Feb 21, 2026) — Added CI verification for baseline CPU instruction usage on Windows, ensuring baseline builds don't accidentally include AVX/AVX2 instructions.
2. **[PR #27801](https://github.com/oven-sh/bun/pull/27801)** (merged Mar 11, 2026) — Added a **static baseline CPU instruction verifier** that scans the compiled binary and **fails the CI build** if any AVX/AVX2 instructions are found in baseline builds. This closes the exact leak (Highway SIMD AVX code paths) that caused the v1.2.19 crashes under Prism.

The original crashes ([#21869](https://github.com/oven-sh/bun/issues/21869)) were caused by AVX instructions leaking into baseline builds through `highway.zig` SIMD routines. The static verifier in PR #27801 directly addresses this — baseline builds are now **guaranteed AVX-free at the CI level**.

**Important correction:** The crashes were NOT caused by "Prism" (the Ruby parser, sometimes called `prism`). They were caused by Bun's own `highway.zig` SIMD routines using AVX/AVX2 instructions that Windows ARM64's Prism **emulation layer** (Microsoft's x86-64 translator, confusingly also called "Prism") cannot translate. The error message was: `"CPU lacks AVX support. Please consider upgrading to a newer CPU."` with `"Features: no_avx2, no_avx"`.

**Revised assessment (updated):**
- **Native ARM64 binary**: Still blocked — `bun:ffi` disabled → OpenTUI crashes (issue #389). No timeline on [Bun #28055](https://github.com/oven-sh/bun/issues/28055).
- **x64 standard binary under Prism**: Still crashes — uses AVX/AVX2 instructions.
- **x64-baseline binary under Prism**: **Now viable** — AVX instructions statically verified as absent in baseline builds (PR #27801, Bun >= v1.3.11). `bun:ffi` works because x64 Bun includes TinyCC x86_64 backend.

**Recommended approach (updated):** Ship an **x64-baseline** compiled binary for ARM64 users, using `--target=bun-windows-x64-baseline` as the compile target. This is the only path where both (a) `bun:ffi`/`dlopen()` works (TinyCC x64 backend included) and (b) AVX instructions are absent (verified by Bun's static verifier). **Requires Bun >= v1.3.11** for the static AVX verifier guarantee. Still needs empirical validation on ARM64 Windows hardware, but the theoretical blocker (AVX in baseline) is now resolved at the CI level.

---

## Detailed Findings

### 1. Current Build Infrastructure

#### 1.1 publish.yml (`.github/workflows/publish.yml`)

The workflow has two build jobs:

- **`build` job**: Runs on `ubuntu-latest`. Cross-compiles binaries for 4 platforms using `--target` flag:
  - `bun-linux-x64`
  - `bun-linux-arm64`
  - `bun-darwin-x64`
  - `bun-darwin-arm64`

- **`build-windows` job**: Runs on `windows-latest` (x64 runner). Builds **two** Windows binaries natively:
  - `atomic-windows-x64.exe` — standard build (no `--target` flag, with AVX for native x64 users)
  - `atomic-windows-x64-baseline.exe` — baseline build (`--target=bun-windows-x64-baseline`, AVX-free for ARM64 Prism compatibility)
  - Also runs `bun run prepare:opentui-bindings` to ensure all platform bindings are available.

- **`release` job**: Downloads both `binaries` (from `build`) and `binaries-windows` (from `build-windows`) artifacts. Publishes 6 binaries + config archives + checksums.

**UPDATE (2026-03-29):** The CI was corrected to match the `main` branch's two-job pattern. Previously on the feature branch, Windows binaries were being cross-compiled in the `build` job on `ubuntu-latest`, and the `build-windows` job's `binaries-windows` artifact was never downloaded by `release`. Now: Windows binaries are built natively on `windows-latest`, and `release` downloads both artifact sets. The Bun issue #21869 (baseline crash under Prism) has been confirmed fixed — the baseline binary works on ARM64 Windows.

#### 1.2 build-binary.ts (`src/scripts/build-binary.ts`)

Current state:
- Has `inferTargetOs()` (lines 45-65) that extracts OS from `--target` flag
- Does NOT have `inferTargetArch()` — no architecture inference
- Does NOT inject `process.platform`/`process.arch` defines at bundle time
- Only defines `OTUI_TREE_SITTER_WORKER_PATH` (line 90-91)

**Gap:** When cross-compiling (e.g., building `bun-win32-x64` from a linux-x64 host), OpenTUI's dynamic import `import(`@opentui/core-${process.platform}-${process.arch}/index.ts`)` at `node_modules/@opentui/core/index-nkrr8a4c.js:11227` would resolve using the HOST's `process.platform`/`process.arch` (linux/x64), not the TARGET's (win32/x64). This embeds the wrong native binding.

**Gap:** No logic to remap ARM64 → x64 on Windows when ARM64 is unsupported due to the TinyCC limitation.

#### 1.3 prepare-opentui-bindings.ts (`src/scripts/prepare-opentui-bindings.ts`)

`DEFAULT_PLATFORMS` (lines 7-13):
```typescript
const DEFAULT_PLATFORMS = [
  "darwin-x64",
  "darwin-arm64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",  // <-- Already included!
] as const;
```

**Note:** `linux-x64` is omitted because it's the host platform in CI and is already installed via `bun ci`. The script fetches tarballs from npm registry for each non-native platform.

**`@opentui/core-win32-arm64@0.1.88` exists on npm** — verified via registry (HTTP 200). Contains:
- `index.ts` — exports path to the native DLL
- `opentui.dll` — ARM64-native DLL
- However, this DLL **cannot be loaded** by `bun:ffi` on ARM64 due to the TinyCC issue.

#### 1.4 OpenTUI Native Binding Resolution

At `node_modules/@opentui/core/index-nkrr8a4c.js:11227-11233`:
```javascript
var module = await import(`@opentui/core-${process.platform}-${process.arch}/index.ts`);
var targetLibPath = module.default;
// ...
if (!existsSync2(targetLibPath)) {
  throw new Error(`opentui is not supported on the current platform: ${process.platform}-${process.arch}`);
}
```

Then at line 11291:
```javascript
const rawSymbols = dlopen(resolvedLibPath, { /* FFI symbol definitions */ });
```

This `dlopen()` is from `bun:ffi` and requires TinyCC to JIT-compile the FFI bridge.

Each platform binding package (e.g., `@opentui/core-darwin-arm64`) contains:
- `index.ts` — `export default path` to the native library
- Native library file (`.dylib` on macOS, `.dll` on Windows, `.so` on Linux)

### 2. Installer Infrastructure

#### 2.1 install.ps1 (`install.ps1:199-208`)

```powershell
$Arch = $env:PROCESSOR_ARCHITECTURE
switch ($Arch) {
    "AMD64" { $Target = "windows-x64.exe" }
    "ARM64" { $Target = "windows-arm64.exe" }
    default { ... exit 1 }
}
```

**Already correctly detects ARM64.** Downloads `atomic-windows-arm64.exe` which doesn't exist → 404 error.

**Change needed:** Either:
- (A) Map ARM64 → download x64 binary (if we ship x64 for ARM64 users), OR
- (B) Keep as-is (if we ship a dedicated ARM64 artifact — even if it's an x64 binary renamed)

#### 2.2 install.sh (`install.sh:132-164`)

The bash installer detects Windows and delegates to PowerShell (line 143). No changes needed here.

#### 2.3 Self-Update (`src/services/system/download.ts:307-339`)

```typescript
export function getBinaryFilename(): string {
  const platform = process.platform;  // runtime value
  const arch = process.arch;          // runtime value
  // ... maps to "atomic-windows-{arch}.exe"
}
```

**Important:** If we ship an x64 binary for ARM64 users:
- An x64 binary running under Prism reports `process.arch === "x64"` → self-update downloads `atomic-windows-x64.exe` ✓
- BUT if we define `process.arch` at bundle time (for OpenTUI binding resolution), we need to ensure the define only affects the OpenTUI import, not the runtime `process.arch` used by download.ts

### 3. The TinyCC / bun:ffi Constraint

#### 3.1 The Problem

TinyCC (Tiny C Compiler) is embedded in Bun to JIT-compile FFI bridges at runtime. It has backends for:
- x86 (32-bit)
- x86_64 (64-bit)
- ARM (32-bit)
- AArch64 / ARM64 (Linux only)

**TinyCC does NOT have a Windows ARM64 (win32-arm64) backend.** When Bun is built for `bun-windows-arm64`, TinyCC is disabled entirely, which means `bun:ffi`'s `dlopen()` throws:

```
bun:ffi dlopen() is not available in this build (TinyCC is disabled)
```

#### 3.2 Bun v1.3.10 / v1.3.11 Impact

**Bun v1.3.10** (released Feb 26, 2026) added:
- **Native ARM64 Windows installation** — Bun can now be installed and run natively on ARM64 Windows
- **Cross-compilation** — `--target=bun-windows-arm64` is a valid compile target
- **[PR #27290](https://github.com/oven-sh/bun/pull/27290)** (merged Feb 20, 2026) — Fixed a `DeadSocket` alignment crash specific to Windows ARM64 stable builds
- **[PR #27434](https://github.com/oven-sh/bun/pull/27434)** (merged Feb 26, 2026) — Fixed a crash when standalone executables with `autoloadDotenv = false` spawned Workers on Windows

**Bun v1.3.11** (released Mar 18, 2026) added:
- **[PR #27448](https://github.com/oven-sh/bun/pull/27448)** (merged Mar 2, 2026) — Made the `node_modules/.bin` shim compile natively for aarch64 instead of being hardcoded to x86_64
- **[PR #27121](https://github.com/oven-sh/bun/pull/27121)** (merged Feb 21, 2026) — Added CI verification for baseline CPU instruction usage on Windows (Intel SDE baseline verification)
- **[PR #27801](https://github.com/oven-sh/bun/pull/27801)** (merged Mar 11, 2026) — **Added static baseline CPU instruction verifier** that scans compiled binaries and fails CI if any AVX/AVX2 instructions are found in baseline builds. This is the key fix that makes `bun-windows-x64-baseline` viable under Prism emulation.

**Still NOT fixed in v1.3.11:**
- TinyCC ARM64 Windows backend — `bun:ffi` `dlopen()` remains broken on native ARM64 binaries ([Bun #28055](https://github.com/oven-sh/bun/issues/28055), Open, no milestone)
- This is a fundamental limitation until Bun either:
  - Adds a TinyCC ARM64 Windows backend, or
  - Replaces TinyCC with an alternative FFI JIT approach (e.g., libffi or a custom solution)

**Minimum Bun version requirement:** Our build must use **Bun >= v1.3.11** to get the static AVX verifier (PR #27801). Without this, baseline builds may still contain AVX instructions that crash under Prism. This applies to the version of Bun used to run `bun build --compile`, not necessarily the end user's installed Bun version (since the compiled binary is standalone).

#### 3.3 x64 Emulation via Prism — Standard Builds UNRELIABLE, Baseline NOW VIABLE

Windows ARM64 includes Prism, Microsoft's x86-64 emulation layer. (Note: "Prism" here refers to Microsoft's x86-64 emulator on ARM64 Windows — NOT the Ruby parser also called "prism". The original crash reports may have caused confusion between these two.)

**Standard x64 builds are unreliable under Prism:**

- **AVX/AVX2 not supported:** Prism does NOT emulate AVX/AVX2 instructions. Bun's standard x64 builds (`bun-windows-x64` and `bun-windows-x64-modern`) require these. ([Bun #21869](https://github.com/oven-sh/bun/issues/21869))
- **Crash details:** The crash occurs in Bun's own `highway.zig:103` (`indexOfChar`) SIMD routines, NOT in any external parser. Stack trace: `highway.zig:103` → `cli.zig:713` → `main.zig:67`. Error: `"CPU lacks AVX support. Please consider upgrading to a newer CPU."` with `"Features: no_avx2, no_avx"`.
- **REPL crashes:** x64 Bun REPL crashes with `Illegal instruction at address` on Windows 11 ARM64. ([Bun #10148](https://github.com/oven-sh/bun/issues/10148))
- **Bun maintainer confirmed:** @RiskyMH noted *"we haven't really tested arm64's emulation much"* — the solution was native ARM64 support, not fixing emulation.
- **Issue status:** [#21869](https://github.com/oven-sh/bun/issues/21869) remains **Open** (not formally resolved, but superseded by native ARM64 support in v1.3.10).

**x64-baseline builds are NOW VIABLE under Prism (Bun >= v1.3.11):**

The `bun-windows-x64-baseline` target is designed for CPUs without AVX/AVX2. Previously, AVX instructions leaked into baseline builds through the Highway SIMD code paths (the exact code that caused the v1.2.19 crashes). Two PRs in Bun v1.3.10-1.3.11 fixed this:

1. **[PR #27121](https://github.com/oven-sh/bun/pull/27121)** (merged Feb 21, 2026) — Added Intel SDE baseline verification in CI for Windows, catching AVX usage in baseline builds.
2. **[PR #27801](https://github.com/oven-sh/bun/pull/27801)** (merged Mar 11, 2026) — Added a **static baseline CPU instruction verifier** that scans the final compiled binary and **fails the CI build** if ANY AVX/AVX2 instructions are present. This is a hard guarantee — not a best-effort check.

This means `bun build --compile --target=bun-windows-x64-baseline` (when using Bun >= v1.3.11) produces a standalone binary that is **guaranteed to contain no AVX/AVX2 instructions**, making it safe to run under Prism emulation on ARM64 Windows.

**What works under Prism with x64-baseline:**
- `bun:ffi` works correctly because the x64 Bun includes TinyCC x86_64 backend
- `process.arch` reports `"x64"` in the emulated environment
- Self-update logic (`download.ts`) would correctly target x64 artifacts
- No AVX/AVX2 instructions → no illegal instruction crashes

**Remaining uncertainty:** While the AVX leak is now provably fixed, no public report has confirmed a `bun build --compile --target=bun-windows-x64-baseline` standalone binary running successfully on ARM64 Windows with Bun v1.3.11. **Empirical testing on ARM64 Windows hardware is still recommended** before shipping, but the theoretical blocker is resolved.

### 4. Approach Analysis

> **NOTE (updated March 20, 2026):** The Prism emulation approach is now viable using `bun-windows-x64-baseline` compile target with Bun >= v1.3.11. The AVX leak that caused crashes in v1.2.19 is fixed by PR #27801's static verifier. Empirical validation on ARM64 hardware is still recommended but the theoretical blocker is resolved.

#### Approach A: Ship x64-baseline binary for ARM64 users (UPDATED RECOMMENDATION)

**Strategy:** Windows ARM64 users download and run the **x64-baseline** binary via Prism emulation. The binary is compiled with `--target=bun-windows-x64-baseline` using Bun >= v1.3.11, which guarantees no AVX/AVX2 instructions are present.

**Risk (previously critical, now low):** The original crash reports ([#21869](https://github.com/oven-sh/bun/issues/21869)) were from Bun v1.2.19, where AVX instructions leaked into baseline builds. This leak is now closed by PR #27801 (static AVX verifier, merged Mar 11, 2026). The remaining risk is that no one has publicly confirmed a `bun build --compile --target=bun-windows-x64-baseline` standalone binary running on ARM64 Windows — so empirical validation is still recommended.

**Key requirement:** The CI build environment must use **Bun >= v1.3.11** to get the static AVX verifier. Without this version guarantee, baseline builds may still contain AVX instructions.

**Changes needed:**

1. **`install.ps1`** — Map ARM64 to download x64 binary:
   ```powershell
   "ARM64" {
     Write-Info "ARM64 detected — installing x64 binary (runs via Prism emulation)"
     $Target = "windows-x64.exe"
   }
   ```

2. **`build-binary.ts`** — Add `inferTargetArch()` and ARM64 Windows guard (error on explicit `--target=bun-windows-arm64`, auto-remap on implicit)

3. **`publish.yml`** — Change the Windows build target from `bun-windows-x64` (standard) to `bun-windows-x64-baseline`. This is the critical change — using the standard x64 target will crash under Prism. Ensure the CI runner uses Bun >= v1.3.11.

4. **`download.ts`** — No changes needed. x64 binary reports `process.arch === "x64"` → self-update downloads `atomic-windows-x64.exe`.

**Pros:** `bun:ffi` works (TinyCC x64 backend included), AVX-free (verified by Bun CI), no additional build artifacts needed, single x64 binary serves both x64 and ARM64 users.
**Cons:** Performance overhead from Prism emulation, not "true" ARM64 support, `bun-windows-x64-baseline` may have slightly lower performance than standard x64 on native x64 machines (no AVX optimizations).

**Important tradeoff:** Using `bun-windows-x64-baseline` instead of `bun-windows-x64` means native x64 Windows users also lose AVX optimizations. If this is a concern, the CI can produce two Windows binaries: `bun-windows-x64` (for native x64) and `bun-windows-x64-baseline` (for ARM64 via Prism). However, this adds complexity and a second artifact. For now, shipping baseline-only is simpler and the performance difference is likely negligible for a TUI application.

#### Approach B: Ship dedicated ARM64 artifact (x64 binary labeled as ARM64)

Same as Approach A but names the x64 binary `atomic-windows-arm64.exe`. Same Prism crash risk applies. **Rejected by spec** due to confusing naming and self-update mismatch.

#### Approach C: Ship true native ARM64 binary (Future — blocked on Bun #28055)

**Strategy:** Wait for Bun to fix TinyCC/FFI on ARM64 Windows, then ship a real ARM64 binary.

**Tracking issue:** [Bun #28055 - "Support bun:ffi on Windows ARM64"](https://github.com/oven-sh/bun/issues/28055) (Open, no milestone)

**Community progress:** A contributor (@bold84) has stated they are working on TinyCC Windows ARM64 support, but no PR has been submitted yet.

**When viable:** When Bun ships `bun:ffi` `dlopen()` support for ARM64 Windows (no timeline available).

**Changes needed (future):**
1. `publish.yml` — Add `--target=bun-windows-arm64` build step
2. Release files — Add `atomic-windows-arm64.exe`
3. `build-binary.ts` — Remove ARM64 Windows guard
4. `install.ps1` — Revert ARM64 → x64 remap
5. `prepare-opentui-bindings.ts` — Re-add `win32-arm64` to `DEFAULT_PLATFORMS`
6. All existing code (download.ts, self-update) already handles ARM64

**Pros:** Native performance, no emulation, no AVX/SIMD issues.
**Cons:** Blocked on upstream, no timeline.

#### Approach D: Ship x64-baseline binary + validate on hardware (CURRENT RECOMMENDATION)

**Strategy:** Proceed with Approach A (x64-baseline binary for ARM64 users) and validate on ARM64 hardware:

1. Implement all Approach A changes on the feature branch, using `--target=bun-windows-x64-baseline` as the compile target
2. **Ensure CI uses Bun >= v1.3.11** — this is required for the static AVX verifier (PR #27801) to guarantee the baseline binary is AVX-free
3. Before merging, test the x64-baseline binary on actual ARM64 Windows hardware (Snapdragon X Elite, etc.):
   - Does `atomic.exe` (x64-baseline standalone compiled binary) launch without crashing under Prism?
   - Does `bun:ffi` / `dlopen()` work (OpenTUI native renderer loads)?
   - Does the TUI render correctly?
   - Do basic operations (chat, init, update) work?
4. If testing passes → merge and ship
5. If testing fails → hold the feature; document as "Windows ARM64 not yet supported; blocked on Bun #28055"; update `install.ps1` to show a clear unsupported error instead of a 404

**Why this is now lower risk than before:** The AVX leak that caused the v1.2.19 crashes is fixed by a static verifier (PR #27801) — not by a code change that "might have helped." The verifier is a CI-level hard gate that fails the entire Bun build if AVX leaks in. This is a fundamentally different risk profile than "maybe the SIMD fallback paths improved."

**Bun version pinning:** Consider pinning the CI Bun version to >= v1.3.11 in `publish.yml` or a `.bun-version` file to prevent accidental regression if a CI update reverts to an older Bun.

### 5. Build Script Changes Required (for any approach)

#### 5.1 Add `inferTargetArch()` to `build-binary.ts`

```typescript
function inferTargetArch(target?: string): NodeJS.Architecture {
  if (!target) {
    // On Windows ARM64, default to x64 due to TinyCC limitation
    if (process.platform === "win32" && process.arch === "arm64") {
      return "x64";
    }
    return process.arch;
  }

  const normalizedTarget = target.toLowerCase();
  if (normalizedTarget.includes("arm64") || normalizedTarget.includes("aarch64")) {
    return "arm64";
  }
  if (normalizedTarget.includes("x64") || normalizedTarget.includes("x86_64")) {
    return "x64";
  }

  throw new Error(`Unable to infer target arch from --target ${target}`);
}
```

#### 5.2 Add `process.platform`/`process.arch` defines

In the `Bun.build()` call, extend the `define` object:

```typescript
const compileTargetArch = inferTargetArch(options.target);

define: {
  OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(`${getBunfsRoot(compileTargetOs)}${workerRelativePath}`),
  "process.platform": JSON.stringify(compileTargetOs),
  "process.arch": JSON.stringify(compileTargetArch),
},
```

**CAUTION:** Defining `process.platform` and `process.arch` globally at bundle time will affect ALL code that reads these values — including `download.ts`'s `getBinaryFilename()`, `isWindows()`, and other runtime detection. This may be desired for cross-compilation correctness, but needs careful testing to ensure the self-update mechanism and other platform-conditional logic continues to work correctly.

**Alternative:** Use a more targeted approach — define a custom variable like `__OPENTUI_PLATFORM__` and `__OPENTUI_ARCH__` that only affects the OpenTUI binding resolution, leaving `process.platform` and `process.arch` as runtime values.

#### 5.3 Construct effective target for Bun compilation

When `inferTargetArch()` remaps the arch (e.g., arm64 → x64 on Windows), construct the correct compile target:

```typescript
const effectiveTarget = options.target
  ? options.target
  : (compileTargetArch !== process.arch
    ? `bun-${compileTargetOs === "win32" ? "windows" : compileTargetOs}-${compileTargetArch}`
    : undefined);
```

### 6. Installer Validation Workflow

`.github/workflows/installer-validation.yml` validates syntax of both `install.sh` and `install.ps1` on PRs. Any changes to `install.ps1` will be automatically validated (ShellCheck for bash, PSScriptAnalyzer for PowerShell).

Currently only runs on `ubuntu-latest` and `macos-latest` for shell, and `windows-latest` (x64) for PowerShell. No ARM64 Windows runner available in GitHub Actions, so ARM64-specific installer behavior cannot be CI-tested directly.

---

## Code References

- `.github/workflows/publish.yml:101-126` — Windows build job (x64 only)
- `.github/workflows/publish.yml:188-196` — Release files list (missing arm64)
- `src/scripts/build-binary.ts:45-65` — `inferTargetOs()` (no `inferTargetArch()`)
- `src/scripts/build-binary.ts:80-92` — `Bun.build()` call (missing platform/arch defines)
- `src/scripts/prepare-opentui-bindings.ts:7-13` — `DEFAULT_PLATFORMS` (includes `win32-arm64`)
- `node_modules/@opentui/core/index-nkrr8a4c.js:11227` — Dynamic platform binding import
- `node_modules/@opentui/core/index-nkrr8a4c.js:11291` — `dlopen()` call
- `install.ps1:199-208` — ARM64 architecture detection
- `src/services/system/download.ts:307-339` — `getBinaryFilename()` self-update logic
- `src/services/system/detect.ts:53-55` — `isWindows()` helper

## Architecture Documentation

### Build Pipeline Flow
```
prepare-opentui-bindings.ts    build-binary.ts              publish.yml
        │                            │                           │
  Fetches ALL platform      Compiles Bun standalone      Orchestrates builds
  native bindings from      binary with embedded          & publishes to
  npm registry              entrypoints + assets          GitHub Releases
        │                            │                           │
  darwin-x64              Infers target OS from           build (ubuntu-latest):
  darwin-arm64            --target flag                     linux-x64
  linux-arm64             Detects baseline from             linux-arm64
  win32-x64               --target flag                     darwin-x64
  win32-arm64             Injects __ATOMIC_BASELINE__       darwin-arm64
                          build-time flag when baseline
                                                          build-windows (windows-latest):
                                                            windows-x64 (standard, native)
                                                            windows-x64-baseline (AVX-free)

                                                          release:
                                                            downloads binaries +
                                                            binaries-windows artifacts
```

### Self-Update Flow
```
updateCommand()
  └─► getBinaryFilename()
        └─► process.platform + process.arch (RUNTIME values)
              └─► "atomic-windows-x64.exe" (x64 host or Prism)
              └─► "atomic-windows-arm64.exe" (native ARM64 — broken)
```

## Historical Context (from research/)

- `research/docs/2026-01-21-update-uninstall-commands.md:654` — "Windows ARM64: Currently not supported in builds. Add if there's demand."
- `research/docs/2026-02-25-skills-directory-structure.md:819-822` — Documents platform detection in installer

## Related Research

- `specs/windows-arm64-support.md` — **Comprehensive technical design document** (Draft/WIP, created 2026-03-20). Covers the selected approach (Approach C in the spec: ARM64-to-x64 remapping), detailed code changes for `install.ps1`, `build-binary.ts`, `install.sh`, and `prepare-opentui-bindings.ts`, plus test plan and rollback strategy.
- `specs/cross-platform-support.md` — Cross-Platform Support Technical Design Document (Draft/WIP)
- `research/docs/2026-01-20-cross-platform-support.md` — Cross-Platform Compatibility Analysis
- `research/docs/2026-01-21-update-uninstall-commands.md` — Update/uninstall command architecture
- `research/docs/2026-01-21-binary-distribution-installers.md` — Original installer design; first raised ARM64 as open question
- `research/docs/2026-02-12-opentui-distribution-ci-fix.md` — OpenTUI distribution; `optionalDependencies` pattern and `prepare-opentui-bindings` script origin
- `research/docs/2026-02-25-install-postinstall-analysis.md` — Installation and Postinstall Infrastructure Analysis
- `research/docs/2026-01-31-opentui-library-research.md` — OpenTUI FFI architecture; `bun:ffi` + Zig native layer
- `research/docs/2026-03-03-bun-migration-startup-optimization.md` — Bun build optimization context

## Existing Spec

A comprehensive spec already exists at `specs/windows-arm64-support.md` that selects **Approach A (ARM64-to-x64 remapping)** as the solution. Key decisions already resolved in the spec:

1. **`install.ps1`**: Remap ARM64 to x64 with informational message + Windows 10 build version warning
2. **`build-binary.ts`**: Add `inferTargetArch()` + ARM64 Windows guard (error on explicit `--target=bun-windows-arm64`, auto-remap on implicit)
3. **`install.sh`**: Fix Windows delegation to pass version/prerelease args (pre-existing bug, optional for this PR)
4. **`prepare-opentui-bindings.ts`**: Remove `win32-arm64` from `DEFAULT_PLATFORMS` (avoids downloading unused binding in CI)
5. **`publish.yml`**: No changes required — CI already produces the needed x64 binary

The spec also notes that when `--target` is set, Bun's `CompileTarget.defineValues()` automatically sets `process.platform` and `process.arch` at bundle time, resolving the concern about global defines affecting runtime detection code. This means the simpler approach (just setting `--target=bun-windows-x64`) handles the OpenTUI binding resolution without needing custom defines.

**SPEC GAPS (to be updated):**
1. The spec does not specify `bun-windows-x64-baseline` as the compile target — it uses the standard `bun-windows-x64`. **Must be changed to `bun-windows-x64-baseline`** to avoid AVX crashes under Prism.
2. The spec does not specify a minimum Bun version requirement. **Must require Bun >= v1.3.11** in CI for the static AVX verifier (PR #27801).
3. The spec should include a hardware validation gate before merge (Approach D in this research).
4. The spec should note the baseline performance tradeoff for native x64 users (likely negligible for a TUI app).

## Open Questions

1. **~~CRITICAL~~ RESOLVED — Prism/AVX viability:** ~~Does the x64 standalone compiled binary actually run under Prism on ARM64 Windows?~~ **Confirmed fixed (2026-03-29).** Bun issue #21869 is resolved — the baseline binary works on ARM64 Windows. The AVX leak that caused crashes in v1.2.19 was fixed by PR #27801's static verifier (Bun >= v1.3.11). The correct compile target is `bun-windows-x64-baseline` (NOT `bun-windows-x64`).

2. **TinyCC timeline:** When will Bun add `bun:ffi` support for ARM64 Windows? Tracked in [Bun #28055](https://github.com/oven-sh/bun/issues/28055). A community contributor (@bold84) is working on TinyCC Windows ARM64 support but no PR exists yet. No official timeline.

3. **~~`process.platform`/`process.arch` define scope~~** — **Resolved by spec:** When `--target` is set, Bun's `CompileTarget.defineValues()` automatically sets `process.platform` and `process.arch` at bundle time.

4. **~~Cross-compilation viability~~** — **Resolved (2026-03-29).** Decision: keep native Windows builds on `windows-latest`. The `build-windows` job builds both standard and baseline binaries natively. Cross-compilation from Linux is possible but native builds avoid edge cases and match the environment users run on.

5. **~~Installer ARM64 UX~~** — **Resolved by spec.**

6. **`install.sh` Windows delegation fix:** Optional for this PR. (See spec Section 5.3.)

7. **~~Fallback if x64 emulation fails~~** — **Largely resolved.** Option (c) — `bun-windows-x64-baseline` — is now the recommended approach. PR #27801 (static AVX verifier) guarantees baseline builds are AVX-free, making them safe under Prism. If empirical testing still somehow fails, fallback to option (a): show a clear "Windows ARM64 not yet supported; blocked on Bun #28055" error.

8. **~~Bun version pinning~~** — **Resolved (2026-03-29).** Decision: keep `bun-version: latest` in CI. This ensures the static AVX verifier (PR #27801, v1.3.11+) is always active, and avoids manual version bumps.

9. **~~Baseline performance tradeoff~~** — **Resolved (2026-03-29).** CI produces two Windows binaries: `atomic-windows-x64.exe` (standard, with AVX for native x64 users) and `atomic-windows-x64-baseline.exe` (AVX-free for ARM64 Prism). Native x64 users get full AVX performance. Both built natively on `windows-latest` in the `build-windows` job.

## External References (from online research)

### Bun Blog Posts & Docs
- [Bun v1.3.10 Blog Post](https://bun.sh/blog/bun-v1.3.10) — ARM64 Windows support announcement (Feb 26, 2026)
- [Bun v1.3.11 Blog Post](https://bun.sh/blog/bun-v1.3.11) — Native ARM64 `.bin` shim fix, latest release as of Mar 18, 2026
- [Bun Standalone Executables Docs](https://bun.sh/docs/bundler/executables) — Full cross-compilation target table (includes `bun-windows-arm64`, `bun-windows-x64-baseline`, etc.)

### GitHub Issues
- [Bun #9824](https://github.com/oven-sh/bun/issues/9824) — Original ARM64 Windows tracking issue (**Closed**, resolved by v1.3.10)
- [Bun #10148](https://github.com/oven-sh/bun/issues/10148) — x64 Bun REPL illegal instruction on ARM64 Windows (**Open**)
- [Bun #15004](https://github.com/oven-sh/bun/issues/15004) — Bunx command fails on ARM64 Windows (**Closed, Not planned**)
- [Bun #21869](https://github.com/oven-sh/bun/issues/21869) — x64 Bun crashes under Prism emulation due to AVX/SIMD in `highway.zig` (**Open**, but superseded by native ARM64 support + baseline AVX verifier)
- [Bun #24309](https://github.com/oven-sh/bun/issues/24309) — Crash installing on Snapdragon X Elite (**Closed, Duplicate**)
- [Bun #28055](https://github.com/oven-sh/bun/issues/28055) — "Support bun:ffi on Windows ARM64" (**Open**, no milestone — blocks native ARM64 path)

### GitHub PRs (key fixes for our approach)
- [Bun PR #26215](https://github.com/oven-sh/bun/pull/26215) — Implementation PR for ARM64 Windows (LLVM 21.1.8, Highway NEON, TinyCC disabled)
- [Bun PR #27121](https://github.com/oven-sh/bun/pull/27121) — **CI: Add Intel SDE baseline verification for Windows** (merged Feb 21, 2026). Catches AVX usage in baseline builds via CI.
- [Bun PR #27290](https://github.com/oven-sh/bun/pull/27290) — Fix DeadSocket alignment crash on Windows ARM64 (merged Feb 20, 2026)
- [Bun PR #27434](https://github.com/oven-sh/bun/pull/27434) — Fix standalone worker dotenv crash on Windows (merged Feb 26, 2026)
- [Bun PR #27448](https://github.com/oven-sh/bun/pull/27448) — Compile Windows `.bin` shim for native arch on aarch64 (merged Mar 2, 2026)
- [Bun PR #27801](https://github.com/oven-sh/bun/pull/27801) — **Add static baseline CPU instruction verifier** (merged Mar 11, 2026). **This is the critical fix** — scans compiled binaries and fails CI if ANY AVX/AVX2 instructions are found in baseline builds. Guarantees `bun-windows-x64-baseline` is safe under Prism.

### TinyCC
- [TinyCC Git Repository](https://repo.or.cz/tinycc.git) — No Windows ARM64 backend. Supports: x86, x86_64, ARM (32-bit), AArch64 (Linux only). No open PRs for Windows ARM64 support as of March 20, 2026.
