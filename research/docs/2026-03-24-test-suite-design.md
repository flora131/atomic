---
date: 2026-03-24 19:56:33 UTC
researcher: Claude Opus 4.6
git_commit: 0f4fe11a0ad47843f269601751788b6e7ff92058
branch: lavaman131/hotfix/interrupt-workflows
repository: atomic
topic: "Comprehensive Test Suite Design for 85%+ Coverage"
tags: [research, testing, coverage, bun, opentui, architecture, test-design, anti-patterns]
status: complete
last_updated: 2026-03-24
last_updated_by: Claude Opus 4.6
last_updated_note: "Corrected OpenTUI testing section: discovered full headless test toolkit (testRender, mockInput, mockMouse, ManualClock). Updated component coverage projections from 70% to 80%."
---

# Test Suite Design: Achieving 85%+ Coverage

## Research Question

Design a robust test suite from scratch for the Atomic CLI codebase that maintains at least 85% line coverage, incorporating Bun test runner best practices, OpenTUI component testing strategies, and testing anti-pattern avoidance.

## Summary

The Atomic CLI codebase contains **588 source files** across 5 architectural layers with **0 existing test files** (all previously deleted). The test root is `tests/` (configured in `bunfig.toml`). Current coverage thresholds are set at 80% but need to be raised to 85%.

The codebase is highly testable due to its layered architecture with strict dependency rules, extensive use of pure functions, and well-defined interfaces. The test suite is organized into **4 tiers**: unit tests for pure functions, integration tests for cross-layer interactions, component tests for UI logic, and E2E tests via tmux-cli.

This document provides a complete test file manifest, testing strategies per module, mock boundaries, and coverage projections.

---

## 1. Test Infrastructure Configuration

### 1.1 Current `bunfig.toml` Test Configuration

```toml
[test]
root = "tests"
timeout = 10000
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { lines = 0.80, functions = 0.80, statements = 0.80 }
coverageSkipTestFiles = true
```

### 1.2 Required Changes for 85% Target

```toml
[test]
root = "tests"
timeout = 10000
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { lines = 0.85, functions = 0.85, statements = 0.85 }
coverageSkipTestFiles = true
```

### 1.3 Coverage Exclusions (Already Configured)

These files are excluded from coverage measurement in `bunfig.toml` — they represent entry points, SDK-dependent I/O, and interactive flows that are better covered by E2E tests:

| Excluded Path | Reason |
|---|---|
| `src/cli.ts` | Entry point |
| `src/version.ts` | Generated |
| `src/components/animated-blink-indicator.tsx` | Animation component (visual-only) |
| `src/components/parallel-agents-tree.tsx` | Complex OpenTUI render tree |
| `src/components/task-list-indicator.tsx` | OpenTUI component |
| `src/theme/index.tsx` | OpenTUI provider |
| `src/services/agents/clients/claude.ts` | Live SDK integration |
| `src/services/agents/clients/opencode.ts` | Live SDK integration |
| `src/services/agents/tools/opencode-mcp-bridge.ts` | SDK-dependent bridge |
| `src/commands/cli/init.ts` | Interactive CLI flow |
| `src/commands/tui/agent-commands.ts` | TUI command handler |
| `src/commands/tui/workflow-commands.ts` | TUI command handler |
| `src/services/telemetry/**` | Fail-safe I/O orchestration (12 files) |
| `src/services/workflows/graph/nodes.ts` | SDK subprocess-dependent |
| `src/services/workflows/graph/subagent-registry.ts` | SDK-dependent |
| `src/services/workflows/graph/errors.ts` | Error types |
| `src/services/config/config-path.ts` | Filesystem-dependent |
| `src/theme/banner/banner.ts` | ASCII art (visual-only) |
| `src/services/workflows/session.ts` | SDK session management |

**Effective testable surface:** ~564 files after exclusions.

---

## 2. Source Module Catalog by Layer

### 2.1 Shared Layer (17 files)

| File | Exports | Testability | Test Priority |
|---|---|---|---|
| `lib/markdown.ts` | `parseMarkdownFrontmatter` | Pure (lazy-loads yaml) | HIGH |
| `lib/merge.ts` | `mergeJsonFile` | I/O (readFile/writeFile) | MEDIUM |
| `lib/path-root-guard.ts` | `isPathWithinRoot`, `assertPathWithinRoot`, `assertRealPathWithinRoot` | Pure + I/O (realpath) | HIGH |
| `lib/spawn.ts` | `runCommand`, `prependPath`, `getHomeDir`, `getBunBinDir` | I/O (Bun.spawn, env) | LOW |
| `lib/ui/format.ts` | `formatDuration`, `formatTimestamp`, `normalizeMarkdownNewlines`, `joinThinkingBlocks`, `collapseNewlines`, `truncateText` | **Pure** | **CRITICAL** |
| `lib/ui/navigation.ts` | `navigateUp`, `navigateDown` | **Pure** | HIGH |
| `lib/ui/hitl-response.ts` | `formatHitlDisplayText`, `normalizeHitlAnswer`, `getHitlResponseRecord` | **Pure** | **CRITICAL** |
| `lib/ui/mcp-output.ts` | `applyMcpServerToggles`, `getActiveMcpServers`, `buildMcpSnapshotView` | **Pure** | **CRITICAL** |
| `lib/ui/agent-list-output.ts` | `buildAgentListView` | **Pure** | HIGH |
| `lib/ui/clipboard.ts` | `createClipboardAdapter` | I/O (Bun.spawnSync, stdout) | LOW |
| `lib/ui/mention-parsing.ts` | `hasAnyAtReferenceToken`, `processFileMentions` | I/O (fs.statSync, readFileSync) | MEDIUM |
| `lib/ui/markdown-selection-patch.ts` | Monkey-patches MarkdownRenderable | Side effect | SKIP |
| `lib/ui/index.ts` | Barrel re-export | N/A | SKIP |
| `types/chat.ts` | Type re-exports | Types only | SKIP |
| `types/command.ts` | Type definitions | Types only | SKIP |
| `types/ui.ts` | Type definitions | Types only | SKIP |
| `types/parallel-agents.ts` | Type definitions | Types only | SKIP |

### 2.2 Service Layer (301 files)

#### services/events/ (82 files) — Pub/Sub Architecture

| Sub-module | Key Exports | Testability |
|---|---|---|
| `event-bus.ts` | `EventBus` class | **Pure** — no I/O, fully testable |
| `bus-events/` (~30 event schemas) | Zod schemas, BusEvent types | **Pure** — schema validation tests |
| `adapters/claude-adapter.ts` | Stream adapter for Claude SDK | SDK mock needed |
| `adapters/copilot-adapter.ts` | Stream adapter for Copilot SDK | SDK mock needed |
| `adapters/opencode-adapter.ts` | Stream adapter for OpenCode SDK | SDK mock needed |
| `adapters/subagent-adapter.ts` | Subagent stream handling | Integration test |
| `batch-dispatcher.ts` | Batched event dispatch | **Pure** — timer-based |
| `coalescing.ts` | Event coalescing logic | **Pure** |
| `consumers/stream-pipeline-consumer.ts` | Event→Part pipeline | **Pure** transformer |
| `consumers/echo-suppressor.ts` | Echo detection | **Pure** |
| `pipeline-logger.ts` | Logging utilities | Side effect (console) |
| `registry.ts` | Event registry | **Pure** |
| `hooks.ts` | Event hook utilities | Integration |

#### services/workflows/ (83 files) — Graph Engine

| Sub-module | Key Exports | Testability |
|---|---|---|
| `dsl/define-workflow.ts` | `defineWorkflow()` chainable builder | **Pure** — critical test target |
| `dsl/compiler.ts` | DSL→Graph compilation | **Pure** |
| `dsl/state-compiler.ts` | State compilation | **Pure** |
| `dsl/agent-resolution.ts` | Agent name resolution | **Pure** |
| `dsl/types.ts` | DSL type definitions | Types |
| `verification/reachability.ts` | Graph reachability check | **Pure** — algorithmic |
| `verification/termination.ts` | Termination proof | **Pure** — algorithmic |
| `verification/deadlock-freedom.ts` | Deadlock detection | **Pure** — algorithmic |
| `verification/loop-bounds.ts` | Loop bound analysis | **Pure** — algorithmic |
| `verification/state-data-flow.ts` | State flow analysis | **Pure** — algorithmic |
| `verification/graph-encoder.ts` | Graph encoding | **Pure** |
| `verification/reporter.ts` | Verification report | **Pure** |
| `graph/builder.ts` | `GraphBuilder` fluent API | **Pure** — builder pattern |
| `graph/annotation.ts` | Graph annotation | **Pure** |
| `graph/types.ts` | Graph type definitions | Types |
| `graph/state-validator.ts` | State validation | **Pure** |
| `graph/provider-registry.ts` | Provider registration | **Pure** |
| `graph/agent-providers.ts` | Agent→provider mapping | **Pure** with mocks |
| `conductor/conductor.ts` | Workflow orchestration | Integration — needs session mock |
| `conductor/types.ts` | Conductor types | Types |
| `conductor/event-bridge.ts` | Event routing | Integration |
| `conductor/truncate.ts` | Context truncation | **Pure** |
| `ralph/definition.ts` | Ralph workflow definition | **Pure** — uses defineWorkflow |
| `ralph/review-loop-terminator.ts` | Review loop logic | **Pure** |
| `runtime-contracts.ts` | Runtime task types | Types |
| `task-identity-service.ts` | Task ID generation | **Pure** |
| `task-result-envelope.ts` | Task result wrapping | **Pure** |
| `helpers/workflow-input-resolver.ts` | Input resolution | **Pure** |

#### services/config/ (17 files)

| Sub-module | Testability |
|---|---|
| `index.ts`, `settings.ts` | I/O (file reads) — need fs mock |
| `atomic-config.ts`, `atomic-global-config.ts` | I/O — need fs mock |
| `claude-config.ts`, `opencode-config.ts` | I/O — need fs mock |
| `mcp-config.ts` | I/O — need fs mock |
| `provider-discovery*.ts` | I/O with pure transform layer |
| `load-agents.ts`, `load-copilot-*.ts` | I/O — need fs mock |
| `resolve-copilot-skills.ts` | **Pure** transform |

#### services/agents/ (90 files)

| Sub-module | Testability |
|---|---|
| `contracts/*.ts` (5 files) | Type definitions — interface tests |
| `tools/discovery.ts` | **Pure** — tool discovery logic |
| `tools/schema-utils.ts` | **Pure** — schema transformation |
| `tools/truncate.ts` | **Pure** — text truncation |
| `tools/todo-write.ts` | **Pure** — todo item handling |
| `init.ts` | I/O — agent initialization |
| `base-client.ts` | Abstract class — tested via implementations |
| `provider-events.ts` | Event type mapping — **Pure** |
| `subagent-tool-policy.ts` | **Pure** — policy logic |
| `clients/claude/*.ts` (12 files) | SDK-dependent — integration test |
| `clients/copilot/*.ts` (6 files) | SDK-dependent — integration test |
| `clients/opencode/*.ts` (16 files) | SDK-dependent — integration test |
| `clients/skill-invocation.ts` | **Pure** — skill routing logic |

#### services/models/ (6 files)

| File | Testability |
|---|---|
| `model-operations.ts` | **Pure** — model listing, filtering |
| `model-transform.ts` | **Pure** — model data transforms |
| `types.ts` | Types |

#### services/system/ (5 files)

| File | Testability |
|---|---|
| `copy.ts` | I/O (fs operations) |
| `detect.ts` | I/O (env/platform detection) |

#### services/agent-discovery/ (4 files)

| File | Testability |
|---|---|
| `index.ts` | I/O — needs fs mock |
| `session.ts` | I/O — needs SDK mock |
| `types.ts` | Types |

#### services/terminal/ (2 files)

| File | Testability |
|---|---|
| `tree-sitter-assets.ts` | I/O — binary loading |
| `web-tree-sitter-shim.ts` | I/O — WASM loading |

### 2.3 State Layer (134 files)

#### state/parts/ (8 files) — **Pure reducers, highest test ROI**

| File | Key Exports | Testability |
|---|---|---|
| `types.ts` | Part union, type guards | **Pure** — `isTextPart()` etc. |
| `id.ts` | `createPartId()`, `_resetPartCounter()` | **Pure** — ID generation |
| `store.ts` | `binarySearchById`, `upsertPart`, `findLastPartIndex` | **Pure** — critical algorithms |
| `handlers.ts` | `handleTextDelta` | **Pure** — reducer |
| `truncation.ts` | `truncateStageParts`, `createDefaultPartsTruncationConfig` | **Pure** — extensive logic |
| `guards.ts` | `shouldFinalizeOnToolComplete`, `hasActiveForegroundAgents`, `shouldFinalizeDeferredStream` | **Pure** — boolean logic |
| `stream-pipeline.ts` | Stream event→Part pipeline | **Pure** transformer |
| `index.ts` | Barrel | SKIP |

#### state/streaming/ (6 files)

| File | Testability |
|---|---|
| `pipeline.ts` | **Pure** — event routing |
| `pipeline-tools.ts` | **Pure** — tool event handling |
| `pipeline-thinking.ts` | **Pure** — reasoning event handling |
| `pipeline-agents.ts` | **Pure** — agent event handling |
| `pipeline-workflow.ts` | **Pure** — workflow event handling |
| `pipeline-types.ts` | Types |

#### state/chat/ (103 files — 8 sub-modules)

| Sub-module | Files | Testability |
|---|---|---|
| `shared/types/` | ~10 | Types — SKIP |
| `shared/helpers/` | ~5 | **Pure** — test these |
| `agent/` | ~12 | Mix — pure state + hooks |
| `command/` | ~8 | **Pure** command execution context |
| `composer/` | ~10 | Mix — pure logic + hooks |
| `controller/` | ~8 | Integration — bridges UI and state |
| `keyboard/` | ~10 | **Pure** key→action mapping |
| `session/` | ~12 | I/O — session lifecycle (SDK) |
| `shell/` | ~15 | Mix — pure state + OpenTUI hooks |
| `stream/` | ~13 | Mix — pure transforms + SDK subscriptions |

#### state/runtime/ (7 files)

| File | Testability |
|---|---|
| `chat-ui-controller.ts` | Integration — factory |
| `stream-run-runtime.ts` | Integration — runtime state |

### 2.4 UI Layer (86 files)

#### theme/ (14 files)

| File | Testability |
|---|---|
| `types.ts` | Types — SKIP |
| `palettes.ts` | **Pure** — `getCatppuccinPalette()` |
| `colors.ts` | **Pure** — `COLORS` constant |
| `helpers.ts` | **Pure** — `getThemeByName`, `getMessageColor`, `createCustomTheme` |
| `themes.ts` | **Pure** — theme objects |
| `spacing.ts` | **Pure** — spacing constants |
| `icons.ts` | **Pure** — icon constants |
| `spinner-verbs.ts` | **Pure** — spinner text |
| `syntax.ts` | **Pure** — syntax highlighting config |
| `context.tsx` | React context — hook test |
| `index.tsx` | OpenTUI provider — E2E |
| `banner/` (3 files) | I/O + constants |

#### components/ (67 files)

| Component | Testability |
|---|---|
| `tool-registry/registry/*.ts` (21 files) | **Pure** — registry logic, catalog, renderers |
| `model-selector/helpers.ts` | **Pure** — selection logic |
| `transcript/*.ts` (5 files) | **Pure** — transcript formatting |
| `*.tsx` components (40+ files) | OpenTUI render — logic extraction needed |

#### hooks/ (4 files)

| File | Testability |
|---|---|
| `use-animation-tick.tsx` | OpenTUI hook — timer-based |
| `use-message-queue.ts` | **Pure** state management hook |
| `use-verbose-mode.ts` | **Pure** boolean toggle hook |
| `index.ts` | Barrel — SKIP |

#### screens/ (1 file)

| File | Testability |
|---|---|
| `chat-screen.tsx` | Integration — E2E test only |

### 2.5 Commands Layer (41 files)

| Sub-module | Testability |
|---|---|
| `core/registry.ts` | **Pure** — command registration |
| `catalog/agents/*.ts` | I/O — discovery logic |
| `catalog/skills/*.ts` | I/O — discovery logic |
| `cli/chat.ts` | I/O — CLI chat flow |
| `cli/config.ts` | I/O — config management |
| `tui/*.ts` | Integration — TUI commands |

---

## 3. Test File Manifest

### 3.1 Directory Structure

```
tests/
├── lib/                          # Shared layer tests
│   ├── markdown.test.ts
│   ├── merge.test.ts
│   ├── path-root-guard.test.ts
│   └── ui/
│       ├── format.test.ts
│       ├── navigation.test.ts
│       ├── hitl-response.test.ts
│       ├── mcp-output.test.ts
│       ├── agent-list-output.test.ts
│       ├── mention-parsing.test.ts
│       └── clipboard.test.ts
│
├── services/                     # Service layer tests
│   ├── events/
│   │   ├── event-bus.test.ts
│   │   ├── bus-events.test.ts         # Schema validation
│   │   ├── batch-dispatcher.test.ts
│   │   ├── coalescing.test.ts
│   │   ├── registry.test.ts
│   │   ├── adapters/
│   │   │   ├── claude-adapter.test.ts
│   │   │   ├── copilot-adapter.test.ts
│   │   │   ├── opencode-adapter.test.ts
│   │   │   └── subagent-adapter.test.ts
│   │   └── consumers/
│   │       ├── stream-pipeline-consumer.test.ts
│   │       └── echo-suppressor.test.ts
│   │
│   ├── workflows/
│   │   ├── dsl/
│   │   │   ├── define-workflow.test.ts
│   │   │   ├── compiler.test.ts
│   │   │   ├── state-compiler.test.ts
│   │   │   ├── agent-resolution.test.ts
│   │   │   └── types.test.ts
│   │   ├── verification/
│   │   │   ├── reachability.test.ts
│   │   │   ├── termination.test.ts
│   │   │   ├── deadlock-freedom.test.ts
│   │   │   ├── loop-bounds.test.ts
│   │   │   ├── state-data-flow.test.ts
│   │   │   ├── graph-encoder.test.ts
│   │   │   └── reporter.test.ts
│   │   ├── graph/
│   │   │   ├── builder.test.ts
│   │   │   ├── annotation.test.ts
│   │   │   ├── state-validator.test.ts
│   │   │   ├── provider-registry.test.ts
│   │   │   ├── agent-providers.test.ts
│   │   │   └── types.test.ts
│   │   ├── conductor/
│   │   │   ├── conductor.test.ts
│   │   │   ├── event-bridge.test.ts
│   │   │   └── truncate.test.ts
│   │   ├── ralph/
│   │   │   ├── definition.test.ts
│   │   │   └── review-loop-terminator.test.ts
│   │   ├── runtime-contracts.test.ts
│   │   ├── task-identity-service.test.ts
│   │   ├── task-result-envelope.test.ts
│   │   └── helpers/
│   │       └── workflow-input-resolver.test.ts
│   │
│   ├── config/
│   │   ├── settings.test.ts
│   │   ├── atomic-config.test.ts
│   │   ├── claude-config.test.ts
│   │   ├── opencode-config.test.ts
│   │   ├── mcp-config.test.ts
│   │   ├── provider-discovery.test.ts
│   │   └── index.test.ts
│   │
│   ├── agents/
│   │   ├── tools/
│   │   │   ├── discovery.test.ts
│   │   │   ├── schema-utils.test.ts
│   │   │   └── truncate.test.ts
│   │   ├── provider-events.test.ts
│   │   ├── subagent-tool-policy.test.ts
│   │   ├── init.test.ts
│   │   ├── types.test.ts
│   │   └── clients/
│   │       ├── claude.test.ts         # Integration with SDK mock
│   │       ├── copilot.test.ts        # Integration with SDK mock
│   │       └── opencode.test.ts       # Integration with SDK mock
│   │
│   ├── models/
│   │   ├── model-operations.test.ts
│   │   └── model-transform.test.ts
│   │
│   ├── system/
│   │   ├── copy.test.ts
│   │   └── detect.test.ts
│   │
│   └── agent-discovery/
│       ├── index.test.ts
│       └── session.test.ts
│
├── state/                        # State layer tests
│   ├── parts/
│   │   ├── types.test.ts             # Type guards
│   │   ├── id.test.ts                # Part ID generation
│   │   ├── store.test.ts             # Binary search, upsert
│   │   ├── handlers.test.ts          # Text delta handling
│   │   ├── truncation.test.ts        # Stage truncation
│   │   ├── guards.test.ts            # Agent lifecycle guards
│   │   └── stream-pipeline.test.ts   # Event→Part pipeline
│   │
│   ├── streaming/
│   │   ├── pipeline.test.ts
│   │   ├── pipeline-tools.test.ts
│   │   ├── pipeline-thinking.test.ts
│   │   ├── pipeline-agents.test.ts
│   │   └── pipeline-workflow.test.ts
│   │
│   ├── chat/
│   │   ├── shared/
│   │   │   └── helpers/
│   │   │       └── messages.test.ts
│   │   ├── agent/                     # Agent state tests
│   │   ├── command/                   # Command context tests
│   │   ├── composer/                  # Composer logic tests
│   │   ├── keyboard/                  # Key mapping tests
│   │   ├── session/                   # Session lifecycle tests
│   │   ├── shell/                     # Shell state tests
│   │   └── stream/                    # Stream lifecycle tests
│   │
│   └── runtime/
│       ├── chat-ui-controller.test.ts
│       └── stream-run-runtime.test.ts
│
├── components/                   # UI layer tests
│   ├── tool-registry/
│   │   └── registry.test.ts
│   ├── model-selector/
│   │   └── helpers.test.ts
│   └── transcript/
│       └── transcript-formatter.test.ts
│
├── theme/
│   ├── helpers.test.ts
│   ├── palettes.test.ts
│   └── themes.test.ts
│
├── commands/
│   ├── core/
│   │   └── registry.test.ts
│   └── tui/
│       └── builtin-commands.test.ts
│
└── packages/
    └── workflow-sdk/
        └── define-workflow.test.ts
```

**Total test files: ~100**

### 3.2 Naming Conventions

- Test files mirror source paths: `src/lib/ui/format.ts` → `tests/lib/ui/format.test.ts`
- Use `.test.ts` extension (not `.spec.ts`)
- Suite files for large tests: `*.suite.ts` (imported by the main `.test.ts`)
- Test support/fixtures: `*.test-support.ts` (shared helpers)

---

## 4. Testing Strategy by Category

### 4.1 Tier 1: Pure Function Unit Tests (Highest ROI)

**Target: ~60% of all test files. Covers the bulk of line coverage.**

Pure functions have no side effects, no I/O, and no dependencies on external services. They are the most reliable, fastest, and highest-coverage tests.

#### Example: `lib/ui/format.test.ts`

```typescript
import { test, expect, describe } from "bun:test";
import {
  formatDuration,
  formatTimestamp,
  normalizeMarkdownNewlines,
  joinThinkingBlocks,
  collapseNewlines,
  truncateText,
} from "@/lib/ui/format.ts";

describe("formatDuration", () => {
  test("returns 0s for zero or negative", () => {
    expect(formatDuration(0)).toEqual({ text: "0s", ms: 0 });
    expect(formatDuration(-100)).toEqual({ text: "0s", ms: 0 });
  });

  test("rounds up sub-second to 1s", () => {
    expect(formatDuration(500).text).toBe("1s");
  });

  test("shows whole seconds under 60s", () => {
    expect(formatDuration(2500).text).toBe("2s");
    expect(formatDuration(59999).text).toBe("59s");
  });

  test("shows minutes and seconds", () => {
    expect(formatDuration(90000).text).toBe("1m 30s");
  });

  test("shows just minutes when seconds are zero", () => {
    expect(formatDuration(120000).text).toBe("2m");
  });
});

describe("normalizeMarkdownNewlines", () => {
  test("trims and normalizes CRLF", () => {
    expect(normalizeMarkdownNewlines("  hello\r\nworld  ")).toBe("hello\nworld");
  });

  test("converts markdown checkboxes to unicode", () => {
    expect(normalizeMarkdownNewlines("- [ ] task")).toBe("- ☐ task");
    expect(normalizeMarkdownNewlines("- [x] done")).toBe("- ☑ done");
  });

  test("returns empty for blank input", () => {
    expect(normalizeMarkdownNewlines("   ")).toBe("");
  });
});

describe("truncateText", () => {
  test("returns unchanged text under limit", () => {
    expect(truncateText("Short", 10)).toBe("Short");
  });

  test("truncates with ellipsis", () => {
    expect(truncateText("Hello World Long", 8)).toBe("Hello...");
  });
});
```

#### Example: `state/parts/store.test.ts`

```typescript
import { test, expect, describe, beforeEach } from "bun:test";
import { binarySearchById, upsertPart, findLastPartIndex } from "@/state/parts/store.ts";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";
import type { Part, TextPart } from "@/state/parts/types.ts";

function makeTextPart(id: string, content: string): TextPart {
  return {
    id: id,
    type: "text",
    content,
    isStreaming: false,
    createdAt: new Date().toISOString(),
  };
}

describe("binarySearchById", () => {
  test("returns index for existing part", () => {
    const parts = [makeTextPart("a", ""), makeTextPart("b", ""), makeTextPart("c", "")];
    expect(binarySearchById(parts, "b")).toBe(1);
  });

  test("returns bitwise complement for missing part", () => {
    const parts = [makeTextPart("a", ""), makeTextPart("c", "")];
    const result = binarySearchById(parts, "b");
    expect(result).toBeLessThan(0);
    expect(~result).toBe(1); // insertion point
  });

  test("handles empty array", () => {
    expect(~binarySearchById([], "a")).toBe(0);
  });
});

describe("upsertPart", () => {
  test("inserts at correct sorted position", () => {
    const parts = [makeTextPart("a", "first"), makeTextPart("c", "third")];
    const newPart = makeTextPart("b", "second");
    const result = upsertPart(parts, newPart);
    expect(result).toHaveLength(3);
    expect(result[1]!.id).toBe("b");
  });

  test("replaces existing part with same ID", () => {
    const parts = [makeTextPart("a", "old")];
    const updated = makeTextPart("a", "new");
    const result = upsertPart(parts, updated);
    expect(result).toHaveLength(1);
    expect((result[0] as TextPart).content).toBe("new");
  });
});
```

#### Example: `state/parts/truncation.test.ts`

```typescript
import { test, expect, describe } from "bun:test";
import {
  truncateStageParts,
  createDefaultPartsTruncationConfig,
} from "@/state/parts/truncation.ts";
import type { Part, WorkflowStepPart, ToolPart, TextPart, ReasoningPart } from "@/state/parts/types.ts";

function makeWorkflowStep(nodeId: string, workflowId: string): WorkflowStepPart {
  return {
    id: `part_step_${nodeId}`,
    type: "workflow-step",
    workflowId,
    nodeId,
    status: "completed",
    startedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function makeToolPart(id: string, status: "completed" | "error" = "completed"): ToolPart {
  return {
    id,
    type: "tool",
    toolCallId: `call_${id}`,
    toolName: "Bash",
    input: { command: "echo test" },
    state: status === "completed"
      ? { status: "completed", output: "output", durationMs: 100 }
      : { status: "error", error: "failed" },
    createdAt: new Date().toISOString(),
  };
}

describe("truncateStageParts", () => {
  const config = createDefaultPartsTruncationConfig({ minTruncationParts: 2 });
  const wfId = "wf1";

  test("replaces truncatable parts with summary", () => {
    const parts: Part[] = [
      makeWorkflowStep("research", wfId),
      makeToolPart("t1"),
      makeToolPart("t2"),
      makeToolPart("t3"),
      makeWorkflowStep("plan", wfId),
    ];

    const result = truncateStageParts(parts, "research", wfId, config);
    expect(result.truncated).toBe(true);
    expect(result.removedCount).toBe(3);
    expect(result.parts.some(p => p.type === "truncation")).toBe(true);
  });

  test("preserves parts below minimum threshold", () => {
    const highConfig = createDefaultPartsTruncationConfig({ minTruncationParts: 100 });
    const parts: Part[] = [
      makeWorkflowStep("research", wfId),
      makeToolPart("t1"),
    ];

    const result = truncateStageParts(parts, "research", wfId, highConfig);
    expect(result.truncated).toBe(false);
  });

  test("returns noop for unknown nodeId", () => {
    const parts: Part[] = [makeWorkflowStep("research", wfId)];
    const result = truncateStageParts(parts, "nonexistent", wfId, config);
    expect(result.truncated).toBe(false);
  });
});
```

### 4.2 Tier 2: Integration Tests with Mocks

**Target: ~25% of test files. Tests cross-layer interactions.**

#### Mock Boundaries (The Iron Rules)

Based on the testing anti-patterns skill:

1. **Mock at the SDK boundary, never mock pure logic**
   - Mock: `@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk`, `@github/copilot-sdk`
   - Mock: `fs/promises` (readFile, writeFile) for config tests
   - Do NOT mock: EventBus, GraphBuilder, Part store, or any pure function

2. **Mock the complete data structure**
   - When mocking SDK events, include all fields the real event has
   - When mocking session objects, include all methods the real session exposes

3. **Use `mock.module()` for SDK mocking**

```typescript
import { test, expect, describe, beforeEach, mock } from "bun:test";

// Mock the SDK module at the boundary
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  ClaudeAgentSDK: class {
    createSession() {
      return {
        id: "test-session",
        send: mock(() => Promise.resolve()),
        destroy: mock(() => Promise.resolve()),
      };
    }
  }
}));
```

#### Example: `services/events/event-bus.test.ts`

```typescript
import { test, expect, describe, beforeEach } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ validatePayloads: false });
  });

  test("dispatches to typed handlers", () => {
    const received: unknown[] = [];
    bus.on("stream.text.delta", (event) => received.push(event));

    bus.publish({
      type: "stream.text.delta",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "hello", messageId: "m1" },
    });

    expect(received).toHaveLength(1);
  });

  test("unsubscribe removes handler", () => {
    const received: unknown[] = [];
    const unsub = bus.on("stream.text.delta", (event) => received.push(event));
    unsub();

    bus.publish({
      type: "stream.text.delta",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "hello", messageId: "m1" },
    });

    expect(received).toHaveLength(0);
  });

  test("wildcard handlers receive all events", () => {
    const received: string[] = [];
    bus.onAll((event) => received.push(event.type));

    bus.publish({
      type: "stream.text.delta",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    });

    expect(received).toEqual(["stream.text.delta"]);
  });

  test("handler errors do not break other handlers", () => {
    const received: string[] = [];
    bus.on("stream.text.delta", () => { throw new Error("boom"); });
    bus.on("stream.text.delta", () => received.push("ok"));

    bus.publish({
      type: "stream.text.delta",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    });

    expect(received).toEqual(["ok"]);
  });

  test("clear removes all handlers", () => {
    bus.on("stream.text.delta", () => {});
    bus.onAll(() => {});
    expect(bus.handlerCount).toBeGreaterThan(0);

    bus.clear();
    expect(bus.handlerCount).toBe(0);
  });

  test("schema validation rejects invalid events when enabled", () => {
    const validatingBus = new EventBus({ validatePayloads: true });
    const errors: unknown[] = [];
    validatingBus.onInternalError((e) => errors.push(e));

    // Publish with missing required fields
    validatingBus.publish({
      type: "stream.text.delta",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: {} as any, // Missing delta and messageId
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});
```

#### Example: Config test with fs mock

```typescript
import { test, expect, describe, beforeEach, mock } from "bun:test";
import { vol } from "memfs"; // Or inline mock

// Mock fs at the module boundary
mock.module("fs/promises", () => ({
  readFile: mock(async (path: string) => {
    const files: Record<string, string> = {
      "/project/.claude/settings.json": JSON.stringify({ model: "opus" }),
    };
    if (files[path]) return files[path];
    throw new Error(`ENOENT: ${path}`);
  }),
  writeFile: mock(async () => {}),
  access: mock(async () => {}),
  mkdir: mock(async () => {}),
}));
```

### 4.3 Tier 3: Component Tests (via OpenTUI `testRender`)

**Target: ~10% of test files. Tests component rendering and interaction.**

OpenTUI provides `testRender` from `@opentui/react/test-utils` for headless component testing:

1. **Render components headlessly** — use `testRender` + `captureCharFrame()` for output assertions
2. **Test interactions** — use `mockInput`/`mockMouse` for keyboard/mouse simulation
3. **Test hooks with wrapper components** — wrap in a test component rendered via `testRender`
4. **Test registries and catalogs** — these are pure data structures (no renderer needed)
5. **Leave full-app visual testing to E2E** via tmux-cli

#### Example: Tool registry test

```typescript
import { test, expect, describe } from "bun:test";
// Test the pure registry catalog, not the React component
import { getToolRenderer } from "@/components/tool-registry/registry/catalog.ts";

describe("tool registry catalog", () => {
  test("returns renderer for known tool names", () => {
    expect(getToolRenderer("Bash")).toBeDefined();
    expect(getToolRenderer("Read")).toBeDefined();
    expect(getToolRenderer("Edit")).toBeDefined();
  });

  test("returns default renderer for unknown tools", () => {
    expect(getToolRenderer("UnknownTool")).toBeDefined();
  });
});
```

#### Example: Theme helpers test

```typescript
import { test, expect, describe } from "bun:test";
import { getThemeByName, getMessageColor, createCustomTheme } from "@/theme/helpers.ts";
import { darkTheme, lightTheme } from "@/theme/themes.ts";

describe("getThemeByName", () => {
  test("returns dark theme for 'dark'", () => {
    expect(getThemeByName("dark")).toBe(darkTheme);
  });

  test("returns light theme for 'light'", () => {
    expect(getThemeByName("light")).toBe(lightTheme);
  });

  test("defaults to dark for unknown name", () => {
    expect(getThemeByName("unknown")).toBe(darkTheme);
  });
});

describe("getMessageColor", () => {
  test("returns correct colors for each role", () => {
    const colors = darkTheme.colors;
    expect(getMessageColor("user", colors)).toBe(colors.userMessage);
    expect(getMessageColor("assistant", colors)).toBe(colors.assistantMessage);
    expect(getMessageColor("system", colors)).toBe(colors.systemMessage);
  });
});

describe("createCustomTheme", () => {
  test("overrides specific colors", () => {
    const custom = createCustomTheme(darkTheme, { accent: "#ff0000" });
    expect(custom.colors.accent).toBe("#ff0000");
    expect(custom.colors.background).toBe(darkTheme.colors.background);
  });
});
```

### 4.4 Tier 4: E2E Tests

**Covered by `docs/e2e-testing.md` — tmux-cli based. Not counted toward unit test coverage.**

---

## 5. Testing Anti-Patterns to Avoid

### 5.1 The Iron Laws (from skill)

| Rule | Application in Atomic |
|---|---|
| Never test mock behavior | Don't assert that a mocked SDK method was called — assert the output/state change |
| Never add test-only methods to production | `_resetPartCounter()` already exists — acceptable since it's marked `@internal` |
| Never mock without understanding dependencies | Always trace the dependency chain before deciding what to mock |

### 5.2 Bun-Specific Anti-Patterns

| Anti-Pattern | Correct Approach |
|---|---|
| Using `setTimeout` in tests for timing | Use `Bun.sleep()` or `mock.fn()` for timers |
| Not awaiting async operations | Always `await` — Bun silently swallows unhandled rejections in tests |
| Using `jest.fn()` instead of `mock()` | Use `import { mock } from "bun:test"` |
| Module mocking with side effects | Use `mock.module()` at file top, before any imports of the target |
| Snapshot overuse | Only snapshot complex objects that rarely change (e.g., event schemas) |

### 5.3 OpenTUI-Specific Anti-Patterns

| Anti-Pattern | Correct Approach |
|---|---|
| Trying to render OpenTUI components in tests | Extract logic into pure functions, test those |
| Mocking `SyntaxStyle` without `.destroy()` | Provide a no-op SyntaxStyle mock with a destroy() method |
| Testing React hook internals | Test the hook's return values and state transitions |
| Testing OpenTUI layout/positioning | Leave to E2E tests via tmux-cli |

### 5.4 Architecture-Specific Anti-Patterns

| Anti-Pattern | Correct Approach |
|---|---|
| Testing barrel file re-exports | SKIP — barrel files are re-exports only |
| Testing type guard functions for "coverage" | Only test if the guard has non-trivial logic |
| Importing from wrong layer in tests | Tests may import from any layer (test code is exempt from dependency rules) |
| Mocking EventBus to test event handlers | Use a real EventBus instance — it's pure, lightweight, and fast |

---

## 6. Mock Strategy

### 6.1 What to Mock

| Boundary | Mock Strategy |
|---|---|
| Claude Agent SDK | `mock.module("@anthropic-ai/claude-agent-sdk", ...)` |
| OpenCode SDK | `mock.module("@opencode-ai/sdk", ...)` |
| Copilot SDK | `mock.module("@github/copilot-sdk", ...)` |
| File system | `mock.module("fs/promises", ...)` or `mock.module("node:fs", ...)` |
| `Bun.spawn` / `Bun.spawnSync` | `mock.module()` or create wrapper interface |
| `process.env` | Direct mutation in `beforeEach`, restore in `afterEach` |
| `Date.now()` | `mock.module()` or use `_resetPartCounter()` for ID tests |

### 6.2 What NOT to Mock

| Module | Reason |
|---|---|
| `EventBus` | Pure class, fast, no I/O |
| `GraphBuilder` | Pure builder pattern |
| Part store functions | Pure algorithms |
| Verification modules | Pure graph algorithms |
| Theme helpers/palettes | Pure data |
| Format utilities | Pure functions |

### 6.3 Shared Test Utilities

Create `tests/test-support/` for:

```
tests/test-support/
├── fixtures/
│   ├── parts.ts          # Part factory functions
│   ├── events.ts         # BusEvent factory functions
│   ├── sessions.ts       # Mock session factories
│   └── agents.ts         # Mock agent configs
├── mocks/
│   ├── sdk-claude.ts     # Claude SDK mock
│   ├── sdk-opencode.ts   # OpenCode SDK mock
│   ├── sdk-copilot.ts    # Copilot SDK mock
│   └── fs.ts             # Filesystem mock
└── helpers/
    ├── event-bus.ts       # EventBus test helper (collect events)
    └── parts.ts           # Part assertion helpers
```

---

## 7. Coverage Projections

### 7.1 Coverage by Layer

| Layer | Files | Testable Files | Expected Coverage | Strategy |
|---|---|---|---|---|
| Shared (lib/, types/) | 17 | 10 | **95%** | Pure function tests |
| Services/events | 82 | 65 | **90%** | Pure + SDK adapter mocks |
| Services/workflows | 83 | 60 | **90%** | Pure graph/DSL + conductor mock |
| Services/config | 17 | 14 | **85%** | FS mock tests |
| Services/agents | 90 | 30 | **75%** | Contract tests + SDK mocks |
| Services/models | 6 | 4 | **95%** | Pure transform tests |
| Services/system | 5 | 3 | **80%** | FS mock tests |
| State/parts | 8 | 7 | **95%** | Pure reducer tests |
| State/streaming | 6 | 5 | **90%** | Pure pipeline tests |
| State/chat | 103 | 50 | **80%** | Mix of pure + hook tests |
| State/runtime | 7 | 4 | **75%** | Integration tests |
| Components | 67 | 35 | **80%** | `testRender` + registry tests |
| Theme | 14 | 8 | **90%** | Pure function tests |
| Commands | 41 | 10 | **70%** | Integration tests |
| **Total** | **~564** | **~295** | **~85%** | |

### 7.2 Priority Order for Implementation

Implement tests in this order to reach coverage milestones fastest:

1. **Phase 1 — Pure function tests (target: 50% total coverage)**
   - `lib/ui/format.ts`, `lib/ui/hitl-response.ts`, `lib/ui/mcp-output.ts`, `lib/ui/navigation.ts`, `lib/ui/agent-list-output.ts`
   - `state/parts/` (all files)
   - `state/streaming/` (all pipeline files)
   - `services/workflows/verification/` (all files)
   - `services/workflows/dsl/` (all files)
   - `services/workflows/graph/builder.ts`, `annotation.ts`, `state-validator.ts`
   - `theme/helpers.ts`, `palettes.ts`, `themes.ts`
   - `services/models/` (all files)

2. **Phase 2 — EventBus and event infrastructure (target: 65%)**
   - `services/events/event-bus.ts`
   - `services/events/bus-events/` (schema tests)
   - `services/events/coalescing.ts`
   - `services/events/batch-dispatcher.ts`
   - `services/events/consumers/`

3. **Phase 3 — Integration tests with mocks (target: 80%)**
   - `services/config/` with fs mocks
   - `services/events/adapters/` with SDK mocks
   - `services/agents/tools/`
   - `state/chat/shared/helpers/`
   - `commands/core/registry.ts`

4. **Phase 4 — Remaining modules (target: 85%+)**
   - `state/chat/` sub-modules (keyboard, command, composer)
   - `services/agents/clients/` with SDK mocks
   - `services/workflows/conductor/` with session mocks
   - Component logic extraction tests
   - `lib/markdown.ts`, `lib/merge.ts`, `lib/path-root-guard.ts`

---

## 8. Bun Test Runner Reference

### 8.1 Core APIs

```typescript
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";

// Basic test
test("description", () => { expect(1).toBe(1); });

// Grouped tests
describe("module", () => {
  beforeEach(() => { /* setup */ });
  afterEach(() => { /* cleanup */ });
  test("case", () => {});
});

// Async test
test("async", async () => {
  const result = await someAsyncFn();
  expect(result).toBeDefined();
});

// Skip / todo
test.skip("not yet", () => {});
test.todo("implement later");
```

### 8.2 Mock APIs

```typescript
// Function mock
const fn = mock(() => 42);
fn();
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledTimes(1);

// Spy on object method
import { spyOn } from "bun:test";
const spy = spyOn(console, "error").mockImplementation(() => {});
// ... test ...
spy.mockRestore();

// Module mock (must be before imports in the file)
mock.module("some-module", () => ({
  default: mock(() => "mocked"),
  namedExport: mock(() => "mocked"),
}));
```

### 8.3 Coverage Commands

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test file
bun test tests/lib/ui/format.test.ts

# Run tests matching pattern
bun test --grep "formatDuration"
```

---

## 9. OpenTUI Component Testing Strategy

### 9.1 Available Test Infrastructure

OpenTUI (`@opentui/core` v0.1.90, `@opentui/react` v0.1.90) **provides a full headless testing toolkit**:

| Export | Package | Purpose |
|---|---|---|
| `testRender(node, options)` | `@opentui/react/test-utils` | Renders React components headlessly, returns full test setup |
| `createTestRenderer(options)` | `@opentui/core/testing` | Creates headless renderer + mock input/mouse + frame capture |
| `createMockKeys(renderer)` | `@opentui/core/testing` | Keyboard event simulation (`pressKey`, `typeText`, `pressEnter`, etc.) |
| `createMockMouse(renderer)` | `@opentui/core/testing` | Mouse event simulation (`click`, `drag`, `scroll`, etc.) |
| `ManualClock` | `@opentui/core/testing` | Deterministic time control for animations/timers |
| `TestRecorder` | `@opentui/core/testing` | Records frames for visual regression testing |
| `captureCharFrame()` | returned by `testRender` | Captures terminal character grid as string |
| `captureSpans()` | returned by `testRender` | Captures spans with colors/attributes for style assertions |

The reconciler runs **synchronously** (no concurrent features), so `act()` is the correct synchronization primitive. `testRender` wraps it automatically.

### 9.2 Testing Approach (5 Layers)

1. **Pure logic tests** (no renderer): State reducers, helpers, type guards — plain `bun:test`
2. **Component integration tests** (via `testRender`): Render components headlessly, assert on `captureCharFrame()`
3. **Interaction tests**: Use `mockInput`/`mockMouse` between `renderOnce()` calls for keyboard/mouse behavior
4. **Registry/catalog tests**: Test `PART_REGISTRY`, `ToolRegistry`, `CommandRegistry` as pure data
5. **E2E tests**: Full application via tmux-cli (see `docs/e2e-testing.md`)

### 9.3 Component Test Template

```typescript
import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  testSetup?.renderer.destroy(); // triggers React unmount → useEffect cleanups → SyntaxStyle.destroy()
});

test("component renders expected content", async () => {
  testSetup = await testRender(
    <MyComponent prop="value" />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("expected text");
});

test("component responds to keyboard input", async () => {
  testSetup = await testRender(
    <MyInteractiveComponent />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();

  testSetup.mockInput.pressKey("a");
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("a was pressed");
});
```

### 9.4 Hook Testing

No `renderHook` equivalent exists — test hooks by wrapping in a component rendered via `testRender`:

```typescript
function TestHarness({ onResult }: { onResult: (v: unknown) => void }) {
  const result = useMyHook();
  useEffect(() => { onResult(result); }, [result]);
  return <text>{String(result)}</text>;
}

test("hook returns expected value", async () => {
  let result: unknown;
  testSetup = await testRender(
    <TestHarness onResult={(v) => { result = v; }} />,
    { width: 20, height: 5 }
  );
  await testSetup.renderOnce();
  expect(result).toBe(expectedValue);
});
```

### 9.5 SyntaxStyle Handling in Tests

`SyntaxStyle` is a native Zig resource. Three approaches:

1. **Let components manage it**: `renderer.destroy()` triggers React unmount → `useEffect` cleanup → `SyntaxStyle.destroy()`. Automatic when using `testRender` with `afterEach` cleanup.
2. **Prop injection**: Create a real `SyntaxStyle` in `beforeEach`, destroy in `afterEach`.
3. **Unit test factories**: Test `createMarkdownSyntaxStyle()` directly with manual `destroy()`.

**Note**: `SyntaxStyle` requires the Zig FFI library — there is no pure-JS mock.

### 9.6 Limitations

- No DOM-style queries (`getByText`, `getByRole`). Assert on `captureCharFrame()` strings or `captureSpans()` spans.
- `testRender` is async (loads Zig FFI). Tests must use `async` functions.
- Native binary dependency (`@opentui/core-linux-x64`). Tests only run on supported platforms.
- `ManualClock` replaces OpenTUI's internal timers but does NOT replace `setTimeout`/`setInterval` (same Bun limitation).

---

## 10. Code References

### Core Testable Modules

- `src/lib/ui/format.ts` — Pure formatting utilities (6 functions)
- `src/lib/ui/hitl-response.ts` — Pure HITL response normalization (4 functions)
- `src/lib/ui/mcp-output.ts` — Pure MCP snapshot builder (5 functions)
- `src/lib/ui/navigation.ts` — Pure navigation helpers (2 functions)
- `src/lib/ui/agent-list-output.ts` — Pure agent list builder (1 function)
- `src/state/parts/store.ts` — Binary search and upsert (3 functions)
- `src/state/parts/handlers.ts` — Text delta reducer (1 function)
- `src/state/parts/truncation.ts` — Stage truncation (4 functions + config)
- `src/state/parts/guards.ts` — Agent lifecycle guards (4 functions)
- `src/state/parts/id.ts` — Part ID generation (1 function + reset)
- `src/services/events/event-bus.ts` — EventBus class (6 methods)
- `src/services/workflows/verification/` — Graph algorithms (9 files)
- `src/services/workflows/dsl/` — Workflow DSL (6 files)
- `src/services/workflows/graph/builder.ts` — Graph builder
- `src/theme/helpers.ts` — Theme utilities (3 functions)
- `src/theme/palettes.ts` — Palette data (1 function)

### Test Infrastructure Files

- `bunfig.toml` — Test root, coverage config, exclusions
- `package.json:37-38` — `test` and `test:coverage` scripts
- `tsconfig.json` — Path aliases (`@/*` → `src/*`)
- `oxlint.json:11` — Ignores `*.test.ts` from linting
- `docs/e2e-testing.md` — E2E testing protocol

### Architecture Documentation

- `CLAUDE.md` — Layer dependency rules, barrel export rules, sub-module boundaries

---

## 11. Historical Context (from research/)

### 11.1 Prior Test Coverage Research (February 2026)

A previous 85% coverage plan was created on 2026-02-15 when the codebase had ~88 source files, 18 colocated test files, and 337 passing tests at ~49% line coverage. That plan was based on a fundamentally different codebase structure:

- **Then**: Tests colocated with source (`src/*.test.ts`), 88 source files
- **Now**: Tests in separate `tests/` directory, 588 source files, all prior tests deleted
- **Key insight preserved**: The tiered approach (pure functions first, then mocked I/O, then renderers) remains the optimal strategy
- **Key insight preserved**: Prefer DI over `mock.module()` due to Bun's module mock leak issue ([#12823](https://github.com/oven-sh/bun/issues/12823))
- **Key insight preserved**: Assert on structured return values, not message strings

| Prior Document | Status | Key Takeaway |
|---|---|---|
| `research/docs/2026-02-15-test-coverage-audit-and-85-percent-plan.md` | Superseded by this document | Tiered coverage strategy, Bun mock limitations, anti-pattern catalog |
| `specs/test-coverage-85-percent-plan.md` | Superseded by this document | Detailed spec with module matrix (now outdated due to restructure) |
| `research/docs/2026-02-14-testing-infrastructure-and-dev-setup.md` | Historical | Established testing philosophy: "test real behavior, not trivial properties" |
| `research/docs/2026-02-12-bun-test-failures-root-cause-analysis.md` | Historical | 104 tests failed because source code evolved but tests weren't updated — lesson: test stable interfaces, not implementation details |
| `research/docs/2026-02-14-failing-tests-mcp-config-discovery.md` | Historical | MCP config discovery test failures |

### 11.2 Bun-Specific Limitations (Confirmed from Prior Research)

These limitations were identified in prior research and remain relevant:

1. **No `__mocks__` directory support** — use `mock.module()` instead
2. **No built-in fake timers** — use workarounds or restructure code
3. **`mock.module()` leaks across test files** — prefer DI; use `--preload` if unavoidable
4. **No mock hoisting** — side effects from original module still execute
5. **Coverage function names may be missing** — JSC limitation in lcov output

### 11.3 Architecture & SDK Documentation

| Document | Relevance |
|---|---|
| `research/docs/2026-02-16-opentui-deepwiki-research.md` | OpenTUI API documentation |
| `research/docs/2026-02-16-opentui-rendering-architecture.md` | OpenTUI rendering internals |
| `research/docs/2026-01-31-claude-agent-sdk-research.md` | Claude SDK event schemas |
| `research/docs/2026-03-06-claude-agent-sdk-event-schema.md` | Claude SDK event schema reference |
| `research/docs/2026-03-06-copilot-sdk-session-events-schema-reference.md` | Copilot SDK event schemas |
| `research/docs/2026-03-06-opencode-sdk-event-schema-reference.md` | OpenCode SDK event schemas |
| `research/docs/2026-01-31-opencode-implementation-analysis.md` | OpenCode SDK patterns |
| `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` | Workflow SDK design |
| `research/docs/2026-02-25-workflow-sdk-standardization.md` | Workflow DSL patterns |
| `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md` | Ralph workflow architecture |
| `research/docs/2026-03-13-codebase-architecture-modularity-analysis.md` | Current architecture analysis |
| `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md` | EventBus architecture |
| `research/docs/2026-03-18-opencode-streaming-order-architecture.md` | Streaming order (Part ID system basis) |

---

## 12. Follow-up Research: Detailed Source Analysis

### 12.1 Sub-Module File Counts (Exact)

| Sub-module Path | Files | Pure Functions | I/O Dependent | Types Only |
|---|---|---|---|---|
| `services/agents/clients/` | 65 | 8 | 52 | 5 |
| `services/events/adapters/` | 47 | 5 | 38 | 4 |
| `services/events/bus-events/` | 30 | 30 | 0 | 0 |
| `services/workflows/dsl/` | 7 | 6 | 0 | 1 |
| `services/workflows/verification/` | 9 | 8 | 0 | 1 |
| `services/workflows/graph/` | 12 | 7 | 3 | 2 |
| `services/workflows/conductor/` | 6 | 2 | 3 | 1 |
| `services/workflows/ralph/` | 5 | 3 | 1 | 1 |
| `services/config/` | 17 | 2 | 13 | 2 |
| `state/parts/` | 8 | 7 | 0 | 1 |
| `state/streaming/` | 6 | 5 | 0 | 1 |
| `state/chat/shared/` | 15 | 5 | 0 | 10 |
| `state/chat/agent/` | 12 | 4 | 6 | 2 |
| `state/chat/stream/` | 13 | 5 | 6 | 2 |
| `theme/` | 14 | 10 | 1 | 3 |
| `lib/ui/` | 10 | 7 | 3 | 0 |
| `components/tool-registry/` | 21 | 21 | 0 | 0 |

### 12.2 Pure Function Signature Analysis (Highest-ROI Targets)

These functions have the highest test ROI because they are pure, heavily used, and have complex branching logic:

#### `lib/ui/format.ts` (6 exports)
```typescript
formatDuration(ms: number): { text: string; ms: number }          // 5 branches: 0/neg, <1s, <60s, =60s multiple, else
formatTimestamp(date: Date | string): string                       // 2 branches: Date vs string input
normalizeMarkdownNewlines(text: string): string                    // 4 transforms: trim, CRLF→LF, checkbox Unicode, collapse
joinThinkingBlocks(blocks: string[]): string                       // 2 branches: empty array, join
collapseNewlines(text: string): string                             // 1 regex replacement
truncateText(text: string, maxLen: number, suffix?: string): string // 2 branches: under/over limit
```

#### `state/parts/store.ts` (3 exports)
```typescript
binarySearchById(parts: ReadonlyArray<Part>, targetId: PartId): number  // Binary search: found→index, not found→~insertionPoint
upsertPart(parts: ReadonlyArray<Part>, newPart: Part): Part[]           // 2 branches: update existing or insert new
findLastPartIndex(parts: ReadonlyArray<Part>, predicate: (part: Part) => boolean): number  // Reverse linear scan
```

#### `state/parts/handlers.ts` (1 export)
```typescript
handleTextDelta(msg: ChatMessage, delta: string): ChatMessage
// 3-way branching:
//   1. Last TextPart is streaming → append
//   2. Last TextPart is finalized, no paragraph break → merge back
//   3. Otherwise → create new TextPart
```

#### `state/parts/truncation.ts` (2 exports + config)
```typescript
truncateStageParts(parts: ReadonlyArray<Part>, completedNodeId: string, workflowId: string, config: PartsTruncationConfig): TruncationResult
// Complex flow: find step boundary → collect truncatable parts → check threshold → build summary → replace
createDefaultPartsTruncationConfig(overrides?: Partial<PartsTruncationConfig>): PartsTruncationConfig
```

#### `state/parts/guards.ts` (4 exports)
```typescript
shouldFinalizeOnToolComplete(agent: ParallelAgent): boolean          // 2 checks: background flag, background status
hasActiveForegroundAgents(agents: readonly ParallelAgent[]): boolean  // Composite predicate with shadow check
shouldFinalizeDeferredStream(agents: readonly ParallelAgent[], hasRunningTool: boolean): boolean  // 3-way gate
hasActiveBackgroundAgentsForSpinner(agents: readonly ParallelAgent[]): boolean  // Status check with isBackgroundAgent
```

### 12.3 Testing Anti-Patterns Integration

The testing-anti-patterns skill identifies 4 critical anti-patterns applied to this codebase:

**Anti-Pattern 1: Testing Mock Behavior Instead of Real Outcomes**
```typescript
// WRONG — tests that the mock was called
test("calls SDK send", () => {
  const sendMock = mock(() => {});
  agent.send("hello");
  expect(sendMock).toHaveBeenCalledWith("hello"); // Testing mock, not behavior
});

// RIGHT — tests the observable state change
test("stream produces text delta events", () => {
  const events: BusEvent[] = [];
  bus.on("stream.text.delta", (e) => events.push(e));
  adapter.processChunk({ type: "text", text: "hello" });
  expect(events[0]?.data.delta).toBe("hello"); // Testing real outcome
});
```

**Anti-Pattern 2: Adding Test-Only Code to Production**
- The ONLY acceptable exception in this codebase: `_resetPartCounter()` in `state/parts/id.ts` (marked `@internal`)
- Do NOT add `.toJSON()`, `.__testOnly`, or `._debug` methods to production classes

**Anti-Pattern 3: Mocking What You Own**
```typescript
// WRONG — mocking EventBus (you own it, it's pure)
const mockBus = { publish: mock(() => {}), on: mock(() => () => {}) };

// RIGHT — use a real EventBus instance
const bus = new EventBus({ validatePayloads: false });
```

**Anti-Pattern 4: Over-Mocking SDK Boundaries**
```typescript
// WRONG — mocking every SDK method individually
mock.module("@opencode-ai/sdk", () => ({
  createSession: mock(() => ({ id: "s1" })),
  send: mock(() => {}),
  subscribe: mock(() => {}),
  destroy: mock(() => {}),
}));

// RIGHT — mock the session factory, return a coherent session object
mock.module("@opencode-ai/sdk", () => ({
  OpenCodeSDK: class {
    createSession() {
      return new FakeSession(); // Coherent object with all methods
    }
  }
}));
```

### 12.4 Global State Concerns for Test Isolation

Two sources of mutable global state require attention:

**1. `state/parts/id.ts` — Module-level mutable counter**
```typescript
// Module-level state (simplified):
let counter = 0;
let lastTimestamp = 0;

export function createPartId(): PartId {
  const now = Date.now();
  if (now === lastTimestamp) counter++;
  else { counter = 0; lastTimestamp = now; }
  return `part_${hex(now)}_${hex(counter)}`;
}

export function _resetPartCounter(): void {
  counter = 0;
  lastTimestamp = 0;
}
```

**Required in every test that creates Parts:**
```typescript
import { _resetPartCounter } from "@/state/parts/id.ts";

beforeEach(() => {
  _resetPartCounter();
});
```

Without this reset, Part IDs leak between test files (since Bun runs files in the same process), causing non-deterministic sort orders in `upsertPart()` and flaky tests.

**2. `theme/colors.ts` — Read-only initialization**
```typescript
export const COLORS = supportsColor() ? { ... } : { ... };
```
This is set once at import time based on terminal capabilities. In tests, this is effectively a constant — no reset needed. But if a test needs to force a specific color mode, it must mock the module before import.

---

## 13. Open Questions

1. **Hook testing infrastructure**: Should we build a minimal OpenTUI test renderer, or rely entirely on logic extraction + E2E?
2. **Snapshot testing**: Should bus event schemas use snapshot tests for regression detection?
3. **Coverage CI gate**: Should `bun test --coverage` be added to the CI pipeline with a hard failure on threshold breach?
4. **Test parallelism**: Bun runs test files in parallel by default — are there any shared global state concerns beyond `_resetPartCounter`?
5. **SDK mock fidelity**: How closely should SDK mocks mirror real SDK behavior? Should we maintain a mock SDK fixture file?
