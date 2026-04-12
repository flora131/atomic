---
date: 2026-04-10 13:48:50 PDT
researcher: Claude
git_commit: d5585c874d3d2fc03a012173b10087ad3f338d7b
branch: flora131/feature/tmux-claude-ux
repository: atomic
topic: "Implementation guide for tmux UX improvements (config injection, socket isolation, mouse/scroll support)"
tags: [research, codebase, tmux, ux, runtime, psmux]
status: complete
last_updated: 2026-04-10
last_updated_by: Claude
---

# Research: tmux UX Implementation Guide

## Research Question

How do we implement the proposed changes in `research/web/2026-04-10-tmux-ux-improvements.md` — specifically: shipping a bundled tmux config, injecting it via `-f`, isolating sessions via `-L atomic`, printing reattach info, and ensuring proper cleanup?

## Summary

The implementation requires changes across 3 files and creation of 2 new config files. The core architecture channels all tmux commands through `tmuxRun()` in `src/sdk/runtime/tmux.ts`, which means adding `-f` and `-L` flags in a single location propagates to ~95% of call sites. Two exceptions (`sessionExists` and `attachSession`) bypass `tmuxRun()` and call `Bun.spawnSync` directly — these need individual updates. The chat command in `src/commands/cli/chat/index.ts` also bypasses `tmuxRun()` for its attach call.

## Detailed Findings

### 1. Central tmux Dispatcher: `tmuxRun()` (`src/sdk/runtime/tmux.ts:71-86`)

All exported tmux functions except two flow through `tmuxRun()`:

```
tmuxRun(args) → getMuxBinary() → Bun.spawnSync([binary, ...args])
```

The internal helpers `tmux()` (line 91) and `tmuxExec()` (line 102) are thin wrappers that convert `tmuxRun`'s result union to string/void with error throwing.

**Implication**: Adding `-f <configPath>` and `-L atomic` to `tmuxRun()` at lines 76-80 (prepended to the `args` array) would automatically apply to all of these functions:
- `createSession` (line 137)
- `createWindow` (line 172)
- `createPane` (line 199)
- `sendLiteralText` (line 216)
- `sendSpecialKey` (line 225)
- `capturePane` (line 262)
- `capturePaneVisible` (line 276)
- `capturePaneScrollback` (line 287)
- `killSession` (line 300)
- `killWindow` (line 309)
- `switchClient` (line 356)
- `getCurrentSession` (line 364)
- `selectWindow` (line 389)

### 2. Functions That Bypass `tmuxRun()` (Manual Update Required)

**`sessionExists()` at `src/sdk/runtime/tmux.ts:320-329`:**
Calls `Bun.spawnSync` directly with `[binary, "has-session", "-t", sessionName]`. Must be updated to include `-f` and `-L atomic` flags.

**`attachSession()` at `src/sdk/runtime/tmux.ts:334-349`:**
Calls `Bun.spawnSync` directly with `[binary, "attach-session", "-t", sessionName]` and `stdin: "inherit"`, `stdout: "inherit"`. Must be updated to include `-f` and `-L atomic` flags.

**Chat command attach at `src/commands/cli/chat/index.ts:225-226`:**
Calls `Bun.spawn([muxBinary, "attach-session", "-t", windowName])` directly. Must be updated to include `-f` and `-L atomic` flags.

### 3. Config File Resolution

The config path must be resolved at runtime relative to the package. Two approaches:

**Option A — `import.meta.dir`:**
```ts
const configPath = join(import.meta.dir, "tmux.conf");
```
This resolves relative to the file containing the import statement. If `tmux.conf` lives alongside `tmux.ts` in `src/sdk/runtime/`, this works directly.

**Option B — `__dirname` equivalent:**
```ts
const configPath = join(new URL(".", import.meta.url).pathname, "tmux.conf");
```

The binary name determines which config to use:
- `getMuxBinary()` returns `"tmux"` → use `tmux.conf`
- `getMuxBinary()` returns `"psmux"` or `"pmux"` → use `psmux.conf`

### 4. Session Naming (Relevant to `-L` Socket Scope)

Workflow sessions: `atomic-wf-${definition.name}-${workflowRunId}` (`executor.ts:271`)
Chat sessions: `atomic-chat-${chatId}` (`chat/index.ts:73`)

All sessions already have the `atomic-` prefix, which makes them distinguishable on the `atomic` socket.

### 5. Cleanup Handlers That Need `-L atomic`

**Executor cleanup (`src/sdk/runtime/executor.ts`):**
- `shutdown()` at lines 764-772 calls `tmux.killSession(tmuxSessionName)` — this goes through `tmuxRun()`, so it will automatically get `-L atomic` if added there.
- Catch block at lines 874-891 calls `tmux.killWindow()` for each active session — also through `tmuxRun()`, automatically covered.
- SIGINT handler at line 777 delegates to `shutdown()` — covered.

**Chat cleanup (`src/commands/cli/chat/index.ts`):**
- `killSession(windowName)` at line 236 — goes through `tmuxRun()`, automatically covered.

### 6. Environment Detection: `isInsideTmux()` (`src/sdk/runtime/tmux.ts:62-64`)

```ts
export function isInsideTmux(): boolean {
    return process.env.TMUX !== undefined || process.env.PSMUX !== undefined;
}
```

This checks for *any* tmux server. With `-L atomic` isolation, a user could be inside their personal tmux but *not* inside an Atomic tmux session. The current check still works correctly for the use case: if the user is inside *any* tmux, we should switch-client rather than nest-attach. No change needed.

### 7. Workflow Executor: How Sessions Are Created (`src/sdk/runtime/executor.ts`)

**Step 1 — Orchestrator session (line 311):**
```ts
tmux.createSession(tmuxSessionName, shellCmd, "orchestrator")
```

**Step 2 — Agent windows (lines 515-521):**
```ts
tmux.createWindow(shared.tmuxSessionName, name, command, undefined, envVars)
```

**Step 3 — Attach or switch (lines 313-328):**
- Inside tmux: `tmux.switchClient(tmuxSessionName)` — through `tmuxRun()`.
- Outside tmux: `Bun.spawn([muxBinary, "attach-session", "-t", tmuxSessionName])` directly — **must be manually updated**.

The executor attach at line 316 constructs the command as:
```ts
const muxBinary = getMuxBinary() ?? "tmux";
const attachProc = Bun.spawn([muxBinary, "attach-session", "-t", tmuxSessionName], {
    stdio: ["inherit", "inherit", "inherit"],
});
```

This is a third location (beyond `tmux.ts:attachSession` and `chat/index.ts:226`) that bypasses `tmuxRun()` and needs manual `-f`/`-L` flag addition.

### 8. Reattach Instructions (Plan Item #4)

The reattach message must use the resolved binary name. The `getMuxBinary()` function is already exported from `tmux.ts`. The message should be printed:

1. In `executeWorkflow()` (`executor.ts`) after creating the session at line 311.
2. In `chatCommand()` (`chat/index.ts`) after creating the session at line 223.

Template:
```ts
const binary = getMuxBinary() ?? "tmux";
console.log(`[atomic] Session running on tmux socket "atomic". To reattach: ${binary} -L atomic attach -t ${sessionName}`);
```

### 9. Startup Orphan Detection (Plan Item #5)

On launch, check for orphaned sessions:
```ts
const result = tmuxRun(["ls"]); // -L atomic is auto-injected via tmuxRun
```
If sessions exist that don't correspond to a running Atomic process, they can be cleaned up. This check could be added to `executeWorkflow()` or to a top-level CLI startup hook.

## Code References

- `src/sdk/runtime/tmux.ts:71-86` — `tmuxRun()`, the central dispatcher where `-f` and `-L` should be injected
- `src/sdk/runtime/tmux.ts:25-42` — `getMuxBinary()`, binary resolution (determines config file selection)
- `src/sdk/runtime/tmux.ts:137-160` — `createSession()`, session creation with all flags documented
- `src/sdk/runtime/tmux.ts:172-192` — `createWindow()`, window creation
- `src/sdk/runtime/tmux.ts:300-306` — `killSession()`, cleanup (goes through `tmuxRun`)
- `src/sdk/runtime/tmux.ts:320-329` — `sessionExists()`, **bypasses** `tmuxRun` (needs manual update)
- `src/sdk/runtime/tmux.ts:334-349` — `attachSession()`, **bypasses** `tmuxRun` (needs manual update)
- `src/sdk/runtime/executor.ts:259-329` — `executeWorkflow()`, orchestrator session creation and attach
- `src/sdk/runtime/executor.ts:316` — executor attach, **bypasses** `tmuxRun` (needs manual update)
- `src/sdk/runtime/executor.ts:764-772` — `shutdown()`, SIGINT cleanup handler
- `src/sdk/runtime/executor.ts:874-891` — catch block cleanup
- `src/commands/cli/chat/index.ts:223` — chat session creation
- `src/commands/cli/chat/index.ts:225-226` — chat attach, **bypasses** `tmuxRun` (needs manual update)
- `src/lib/spawn.ts:338-424` — `ensureTmuxInstalled()`, installation logic (no changes needed)

## Architecture Documentation

### Modification Points Summary

| Change | File(s) | Scope |
|---|---|---|
| **1. Create config files** | `src/sdk/runtime/tmux.conf` (new), `src/sdk/runtime/psmux.conf` (new) | New files |
| **2. Inject `-f` and `-L` into `tmuxRun()`** | `src/sdk/runtime/tmux.ts:71-86` | 1 function, covers ~15 call sites automatically |
| **3. Update `sessionExists()` bypass** | `src/sdk/runtime/tmux.ts:320-329` | 1 function |
| **4. Update `attachSession()` bypass** | `src/sdk/runtime/tmux.ts:334-349` | 1 function |
| **5. Update executor direct attach** | `src/sdk/runtime/executor.ts:316` | 1 call site |
| **6. Update chat direct attach** | `src/commands/cli/chat/index.ts:225-226` | 1 call site |
| **7. Add config path resolver** | `src/sdk/runtime/tmux.ts` (new function) | 1 new function |
| **8. Print reattach instructions** | `src/sdk/runtime/executor.ts`, `src/commands/cli/chat/index.ts` | 2 locations |
| **9. Orphan detection (optional)** | `src/sdk/runtime/executor.ts` or CLI startup | 1 location |

### Proposed `tmuxRun()` Modification

```ts
export function tmuxRun(args: string[]): { ok: true; stdout: string } | { ok: false; stderr: string } {
    const binary = getMuxBinary();
    if (!binary) {
        return { ok: false, stderr: "No terminal multiplexer (tmux/psmux) found on PATH" };
    }
    
    const configPath = getConfigPath(binary); // new helper
    const fullArgs = ["-f", configPath, "-L", "atomic", ...args];
    
    const result = Bun.spawnSync({
        cmd: [binary, ...fullArgs],
        stdout: "pipe",
        stderr: "pipe",
    });
    // ... rest unchanged
}
```

### Config File Selection Logic

```ts
function getConfigPath(binary: string): string {
    const configFile = binary === "tmux" ? "tmux.conf" : "psmux.conf";
    return join(import.meta.dir, configFile);
}
```

### Bypass Functions Update Pattern

For each function that bypasses `tmuxRun()` (`sessionExists`, `attachSession`, executor attach, chat attach), the binary args array changes from:

```ts
// Before
[binary, "subcommand", "-t", target]

// After
[binary, "-f", configPath, "-L", "atomic", "subcommand", "-t", target]
```

Alternatively, refactor these to use `tmuxRun()` where possible. `attachSession` and the executor/chat attach calls need `stdin: "inherit"` which `tmuxRun()` doesn't support, so they must remain as direct `Bun.spawnSync`/`Bun.spawn` calls but with the flags added.

`sessionExists` could be refactored to use `tmuxRun()` since it only checks the exit code — `tmuxRun()` returns `{ ok: false }` on non-zero exit, which maps to "session doesn't exist."

## Historical Context (from research/)

- `research/web/2026-04-10-tmux-ux-improvements.md` — The proposal document, with full config file contents, P0 implementation plan, and psmux considerations.
- `research/web/2026-04-10-tmux-ux-for-embedded-cli-tools.md` — Companion research on tmux UX patterns from OSS projects (Overmind, Claude Squad, tmux-sensible).

## Open Questions

1. **TPM auto-bootstrap**: The proposed config clones TPM on first run. This adds a `git clone` side effect to session creation. Should this be gated behind a user opt-in or first-run prompt?
2. **Config file bundling**: When Atomic is distributed as an npm package, `import.meta.dir` resolves inside `node_modules`. The `.conf` files need to be included in the package's `files` array in `package.json` or bundled by the build step.
3. **`sessionExists` refactor**: Should `sessionExists()` be refactored to use `tmuxRun()` to avoid maintaining a separate bypass, or should it remain a direct `Bun.spawnSync` call for the explicit exit-code check?
4. **Orphan cleanup strategy**: Should orphan detection be automatic (silent cleanup) or interactive (prompt the user)?
5. **psmux `display-popup` support**: The session switcher (`C-l` binding) uses `display-popup -E` which may not be available in all psmux versions. Needs validation.
