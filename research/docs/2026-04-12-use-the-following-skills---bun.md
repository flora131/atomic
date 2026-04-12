---
date: 2026-04-12 19:54:09 UTC
researcher: deep-research-codebase workflow
git_commit: 28d3950f33dd7d982a0d47cd700392bda60d822e
branch: lavaman131/hotfix/workflow-sdk-fixes
repository: atomic
topic: "Use the following skills: bun, typescript-advanced-types, typescript-expert, typescript-react-reviewer, opentui — to refine the code in the codebase if there are any anti-patterns or where you should be using libraries instead of implementing from scratch."
tags: [research, codebase, deep-research]
status: complete
last_updated: 2026-04-12
---

# Research: Codebase Pattern & Anti-Pattern Audit Against Skill Rulesets

## Research Question

Use the following skills: bun, typescript-advanced-types, typescript-expert, typescript-react-reviewer, opentui — to refine the code in the codebase if there are any anti-patterns or where you should be using libraries instead of implementing from scratch.

## Executive Summary

The Atomic CLI codebase (49,620 LOC across 198 source files) demonstrates strong TypeScript patterns in its SDK core — discriminated unions for multi-provider message handling (`src/sdk/types.ts:37-83`), a Result-type pipeline in the workflow loader (`src/sdk/runtime/loader.ts:26-36`), branded nominal types for identity (`src/sdk/types.ts:362-363`), `useSyncExternalStore` for React state synchronization (`src/sdk/components/orchestrator-panel-contexts.ts:30-35`), and `assertNever` for compile-time exhaustiveness checking (`src/sdk/runtime/executor.ts:94-96`). The test suite uses no `any`/`unknown` types, employs factory functions with typed defaults, and correctly leverages OpenTUI's `testRender` and `createTestRenderer` APIs.

Five distinct areas exist where library functionality could replace hand-rolled implementations: (1) manual hex color parsing in `src/sdk/components/color-utils.ts` duplicates OpenTUI's `RGBA.fromHex()` and `parseColor()` APIs; (2) the `setInterval`-based pulse animation in `src/sdk/components/session-graph-panel.tsx:86-101` could use OpenTUI's `useTimeline` hook; (3) the ~290-line file-based lock implementation in `src/services/system/file-lock.ts` reinvents `proper-lockfile` or `lockfile` npm packages; (4) manual field-by-field type validation in `src/services/config/atomic-config.ts:51-64` and `src/services/config/settings.ts:34-36` could use a schema validation library; (5) the custom terminal color system in `src/theme/colors.ts` (three-tier truecolor/ANSI/no-color dispatch) replicates functionality provided by `chalk`, `kleur`, or `picocolors`.

Three cross-cutting inconsistencies span multiple directories: mixed Bun/Node.js file I/O strategies within `src/services/` (Bun APIs in `settings.ts`, Node.js `fs/promises` in `atomic-config.ts`, synchronous `node:fs` in `file-lock.ts`); two coexisting subprocess stream-reading idioms (`Bun.readableStreamToText` in `src/lib/spawn.ts:48-49` vs. `new Response().text()` in `src/commands/cli/init/scm.ts:186-189` and `src/services/system/skills.ts:29-35`); and an inline type union duplication in `src/cli.ts:123` (`"claude" | "opencode" | "copilot"`) that bypasses the canonical `AgentKey` type from `src/services/config/definitions.ts:29`.

Several patterns are confirmed correct and intentional: `Bun.spawnSync` with array arguments in `src/sdk/runtime/tmux.ts:97-106` (prevents shell injection — `Bun.$` templates would be unsafe here); the `useLatest` ref-mutation-during-render pattern in `src/sdk/components/hooks.ts:17-21` (safe under OpenTUI's synchronous reconciler); the `PanelStore` manual external store with `useSyncExternalStore` (textbook React 19 pattern); and the custom path traversal guard in `src/lib/path-root-guard.ts` (security-critical, appropriately hand-rolled).

## Detailed Findings

### Bun Runtime API Usage

#### Correct Bun-Native Patterns

The codebase uses Bun-native APIs extensively:

- **`Bun.file().json()` and `Bun.file().text()`** for async file reading (`src/lib/merge.ts:29-32`, `src/sdk/runtime/loader.ts:83`, `build.ts:11, 52`, `src/services/config/settings.ts:46`)
- **`Bun.write()`** for atomic file writes (`src/lib/merge.ts:50`, `build.ts:53`, `src/services/config/settings.ts:54-59`)
- **`Bun.spawnSync()` with array arguments** in `src/sdk/runtime/tmux.ts:97-106` — this intentionally avoids `Bun.$` shell templates to prevent shell injection when constructing tmux commands with user-supplied pane names and session IDs
- **`Bun.which()`** for binary resolution (`src/sdk/runtime/tmux.ts:45-62`, `src/lib/spawn.ts:109-487`, `src/services/system/detect.ts:12, 27, 35`)
- **`Bun.spawn()` with piped streams** for subprocess output capture (`src/lib/spawn.ts:41-55`)
- **`Bun.$` shell templates** for safe, simple shell operations (`build.ts:21, 44`, `src/scripts/bump-version.ts:56`)
- **`Bun.build()`** for the native build pipeline (`build.ts:27-35`)
- **`new Glob().scan()`** for file discovery (`build.ts:46, 57`)
- **`Bun.sleep()`** for async delays (`src/sdk/runtime/tmux.ts:576-591`)

#### Mixed File I/O Strategies in `src/services/`

Three distinct file I/O approaches coexist within the same package:

1. **Bun APIs** — `src/services/config/settings.ts:46` uses `Bun.file(path).json()` and `Bun.write()`
2. **Node.js `fs/promises`** — `src/services/config/atomic-config.ts` uses `readFile`/`writeFile` from `fs/promises`
3. **Synchronous Node.js `fs`** — `src/services/system/file-lock.ts:124` uses `writeFileSync`, `readFileSync`, `existsSync`, `unlinkSync`, `readdirSync`

The `file-lock.ts` synchronous API usage is intentional — file locking requires atomic `"wx"` flag exclusivity that must be synchronous to prevent TOCTOU races. The split between `settings.ts` (Bun) and `atomic-config.ts` (Node.js) has no such justification.

#### Subprocess Stream Reading — Two Coexisting Idioms

**Idiom A** — `Bun.readableStreamToText()`:
- `src/lib/spawn.ts:48-49`: `Bun.readableStreamToText(proc.stderr)`

**Idiom B** — `new Response().text()`:
- `src/commands/cli/init/scm.ts:186-189`: `new Response(proc.stderr).text()`
- `src/services/system/skills.ts:29-35`: `new Response(proc.stderr).text()`

Both consume the same `ReadableStream` type from `Bun.spawn`'s piped output. Both work correctly in Bun.

#### Module Import Specifier Variation

- `src/lib/spawn.ts:9` uses `import { homedir } from "os"` (bare)
- `src/services/config/settings.ts:13` uses `import { homedir } from "node:os"` (prefixed)
- `src/lib/merge.ts:5` and `src/lib/path-root-guard.ts:2` use `"path"` (bare)
- `src/services/config/settings.ts:12` uses `"node:path"` (prefixed)

Both resolve identically in Bun.

### TypeScript Type System Patterns

#### Agent-Polymorphic Mapped Types (`src/sdk/types.ts:37-83`)

The SDK's type system uses four internal maps keyed by `AgentType = "copilot" | "opencode" | "claude"`:

```typescript
type ClientOptionsMap = {
  opencode: { directory?: string; experimental_workspaceID?: string };
  copilot: Omit<CopilotClientOptions, "cliUrl">;
  claude: { chatFlags?: string[]; readyTimeoutMs?: number };
};
export type StageClientOptions<A extends AgentType> = ClientOptionsMap[A];
```

Public utility types resolve via indexed access, ensuring type-safe polymorphism when workflows target a specific agent.

#### Result-Type Pipeline (`src/sdk/runtime/loader.ts:26-36`)

The workflow loader implements a three-stage pipeline with discriminated Result types:

```typescript
export type Ok<T> = { ok: true; value: T };
export type StageError<S extends string> = { ok: false; stage: S; error: unknown; message: string };
export type StageResult<T, S extends string> = Ok<T> | StageError<S>;
```

Stages: `resolve` (`loader.ts:79-101`), `validate` (`loader.ts:127-146`), `load` (`loader.ts:156-195`), sequenced in `loadWorkflow` (`loader.ts:207-239`) with short-circuit returns on failure. Each stage structurally extends the previous result.

#### Branded Nominal Types

- `src/sdk/types.ts:362-363`: `readonly __brand: "WorkflowDefinition"`
- `src/sdk/define-workflow.ts:61`: `readonly __brand: "WorkflowBuilder"`
- `src/sdk/runtime/loader.ts:163`: Uses `__brand` for identity checks instead of `instanceof`

#### Discriminated Union for Multi-Provider Messages (`src/sdk/types.ts:198-201`)

`SavedMessage` discriminates on `provider`, with each branch's `data` typed to the native SDK message type. `SaveTranscript` (`types.ts:210-217`) uses three overloaded call signatures for the same three-way dispatch.

#### Exhaustiveness via `assertNever` (`src/sdk/runtime/executor.ts:94-96`)

```typescript
function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`);
}
```

Used at `default` branches in switch statements on discriminated unions. The `typescript-expert` skill's `utility-types.ts:306-335` defines the same pattern — the codebase implements it independently.

#### Type Guard Predicates (`src/sdk/runtime/executor.ts:408-416`)

```typescript
export function hasContent(value: unknown): value is { content: string } {
  return typeof value === "object" && value !== null &&
    "content" in value && typeof (value as { content: unknown }).content === "string";
}
```

Type predicate filters are also used at `executor.ts:450-454`:
```typescript
.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
```

#### Generic with Producer-Side Type Assertions (`src/sdk/runtime/executor.ts:565`)

`initProviderClientAndSession<A extends AgentType>` uses casts like `clientOpts as StageClientOptions<"copilot">` because TypeScript cannot narrow generic parameters through switch statements. This is a known TypeScript limitation, not an anti-pattern.

#### `as const` Tuple to Union Type (`src/services/config/definitions.ts:28-29`)

```typescript
const AGENT_KEYS = ["claude", "opencode", "copilot"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];
```

`AGENT_CONFIG` is typed `Record<AgentKey, AgentConfig>` (`definitions.ts:31`) ensuring exhaustive mapping. However, `SourceControlType` (`definitions.ts:123`) is defined as a standalone union `"github" | "sapling"` rather than being derived from its `SCM_KEYS` tuple — an inconsistency with the `AgentKey` pattern.

#### Inline Type Union Duplication (`src/cli.ts:123`)

```typescript
agentType: agentType as "claude" | "opencode" | "copilot",
```

This duplicates the `AgentKey` type from `src/services/config/definitions.ts:29` as an inline literal union.

#### Manual Type Validation vs. Schema Libraries

`src/services/config/atomic-config.ts:51-64` validates config fields one by one:
```typescript
if (typeof version === "number") config.version = version;
if (typeof scm === "string") config.scm = scm as SourceControlType;
```

`src/services/config/settings.ts:34-36` uses a hand-rolled `isPlainObject` guard. `normalizeTrustedPaths` (`settings.ts:68-87`) manually validates fields with `typeof` checks. No schema validation library (Zod, Valibot, ArkType) is used.

### React/OpenTUI Component Patterns

#### External Store with `useSyncExternalStore` (`src/sdk/components/orchestrator-panel-contexts.ts:30-35`)

```typescript
export function useStoreVersion(store: PanelStore): number {
  return useSyncExternalStore(store.subscribe, () => store.version);
}
```

The `PanelStore` (`orchestrator-panel-store.ts`) implements the observer pattern with `Set<Listener>`, `subscribe()` returning a removal closure, and `emit()` incrementing a `version` counter. This is textbook `useSyncExternalStore` usage confirmed against React 19 documentation.

#### Imperative Class with Static Factory (`src/sdk/components/orchestrator-panel.tsx:18, 67`)

`OrchestratorPanel` uses a private constructor with static `create()` and `createWithRenderer()` factory methods. It wraps `createRoot(renderer).render(...)` with `SessionGraphPanel` inside three Context providers (`StoreContext`, `ThemeContext`, `TmuxSessionContext`) plus an `ErrorBoundary`. Imperative methods delegate to `PanelStore`.

#### `useLatest` Ref Mutation During Render (`src/sdk/components/hooks.ts:17-21`)

```typescript
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
```

Assigns `ref.current` during render. This is safe under OpenTUI's synchronous reconciler (no concurrent features). Used throughout the codebase for event handler refs.

#### `React.memo` with Named Functions (`src/sdk/components/node-card.tsx:9`)

```typescript
export const NodeCard = React.memo(function NodeCard({ ... }) { ... });
```

Named function expression inside `React.memo` — enables React DevTools identification. The `useCallback` anti-pattern (wrapping callbacks without `React.memo` on consumers) does not appear in this codebase.

#### Manual Pulse Animation with `setInterval` (`src/sdk/components/session-graph-panel.tsx:86-101`)

```typescript
const pulseId = setInterval(
  () => setPulsePhase((p) => (p + 1) % PULSE_FRAME_COUNT),
  PULSE_INTERVAL_MS,
);
return () => clearInterval(pulseId);
```

OpenTUI provides `useTimeline` from `@opentui/react` for animation scheduling with loop management and automatic cleanup. The skill reference at `.agents/skills/opentui/references/animation/REFERENCE.md` documents this API.

#### Manual Hex Color Parsing (`src/sdk/components/color-utils.ts:4-9`)

```typescript
const n = parseInt(hex.slice(1), 16);
const r = (n >> 16) & 255;
const g = (n >> 8) & 255;
const b = n & 255;
```

OpenTUI provides `RGBA.fromHex("#FF0000")` for hex parsing and `parseColor(input)` as a polymorphic converter. The codebase's `hexToRgb`/`rgbToHex` manually implements this with bit-shifting. OpenTUI's `RGBA` class does **not** expose a public `lerp` method, so the `lerpColor` function must remain custom but could operate on `RGBA` values instead of raw hex strings.

#### Keyboard Navigation (`src/sdk/components/session-graph-panel.tsx:175-238`)

`useKeyboard` handles vim-style navigation with "gg" double-tap detection using `lastKeyRef` with `Date.now()`. Spatial navigation (`navigate()` at lines 132-169) uses O(n) scan with 3x off-axis penalty. This pattern correctly uses OpenTUI's `useKeyboard` API.

### Error Handling Patterns

#### Custom Error Classes (`src/sdk/errors.ts:9-43`)

Three custom error classes with literal union constraints:
- `MissingDependencyError` (with `dependency: "tmux" | "psmux" | "bun"`)
- `WorkflowNotCompiledError` (with `path: string`)
- `InvalidWorkflowError` (with `path: string`)

All extend `Error` and manually set `this.name`. `errorMessage(error: unknown): string` (`errors.ts:42-44`) narrows via `instanceof`, returning `.message` or `String(error)` fallback.

#### Dynamic Import with Graceful Failure (`src/sdk/providers/claude.ts:188-194`)

```typescript
const sdk = await import("@anthropic-ai/claude-agent-sdk").catch(() => null);
if (!sdk) { await Bun.sleep(3_000); return ""; }
```

#### Error Swallowing with Default Return (`src/services/config/settings.ts:44-51`)

```typescript
async function loadSettingsFile(path: string): Promise<AtomicSettings> {
  try {
    const parsed: unknown = await Bun.file(path).json();
    if (isPlainObject(parsed)) return parsed as AtomicSettings;
  } catch { }
  return {};
}
```

Also used in `src/services/system/auto-sync.ts:68-74` for best-effort marker writes.

### Custom Terminal Color System (`src/theme/colors.ts`)

Three-tier dispatch in `createPainter()` (`colors.ts:64-91`): truecolor uses `\x1b[1;38;2;R;G;Bm` SGR sequences from `PALETTE` RGB triples (`colors.ts:39-48`); ANSI basic uses an inline map; no-color returns identity. A separate static `COLORS` object (`colors.ts:27`) provides raw ANSI codes. Both systems coexist — `createPainter()` is used in `src/commands/cli/workflow.ts:599`, while `COLORS` is used at `workflow.ts:214, 221, 268`.

### File-Based Lock Implementation (`src/services/system/file-lock.ts`)

A complete mutual exclusion mechanism (~290 lines):
- `tryAcquireLock` (`file-lock.ts:77-134`): exclusive creation via `writeFileSync(lockPath, ..., { flag: "wx" })`, PID liveness checks via `process.kill(pid, 0)`, stale lock cleanup
- `acquireLock` (`file-lock.ts:143-165`): polling loop with 100ms interval, 30-second default timeout
- `withLock<T>` (`file-lock.ts:213-232`): generic resource guard (acquire, execute, release in `finally`)
- `cleanupStaleLocks` (`file-lock.ts:258-289`): directory scan removing locks with dead owner PIDs

### Custom Arg Parser (`src/commands/cli/workflow.ts:49-88`)

`parsePassthroughArgs` hand-parses `--name=value` and `--name value` forms into `{ flags, positional, errors }`. The project uses Commander.js for main CLI routing but not for passthrough argument parsing in the workflow command.

### Test Suite Patterns

#### OpenTUI Test API Usage

Component tests use `testRender` from `@opentui/react/test-utils`:
```typescript
testSetup = testRender(
  <TestProviders store={store}><NodeCard node={node} focused={false} pulsePhase={0} /></TestProviders>,
  { cols: 60, rows: 10 },
);
testSetup.renderOnce();
const frame = testSetup.captureCharFrame();
```

The imperative `OrchestratorPanel` uses `createTestRenderer` from `@opentui/core/testing`:
```typescript
const renderer = createTestRenderer({ cols: 80, rows: 24 });
const panel = OrchestratorPanel.createWithRenderer(store, renderer);
```

#### Factory Functions with Typed Defaults

```typescript
// tests/sdk/components/node-card.test.tsx:18-30
function makeLayoutNode(overrides: Partial<LayoutNode> & { name: string }): LayoutNode {
  return { status: "pending" as SessionStatus, parents: [], ... , ...overrides };
}
```

Used consistently across all test files. No `any` or `unknown` types appear in tests.

#### Conditional Integration Tests

```typescript
// tests/sdk/runtime/tmux.test.ts:436-438
const tmuxAvailable = Bun.which("tmux") !== null;
describe.if(tmuxAvailable)("tmux integration: session lifecycle", () => { ... });
```

#### Temp Directory Fixtures

```typescript
// tests/sdk/runtime/loader.test.ts:14-22
let tempDir: string;
beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "loader-test-")); });
afterEach(async () => { await rm(tempDir, { recursive: true, force: true }); });
```

#### Environment Variable Save/Restore

```typescript
// tests/sdk/runtime/tmux.test.ts:42-55
function withEnvRestore(vars: string[]) {
  const saved: Record<string, string | undefined> = {};
  for (const v of vars) saved[v] = process.env[v];
  afterEach(() => { ... });
}
```

#### Discriminated Union Narrowing in Tests

```typescript
// tests/sdk/runtime/loader.test.ts:63-74
const resolved = await WorkflowLoader.resolve(plan);
expect(resolved.ok).toBe(true);
if (!resolved.ok) return; // narrows to success type
```

### Workflow System Patterns

#### Workflow Definition Builder (`src/sdk/define-workflow.ts`)

`WorkflowBuilder<A extends AgentType = AgentType>` with method chaining and branded type. `.run().compile()` converts a builder into a `WorkflowDefinition`. The `__brand` field enables structural identity checks in the loader.

#### Workflow Executor (`src/sdk/runtime/executor.ts`)

- `executeWorkflow` (`executor.ts:309-394`): Generates run ID, builds launcher script with base64-encoded inputs, spawns tmux session
- `runOrchestrator` (`executor.ts:940-1090`): Loads workflow, creates `OrchestratorPanel`, races `definition.run(workflowCtx)` against `panel.waitForAbort()` via `Promise.race` (`executor.ts:1064`)
- `createSessionRunner` (`executor.ts:666-933`): 15-step async session lifecycle with uniqueness validation, tmux window creation, provider init, user callback execution, and registry management

#### Tmux Session Management (`src/sdk/runtime/tmux.ts`)

Binary resolution with module-level cache (`tmux.ts:45-62`). Pane state detection uses regex heuristics: `paneIsBootstrapping` (`tmux.ts:516-522`), `paneLooksReady` (`tmux.ts:529-540`), `paneHasActiveTask` (`tmux.ts:546-557`). `waitForPaneReady` (`tmux.ts:576-591`) implements exponential backoff (150ms doubling to 8000ms). `sendLiteralText` (`tmux.ts:249-262`) normalizes newlines and chunks at 50,000 bytes.

### Provider Adapters

#### Claude Provider (`src/sdk/providers/claude.ts`)

`createClaudeSession` (`claude.ts:99-145`): snapshots existing sessions, sends `claude <flags>`, waits for readiness, resolves session ID via set-difference. `claudeQuery` (`claude.ts:354-496`): multi-phase delivery with adaptive retry — primary rounds, `C-u` clear + re-send (up to 4 rounds), final fallback. Two idle detection strategies: SDK-based (`waitForIdleViaTranscript`) and pane-content heuristics (`waitForIdleViaCapture`).

### Configuration System

#### Hierarchical Config (`src/services/config/`)

- `definitions.ts`: Static registry with `as const` tuples, typed Records, type guards
- `settings.ts`: Global `~/.atomic/settings.json` with `isPlainObject` guard, trusted path deduplication
- `atomic-config.ts`: Local/global `.atomic.json` with Node.js `fs/promises` I/O
- `atomic-global-config.ts`: Agent template sync to provider home directories, recursive directory walking

#### Environment Variable Pattern

```typescript
// Repeated across settings.ts:40, auto-sync.ts:51, agents.ts:39
const home = process.env.ATOMIC_SETTINGS_HOME ?? homedir();
```

## Architecture & Patterns

### Cross-Cutting Pattern: Discriminated Unions Throughout

Discriminated unions are the codebase's primary type-safety mechanism, used at every layer:
- **SDK types**: `SavedMessage` discriminates on `provider` (`types.ts:198-201`)
- **Loader pipeline**: `Ok<T> | StageError<S>` discriminates on `ok` (`loader.ts:26-36`)
- **Error classes**: `MissingDependencyError.dependency` is `"tmux" | "psmux" | "bun"` (`errors.ts:9-14`)
- **Component state**: `SessionStatus` drives visual rendering across `NodeCard`, `SessionGraphPanel`
- **Config validation**: `isValidAgent()` and `isValidScm()` narrow strings to literal unions (`definitions.ts:106, 204`)

### Cross-Cutting Pattern: Bun-First with Node.js Fallbacks

The codebase follows a "Bun-first" strategy where Bun-native APIs (`Bun.file`, `Bun.spawn`, `Bun.which`, `Bun.write`, `Bun.$`, `Bun.build`, `Bun.sleep`, `new Glob`) are preferred. Node.js APIs appear in three contexts:
1. **Synchronous operations** where Bun has no equivalent (`file-lock.ts` using `writeFileSync` with `"wx"` flag)
2. **Legacy code** not yet migrated (`atomic-config.ts` using `fs/promises`)
3. **Module specifiers** — bare (`"os"`, `"path"`) and prefixed (`"node:os"`, `"node:path"`) coexist

### Cross-Cutting Pattern: Hand-Rolled Implementations

The codebase implements several utilities from scratch rather than using libraries:
- Color parsing and interpolation (`color-utils.ts`) — OpenTUI provides `RGBA.fromHex()`, `parseColor()`
- Terminal color system (`colors.ts`) — `chalk`, `kleur`, `picocolors` provide this
- File locking (`file-lock.ts`) — `proper-lockfile`, `lockfile` npm packages exist
- Config validation (`settings.ts`, `atomic-config.ts`) — Zod, Valibot, ArkType provide schema validation
- Arg parsing for passthrough (`workflow.ts:49-88`) — Commander.js (already a dependency) has `parseArgs()`
- `setInterval` animation (`session-graph-panel.tsx:86-101`) — OpenTUI provides `useTimeline`

### Cross-Cutting Pattern: Two Color Systems

`COLORS` (static ANSI codes at `colors.ts:7-27`) and `createPainter()` (adaptive factory at `colors.ts:64-91`) coexist. Some files use both: `workflow.ts` imports `COLORS` at lines 214, 221, 268 and calls `createPainter()` at line 599.

### Confirmed Correct Patterns (Do Not Modify)

- **`Bun.spawnSync` array arguments** in `tmux.ts:97-106` — intentionally avoids shell templates to prevent injection
- **`useLatest` ref mutation during render** in `hooks.ts:17-21` — safe under OpenTUI's synchronous reconciler
- **`useSyncExternalStore` with `PanelStore`** — textbook React 19 implementation
- **`SyntaxStyle` useMemo+useEffect lifecycle** — native resource requiring `.destroy()` in cleanup effect
- **Custom path traversal guard** in `path-root-guard.ts` — security-critical, no external dependency warranted
- **`assertNever` for exhaustiveness** — standard TypeScript pattern, no library needed
- **Dynamic imports with `.catch(() => null)`** in `claude.ts:188-194` — graceful SDK absence handling

## Code References

- `src/sdk/types.ts:37-83` — Agent-polymorphic mapped types (ClientOptionsMap, SessionOptionsMap, ClientMap, SessionMap)
- `src/sdk/types.ts:198-201` — SavedMessage discriminated union
- `src/sdk/types.ts:362-363` — Branded WorkflowDefinition type
- `src/sdk/runtime/loader.ts:26-36` — Result-type pipeline (Ok, StageError, StageResult)
- `src/sdk/runtime/loader.ts:207-239` — loadWorkflow sequencing with short-circuit returns
- `src/sdk/runtime/executor.ts:94-96` — assertNever exhaustiveness function
- `src/sdk/runtime/executor.ts:408-416` — hasContent type guard
- `src/sdk/runtime/executor.ts:450-454` — Type predicate filter with Extract
- `src/sdk/runtime/executor.ts:565` — Generic initProviderClientAndSession with producer-side assertions
- `src/sdk/runtime/executor.ts:1064` — Promise.race for abort handling
- `src/sdk/runtime/tmux.ts:45-62` — Bun.which binary resolution with caching
- `src/sdk/runtime/tmux.ts:91-106` — Bun.spawnSync with array arguments
- `src/sdk/runtime/tmux.ts:516-557` — Regex-based pane state detection heuristics
- `src/sdk/runtime/tmux.ts:576-591` — Exponential backoff pattern
- `src/sdk/providers/claude.ts:188-194` — Dynamic import with graceful failure
- `src/sdk/providers/claude.ts:354-496` — Multi-phase adaptive retry in claudeQuery
- `src/sdk/components/hooks.ts:17-21` — useLatest ref mutation during render
- `src/sdk/components/orchestrator-panel-contexts.ts:30-35` — useSyncExternalStore hook
- `src/sdk/components/orchestrator-panel-store.ts:20-27` — PanelStore Set<Listener> observer
- `src/sdk/components/orchestrator-panel.tsx:18, 67` — Static factory pattern
- `src/sdk/components/session-graph-panel.tsx:86-101` — setInterval pulse animation
- `src/sdk/components/session-graph-panel.tsx:132-169` — Spatial navigation O(n) scan
- `src/sdk/components/session-graph-panel.tsx:175-238` — useKeyboard with vim-style navigation
- `src/sdk/components/color-utils.ts:4-9` — Manual hex color parsing
- `src/sdk/components/node-card.tsx:9` — React.memo with named function
- `src/sdk/errors.ts:9-43` — Custom error classes with literal union dependency field
- `src/sdk/define-workflow.ts:61` — WorkflowBuilder branded type
- `src/lib/merge.ts:21-51` — Two-level JSON merge with server-map keys
- `src/lib/spawn.ts:28-62` — Bun.spawn subprocess wrapper
- `src/lib/spawn.ts:48-49` — Bun.readableStreamToText stream reading
- `src/lib/path-root-guard.ts:4-37` — Path traversal protection
- `src/commands/cli/init/scm.ts:186-189` — new Response().text() stream reading
- `src/commands/cli/workflow.ts:49-88` — Hand-rolled arg parser
- `src/theme/colors.ts:7-27` — Static COLORS ANSI object
- `src/theme/colors.ts:64-91` — createPainter adaptive factory
- `src/services/config/definitions.ts:28-29` — as const tuple to union type
- `src/services/config/definitions.ts:123` — Standalone SourceControlType union (inconsistent with AgentKey pattern)
- `src/services/config/settings.ts:34-36` — Manual isPlainObject guard
- `src/services/config/settings.ts:68-87` — Manual normalizeTrustedPaths validation
- `src/services/config/atomic-config.ts:51-64` — Field-by-field type validation
- `src/services/config/atomic-global-config.ts:38-42` — Nested Partial<Record> types
- `src/services/system/file-lock.ts:77-134` — Manual file lock acquisition
- `src/services/system/file-lock.ts:213-232` — withLock generic resource guard
- `src/services/system/skills.ts:29-35` — new Response() stream reading
- `src/services/system/agents.ts:39` — ATOMIC_SETTINGS_HOME env override
- `src/cli.ts:123` — Inline type union duplication
- `build.ts:27-35` — Bun.build with code splitting
- `build.ts:46-54` — Glob-based .d.ts specifier rewriting
- `tests/sdk/components/test-helpers.tsx:12, 27` — TEST_THEME and TestProviders
- `tests/sdk/components/node-card.test.tsx:18-30` — Factory function with typed defaults
- `tests/sdk/runtime/tmux.test.ts:42-55` — Environment variable save/restore
- `tests/sdk/runtime/tmux.test.ts:436-438` — describe.if conditional integration tests
- `tests/sdk/runtime/loader.test.ts:14-22` — Temp directory fixture pattern
- `tests/sdk/runtime/loader.test.ts:63-74` — Discriminated union narrowing with early return

## Historical Context (from research/)

### OpenTUI Anti-Pattern Audit (2026-03-25)

`research/docs/2026-03-25-opentui-react-antipattern-audit.md` catalogued anti-patterns in the UI layer including orchestration concentration in god-hooks (`use-ui-controller-stack`, `use-dispatch-controller`, `use-runtime`, `use-session-subscriptions`), effect-driven synchronization instead of render-time derivation in `task-list-panel.tsx`, `autocomplete.tsx`, `use-input-state.ts`, unsafe `as any` casts in tool renderers (`read.ts`, `bash.ts`), and index keys on reorderable lists (`tool-result.tsx`, `transcript-view.tsx`). A prioritized refactoring order was established: orchestration decomposition first, then keyboard/focus consolidation, then effect cleanup. **Note**: Many of these files (tool renderers, transcript view, task list panel) are no longer present in the current codebase — the SDK layer has been substantially rewritten since this audit.

### OpenTUI Testing (2026-04-08)

`research/web/2026-04-08-opentui-testing.md` confirmed that `@opentui/react/test-utils` provides `testRender()`, `captureCharFrame()`, and `captureSpans()`, and that `renderer.destroy()` must be called in `afterEach`. The current test suite (Explorer 3) correctly uses both `testRender` and `createTestRenderer` from the appropriate OpenTUI packages.

### Bun Migration (2026-03-03)

`research/docs/2026-03-03-bun-migration-startup-optimization.md` completed high-priority migrations achieving 60% faster subprocess spawning. Remaining items included `require()` → ESM in 6 files and `readFileSync` → `Bun.file().text()` in ~15 files. Critical constraint: Copilot SDK must remain Node.js-spawned due to `node:sqlite`. The mixed file I/O patterns observed by Explorer 5 in `src/services/` are consistent with this partially-completed migration.

### Architecture Analysis (2026-03-13)

`research/docs/2026-03-13-codebase-architecture-modularity-analysis.md` identified structural coupling hotspots. The dead `WorkflowSDK` class flagged in that audit is no longer present in the current codebase.

### Confirmed Correct Patterns (from memory)

- `SyntaxStyle` from OpenTUI is a native resource requiring `useMemo` creation + `useEffect` cleanup
- Ref mutation during render (callback ref mirroring) is safe because OpenTUI's React reconciler doesn't use concurrent features

## Open Questions

1. **`useTimeline` for pulse animation**: OpenTUI's `useTimeline` hook would need testing to confirm it supports infinite-loop animation suitable for the terminal pulse pattern in `session-graph-panel.tsx:86-101`. The current `setInterval` approach works but requires manual cleanup.

2. **`RGBA.fromHex()` integration**: The `lerpColor` function in `color-utils.ts` must remain custom (OpenTUI has no public `lerp` on `RGBA`), but whether building it on `RGBA` values vs. raw hex strings provides meaningful benefits is untested.

3. **File lock library evaluation**: The hand-rolled `file-lock.ts` (~290 lines) handles PID liveness, stale cleanup, and exclusive creation. Whether `proper-lockfile` offers the same guarantees with its dependency footprint is worth evaluating.

4. **Schema validation library adoption**: Adding Zod/Valibot for config validation would add a dependency but centralize the scattered manual `typeof` checks across `settings.ts`, `atomic-config.ts`, and `normalizeTrustedPaths`.

5. **`SourceControlType` derivation**: `definitions.ts:123` defines `SourceControlType` as a standalone union instead of deriving it from `SCM_KEYS` — whether aligning this with the `AgentKey` pattern is desirable.

6. **Copilot SDK Node.js constraint**: The Bun migration research noted Copilot SDK requires Node.js due to `node:sqlite`. Whether this constraint still holds should be verified before completing the file I/O API migration in `src/services/`.

## Methodology

Generated by the deep-research-codebase workflow with 5 parallel explorers covering 198 source files (49,620 LOC). Each explorer dispatched the codebase-locator, codebase-analyzer, codebase-pattern-finder, and (when applicable) codebase-online-researcher sub-agents over its assigned partition. A parallel research-history scout dispatched codebase-research-locator and codebase-research-analyzer over the project's prior research documents.

**Explorer partitions:**
- Explorer 1: `.agents/` — skill definitions and reference documents (76 files)
- Explorer 2: `src/sdk/` — SDK core: runtime, providers, components, workflows, types (49 files, ~13,308 LOC)
- Explorer 3: `tests/` — complete test suite (24 files, ~5,846 LOC)
- Explorer 4: `src/commands/`, `src/lib/`, `.atomic/`, `.opencode/`, `devcontainer-features/`, `install.sh`, `src/theme/`, `build.ts`
- Explorer 5: `src/services/`, `src/cli.ts`, `src/scripts/`, `src/version.ts`, `research/`
