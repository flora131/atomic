---
source_url: https://opentui.com/docs/ + https://bun.sh/docs/ + https://react.dev/
fetched_at: 2026-04-12
fetch_method: html-parse (playwright-cli)
topic: OpenTUI, Bun, React 19 - anti-patterns, best practices, and library utilities relevant to src/sdk/
---

# OpenTUI, Bun, React 19 — Anti-Patterns & Library Utilities

## OpenTUI

### Color API (`RGBA` + `parseColor`)
- `RGBA.fromHex(hex)`, `RGBA.fromInts(r, g, b, a)`, `RGBA.fromValues(r, g, b, a)` — built-in color construction.
- `parseColor(input)` — converts hex strings, CSS color names, or existing `RGBA` objects to `RGBA`.
- **Anti-pattern in codebase**: `src/sdk/components/color-utils.ts` manually implements `hexToRgb`, `rgbToHex`, and `lerpColor` using manual bit-shifting and `parseInt`. OpenTUI's `RGBA` class has all of these natively. However, `RGBA` does not expose a public lerp method, so `lerpColor` itself may still need to remain custom.

### `useTimeline` — Animation Hook
- OpenTUI's `@opentui/react` exposes `useTimeline({ duration, loop, autoplay, onComplete, onPause })`.
- It manages animation state via a timeline with `add({ fromProps }, { toProps, duration, ease, onUpdate })`.
- **Anti-pattern in codebase**: `session-graph-panel.tsx` implements pulse animation manually with `setInterval` + `setPulsePhase`. The `useTimeline` hook could replace this — it handles the loop scheduling, cleanup, and frame interpolation automatically, making the manual `setInterval` / `clearInterval` + `useEffect` pattern redundant.

### `useKeyboard` Hook
- `useKeyboard(handler, options?)` is the canonical React hook for keyboard input.
- `options.release: true` enables key-release events.
- **The codebase uses this correctly** — `session-graph-panel.tsx` and `workflow-picker-panel.tsx` both use `useKeyboard`.
- **Anti-pattern**: The `useLatest` pattern in `hooks.ts` (assigning `.current` during render to avoid stale closures in `useKeyboard`) is intentional and correct for OpenTUI's synchronous reconciler, per MEMORY.md.

### `useTerminalDimensions` / `useRenderer`
- Both hooks are used correctly in `session-graph-panel.tsx`.
- `useRenderer()` is the hook to obtain the renderer instance inside a React component.

### `ScrollBoxRenderable` — Scroll Control
- `scrollboxRef.current.scrollTo({ x, y })` — used correctly in `session-graph-panel.tsx`.
- `scrollboxRef.current.scrollLeft` / `scrollboxRef.current.scrollTop` — read-only getters, also used correctly.
- ScrollBox has built-in `viewportCulling: true` for performance with large lists.
- **Anti-pattern potential**: The manual scroll computation in `session-graph-panel.tsx` (calculating `nodeLeft`, `nodeRight`, `nodeTop`, `nodeBottom` to decide whether to scroll) is a correct use because OpenTUI's `ScrollBoxRenderable` does not have a `scrollIntoView()` method. The manual bounding-box check is therefore necessary.

### `SyntaxStyle` Lifecycle
- OpenTUI `SyntaxStyle` objects are native resources that must be `.destroy()`ed.
- Pattern: pure `useMemo` creation + `useEffect` cleanup (confirmed correct per MEMORY.md).

### `createRoot` + `createCliRenderer`
- `createRoot(renderer).render(<App />)` — correct entry pattern, used throughout.
- `createCliRenderer({ exitOnCtrlC: false, exitSignals: [...] })` — the codebase correctly disables `exitOnCtrlC` and manages `SIGINT` manually.

### Plugin Slots
- `createReactSlotRegistry` / `<Slot>` for React plugin extension points — not used in current codebase (not needed unless plugin extensibility is added).

## Bun

### `Bun.$` Shell API (Tagged Template Literal)
- `import { $ } from "bun"; await $\`cmd arg ${var}\`;`
- Cross-platform bash-like shell: Windows/Linux/macOS. Built-in commands: `ls`, `rm`, `mkdir`, `cat`, `pwd`, etc.
- Auto-escapes interpolated variables to prevent injection.
- `.text()`, `.json()`, `.lines()`, `.blob()` — output readers.
- `.env({...})`, `.cwd(path)` — per-command overrides.
- `.quiet()` — suppresses stdout/stderr.
- `.nothrow()` — disables non-zero exit code throwing.
- **Anti-pattern in codebase**: `src/sdk/runtime/tmux.ts` uses `Bun.spawnSync` with manually constructed string arrays for every tmux invocation. The `Bun.$` shell API would not be a drop-in replacement here because tmux commands pass arguments as separate strings (not a shell command string), and `Bun.spawnSync` with array arguments is the correct pattern for predictable argument passing without shell injection risk. The current usage in `tmux.ts` is correct.
- **Potential use case**: Shell-based operations in `src/lib/spawn.ts` (`installNodeViaFnm`, `ensureNpmInstalled`) already correctly use `Bun.spawn` with shell scripts via `[shell, "-lc", script]`. The `Bun.$` API could simplify some of these but the current approach is safe and explicit.

### `Bun.spawn` vs `Bun.spawnSync`
- `Bun.spawn` — async, returns `Subprocess` with `.exited: Promise<number>`. Use for HTTP servers and long-running processes.
- `Bun.spawnSync` — blocking, returns `SyncSubprocess` with `.success: boolean`, `.stdout: Buffer`, `.stderr: Buffer`. Better for CLI tools and short commands.
- **Codebase uses both correctly**: `tmux.ts` uses `Bun.spawnSync` for synchronous tmux control commands; `executor.ts` uses `Bun.spawn` for async agent process spawning.
- **Anti-pattern**: `src/lib/spawn.ts` `runCommand()` uses `Bun.readableStreamToText(proc.stderr)` + `Promise.all([stderr, stdout, exited])`. This is correct but verbose — `Bun.spawnSync` could simplify the non-inherit branch since it returns `Buffer` directly. However, the async path is needed for the `inherit` case, so the dual path is justified.

### `Bun.file` + `Bun.write`
- `Bun.file(path).text()` — async read as string. Used correctly in `executor.ts` for reading transcript/messages files.
- `Bun.write(path, content)` — async write. Used correctly throughout executor.ts for writing JSON metadata, transcripts, error files.
- No anti-patterns detected here — the codebase uses these idiomatically.

### `Bun.which`
- `Bun.which("tmux")` — find binary on PATH. Used extensively and correctly in `tmux.ts` and `spawn.ts`.

### `Bun.sleep`
- `await Bun.sleep(ms)` — used correctly in `executor.ts` for polling loops.

### `node:net` for Port Discovery
- `executor.ts` imports `node:net` dynamically to find a free port. This is correct; Bun does not have a built-in `getRandomPort()` equivalent.

## React 19

### `useSyncExternalStore`
- **Correct usage in codebase**: `orchestrator-panel-contexts.ts` `useStoreVersion` uses `useSyncExternalStore(store.subscribe, () => store.version)`. This is textbook correct usage — the `subscribe` method is defined on the `PanelStore` class (stable, not recreated each render), and `getSnapshot` returns a primitive (`number`) so `Object.is` comparison works without caching concerns.
- **Key caveat from docs**: If `getSnapshot` returns an object, it must be cached (referential stability). Since the codebase returns `store.version` (a number), this is fine.
- **React docs warning**: The `subscribe` function must be stable across re-renders. The codebase uses `store.subscribe` (a class method, always the same reference) — correct.

### `React.memo`
- `NodeCard` is wrapped with `React.memo` — correct, as it receives many props that change independently (focused, pulsePhase, node data).

### `useCallback` / `useMemo` Patterns
- `navigate` and `doAttach` are wrapped with `useCallback` — correct.
- `layout`, `nodeList`, `connectors` are computed with `useMemo` keyed to `storeVersion` / `layout` — correct.
- **Potential issue**: In `session-graph-panel.tsx`, `useEffect` for auto-scroll lists `[focusedId, focused, termW, termH, padX, padY, viewportH, layout.rowH]` as dependencies. `layout.rowH` is a new `Record<number, number>` object on every `computeLayout` call (no memoization of the object reference itself), which means the effect could run more often than needed. This is a minor reactivity concern but not a correctness bug in OpenTUI's synchronous reconciler.

### React 19 New Hooks — Applicability Assessment
- **`use(promise)`**: Not applicable — the codebase does not have async data-loading patterns inside components.
- **`useActionState`**: Not applicable — designed for form submission with server actions; the picker's submit flow uses plain callbacks.
- **`useOptimistic`**: Not applicable — there are no optimistic UI updates; session state comes from a shared store.
- **`useTransition`**: Not directly applicable — the OpenTUI reconciler is synchronous and does not benefit from React's concurrent deferred rendering.
- **Conclusion**: React 19 new hooks do not offer improvements over current patterns for this terminal UI use case.

### Ref Mutation During Render
- The codebase intentionally uses "callback ref mirroring" (assigning `ref.current` during render in `useLatest`). Per MEMORY.md, this is safe in OpenTUI's synchronous reconciler (no concurrent features).

## Summary of Actionable Anti-Patterns

| Location | Anti-Pattern | Library Alternative |
|---|---|---|
| `src/sdk/components/color-utils.ts` | Manual `hexToRgb`/`rgbToHex` bit manipulation | `RGBA.fromHex()`, `RGBA.fromInts()` from `@opentui/core` for color construction |
| `src/sdk/components/session-graph-panel.tsx` | Manual `setInterval` + `setPulsePhase` for animation | `useTimeline` hook from `@opentui/react` |
| `src/sdk/components/orchestrator-panel-contexts.ts` | (none — `useSyncExternalStore` used correctly) | — |
| `src/lib/spawn.ts` `runCommand` | Verbose `Bun.readableStreamToText` for non-inherit path | `Bun.spawnSync` for the synchronous/captured case |

