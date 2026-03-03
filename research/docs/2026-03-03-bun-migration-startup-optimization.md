---
date: 2026-03-03 05:09:00 UTC
researcher: Copilot
git_commit: f1dad180ce9235cb0170787803115a911bddd6be
branch: lavaman131/feature/perf
repository: atomic
topic: "Bun Migration & CLI Startup Time Optimization"
tags: [research, codebase, bun, migration, performance, startup-time, copilot-sdk, node-js]
status: complete
last_updated: 2026-03-03
last_updated_by: Copilot
---

# Research: Bun Migration & CLI Startup Time Optimization

## Research Question

Document all current Node.js dependencies and usages across the Atomic CLI codebase. Identify which can be migrated to Bun-native APIs/runtime and which cannot (specifically the Copilot SDK spawning via `node` due to its hard requirement on `node:sqlite`). Additionally, document the current CLI startup path and identify opportunities to optimize startup time using Bun-specific features. The only thing that must remain using Node.js is the Copilot SDK subprocess spawning.

## Summary

The Atomic CLI is already a **Bun-first project** — all scripts, tests, builds, and the runtime use Bun. However, the codebase still heavily uses **`node:*` protocol imports** (70+ import statements across 35+ files) and **`process.*` APIs** (308 instances across 50+ files). Most of these are Bun-compatible (Bun polyfills them), but many have **faster Bun-native alternatives**. The sole hard Node.js requirement is the **Copilot SDK subprocess**, which depends on `node:sqlite` — an experimental Node.js built-in that Bun does not support. The CLI startup is already well-optimized with lazy loading (only 6 modules / ~36KB loaded eagerly), but further gains are possible via Bun-specific APIs.

---

## Detailed Findings

### 1. Node.js `node:*` Protocol Imports (Migration Candidates)

The codebase uses 70+ `node:*` import statements. Here is the breakdown by module:

#### 1.1 `node:fs` / `node:fs/promises` — 31 files

**Most common usages:**
- `existsSync`, `readFileSync`, `writeFileSync`, `mkdirSync`, `readdirSync`, `rmSync`, `statSync`
- `mkdir`, `readFile`, `writeFile`, `readdir`, `unlink`, `rm` (promises)

**Key files:**
- `src/utils/settings.ts:12` — `readFileSync`, `writeFileSync`, `mkdirSync`, `existsSync`
- `src/utils/mcp-config.ts:10` — `readFileSync`
- `src/ui/chat.tsx:69` — `readdirSync`, `readFileSync`
- `src/ui/commands/skill-commands.ts:34` — multiple fs imports
- `src/ui/utils/mention-parsing.ts:1` — `readdirSync`, `readFileSync`, `statSync`
- `src/ui/utils/conversation-history-buffer.ts:17` — multiple fs imports
- `src/ui/utils/command-history.ts:7` — multiple fs imports
- `src/workflows/graph/checkpointer.ts:15` — `mkdir`, `readFile`, `writeFile`, `readdir`, `unlink`, `rm`
- `src/sdk/clients/copilot.ts:36` — `existsSync`
- `src/sdk/clients/claude.ts:61` — `existsSync`

**Bun-native alternatives:**
- `Bun.file(path).text()` / `Bun.file(path).json()` — async file reading (2x faster)
- `Bun.write(path, data)` — async file writing
- `existsSync` → Bun supports `node:fs` natively, but `Bun.file(path).exists()` is also available (async)
- For sync operations, `node:fs` sync functions work in Bun and are acceptable

**Migration safety:** ✅ Safe to migrate — Bun's `node:fs` compatibility is complete, and `Bun.file`/`Bun.write` are drop-in upgrades for async patterns.

#### 1.2 `node:path` — 25 files

**Most common usages:** `join`, `dirname`, `basename`

**Key files:**
- Used in nearly every module for path construction
- `src/utils/settings.ts:13`, `src/config/index.test.ts:4`, `src/ui/chat.tsx:70`, etc.

**Bun-native alternatives:**
- Bun provides **100% node:path compatibility** — no migration needed
- Additional: `import.meta.dir` (replaces `__dirname`), `import.meta.file` (replaces `__filename`), `import.meta.path` (absolute path)

**Migration safety:** ✅ No migration needed — `node:path` works identically in Bun.

#### 1.3 `node:child_process` — 2 files

**Usages:**
- `src/sdk/clients/copilot.ts:37` — `execSync` for `which node` / `where node`
- `src/sdk/clients/claude.ts:60` — `execSync` for `which claude` / `where claude`

**Bun-native alternatives:**
- `Bun.which("node")` — resolves binary paths (replaces `which`/`where` + `execSync`)
- `Bun.spawn()` / `Bun.spawnSync()` — 60% faster subprocess spawning using `posix_spawn(3)`

**Migration safety:** ✅ Safe — `Bun.which()` is a direct replacement for the `execSync("which ...")` pattern. `Bun.spawn` replaces `child_process.spawn`.

#### 1.4 `node:url` — 2 files

**Usages:**
- `src/sdk/clients/copilot.ts:39` — `fileURLToPath` for `import.meta.resolve()` URLs
- `src/sdk/clients/claude.ts:63` — `fileURLToPath` for the same

**Bun-native alternatives:**
- Bun supports `node:url` natively
- `import.meta.dir` and `import.meta.path` can replace many `fileURLToPath(import.meta.resolve(...))` patterns

**Migration safety:** ✅ Safe — both approaches work.

#### 1.5 `node:os` — 15 files

**Most common usages:** `homedir()`, `tmpdir()`

**Key files:**
- `src/utils/settings.ts:14` — `homedir()`
- `src/sdk/clients/copilot.ts:40` — `homedir()`
- `src/ui/commands/agent-commands.ts:17` — `homedir()`
- Multiple test files use `tmpdir()`

**Bun-native alternatives:**
- Bun supports `node:os` natively — no change needed
- `process.env.HOME` / `process.env.USERPROFILE` work as alternatives to `homedir()`

**Migration safety:** ✅ No migration needed — works identically.

---

### 2. Copilot SDK Node.js Hard Requirement (CANNOT Migrate)

#### 2.1 The Problem

The Copilot SDK (`@github/copilot-sdk` v0.1.29) spawns the Copilot CLI as a subprocess. The CLI depends on **`node:sqlite`**, an experimental Node.js built-in module that **Bun does not support**.

#### 2.2 Current Workaround

**Location:** `src/sdk/clients/copilot.ts:320-373`

The codebase implements a workaround in `buildSdkOptions()`:

1. Resolves the **Node.js binary path** via `resolveNodePath()` (uses `which node` / `where node`)
2. Resolves the **bundled Copilot CLI `index.js`** via `getBundledCopilotCliPath()`
3. Sets `cliPath` to the Node.js binary (not Bun)
4. Prepends `--no-warnings` and the CLI path to `cliArgs`
5. Result: SDK spawns `node --no-warnings /path/to/@github/copilot/index.js`

**Key code** (`src/sdk/clients/copilot.ts:327-347`):
```typescript
private buildSdkOptions(): SdkClientOptions {
  let cliPath = this.clientOptions.cliPath;
  const cliArgs = [...(this.clientOptions.cliArgs ?? [])];

  if (!cliPath) {
    const copilotCliPath = getBundledCopilotCliPath();
    const nodePath = resolveNodePath();
    if (nodePath && copilotCliPath.endsWith(".js")) {
      cliPath = nodePath;
      cliArgs.unshift("--no-warnings", copilotCliPath);
    } else {
      cliPath = copilotCliPath;
    }
  }
  // ...
}
```

**Comment** (`src/sdk/clients/copilot.ts:320-325`):
```
The Copilot SDK spawns its CLI subprocess using process.execPath when
cliPath ends in ".js". Under Bun, this fails because @github/copilot
depends on node:sqlite which Bun does not support.
```

#### 2.3 Node Path Resolution

**Location:** `src/sdk/clients/copilot.ts:1497-1509`

```typescript
export function resolveNodePath(): string | null {
  try {
    const cmd = process.platform === "win32" ? "where node" : "which node";
    const result = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      .trim()
      .split(/\r?\n/)[0]
      ?.replace(/\r$/, "");
    return result || null;
  } catch {
    return null;
  }
}
```

**Optimization opportunity:** Replace `execSync(cmd)` with `Bun.which("node")` for faster resolution.

#### 2.4 Copilot CLI Path Resolution

**Location:** `src/sdk/clients/copilot.ts:1511-1575`

Three-strategy resolution:
1. `import.meta.resolve("@github/copilot")` → find `index.js` in SDK package
2. `require.resolve("@github/copilot")` → fallback for npm installs
3. `which copilot` / `where copilot` → check PATH for CLI binary

#### 2.5 Why This Cannot Be Migrated

- **`node:sqlite`** is a Node.js-specific built-in with no Bun equivalent
- **`bun:sqlite`** exists but has a **different API** — the Copilot CLI is compiled to use `node:sqlite` internally
- The Copilot CLI is a third-party binary — cannot modify its imports
- This is the **only** place in the codebase where Node.js is a hard runtime requirement

#### 2.6 Same Workaround in Model Operations

**Location:** `src/models/model-operations.ts:270-277`

```typescript
// The Copilot SDK spawns its CLI subprocess using process.execPath
// depends on node:sqlite which Bun does not support.
```

This module also dynamically imports the Copilot SDK for model probing.

---

### 3. Comparison with Other SDKs

| Feature | Copilot SDK | Claude Agent SDK | OpenCode SDK |
|---------|-------------|------------------|--------------|
| **Communication** | JSON-RPC | Query function-based | SSE (Server-Sent Events) |
| **Spawning** | External CLI via subprocess | External CLI or standalone binary | Embedded server |
| **Hard Dependencies** | `node:sqlite` (Node.js only) | None (works with Bun) | None (works with Bun) |
| **Process Runtime** | **Must use Node.js** | Can use Bun | Can use Bun |
| **Workaround Needed** | ✅ Yes — spawn with `node` | ❌ No | ❌ No |

**Claude SDK** (`src/sdk/clients/claude.ts`): Uses `query()` function, spawns `cli.js` or standalone binary. No `node:sqlite` dependency.

**OpenCode SDK** (`src/sdk/clients/opencode.ts`): Spawns an embedded server via `createOpencodeServer()`. No external CLI binary needed.

---

### 4. `process.*` API Usage (308 instances)

#### 4.1 `process.env` — 150+ instances

Widespread usage for environment variable access. **Bun supports `process.env` natively** with automatic `.env` loading.

Key usages:
- `process.env.DEBUG` — debug mode flag (multiple files)
- `process.env.HOME` / `process.env.USERPROFILE` — home directory
- `process.env.ATOMIC_*` — project-specific env vars
- `process.env.PATH` — PATH manipulation in postinstall scripts
- `process.env.GITHUB_TOKEN` — auth token for downloads

**Migration:** ✅ No change needed — Bun supports `process.env` identically and auto-loads `.env`.

#### 4.2 `process.cwd()` — 30+ instances

Used for project root detection and working directory resolution.

**Migration:** ✅ No change needed — works identically in Bun.

#### 4.3 `process.exit()` — 20+ instances

Used for CLI exit codes in `src/cli.ts`, `src/commands/init.ts`, `src/commands/update.ts`, etc.

**Migration:** ✅ No change needed — works identically in Bun.

#### 4.4 `process.platform` — 15+ instances

Used for cross-platform detection in `src/utils/detect.ts`, `src/sdk/clients/copilot.ts`, install scripts.

**Migration:** ✅ No change needed — works identically in Bun.

#### 4.5 `process.execPath` — 3 instances

- `src/cli.ts:255` — used to spawn telemetry upload subprocess
- `src/sdk/clients/copilot.ts:320` — (comment) SDK uses this to spawn CLI
- `src/models/model-operations.ts:273` — (comment) same

**Note:** Under Bun, `process.execPath` resolves to the Bun binary, which is correct for self-spawning. The Copilot workaround already handles the case where Node.js is needed.

#### 4.6 Other `process.*` APIs

- `process.pid` — 6 instances (file locks, temp files, buffer paths)
- `process.stdout` — 8 instances (TTY detection, ANSI output)
- `process.stdin` — 1 instance (MCP bridge)
- `process.argv` — 2 instances (CLI args, debug info)
- `process.arch` — 2 instances (download, debug)
- `process.version` — 1 instance (debug info)
- `process.memoryUsage()` — 1 instance (debug diagnostics)
- `process.kill()` — 1 instance (file lock cleanup)
- `process.on/off/removeListener` — 5 instances (signal handling)
- `process.chdir()` — 5 instances (test setup/teardown)

**Migration:** ✅ All supported natively in Bun.

---

### 5. `require()` Calls — 9 instances

| File | Line | Import | Context |
|------|------|--------|---------|
| `src/sdk/clients/copilot.ts` | 1558 | `require("node:fs")` | `realpathSync` for CLI path resolution |
| `src/sdk/clients/claude.ts` | 2515 | `require("node:fs")` | Same pattern for Claude CLI |
| `src/sdk/tools/discovery.ts` | 116 | `require("fs")` | `rmdirSync` |
| `src/ui/commands/workflow-commands.ts` | 416 | `require("fs")` | `readdirSync` |
| `src/ui/commands/workflow-commands.test.ts` | 253, 356, 445 | `require("fs")` | `mkdirSync` in tests |
| `src/utils/file-lock.ts` | 119, 259 | `require("fs")` | `mkdirSync`, `readdirSync` |

**Migration:** These `require()` calls should be converted to ESM `import` statements for consistency. The `require("fs")` calls (without `node:` prefix) can become `import { ... } from "node:fs"` or `Bun.file()`/`Bun.write()`.

---

### 6. `Buffer` Usage — 5 actual instances

Most Buffer references are type annotations or test data. Actual API usage:
- `src/ui/index.protocol-ordering.test.ts:147` — `Buffer.from(chunk).toString("utf8")`
- `src/ui/commands/workflow-commands.ts:229,740,744,759` — `Buffer` type in function signatures (for `fs.watch` events)

**Migration:** ✅ Bun supports `Buffer` natively via its Node.js compatibility layer.

---

### 7. CLI Startup Path Analysis

#### 7.1 Current Architecture

The CLI uses a **lazy-loading architecture** with minimal startup overhead:

**Eager imports (loaded at startup) — 6 modules, ~36KB:**
```
src/cli.ts (12KB)
  ├── child_process (spawn — for telemetry)
  ├── @commander-js/extra-typings (Commander.js)
  ├── src/version.ts (4KB) → package.json
  ├── src/utils/colors.ts (4KB) → src/utils/detect.ts (8KB)
  └── src/config.ts (8KB)
```

**What does NOT happen at startup:**
- ❌ No SDK loading (Claude, OpenCode, Copilot)
- ❌ No telemetry state reading
- ❌ No config file I/O
- ❌ No network requests
- ❌ No UI/React/OpenTUI initialization
- ❌ No MCP server discovery

**Lazy imports — loaded on-demand per command:**
- `atomic chat` → loads ~150 modules (SDKs, UI, telemetry)
- `atomic init` → loads ~15 modules
- `atomic update` → loads ~10 modules

#### 7.2 Startup Execution Sequence

1. **Module loading** — 6 modules (~36KB)
2. **`createProgram()`** — Commander.js command registration (metadata only)
3. **`main()`** invoked:
   - Windows cleanup (conditional, `process.platform === "win32"`)
   - `program.parseAsync()` — routes to command handler
   - `spawnTelemetryUpload()` — detached background process after command completes

#### 7.3 Telemetry Upload Spawning

**Location:** `src/cli.ts:232-268`

```typescript
const child = spawn(process.execPath, [scriptPath, "upload-telemetry"], {
  detached: true,
  stdio: "ignore",
  env: { ...process.env, ATOMIC_TELEMETRY_UPLOAD: "1" },
});
child.unref();
```

Uses `child_process.spawn` with `process.execPath`. Under Bun, this spawns another Bun process. Could use `Bun.spawn()` for 60% faster subprocess creation.

---

### 8. Optimization Opportunities for Startup Time

#### 8.1 Replace `child_process.spawn` with `Bun.spawn()`

**Current:** `src/cli.ts:18` — `import { spawn } from "child_process";`
**Improvement:** Use `Bun.spawn()` which is 60% faster (uses `posix_spawn(3)` internally).

```typescript
// Before
import { spawn } from "child_process";
const child = spawn(process.execPath, [...], { detached: true, stdio: "ignore" });
child.unref();

// After
const proc = Bun.spawn([process.execPath, ...], {
  stdio: ["ignore", "ignore", "ignore"],
  env: { ...process.env, ATOMIC_TELEMETRY_UPLOAD: "1" },
});
proc.unref();
```

#### 8.2 Replace `execSync` with `Bun.which()` / `Bun.spawnSync()`

**Current:** `src/sdk/clients/copilot.ts:1501` and `src/sdk/clients/claude.ts:2505`
```typescript
const cmd = process.platform === "win32" ? "where node" : "which node";
const result = execSync(cmd, { encoding: "utf-8", ... });
```

**Improvement:**
```typescript
const result = Bun.which("node");
```

This eliminates a shell spawn entirely — `Bun.which()` is a direct PATH lookup.

#### 8.3 Use `Bun.file()` for Async File Reading

**Current:** Many files use `readFileSync()` for configuration loading.

**Improvement:** For non-blocking paths, use `Bun.file()`:
```typescript
// Before
const content = readFileSync(path, "utf-8");

// After
const content = await Bun.file(path).text();
```

`Bun.file()` is 2x faster for file I/O using optimized system calls.

#### 8.4 `bun build --compile` Optimizations

The project already uses `bun build src/cli.ts --compile --outfile atomic`. Additional options:

- `--compile-autoload-dotenv=false` — skip `.env` loading if not needed in compiled binary
- `--compile-autoload-bunfig=false` — skip `bunfig.toml` loading
- Bytecode caching provides 1.5-4x faster startup for compiled binaries
- The compiled binary embeds the Bun runtime — users don't need Bun installed

#### 8.5 Eagerly Imported `child_process` at Startup

**Current:** `src/cli.ts:18` imports `spawn` from `child_process` at the top level, but it's only used in `spawnTelemetryUpload()` which runs **after** the command completes.

**Improvement:** Move to a dynamic import:
```typescript
// Before (eager, at module load)
import { spawn } from "child_process";

// After (lazy, when needed)
async function spawnTelemetryUpload(): Promise<void> {
  // ... checks ...
  const { spawn } = await import("child_process");
  // ... or use Bun.spawn() directly
}
```

Or better: replace with `Bun.spawn()` entirely, eliminating the import.

---

### 9. Scripts and Build Configuration

#### 9.1 All Scripts Use Bun

| Script | Command | Status |
|--------|---------|--------|
| `dev` | `bun run src/cli.ts` | ✅ Bun |
| `build` | `bun build src/cli.ts --compile --outfile atomic` | ✅ Bun |
| `test` | `bun test` | ✅ Bun |
| `typecheck` | `tsc --noEmit` | ✅ Runtime-agnostic |
| `lint` | `oxlint --config=oxlint.json src` | ✅ Runtime-agnostic (Rust) |
| `postinstall` | `lefthook install && bun run src/scripts/postinstall.ts` | ✅ Bun |

#### 9.2 npm Fallback in Install Scripts

`install.sh` and `install.ps1` install npm as a fallback for `@playwright/cli` global installation when Bun is unavailable. `src/scripts/postinstall-playwright.ts` similarly falls back to npm.

#### 9.3 TypeScript Configuration

`tsconfig.json` uses `moduleResolution: "bundler"` — designed for Bun/esbuild, incompatible with Node.js native resolution.

#### 9.4 No Node.js Config Files

No `.npmrc`, `.nvmrc`, `.node-version`, or `package-lock.json` exist. Only `bun.lock` and `bunfig.toml`.

---

### 10. `require()` to ESM Migration

Nine `require()` calls exist in the codebase that can be converted to ESM imports:

| File | Line | Current | Suggested |
|------|------|---------|-----------|
| `src/sdk/clients/copilot.ts` | 1558 | `require("node:fs")` | `import { realpathSync } from "node:fs"` (top-level) |
| `src/sdk/clients/claude.ts` | 2515 | `require("node:fs")` | Same pattern |
| `src/sdk/tools/discovery.ts` | 116 | `require("fs")` | `import { rmdirSync } from "node:fs"` |
| `src/utils/file-lock.ts` | 119, 259 | `require("fs")` | ESM imports |
| `src/ui/commands/workflow-commands.ts` | 416 | `require("fs")` | ESM import |
| Test files | various | `require("fs")` | ESM imports |

---

## Code References

### Copilot SDK Workaround
- `src/sdk/clients/copilot.ts:320-373` — `buildSdkOptions()` method with Node.js workaround
- `src/sdk/clients/copilot.ts:1497-1509` — `resolveNodePath()` function
- `src/sdk/clients/copilot.ts:1511-1575` — `getBundledCopilotCliPath()` function
- `src/models/model-operations.ts:270-277` — Same workaround for model probing

### CLI Startup Path
- `src/cli.ts:1-307` — Entry point with lazy loading architecture
- `src/cli.ts:18-22` — Eager imports (6 modules)
- `src/cli.ts:34-221` — `createProgram()` with Commander.js setup
- `src/cli.ts:232-268` — `spawnTelemetryUpload()` using `child_process.spawn`
- `src/cli.ts:278-303` — `main()` function

### Node.js API Heavy Files
- `src/utils/settings.ts` — `node:fs`, `node:path`, `node:os`
- `src/ui/utils/command-history.ts` — `node:fs`, `node:path`, `node:os`
- `src/ui/utils/conversation-history-buffer.ts` — `node:fs`, `node:path`, `node:os`
- `src/ui/commands/skill-commands.ts` — `node:fs`, `node:path`, `node:os`
- `src/workflows/graph/checkpointer.ts` — `node:fs/promises`, `node:path`

### Other SDK Clients (for comparison)
- `src/sdk/clients/claude.ts:2336-2406` — Claude SDK `start()` method
- `src/sdk/clients/claude.ts:2487-2533` — `getBundledClaudeCodePath()`
- `src/sdk/clients/opencode.ts:3077-3152` — OpenCode SDK server spawning

## Architecture Documentation

### Current Patterns

1. **Lazy Loading Pattern:** All command handlers use `await import()` to defer module loading until the command is executed. This keeps startup under 36KB of eagerly loaded code.

2. **SDK Client Wrapper Pattern:** Each SDK (Copilot, Claude, OpenCode) has a wrapper in `src/sdk/clients/` that abstracts the SDK-specific API into a unified interface. Only the Copilot wrapper requires the Node.js workaround.

3. **Cross-Platform Detection:** `src/utils/detect.ts` provides platform detection using `Bun.which()` and `Bun.spawnSync()` (already Bun-native) alongside `process.platform` checks.

4. **Configuration Resolution:** `src/utils/config-path.ts` detects installation type (source/npm/binary) via `import.meta.dir` patterns and resolves data directories accordingly.

5. **Telemetry Fire-and-Forget:** Telemetry upload is spawned as a detached child process after command completion, avoiding startup impact.

### Migration Priority Matrix

| Category | Files Affected | Migration Effort | Performance Gain | Priority |
|----------|---------------|-----------------|-----------------|----------|
| `execSync` → `Bun.which()` | 2 (copilot, claude clients) | Low | Medium (eliminates shell spawn) | **High** |
| `child_process.spawn` → `Bun.spawn()` | 1 (cli.ts) | Low | Medium (60% faster) | **High** |
| Eager `child_process` import → lazy/Bun | 1 (cli.ts) | Low | Low (saves one import at startup) | **Medium** |
| `require()` → ESM imports | 6 files | Low | None (code quality) | **Medium** |
| `readFileSync` → `Bun.file().text()` | ~15 files | Medium | Medium (2x faster I/O) | **Low** |
| `node:path` | 25 files | None | None (already compatible) | **Skip** |
| `node:os` | 15 files | None | None (already compatible) | **Skip** |
| `process.*` APIs | 50+ files | None | None (already compatible) | **Skip** |

## Historical Context (from research/)

- `research/docs/2026-01-24-bun-shell-script-conversion.md` — Documents a previous migration of bash scripts to Bun TypeScript using `Bun.$`, `Bun.file()`, `Bun.write()`, `Bun.spawn()`. Establishes patterns for the current migration.
- `research/docs/2026-02-12-bun-test-failures-root-cause-analysis.md` — 104 test failures analyzed; all were stale test expectations, not Bun compatibility issues.
- `research/docs/2026-01-20-cross-platform-support.md` — Documents strong cross-platform design with centralized platform detection and Bun-native process spawning.
- `research/docs/2026-03-01-opencode-tui-concurrency-bottlenecks.md` — Performance bottlenecks in SSE event loops (relevant for runtime optimization).
- `research/bun-native-alternatives.md` — Comprehensive Bun API reference document with benchmarks and migration guidance from DeepWiki research.

## Related Research

- `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` — SDK migration paths analysis
- `research/docs/2026-01-31-github-copilot-sdk-research.md` — Copilot SDK architecture deep dive
- `research/docs/2026-02-25-install-postinstall-analysis.md` — Installation infrastructure
- `specs/bun-shell-script-conversion.md` — RFC for bash-to-Bun conversion patterns

## Open Questions

1. **Bun `node:sqlite` support timeline:** Will Bun add `node:sqlite` support? If so, the Copilot SDK workaround could be removed entirely. Current status: not supported.
2. **Copilot SDK update:** Will `@github/copilot-sdk` move away from `node:sqlite` dependency? This would eliminate the Node.js requirement.
3. **Compiled binary performance:** Benchmarking `bun build --compile` with different flags (`--compile-autoload-dotenv`, `--compile-autoload-bunfig`) to measure actual startup time impact.
4. **`Bun.file()` sync equivalent:** Some code paths require synchronous file reads (e.g., settings, config loading during startup). `Bun.file()` is async-only — need to verify if `readFileSync` is the correct choice for these paths.
5. **`Bun.spawn` detached mode:** Verify that `Bun.spawn()` supports `detached`/`unref()` semantics equivalent to `child_process.spawn()` for the telemetry upload use case.

## Baseline Benchmark Results (Task #1)

Measured baseline startup latency for `atomic --version` using the local CLI entrypoint (`./src/cli.ts --version`) to represent the installed command path.

### Method

- Warmups: 10
- Measured runs: 60
- Command: `./src/cli.ts --version`
- Environment: Linux (project branch `lavaman131/feature/perf`)

### Results

| Metric | Value (ms) |
|--------|------------|
| Mean | 32.03 |
| Median | 31.73 |
| Std Dev | 1.49 |
| Min | 29.69 |
| P95 | 34.47 |
| Max | 37.86 |

## Post-Migration Benchmark Results (Task #15)

Re-ran the same startup benchmark after completing migration tasks (#2-#14) to compare against the Task #1 baseline.

### Method

- Warmups: 10
- Measured runs: 60
- Command: `./src/cli.ts --version`
- Environment: Linux (project branch `lavaman131/feature/perf`)

### Results

| Metric | Value (ms) |
|--------|------------|
| Mean | 31.79 |
| Median | 31.62 |
| Std Dev | 1.04 |
| Min | 30.26 |
| P95 | 33.30 |
| Max | 36.20 |

### Comparison vs Task #1 Baseline

| Metric | Baseline (ms) | Post-Migration (ms) | Delta (ms) | Delta (%) |
|--------|---------------|---------------------|------------|-----------|
| Mean | 32.03 | 31.79 | -0.24 | -0.74% |
| Median | 31.73 | 31.62 | -0.11 | -0.34% |
| Std Dev | 1.49 | 1.04 | -0.45 | -30.20% |
| Min | 29.69 | 30.26 | +0.57 | +1.92% |
| P95 | 34.47 | 33.30 | -1.17 | -3.39% |
| Max | 37.86 | 36.20 | -1.66 | -4.39% |
