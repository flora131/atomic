---
date: 2026-02-15 00:28:10 UTC
researcher: Claude Opus 4.6
git_commit: dce3092259d2a7d36133bcfe03d6c3cbcf939120
branch: lavaman131/feature/testing
repository: atomic
topic: "Test coverage audit and plan to reach 85% with robust, meaningful tests"
tags: [research, testing, coverage, bun, test-quality, audit, staff-engineering]
status: complete
last_updated: 2026-02-15
last_updated_by: Claude Opus 4.6
---

# Research: Test Coverage Audit and 85% Coverage Plan

## Research Question

Audit the existing test suite to identify (a) tests that are trivial or test dependency behavior rather than library behavior, (b) untested modules/functions that represent meaningful coverage gaps, and (c) bun-specific testing patterns and best practices. Produce a research document cataloging current test quality issues and a prioritized list of modules needing coverage to reach 85%.

## Summary

The Atomic CLI currently has **18 test files** with **337 passing tests** and **822 expect() calls**, yielding **44.48% function coverage** and **48.71% line coverage**. The `bunfig.toml` threshold is set at 48% lines / 44% functions. To reach 85%, substantial new tests are needed, but the existing suite is of mixed quality: the graph engine tests (`compiled.test.ts`, `builder.test.ts`, `types.test.ts`) and data structure tests (`task-order.test.ts`, `registry.test.ts`) are excellent, while command tests rely heavily on substring matching of UI messages and some tests verify trivial properties. There are 25+ source modules with zero or near-zero test coverage, many containing pure testable logic. The highest-ROI path to 85% targets pure data transformations, type guards, and utility functions that can be tested without mocking.

---

## Detailed Findings

### 1. Current Coverage Baseline

```
All files: 44.48% functions | 48.71% lines
337 tests pass | 0 fail | 822 expect() calls
18 test files | ~88 source files
```

**Current `bunfig.toml` thresholds:**
```toml
[test]
coverage = true
coverageThreshold = { lines = 0.48, functions = 0.44 }
```

**Files at 100% coverage (already done):**
- `src/graph/types.ts` — type guards and constants
- `src/sdk/tools/schema-utils.ts` — schema utility functions
- `src/ui/utils/format.ts` — text formatting helpers
- `src/ui/commands/registry.ts` — CommandRegistry class (90.91% funcs / 100% lines)
- `src/config/copilot-manual.ts` — agent/instruction loading (100% / 98.91%)
- `src/telemetry/constants.ts`, `src/telemetry/index.ts` — re-exports

**Files with good coverage (>80%):**
- `src/graph/compiled.ts` — 89.29% / 93.30%
- `src/graph/builder.ts` — 81.08% / 85.63%
- `src/ui/components/task-order.ts` — 100% / 98.88%
- `src/ui/utils/hitl-response.ts` — 100% / 94.92%
- `src/ui/utils/mcp-output.ts` — 77.78% / 89.84%
- `src/config.ts` — 0% funcs (no exported functions) / 92.21% lines

### 2. Test Quality Audit

#### Excellent Tests (No Issues)

| File | Tests | Quality | Why |
|------|-------|---------|-----|
| `task-order.test.ts` | 7 | Excellent | Pure algorithmic tests with precise ordering expectations, immutability verification, edge cases (cycles, duplicates, unknown blockers) |
| `registry.test.ts` (commands) | 40+ | Excellent | Comprehensive lifecycle testing: conflict detection, case-insensitivity, search semantics, category sorting, dedup, `beforeEach` isolation |
| `builder.test.ts` | 30+ | Excellent | Full DSL coverage, structural graph verification, error message validation, decision/wait node execution tests |
| `compiled.test.ts` | 40+ | Excellent | Full execution lifecycle: state merging, conditional routing, retries, signals, streaming, abort, context access, unique execution IDs |

#### Good Tests (Minor Issues)

| File | Tests | Issues |
|------|-------|--------|
| `schema-utils.test.ts` | 15+ | Clean, no issues. Tests Zod-to-JSON-Schema conversion behavior |
| `config/index.test.ts` | 30+ | Thorough DI-based filesystem tests using injected `FsOps`. Tests agent loading, instruction priority, edge cases |
| `annotation.test.ts` | 40+ | Core reducer system thoroughly tested. Gap: `create*State`, `update*State`, and `is*` type guard functions are untested |
| `opencode-client.mcp-snapshot.test.ts` | 3 | Good: dedup verification, partial/total failure resilience. Minor: tightly coupled to SDK response shapes |
| `model-operations.test.ts` | 20+ | Good behavioral coverage. Issues: 7 instances of `(ops as any).cachedModels` reaching into private state; trivial constant identity test for `CLAUDE_ALIASES` |
| `tools/registry.test.ts` | 30+ | Good coverage of lookup, parsing, extension mapping. Issues: `Array.isArray` assertion is trivial; icon value assertions are cosmetic snapshots |
| `mcp-output.test.ts` | 8 | Good: toggle overrides, filtering, sorting, secret masking |
| `hitl-response.test.ts` | 5 | Good: normalization, structured field extraction |

#### Fair Tests (Significant Issues)

| File | Tests | Issues |
|------|-------|--------|
| `builtin-commands.test.ts` | 50+ | **21 instances of substring matching on UI messages** (`.toContain("dark")`, `.toContain("Goodbye")`, `.toContain("Available Models")`, etc.). These test wording rather than behavior. Also: trivial type assertions (`typeof result.message === "string"`), weak regex disjunction (`/Available Commands|No commands available/`), `registerBuiltinCommands` not tested directly. **Good parts**: structured result property assertions (`result.themeChange`, `result.shouldExit`, `result.stateUpdate`) are meaningful |
| `transcript-formatter.hitl.test.ts` | 1 | **Single test case** covering only one HITL scenario (question with empty answer). Uses substring matching on rendered content. **Good**: negative assertion for raw JSON presence |
| `detect.test.ts` | 5 | Only tests platform detection functions (5 of 12 exported functions). Missing: `isCommandInstalled`, `getCommandPath`, `getCommandVersion`, `supportsColor`, `supportsTrueColor`, `supports256Color` |
| `init.test.ts` | 3 | Only tests `reconcileScmVariants`. The 280-line `initCommand` interactive flow is untested (but testing interactive CLI is legitimately hard) |

#### Anti-Patterns Found Across Tests

1. **Substring matching on UI messages** (21+ instances in `builtin-commands.test.ts`, 4 in `transcript-formatter.hitl.test.ts`): Tests break on wording changes even when behavior is correct. Prefer asserting on structured result properties.

2. **Private state access via `as any`** (7 instances in `model-operations.test.ts`): `(ops as any).cachedModels = [...]` couples tests to internal implementation. Tests break if caching mechanism changes even if public API behavior is identical.

3. **Trivial type assertions**: `expect(typeof result.message).toBe("string")` and `expect(Array.isArray(toolNames)).toBe(true)` test JavaScript type system behavior, not library behavior.

4. **Cosmetic snapshot assertions**: Icon value tests (`expect(readToolRenderer.icon).toBe("≡")`) verify presentation details with no behavioral significance.

5. **Testing dependency behavior**: The `opencode-client.mcp-snapshot.test.ts` is tightly coupled to the exact SDK response format. If the SDK changes its response shape, tests pass but production breaks.

### 3. Coverage Gaps — Prioritized Module List

#### Tier 1: Pure Logic, Zero Mocking Needed (Highest ROI)

| Module | Current Coverage | Testable Functions | Why High ROI |
|--------|-----------------|-------------------|--------------|
| `src/models/model-transform.ts` | 0% / 7.89% | `fromClaudeModelInfo`, `fromCopilotModelInfo`, `fromOpenCodeModel`, `fromOpenCodeProvider` | 4 pure transform functions with zero I/O, rich branching (array vs object supports, error throws, field renaming). No imports. |
| `src/telemetry/graph-integration.ts` | 0% / 8.42% | `clampSampleRate`, `shouldSample`, `safeEmit`, `trackWorkflowExecution` + all tracker methods | **Zero external imports.** Fully self-contained pure logic. Sample rate clamping, noop vs active tracker, event emission, error swallowing. |
| `src/graph/annotation.ts` (gaps) | 64% / 56.82% | `createAtomicState`, `updateAtomicState`, `isFeature`, `isAtomicWorkflowState`, `createRalphState`, `updateRalphState`, `isRalphWorkflowState` | 7 untested functions, all pure and deterministic. Core annotation system already tested. |
| `src/sdk/types.ts` (runtime fns) | 0% / 25% | `stripProviderPrefix`, `formatModelDisplayName` | 2 small pure functions. Module is 95% type definitions. |
| `src/telemetry/telemetry-upload.ts` (pure fns) | 0% / 6.59% | `filterStaleEvents`, `splitIntoBatches` | 2 pure functions: timestamp-based filtering and array chunking. |
| `src/telemetry/telemetry.ts` (pure fn) | 0% / 10.32% | `shouldRotateId` | Pure date comparison (month/year boundary). Directly testable. |

#### Tier 2: Pure Utilities + Light Mocking

| Module | Current Coverage | Testable Functions | Why |
|--------|-----------------|-------------------|-----|
| `src/utils/markdown.ts` | 100% / 66.23% | `parseMarkdownFrontmatter` (uncovered branches) | Single pure function with complex parsing: arrays, objects, booleans, numbers, comments. Already 66% covered — filling gaps is straightforward. |
| `src/utils/copy.ts` | 20% / 9.09% | `normalizePath`, `isPathSafe`, `shouldExclude` (pure); `isFileEmpty`, `copyDir` (need temp dirs) | Pure helpers testable without mocks. Filesystem functions testable with temp dirs (pattern already used in `init.test.ts`). |
| `src/utils/detect.ts` (gaps) | 41.67% / 35.29% | `supportsColor`, `supportsTrueColor`, `supports256Color`, `isCommandInstalled`, `getCommandPath` | Color functions testable via `process.env` manipulation. Command functions depend on `Bun.which`. |
| `src/utils/merge.ts` | 0% / 4.17% | `mergeJsonFile` | Single async function with clear merge semantics. Needs temp files. |
| `src/utils/settings.ts` | 50% / 52.63% | `getModelPreference`, `saveModelPreference`, `getReasoningEffortPreference`, `saveReasoningEffortPreference`, `clearReasoningEffortPreference` | Priority resolution (local > global), merge-on-save. Needs temp dir. |
| `src/utils/atomic-config.ts` | 0% / 14.29% | `readAtomicConfig`, `saveAtomicConfig`, `getSelectedScm` | JSON CRUD with merge semantics. Needs temp dir. |
| `src/sdk/init.ts` | 0% / 11.76% | `initClaudeOptions`, `initOpenCodeConfigOverrides`, `initCopilotSessionOptions` | 3 factory functions returning static config objects. Trivial assertions on returned shapes. |

#### Tier 3: Renderer Logic + Event Processing

| Module | Current Coverage | Testable Functions | Why |
|--------|-----------------|-------------------|-----|
| `src/ui/tools/registry.ts` (render methods) | 40.74% / 32.32% | `.render()` on 9 renderer objects (`readToolRenderer`, `editToolRenderer`, `bashToolRenderer`, `writeToolRenderer`, `globToolRenderer`, `grepToolRenderer`, `defaultToolRenderer`, `mcpToolRenderer`, `taskToolRenderer`) | Each renderer's `render()` is a pure function taking `ToolRenderProps` and returning deterministic data. High complexity in `readToolRenderer.render()` (6+ fallback paths). |
| `src/ui/utils/transcript-formatter.ts` | 37.5% / 33.85% | `formatTranscript` (user messages, thinking traces, timestamps, non-HITL tools, parallel agents, streaming indicator, completion summary) | Single pure function, 180-line loop with nested conditionals. Only 1 of 14 transcript line types currently tested. |
| `src/telemetry/telemetry-session.ts` | 0% / 8.14% | `extractCommandsFromTranscript` | **Pure data transformation**: JSONL parse + regex command scan. Zero mocking needed. |
| `src/models/model-operations.ts` (gaps) | 73.33% / 38.04% | `listAvailableModels`, `listModelsForClaude` (with mock `sdkListModels`) | The dispatch and Claude-specific listing are testable with mock callbacks. OpenCode/Copilot listing requires real SDK. |

#### Tier 4: I/O-Heavy / Interactive (Low ROI for Unit Tests)

| Module | Current Coverage | Why Low ROI |
|--------|-----------------|-------------|
| `src/telemetry/telemetry-consent.ts` | 0% / 10.42% | Interactive `@clack/prompts` terminal I/O |
| `src/telemetry/telemetry-cli.ts` | 0% / 14.29% | Thin guard-then-delegate orchestration |
| `src/telemetry/telemetry-file-io.ts` | 0% / 15.38% | Almost entirely FS I/O (appendFileSync) |
| `src/telemetry/telemetry-tui.ts` | 0% / 8.81% | Stateful class, every method delegates to `appendEvent` |
| `src/sdk/opencode-client.ts` | 12.82% / 7.83% | 1708-line module requiring live SDK server or massive mocking |
| `src/commands/init.ts` (initCommand) | 66.67% / 12.84% | 280-line interactive CLI flow with `@clack/prompts` |
| `src/ui/components/parallel-agents-tree.tsx` | 10% / 7.23% | React component requiring OpenTUI test infrastructure |
| `src/ui/theme.tsx` | 10% / 52.04% | React component with theme provider |
| `src/utils/config-path.ts` | 0% / 10.81% | `import.meta.dir` dependency makes mocking hard |
| `src/utils/banner/banner.ts` | 0% / 16.67% | Side-effect-only `console.log` function |
| `src/sdk/tools/opencode-mcp-bridge.ts` | 0% / 14.89% | Filesystem writes, module-level mutable state, core logic not exported |

### 4. Impact Analysis: Path to 85%

Current: ~44.48% functions, ~48.71% lines across ~46 measured files.

To estimate what's needed: the coverage report measures ~46 files. With ~48.71% line coverage overall, approximately 51.29% of lines are uncovered. To reach 85%, we need to cover ~36.29 percentage points more, which means testing roughly 70% of currently uncovered lines.

**Estimated new tests needed by tier:**

| Tier | Est. Tests | Est. Line Coverage Gain | Cumulative |
|------|-----------|------------------------|------------|
| Tier 1 (pure logic) | ~80-100 | +12-15% → ~61-64% | 61-64% |
| Tier 2 (utils + light mocking) | ~60-80 | +10-13% → ~71-77% | 71-77% |
| Tier 3 (renderers + formatters) | ~60-80 | +8-12% → ~79-89% | 79-89% |
| Tier 4 (I/O-heavy) | ~20-40 | +3-5% → ~82-94% | 82-94% |

**Targeting Tier 1 + Tier 2 + Tier 3 should reach 85% without testing interactive flows or SDK integration code.**

### 5. Bun Testing Best Practices

#### Available APIs (`bun:test`)
- `test`, `describe`, `expect`, `beforeAll`, `beforeEach`, `afterEach`, `afterAll`
- `mock()` for creating mock functions (equivalent to `jest.fn()`)
- `spyOn(object, method)` for spying on existing methods
- `mock.module(path, factory)` for module mocking (runtime patching, no hoisting)

#### Coverage Configuration
```toml
[test]
coverage = true
coverageThreshold = { lines = 0.85, functions = 0.85 }
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageSkipTestFiles = true
coveragePathIgnorePatterns = ["src/cli.ts", "src/version.ts"]
```

#### Known Limitations
1. **No `__mocks__` directory support** — use `mock.module()` instead
2. **No built-in fake timers** — use SinonJS as workaround if needed
3. **`mock.module()` leaks across test files** — modules mocked in one file may affect others
4. **No mock hoisting** — module cache is patched at runtime; side effects from original module still execute
5. **`--preload` for early mocking** — to prevent original module evaluation, use `--preload` or `[test] preload` in `bunfig.toml`
6. **Coverage function names may be missing** — JSC limitation in lcov output

#### Best Practices for This Codebase
1. **Prefer pure function testing**: Most untested modules contain pure transformations that need zero mocking. Start there.
2. **Use dependency injection**: The codebase already uses this pattern well (e.g., `FsOps` in `copilot-manual.ts`). Extend it to other I/O-dependent modules.
3. **Use temp directories for filesystem tests**: Pattern from `init.test.ts` — `mkdtemp`, try/finally cleanup.
4. **Test structured return values, not message strings**: Assert on `result.themeChange`, `result.shouldExit`, etc., not on `result.message.includes("dark")`.
5. **Use `beforeEach` for test isolation**: Already well-practiced in `registry.test.ts`.
6. **Avoid `as any` for private state access**: Restructure tests to go through public API only.

Sources:
- [Bun Code Coverage Docs](https://bun.com/docs/test/code-coverage)
- [Bun Test Configuration](https://bun.sh/docs/test/configuration)
- [Bun Coverage Threshold Guide](https://bun.com/guides/test/coverage-threshold)
- [Bun Mocks Docs](https://bun.com/docs/test/mocks)
- [Bun Test Lifecycle](https://bun.com/docs/test/lifecycle)
- [Bun Mock Module Isolation Issue #12823](https://github.com/oven-sh/bun/issues/12823)

### 6. Existing Test Quality Issues to Fix

These existing tests should be improved as part of reaching 85%:

1. **`builtin-commands.test.ts`**: Replace 21 `.toContain(string)` assertions on `result.message` with assertions on structured properties. The test already uses `result.themeChange`, `result.shouldExit` etc. for some tests — extend this pattern to all.

2. **`model-operations.test.ts`**: Remove 7 instances of `(ops as any).cachedModels` private state injection. Instead, provide a mock `sdkListModels` callback that returns the desired model list, and call `listAvailableModels()` first to populate the cache through the public API.

3. **`transcript-formatter.hitl.test.ts`**: Expand from 1 test to cover all 14 `TranscriptLineType` variants. Replace `.includes("Pick one")` substring checks with structural assertions on `line.type` and `line.content` format.

4. **`tools/registry.test.ts`**: Remove trivial `Array.isArray` assertion. Add `.render()` method tests for all 9 renderer objects.

5. **`detect.test.ts`**: Add tests for the 7 missing exported functions, particularly color support functions (testable via `process.env` manipulation).

## Code References

### Test Files
- `src/commands/init.test.ts` — reconcileScmVariants (3 tests)
- `src/ui/utils/mcp-output.test.ts` — MCP snapshot view building (8 tests)
- `src/ui/utils/hitl-response.test.ts` — HITL response normalization (5 tests)
- `src/graph/types.test.ts` — type guards (100% coverage)
- `src/utils/detect.test.ts` — platform detection (5 of 12 functions)
- `src/ui/utils/format.test.ts` — formatting utilities (100% coverage)
- `src/config/index.test.ts` — agent/instruction loading
- `src/sdk/tools/schema-utils.test.ts` — Zod schema conversion (100% coverage)
- `src/graph/annotation.test.ts` — reducer system (64% funcs)
- `src/models/model-operations.test.ts` — model operations (73% funcs)
- `src/ui/components/task-order.test.ts` — topological sort (100% coverage)
- `src/ui/utils/transcript-formatter.hitl.test.ts` — 1 HITL scenario
- `src/ui/tools/registry.test.ts` — tool renderer registry (40% funcs)
- `src/graph/builder.test.ts` — graph builder DSL (81% funcs)
- `src/sdk/opencode-client.mcp-snapshot.test.ts` — MCP snapshot (3 tests)
- `src/graph/compiled.test.ts` — graph execution engine (89% funcs)
- `src/ui/commands/builtin-commands.test.ts` — command handlers (89% funcs)
- `src/ui/commands/registry.test.ts` — CommandRegistry (90% funcs)

### Highest-Priority Untested Source Files
- `src/models/model-transform.ts:75-249` — 4 pure transform functions
- `src/telemetry/graph-integration.ts:72-176` — fully self-contained tracker logic
- `src/graph/annotation.ts:349-685` — 7 untested state/type-guard functions
- `src/utils/copy.ts:17-30` — pure path utilities (`normalizePath`, `isPathSafe`)
- `src/utils/markdown.ts:34-113` — uncovered parsing branches
- `src/telemetry/telemetry-session.ts:92-133` — `extractCommandsFromTranscript` pure function
- `src/telemetry/telemetry-upload.ts:128-198` — `filterStaleEvents`, `splitIntoBatches` pure functions
- `src/telemetry/telemetry.ts:116-137` — `shouldRotateId` pure date logic
- `src/ui/tools/registry.ts:64-738` — 9 renderer `.render()` methods
- `src/ui/utils/transcript-formatter.ts:79-310` — `formatTranscript` + private helpers

## Architecture Documentation

### Testing Patterns in Use
- **Dependency injection for FS**: `copilot-manual.ts` uses `FsOps` interface for test isolation (`config/index.test.ts`)
- **Temp directory fixtures**: `init.test.ts` uses `mkdtemp` with try/finally cleanup
- **Mock objects matching SDK shapes**: `opencode-client.mcp-snapshot.test.ts` constructs typed mock SDK clients
- **Factory helpers**: `task-order.test.ts` uses `task()` factory for clean test data
- **`beforeEach` isolation**: `registry.test.ts` creates fresh `CommandRegistry` per test

### Test Runner Configuration
- Runtime: Bun with `bun test`
- Config: `bunfig.toml` with coverage, thresholds, reporters
- TypeScript: strict mode, JSX with `@opentui/react`
- Linting: oxlint
- Pre-commit: lefthook

## Historical Context (from research/)

- `research/docs/2026-02-14-testing-infrastructure-and-dev-setup.md` — Prior research on testing infrastructure. Found 5 test files (now 18) with quality assessment. Planned pre-commit hooks and coverage thresholds. Established testing philosophy: "test real behavior, not trivial properties."
- `research/docs/2026-02-12-bun-test-failures-root-cause-analysis.md` — 104 tests failed because source code evolved but tests were not updated. Tests were removed. Categories: agent model field mismatches, sentMessages tracking, theme migration, icon changes, Claude SDK refactor.
- `research/docs/2026-02-14-failing-tests-mcp-config-discovery.md` — MCP config discovery test failures for project-level `.mcp.json`.
- `specs/testing-infrastructure-and-dev-setup.md` — Formal spec for testing infrastructure.
- `specs/bun-test-failures-remediation.md` — Formal spec for remediating historical test failures.

## Related Research

- `research/docs/2026-02-14-testing-infrastructure-and-dev-setup.md`
- `research/docs/2026-02-12-bun-test-failures-root-cause-analysis.md`
- `research/docs/2026-02-14-failing-tests-mcp-config-discovery.md`
- `specs/testing-infrastructure-and-dev-setup.md`
- `specs/bun-test-failures-remediation.md`

## Open Questions

1. **Should `src/sdk/opencode-client.ts` be tested at the unit level?** At 1708 lines and 7.83% coverage, it's the largest untested module, but almost all methods require a live SDK server. Extracting pure helper functions (like `parseOpenCodeMcpToolId`, `mapOpenCodeMcpStatusToAuth`, `resolveModelForPrompt`) into a separate module would make them testable.

2. **Should telemetry modules be excluded from coverage?** The telemetry subsystem is fail-safe by design (all errors silently swallowed). Many modules are thin orchestration over file I/O. If excluded via `coveragePathIgnorePatterns`, the effective coverage of remaining code would be higher. However, the pure functions within telemetry (Tier 1) are worth testing.

3. **How to handle `mock.module()` leak across files?** Bun's module mocking leaks across test files. For modules that require `mock.module()`, consider using `--preload` or restructuring to use dependency injection instead.

4. **Should `.tsx` component files be tested?** `parallel-agents-tree.tsx`, `theme.tsx`, and `animated-blink-indicator.tsx` are at near-zero coverage. Testing React components with OpenTUI requires additional infrastructure. These could be excluded from coverage thresholds via `coveragePathIgnorePatterns` if component testing is deferred.
