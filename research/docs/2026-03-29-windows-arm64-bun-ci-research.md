---
date: 2026-03-29 19:07:47 UTC
researcher: Claude Code
git_commit: d8fe65629453393e8136ac4fc92344e05ab879ce
branch: flora131/feature/windows-arm64
repository: atomic
topic: "Windows ARM64 via Bun: baseline builds, dual-binary strategy, CI structure, and native binding compatibility"
tags: [research, codebase, windows, arm64, bun, baseline, avx, prism, ci, opentui, cross-compilation]
status: complete
last_updated: 2026-03-29
last_updated_by: Claude Code
---

# Research: Windows ARM64 via Bun — Baseline Builds, Dual-Binary Strategy, CI Structure, and Native Binding Compatibility

## Research Question

Comprehensive investigation of six interconnected topics for Windows ARM64 support in Atomic CLI:

1. Is `bun-windows-x64-baseline` (no AVX) the correct target for ARM64 compatibility via Windows' Prism emulation?
2. Should we ship one or two Windows binaries (single baseline vs dual standard+baseline)?
3. What is the recommended Windows CI runner strategy?
4. How do OpenTUI native bindings interact with Windows ARM64?
5. What CI structure should `publish.yml` use?
6. What is the current implementation state on the feature branch?

## Summary

### Critical Finding: Prism Compatibility Risk

The existing research documents (`2026-03-20-388-389-windows-arm64-support.md`) state that PR #27801's static AVX verifier makes `bun-windows-x64-baseline` viable under Prism. However, **Bun issue [#21869](https://github.com/oven-sh/bun/issues/21869) remains OPEN** and the crash reported there may not be purely an AVX leak — the crash metadata shows `Features: no_avx2, no_avx`, indicating the binary correctly detected the absence of AVX but the **non-AVX fallback code path itself** (`highway.zig:103 indexOfChar`) had an assertion failure. Two interpretations exist:

- **Interpretation A** (from existing docs): AVX instructions leaked into baseline builds through `highway.zig`. PR #27801's static verifier eliminates the leak, making baseline safe under Prism.
- **Interpretation B** (from fresh DeepWiki analysis): The crash is in the SSE4.2 fallback path itself — a bug that manifests specifically under Prism emulation. The static AVX verifier would not fix a bug in the non-AVX code path.

The crash was reported against Bun v1.2.19/v1.2.20. PR #27801 was merged in v1.3.11. **No public confirmation exists** of `bun build --compile --target=bun-windows-x64-baseline` running successfully on ARM64 Windows with Bun >= v1.3.11. The issue remaining OPEN (though potentially stale) means empirical validation remains essential.

### Answers to the Six Research Questions

| Question | Finding |
|----------|---------|
| 1. Correct target for ARM64? | `bun-windows-x64-baseline` is the only viable path. Native ARM64 is blocked by TinyCC/`bun:ffi` ([#28055](https://github.com/oven-sh/bun/issues/28055)). Standard x64 crashes under Prism due to AVX. Baseline viability depends on whether #21869 is truly fixed by v1.3.11. |
| 2. One or two binaries? | The branch ships two: `atomic-windows-x64.exe` (standard, AVX) and `atomic-windows-x64-baseline.exe` (AVX-free). Performance difference is negligible for a CLI/TUI app, so a single baseline binary would also work. |
| 3. CI runner strategy? | Keep the `main` branch pattern: `build` on `ubuntu-latest` for Linux/macOS, `build-windows` on `windows-latest` for Windows binaries built natively. Extend `build-windows` to produce both standard and baseline binaries. No need for `windows-11-arm` (public preview, costs money, adds no value for x64 targets). |
| 4. OpenTUI bindings? | x64 bindings work under Prism. Resolution uses `process.platform`/`process.arch` (reports `"x64"` under Prism). No fallback mechanism. No binding-related reason to prefer native builds. |
| 5. CI structure? | Two build jobs matching `main`: `build` on `ubuntu-latest` (Linux/macOS, 4 binaries) and `build-windows` on `windows-latest` (standard + baseline, 2 binaries). `release` downloads both `binaries` and `binaries-windows` artifacts. |
| 6. Implementation state? | All 5 MVP-scope files are implemented. `build-windows` needs to be updated to build both Windows binaries natively and `release` needs to download `binaries-windows` again. 2 deferred items not implemented (as intended). |

---

## Detailed Findings

### 1. Bun Windows ARM64 Support — Baseline vs Standard Builds

**Sources**: DeepWiki analysis of `oven-sh/bun`, GitHub issues #21869, #10148, #28055, PR #27801, PR #26215

#### 1.1 What is `bun-windows-x64-baseline`?

`bun-windows-x64-baseline` is compiled with `-march=nehalem` (1st-gen Intel Core / 2008), targeting SSE4.2. The standard `bun-windows-x64` is compiled with `-march=haswell` (4th-gen / 2013), requiring AVX/AVX2.

| Property | `bun-windows-x64` | `bun-windows-x64-baseline` |
|---|---|---|
| Compiler flag | `-march=haswell` | `-march=nehalem` |
| Minimum CPU | Haswell (2013) | Nehalem (2008) |
| AVX/AVX2 | Required | Guaranteed absent (statically verified) |
| Under Prism | Crashes (AVX unsupported) | Theoretically viable (needs validation) |

#### 1.2 Static AVX Verifier (PR #27801 / Bun v1.3.11)

PR #27801, merged 2026-03-11, introduced `scripts/verify-baseline-static/` — a Rust tool that performs a linear sweep of the binary's `.text` section. For each instruction, it calls `insn.cpuid_features()` and checks against the `NEHALEM_ALLOWED` constant. Violations are compared against an allowlist of symbols that use runtime CPUID dispatch (Highway's `HWY_DYNAMIC_DISPATCH`, simdutf, BoringSSL). Any new post-baseline instruction either needs to be allowlisted (if runtime-dispatched) or represents a real `-march` leak to fix.

Additionally, `scripts/verify-baseline-cpu.sh` uses Intel SDE (for Windows) or QEMU (for Linux) to run the binary on a simulated Nehalem CPU, catching any runtime-emitted instructions.

**Key**: The static verifier guarantees **no AVX/AVX2 instructions exist in baseline builds** (outside of runtime-dispatched functions that gate on CPUID). This is a CI-level hard gate that fails the entire Bun build on violations.

#### 1.3 Performance: Baseline vs Standard

The performance difference comes from SIMD width: AVX/AVX2 operates on 256-bit vectors vs SSE4.2's 128-bit. Affected operations:

- `simdutf` (UTF-8/UTF-16 conversion)
- `highway_strings.cpp` (string search: `indexOfChar`, `memmem`)
- Memory operations (`memcpy`, `memset`)

**Critically**, Highway and simdutf use **runtime dispatch** (`HWY_DYNAMIC_DISPATCH` / `hwy::SupportedTargets()`). On a CPU that supports AVX, even a baseline build will use AVX code paths at runtime. The main loss is in compiler-generated code that cannot be runtime-dispatched.

**For a CLI/TUI application, the performance difference is negligible.** The AVX/AVX2 advantage manifests in heavy string processing, bulk memory operations, and mathematical compute. A CLI/TUI app's bottlenecks are I/O, user interaction latency, and terminal rendering — none of which benefit meaningfully from 256-bit SIMD.

#### 1.4 Known Issues Under Prism Emulation

**Issue [#21869](https://github.com/oven-sh/bun/issues/21869)** — "Bun build crashes on Windows ARM64" — **OPEN**

Filed against Bun v1.2.19 by `@anaisbetts`. Crash stack trace:

```
Bun v1.2.19 on windows x86_64_baseline [BuildCommand]
panic: Internal assertion failure
- highway.zig:103: indexOfChar
- cli.zig:713: start
Features: no_avx2, no_avx
```

On v1.2.20:
```
CPU lacks AVX support. Please consider upgrading to a newer CPU.
panic(main thread): Internal assertion failure
```

**Two interpretations**:

1. **AVX leak interpretation**: AVX instructions leaked into baseline builds through `highway.zig`. The `Features: no_avx2, no_avx` output is Bun detecting the absence of AVX before crashing on a leaked AVX instruction. PR #27801's static verifier closes the leak, making baseline safe under Prism. This is the interpretation in the existing research docs.

2. **Fallback bug interpretation**: The baseline binary correctly detected no AVX and fell back to the SSE4.2 code path, but the SSE4.2 fallback in `highway.zig:103 indexOfChar` has a bug that manifests specifically under Prism emulation (perhaps due to subtle differences in how Prism emulates certain SSE4.2 instructions). The static verifier would not fix this.

**The crash was on v1.2.19/v1.2.20. PR #27801 was merged in v1.3.11 (2026-03-11).** No public report confirms a `bun build --compile --target=bun-windows-x64-baseline` standalone binary running on ARM64 Windows with Bun >= v1.3.11.

**Issue [#10148](https://github.com/oven-sh/bun/issues/10148)** — "Bun REPL does not work on Windows ARM64" — **CLOSED**

Filed against Bun v1.1.3. x64 REPL crashed with "Illegal instruction" on ARM64. Superseded by native ARM64 support (PR #26215).

#### 1.5 Native ARM64 Binary — Blocked

`bun-windows-arm64` is an officially supported compile target since PR #26215 (merged 2026-01-22, Bun v1.3.10). However, **`bun:ffi` is completely disabled on Windows ARM64**:

- `cmake/Options.cmake`: `DEFAULT_ENABLE_TINYCC = OFF` for `WIN32 AND aarch64`
- `src/bun.js/api/ffi.zig`: `cc()`, `callback()`, `dlopen()`, `linkSymbols()` all throw errors when TinyCC is disabled

**Issue [#28055](https://github.com/oven-sh/bun/issues/28055)** — "Support bun:ffi on Windows ARM64" — **OPEN**, no milestone, no assignee. A community contributor (@bold84) has stated they are working on TinyCC ARM64 Windows support, but no PR has been submitted.

#### 1.6 Cross-Compilation Reliability

Cross-compilation is a first-class feature of `bun build --compile`. The process:

1. `CompileTarget.tryFrom()` in `src/compile_target.zig` parses the target string
2. Bun downloads the target-platform Bun binary from npm registry and caches it
3. Bundled application code is embedded into the downloaded binary in a `.bun` PE section
4. `CompileTarget.defineValues()` correctly sets `process.platform` and `process.arch` at bundle time

**Important**: `defineValues()` does NOT differentiate based on the `baseline` flag. Both `bun-windows-x64` and `bun-windows-x64-baseline` set `process.platform = "win32"` and `process.arch = "x64"`. This is correct behavior — the baseline binary runs as an x64 process.

No known issues exist with cross-compiling Windows targets from Linux. The mechanism is straightforward: Bun downloads a pre-built Windows binary and embeds the bundled code.

---

### 2. Single vs Dual Windows Binaries

#### 2.1 Option A — Two Binaries (Current Implementation on Branch)

Ships `atomic-windows-x64.exe` (standard, AVX) and `atomic-windows-x64-baseline.exe` (AVX-free).

- Native x64 users get the standard binary via `install.ps1` (`$Arch = "AMD64"`)
- ARM64 users get the baseline binary via `install.ps1` (`$Arch = "ARM64"`)
- Self-update uses `__ATOMIC_BASELINE__` build-time flag to stay on the correct track

**CI cost**: One additional `bun build --compile` invocation (~30s). One additional release artifact (~80MB).

#### 2.2 Option B — Single Baseline Binary

Ships one `atomic-windows-x64-baseline.exe` for all Windows users.

- Simpler CI, simpler release, no self-update flag needed
- Native x64 users lose AVX in compiler-generated code (but Highway runtime dispatch still uses AVX on capable CPUs)

#### 2.3 Performance Difference Assessment

For a CLI/TUI application like Atomic CLI:

- **Terminal rendering**: Bottlenecked by terminal I/O, not SIMD
- **String processing**: Most strings in a TUI are short (UI labels, messages). AVX advantage manifests at scale (large file parsing)
- **Network I/O**: HTTP handling has some SIMD paths in Bun internals, but throughput is dominated by network latency
- **Runtime dispatch mitigates the gap**: Highway and simdutf use CPUID-gated dispatch, so even a baseline binary uses AVX on capable CPUs for the hottest SIMD functions

**The practical performance difference is negligible for this application.** The main argument for dual binaries is preserving "best possible" optimization for the x64 majority. The main argument against is added complexity (build-time flag, self-update correctness, two artifacts).

The branch currently implements the dual-binary approach. The build-time `__ATOMIC_BASELINE__` discriminator pattern solves the self-update correctness problem cleanly.

---

### 3. Windows CI Runner Strategy

**Sources**: GitHub Docs (`github/docs` repo), GitHub Actions runner pricing docs

#### 3.1 GitHub Actions Windows ARM64 Runners

**`windows-11-arm`** exists in **public preview** (not GA, not beta).

| Property | Value |
|---|---|
| Runner label | `windows-11-arm` |
| Status | Public preview |
| CPU | 4 cores (ARM64) |
| RAM | 16 GB |
| Storage | 14 GB SSD |
| Billing | **Always charged** ($0.008-$0.014/min), even for public repos |
| Stability | Subject to change; not in `actions/runner-images` production repository |

**For Atomic CLI's use case, a Windows ARM64 runner is unnecessary.** Both `bun-windows-x64` and `bun-windows-x64-baseline` targets can be cross-compiled from `ubuntu-latest` using `--target`. An ARM64 runner would only add value for running the compiled binary on ARM64 hardware as an integration test.

#### 3.2 Two-Job Build Pattern (from `main`, Recommended)

The `main` branch uses a two-job pattern that should be preserved and extended:

- **`build`** on `ubuntu-latest`: cross-compiles Linux and macOS binaries (4 total), runs tests and typecheck. Free for public repos.
- **`build-windows`** on `windows-latest`: builds Windows binaries **natively** (no `--target` flag), uploads as `binaries-windows` artifact. Free for public repos.
- **`release`** downloads both `binaries` and `binaries-windows` artifacts.

Native Windows builds avoid any cross-compilation edge cases and match the environment users will actually run the binary on. The `build-windows` job should be extended to build both the standard and baseline Windows binaries.

#### 3.3 Current State on Feature Branch (Needs Correction)

On the feature branch, the CI pattern has diverged from `main`:
- The `build` job was changed to cross-compile all 6 binaries including both Windows ones
- The `build-windows` job still exists but its `binaries-windows` output is never downloaded by the `release` job
- The `release` job still declares `needs: [build, build-windows]`, so it waits for `build-windows` to complete even though its output is discarded

**To fix**: Restore the `main` branch pattern — remove the Windows build lines from the `build` job, extend `build-windows` to build both `atomic-windows-x64.exe` and `atomic-windows-x64-baseline.exe` natively, and restore the `binaries-windows` download step in the `release` job.

---

### 4. OpenTUI Native Binding Compatibility

**Sources**: DeepWiki analysis of `anomalyco/opentui`, local codebase analysis

#### 4.1 Platform-Specific Binding Packages

OpenTUI ships **six** platform-specific optional dependencies (from `@opentui/core` `package.json`):

| Package | DLL/SO | Available |
|---------|--------|-----------|
| `@opentui/core-darwin-x64` | `libopentui.dylib` | Yes |
| `@opentui/core-darwin-arm64` | `libopentui.dylib` | Yes |
| `@opentui/core-linux-x64` | `libopentui.so` | Yes |
| `@opentui/core-linux-arm64` | `libopentui.so` | Yes |
| `@opentui/core-win32-x64` | `opentui.dll` | Yes |
| `@opentui/core-win32-arm64` | `opentui.dll` | Yes (but cannot be loaded — TinyCC blocked) |

The native core is written in **Zig** (not C/TinyCC). The Zig toolchain cross-compiles all 6 variants from any host platform. The DLLs link against `msvcrt.dll` (universally available on Windows).

#### 4.2 FFI/dlopen Dependency Chain

OpenTUI uses `bun:ffi`'s `dlopen` to load the platform-specific DLL:

```typescript
// @opentui/core/index-e89anq5x.js:11771
var module = await import(`@opentui/core-${process.platform}-${process.arch}/index.ts`);
var targetLibPath = module.default;
// ...
const rawSymbols = dlopen(resolvedLibPath, { /* 245 symbol definitions */ });
```

The dependency chain is: **OpenTUI → `bun:ffi` `dlopen` → TinyCC (for JIT FFI bridge compilation) → native DLL**.

**TinyCC is NOT used by OpenTUI directly** — it is used by Bun's FFI subsystem to JIT-compile the call bridge between JavaScript and the native DLL. When TinyCC is disabled (as on `bun-windows-arm64`), `dlopen()` throws regardless of whether the DLL itself is ARM64-native.

#### 4.3 Behavior Under Prism Emulation

When an x64-baseline Bun binary runs under Prism:
- `process.platform` reports `"win32"` and `process.arch` reports `"x64"`
- OpenTUI resolves to `@opentui/core-win32-x64` (the x64 binding)
- Both Bun and the DLL run as x64 processes under Prism — architecture matches
- `bun:ffi` includes TinyCC x86_64 backend — `dlopen` works
- **No fallback mechanism exists**: if the binding doesn't match, OpenTUI throws a fatal error

#### 4.4 Cross-Compilation Considerations

There are **no binding-related reasons to prefer native builds** over cross-compilation:
- The Zig toolchain produces identical binaries regardless of build host
- `bun run prepare:opentui-bindings` downloads all platform bindings from npm
- The `@opentui/core-win32-x64` DLL is a standard C ABI shared library
- No Windows SDK or MSVC toolchain is required

The one consideration is **testing**: while cross-compiled DLLs should be functionally identical, integration testing on actual Windows hardware (especially ARM64) is advisable to verify `dlopen` loading, FFI symbol resolution, and all 245+ native function calls.

#### 4.5 `win32-arm64` Binding in CI

`prepare-opentui-bindings.ts` currently includes `"win32-arm64"` in `DEFAULT_PLATFORMS` (line 12). This downloads `@opentui/core-win32-arm64` during CI even though no binary targets that platform. The spec defers removal to a follow-up PR.

---

### 5. Current Implementation State on Feature Branch

**Sources**: `git diff main...HEAD` analysis

All 5 MVP-scope files from the spec are implemented:

| File | Change | Status |
|------|--------|--------|
| `install.ps1` | ARM64 remaps to `windows-x64-baseline.exe` with info message | Done |
| `.github/workflows/publish.yml` | Dual Windows builds (standard + baseline) in `build` job; baseline added to release files | Done (with orphaned `build-windows`) |
| `src/scripts/build-binary.ts` | `isBaseline` derived from `--target`; `__ATOMIC_BASELINE__` injected via `define` | Done |
| `src/services/system/download.ts` | `getBinaryFilename()` checks `__ATOMIC_BASELINE__` for self-update | Done |
| `install.sh` | Windows delegation passes version/prerelease args; uses `pwsh` | Done |

Two deferred items are NOT implemented (as intended by spec):

| File | Change | Status |
|------|--------|--------|
| `build-binary.ts` | `inferTargetArch()` + ARM64 guard | Deferred |
| `prepare-opentui-bindings.ts` | Remove `win32-arm64` from `DEFAULT_PLATFORMS` | Deferred |

**Three new test files** were added:
- `tests/scripts/build-binary-baseline.test.ts` (87 lines)
- `tests/scripts/install-sh-windows-delegation.test.ts` (239 lines)
- `tests/services/system/download.test.ts` (152 lines)

**Divergences from spec / `main` branch**:
1. `install.sh` uses `pwsh` (PowerShell 7+) instead of `powershell` as shown in spec Section 5.3
2. `publish.yml` diverges from the `main` branch pattern: Windows binaries are cross-compiled in the `build` job instead of built natively in `build-windows`. The `build-windows` job still runs but its `binaries-windows` artifact is never downloaded by `release`. Needs to be corrected to match the `main` pattern (see Section 3.3 and 6).

---

### 6. Recommended CI Structure

Based on all findings, the CI should preserve the two-job pattern from `main` and extend `build-windows` to produce both Windows binaries.

#### 6.1 Build Jobs

**`build` job on `ubuntu-latest`** — cross-compiles Linux and macOS binaries (4 total):

```yaml
# Linux x64
bun run src/scripts/build-binary.ts --minify --target=bun-linux-x64 --outfile dist/atomic-linux-x64
# Linux arm64
bun run src/scripts/build-binary.ts --minify --target=bun-linux-arm64 --outfile dist/atomic-linux-arm64
# macOS x64
bun run src/scripts/build-binary.ts --minify --target=bun-darwin-x64 --outfile dist/atomic-darwin-x64
# macOS arm64
bun run src/scripts/build-binary.ts --minify --target=bun-darwin-arm64 --outfile dist/atomic-darwin-arm64
```

**`build-windows` job on `windows-latest`** — builds both Windows binaries natively (no `--target` flag needed for standard; baseline uses `--target=bun-windows-x64-baseline`):

```yaml
# Windows x64 (standard, with AVX — native build, no --target)
bun run src/scripts/build-binary.ts --minify --outfile dist/atomic-windows-x64.exe
# Windows x64-baseline (AVX-free, for ARM64 Prism compatibility)
bun run src/scripts/build-binary.ts --minify --target=bun-windows-x64-baseline --outfile dist/atomic-windows-x64-baseline.exe
```

The standard binary is built natively (matching the `main` branch pattern). The baseline binary uses `--target=bun-windows-x64-baseline` to produce the AVX-free variant from the same Windows runner. Both are uploaded as the `binaries-windows` artifact.

#### 6.2 Release Job

Single `release` job with `needs: [build, build-windows]`. Downloads both `binaries` and `binaries-windows` artifacts. Release files:

```yaml
files: |
  dist/atomic-linux-x64
  dist/atomic-linux-arm64
  dist/atomic-darwin-x64
  dist/atomic-darwin-arm64
  dist/atomic-windows-x64.exe
  dist/atomic-windows-x64-baseline.exe
  dist/atomic-config.tar.gz
  dist/atomic-config.zip
  dist/checksums.txt
```

Checksums auto-include both Windows binaries via `sha256sum *`.

#### 6.3 Binary Names in Release

| Binary | Target | Use Case |
|--------|--------|----------|
| `atomic-linux-x64` | `bun-linux-x64` | Linux x64 |
| `atomic-linux-arm64` | `bun-linux-arm64` | Linux ARM64 |
| `atomic-darwin-x64` | `bun-darwin-x64` | macOS Intel |
| `atomic-darwin-arm64` | `bun-darwin-arm64` | macOS Apple Silicon |
| `atomic-windows-x64.exe` | `bun-windows-x64` | Windows x64 (native) |
| `atomic-windows-x64-baseline.exe` | `bun-windows-x64-baseline` | Windows ARM64 (via Prism) |

---

## Code References

### Bun (oven-sh/bun)
- `src/compile_target.zig` — `CompileTarget.tryFrom()`, `defineValues()`, `defineKeys()`, `isSupported()`
- `cmake/Options.cmake` — `DEFAULT_ENABLE_TINYCC` logic (disabled for `WIN32 AND aarch64`)
- `scripts/verify-baseline-static/src/main.rs` — Static ISA verifier (Rust)
- `scripts/verify-baseline-static/allowlist-x64.txt` — Allowlist for x64 baseline
- `scripts/verify-baseline-static/allowlist-x64-windows.txt` — Windows-specific allowlist
- `src/highway.zig:103` — `indexOfChar` crash site under Prism
- `src/bun.js/api/ffi.zig` — FFI implementation (throws when TinyCC disabled)

### Atomic CLI (this repo)
- `.github/workflows/publish.yml` — `build` job (Linux/macOS cross-compilation) and `build-windows` job (native Windows builds, to be extended with baseline)
- `src/scripts/build-binary.ts:79` — `isBaseline` derivation
- `src/scripts/build-binary.ts:92` — `__ATOMIC_BASELINE__` injection via `define`
- `src/services/system/download.ts:296` — `declare const __ATOMIC_BASELINE__`
- `src/services/system/download.ts:341-344` — `baselineSuffix` logic in `getBinaryFilename()`
- `src/scripts/prepare-opentui-bindings.ts:12` — `win32-arm64` in `DEFAULT_PLATFORMS`
- `install.ps1:243-246` — ARM64 remapping to `windows-x64-baseline.exe`
- `install.sh:364-385` — Windows delegation with `pwsh` and arg passing

### OpenTUI (anomalyco/opentui)
- `node_modules/@opentui/core/index-e89anq5x.js:11771` — Dynamic platform binding import
- `node_modules/@opentui/core/index-e89anq5x.js:11835` — `dlopen()` call with 245 FFI symbols
- `node_modules/@opentui/core/package.json:65-76` — Six `optionalDependencies` binding packages
- `packages/core/src/zig/build.zig` — Zig cross-compilation targets including `x86_64-windows-gnu` and `aarch64-windows-gnu`

## Architecture Documentation

### Build-Time Discriminator Pattern (Strategy)

```
                    Build Time                          Runtime (Self-Update)
                    ----------                          ---------------------

  publish.yml                                     download.ts
  +-----------------------------------------+     +------------------------------------+
  | --target=bun-windows-x64                |     | getBinaryFilename()                |
  |   build-binary.ts:                      |     |   __ATOMIC_BASELINE__ undefined    |
  |     isBaseline = false                  | --> |   -> "atomic-windows-x64.exe"      |
  |     define: {} (no flag)                |     +------------------------------------+
  |   -> atomic-windows-x64.exe (AVX)      |
  +-----------------------------------------+
                                                  +------------------------------------+
  +-----------------------------------------+     | getBinaryFilename()                |
  | --target=bun-windows-x64-baseline       |     |   __ATOMIC_BASELINE__ = true       |
  |   build-binary.ts:                      | --> |   -> "atomic-windows-x64-baseline  |
  |     isBaseline = true                   |     |       .exe"                        |
  |     define: {__ATOMIC_BASELINE__: true} |     +------------------------------------+
  |   -> atomic-windows-x64-baseline.exe    |
  +-----------------------------------------+
```

### Why Build-Time, Not Runtime Detection

Under Prism emulation, `process.arch === "x64"` and `process.platform === "win32"` — identical to native x64. There is no reliable runtime signal to distinguish the two environments. The build-time flag is the only deterministic discriminator.

### OpenTUI FFI Dependency Chain

```
OpenTUI JavaScript    bun:ffi         TinyCC           Native DLL
+-----------------+  +------------+  +-----------+    +---------------+
| dlopen(path,    |->| JIT bridge |->| x86_64    |    | opentui.dll   |
|   {245 symbols})|  | compilation|  | backend   |    | (Zig-compiled)|
+-----------------+  +------------+  +-----------+    +---------------+
                          |
                          v
                     Requires TinyCC
                     (disabled on
                      win32-arm64)
```

## Historical Context (from research/)

- `research/docs/2026-03-20-388-389-windows-arm64-support.md` — Primary ARM64 research. Documents TinyCC/`bun:ffi` limitation, AVX/Prism constraints, Bun v1.3.10/v1.3.11 impact. **States x64-baseline path is "now viable" based on PR #27801 resolving the AVX leak.** See Critical Finding above for nuance.
- `research/docs/2026-03-23-dual-binary-windows-approach.md` — Detailed mechanics of the dual-binary strategy, `__ATOMIC_BASELINE__` build-time discriminator, self-update flow, and `publish.yml` artifact pipeline.
- `research/docs/2026-01-21-binary-distribution-installers.md` — Original installer design. First raised ARM64 as an open question. Documents `install.sh`/`install.ps1` architecture, checksum verification, PATH auto-modification.
- `specs/windows-arm64-support.md` — Full technical design document (Draft/WIP). Covers selected approach (dual-binary with `__ATOMIC_BASELINE__`), alternatives considered, deployment plan, test plan, and future native ARM64 path.
- `research/docs/2026-02-12-opentui-distribution-ci-fix.md` — OpenTUI `optionalDependencies` pattern and `prepare-opentui-bindings` script origin.
- `research/docs/2026-01-31-opentui-library-research.md` — OpenTUI FFI architecture; `bun:ffi` + Zig native layer.

## Related Research

- `specs/windows-arm64-support.md` — Spec driving this implementation
- `research/docs/2026-03-20-388-389-windows-arm64-support.md` — Primary ARM64 research
- `research/docs/2026-03-23-dual-binary-windows-approach.md` — Dual-binary mechanics

## External References

### Bun Issues and PRs
| Reference | Status | Description |
|-----------|--------|-------------|
| [Bun #28055](https://github.com/oven-sh/bun/issues/28055) | Open | Support bun:ffi on Windows ARM64 (blocks native ARM64) |
| [Bun #21869](https://github.com/oven-sh/bun/issues/21869) | Open | x64 Bun crashes under Prism (highway.zig indexOfChar) |
| [Bun #10148](https://github.com/oven-sh/bun/issues/10148) | Closed | Bun REPL illegal instruction on ARM64 Windows |
| [Bun #9824](https://github.com/oven-sh/bun/issues/9824) | Closed | Original ARM64 Windows tracking (resolved by v1.3.10) |
| [Bun PR #27801](https://github.com/oven-sh/bun/pull/27801) | Merged (2026-03-11) | Static baseline CPU instruction verifier |
| [Bun PR #27121](https://github.com/oven-sh/bun/pull/27121) | Merged (2026-02-21) | CI baseline verification for Windows (Intel SDE) |
| [Bun PR #26215](https://github.com/oven-sh/bun/pull/26215) | Merged (2026-01-22) | ARM64 Windows support |
| [Bun PR #27290](https://github.com/oven-sh/bun/pull/27290) | Merged (2026-02-20) | Fix DeadSocket alignment crash on Windows ARM64 |
| [Bun PR #27434](https://github.com/oven-sh/bun/pull/27434) | Merged (2026-02-26) | Fix standalone worker dotenv crash on Windows |

### GitHub Actions
| Resource | Detail |
|----------|--------|
| `windows-11-arm` runner | Public preview, 4 cores ARM64, 16GB RAM, always billed |
| `windows-latest` runner | GA, x64, free for public repos |
| `ubuntu-latest` runner | GA, x64, free for public repos |

### TinyCC
- [TinyCC Git Repository](https://repo.or.cz/tinycc.git) — No Windows ARM64 backend. Supports x86, x86_64, ARM (32-bit), AArch64 (Linux only).

## Open Questions

1. **Empirical Prism validation**: No public report confirms `bun build --compile --target=bun-windows-x64-baseline` standalone binary running on ARM64 Windows with Bun >= v1.3.11. Bun issue #21869 remains open. Testing on actual ARM64 hardware (Snapdragon X Elite, etc.) is essential before shipping with confidence.

2. **Is #21869 fixed in v1.3.11?**: The crash was on v1.2.19/v1.2.20. If Interpretation A (AVX leak) is correct, PR #27801 fixes it. If Interpretation B (fallback bug) is correct, it may persist. The issue has no resolution comment or close date.

3. **Baseline binary on `windows-latest`**: The `build-windows` job builds the standard binary natively (no `--target`). For the baseline binary, it must use `--target=bun-windows-x64-baseline` from the same Windows runner. Verify that this cross-target build works correctly on `windows-latest` (i.e., Bun on Windows can produce a baseline-targeted binary using `--target`).

4. **TinyCC timeline for native ARM64**: Issue #28055 has no milestone. A community contributor is working on it but no PR exists. No timeline available.

5. **Bun version pinning strategy**: The branch uses `bun-version: latest` in CI. This ensures the static AVX verifier is always active (introduced v1.3.11), but introduces risk of unexpected Bun regressions. A minimum version pin (e.g., `>= 1.3.11`) would be safer but requires manual bumps.
