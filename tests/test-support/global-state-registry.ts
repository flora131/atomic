/**
 * Global State Registry
 *
 * Central registry of all module-level mutable state in src/.
 * Provides a single `resetAllGlobalState()` function that tests
 * can call in `beforeEach` to ensure clean isolation between tests.
 *
 * ## How to use
 *
 * ```ts
 * import { resetAllGlobalState } from "tests/test-support/global-state-registry.ts";
 *
 * beforeEach(() => {
 *   resetAllGlobalState();
 * });
 * ```
 *
 * ## Audit methodology
 *
 * Searched all `src/` TypeScript files for:
 *   - `let` declarations at module scope
 *   - `const` declarations initialized to `new Map()`, `new Set()`, `[]`
 *   - Singleton getter/setter patterns
 *   - Mutable `Record<>` / object literals that receive runtime mutations
 *
 * Each entry is classified as:
 *   - **resettable** — has an exported reset/clear function we can call
 *   - **read-only-at-init** — set once at import time, never mutated; no reset needed
 *   - **lazy-cache** — populated on first access, safe to leave; or needs mock.module()
 *   - **infrastructure** — server/process lifecycle state; tests should mock the module
 *   - **gc-managed** — WeakMap/WeakRef; GC handles cleanup automatically
 */

// ============================================================================
// Imports — source-provided reset functions
// ============================================================================

import { _resetPartCounter } from "@/state/parts/id.ts";
import { resetPipelineDebugCache } from "@/services/events/pipeline-logger.ts";
import { resetRuntimeParityMetrics } from "@/services/workflows/runtime-parity-observability.ts";
import { clearActiveSessions } from "@/services/agent-discovery/session.ts";
import { clearProviderDiscoverySessionCache } from "@/services/config/provider-discovery-cache.ts";
import { clearHistoryBuffer } from "@/state/chat/shared/helpers/conversation-history-buffer.ts";
import { clearAgentEventBuffer } from "@/state/streaming/pipeline-agents/buffer.ts";
import { clearAgentLookupCache } from "@/services/workflows/dsl/agent-resolution.ts";
import { setToolRegistry, ToolRegistry } from "@/services/agents/tools/registry.ts";
import { globalRegistry as commandRegistry } from "@/commands/core/registry.ts";

// ============================================================================
// Module-level mutable state inventory
// ============================================================================

/**
 * Describes a single piece of module-level mutable state.
 */
export interface MutableStateEntry {
  /** Absolute import path (using @/ alias) */
  file: string;
  /** Variable name(s) at module scope */
  variables: string[];
  /** Brief description of what the state holds */
  description: string;
  /** How to reset this state for test isolation */
  resetStrategy:
    | "exported-reset-fn"
    | "read-only-at-init"
    | "lazy-cache-no-reset-needed"
    | "mock-module"
    | "gc-managed"
    | "manual-clear";
  /** Whether resetAllGlobalState() calls its reset function */
  coveredByResetAll: boolean;
}

/**
 * Complete inventory of all module-level mutable state in src/.
 * Useful for documentation, auditing, and test tooling.
 */
export const MUTABLE_STATE_INVENTORY: readonly MutableStateEntry[] = [
  // ── Resettable (covered by resetAllGlobalState) ──────────────────────

  {
    file: "@/state/parts/id.ts",
    variables: ["lastPartTimestamp", "partCounter"],
    description:
      "Monotonically increasing part ID counter. Encodes timestamp * 0x1000 + counter.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/services/events/pipeline-logger.ts",
    variables: ["_debugEnabled"],
    description:
      "Cached DEBUG env var check for pipeline diagnostic logging.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/services/workflows/runtime-parity-observability.ts",
    variables: ["state (counters, gauges, histograms Maps)"],
    description:
      "Runtime parity metrics: counters, gauges, and histograms for workflow observability.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/services/agent-discovery/session.ts",
    variables: ["activeSessions"],
    description:
      "In-memory Map of active workflow sessions keyed by sessionId.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/services/config/provider-discovery-cache.ts",
    variables: ["providerDiscoverySessionState", "cacheInvalidators"],
    description:
      "Provider discovery session cache (project root, startup plans, cache entries) and invalidator callbacks.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/state/chat/shared/helpers/conversation-history-buffer.ts",
    variables: ["writtenIds", "cachedMessages"],
    description:
      "In-memory dedup Set and cached messages for NDJSON conversation history persistence.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/state/streaming/pipeline-agents/buffer.ts",
    variables: ["agentEventBuffer"],
    description:
      "Map buffering StreamPartEvents per agent until the agent is registered in the parallel tree.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/services/workflows/dsl/agent-resolution.ts",
    variables: ["cachedAgentLookup"],
    description:
      "Cached Map of agent name -> AgentInfo for workflow stage resolution.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/services/agents/tools/registry.ts",
    variables: ["globalToolRegistry"],
    description:
      "Singleton ToolRegistry storing discovered custom tool entries.",
    resetStrategy: "exported-reset-fn",
    coveredByResetAll: true,
  },
  {
    file: "@/commands/core/registry.ts",
    variables: ["globalRegistry"],
    description:
      "Global CommandRegistry instance storing slash command definitions and aliases.",
    resetStrategy: "manual-clear",
    coveredByResetAll: true,
  },

  // ── Read-only at init (no reset needed) ──────────────────────────────

  {
    file: "@/services/events/registry/registry.ts",
    variables: ["globalRegistry"],
    description:
      "Singleton EventHandlerRegistry. Handlers registered at module load time cannot be replayed.",
    resetStrategy: "read-only-at-init",
    coveredByResetAll: false,
  },
  {
    file: "@/theme/colors.ts",
    variables: ["COLORS"],
    description:
      "ANSI color codes object, set once at import based on supportsColor(). Never mutated.",
    resetStrategy: "read-only-at-init",
    coveredByResetAll: false,
  },
  {
    file: "@/services/workflows/dsl/state-compiler.ts",
    variables: ["REDUCER_MAP"],
    description:
      "Static Record mapping reducer names to Reducer functions. Never mutated after init.",
    resetStrategy: "read-only-at-init",
    coveredByResetAll: false,
  },

  // ── Lazy caches (no reset needed in most tests) ──────────────────────

  {
    file: "@/lib/markdown.ts",
    variables: ["_parseYaml"],
    description:
      "Lazy-loaded YAML parser reference. Set once on first call to parseMarkdownFrontmatter().",
    resetStrategy: "lazy-cache-no-reset-needed",
    coveredByResetAll: false,
  },
  {
    file: "@/services/telemetry/telemetry.ts",
    variables: ["ciInfo"],
    description:
      "Lazily imported ci-info module. Cached after first dynamic import().",
    resetStrategy: "lazy-cache-no-reset-needed",
    coveredByResetAll: false,
  },
  {
    file: "@/services/workflows/builtin/ralph/ralph-workflow.ts",
    variables: ["_compiledRalphDefinition"],
    description:
      "Lazily compiled Ralph workflow definition. First access triggers compile(), then cached.",
    resetStrategy: "lazy-cache-no-reset-needed",
    coveredByResetAll: false,
  },
  {
    file: "@/services/config/copilot-config.ts",
    variables: ["agentCache", "skillDirectoryCache"],
    description:
      "TTL-based caches for Copilot agents and skill directories. Cleared via provider-discovery invalidation.",
    resetStrategy: "lazy-cache-no-reset-needed",
    coveredByResetAll: false,
  },

  // ── GC-managed (WeakMap, no reset needed) ────────────────────────────

  {
    file: "@/state/streaming/pipeline-thinking.ts",
    variables: ["reasoningPartIdBySourceRegistry"],
    description:
      "WeakMap<ChatMessage, Map<string, PartId>> for reasoning part ID tracking. GC handles cleanup.",
    resetStrategy: "gc-managed",
    coveredByResetAll: false,
  },

  // ── Infrastructure (needs mock.module for tests) ─────────────────────

  {
    file: "@/services/agents/clients/opencode/server.ts",
    variables: ["atomicManagedOpenCodeServer"],
    description:
      "Singleton state for the Atomic-managed OpenCode server (URL, lease count, process).",
    resetStrategy: "mock-module",
    coveredByResetAll: false,
  },
  {
    file: "@/services/agents/tools/discovery.ts",
    variables: ["discoveredCustomTools", "tempToolFiles"],
    description:
      "Discovered custom tool definitions and temp file paths for cleanup.",
    resetStrategy: "mock-module",
    coveredByResetAll: false,
  },
  {
    file: "@/commands/tui/workflow-commands/workflow-files.ts",
    variables: ["loadedWorkflows", "tempBundledFiles"],
    description:
      "Loaded workflow definitions from disk and temp bundled file paths for cleanup.",
    resetStrategy: "mock-module",
    coveredByResetAll: false,
  },
  {
    file: "@/services/workflows/helpers/persist-workflow-tasks.ts",
    variables: ["pendingWrite"],
    description:
      "Debounced write timer for persisting workflow tasks to disk.",
    resetStrategy: "mock-module",
    coveredByResetAll: false,
  },
  {
    file: "@/services/events/adapters/providers/claude/tool-debug-log.ts",
    variables: ["_enabled", "_writer"],
    description:
      "Debug logger enabled flag and Bun file writer for tool attribution JSONL log.",
    resetStrategy: "mock-module",
    coveredByResetAll: false,
  },
  {
    file: "@/components/tool-registry/registry/catalog.ts",
    variables: ["TOOL_RENDERERS"],
    description:
      "Mutable Record of tool name -> ToolRenderer. Receives new entries via registerAgentToolNames().",
    resetStrategy: "mock-module",
    coveredByResetAll: false,
  },
  {
    file: "@/cli.ts",
    variables: ["program"],
    description:
      "Commander.js program instance created at module scope. Used by main() and CLI tests.",
    resetStrategy: "mock-module",
    coveredByResetAll: false,
  },
] as const;

// ============================================================================
// Reset functions
// ============================================================================

/**
 * Reset all known module-level mutable state that has exported reset functions.
 *
 * Call this in `beforeEach` to ensure test isolation. This covers all state
 * entries marked with `coveredByResetAll: true` in the inventory above.
 *
 * State that requires `mock.module()` (infrastructure singletons, server
 * lifecycle, file-system side effects) is NOT reset here — those modules
 * should be mocked at the test-file level using Bun's `mock.module()`.
 *
 * NOTE: EventHandlerRegistry is intentionally excluded — its handlers are
 * registered once at module load time and cannot be re-registered.
 */
export function resetAllGlobalState(): void {
  // ── Part ID counter ────────────────────────────────────────────────
  _resetPartCounter();

  // ── Pipeline debug cache ───────────────────────────────────────────
  resetPipelineDebugCache();

  // ── Runtime parity metrics ─────────────────────────────────────────
  resetRuntimeParityMetrics();

  // ── Active workflow sessions ───────────────────────────────────────
  clearActiveSessions();

  // ── Provider discovery cache ───────────────────────────────────────
  clearProviderDiscoverySessionCache();

  // ── Conversation history buffer ────────────────────────────────────
  clearHistoryBuffer();

  // ── Agent event buffer ─────────────────────────────────────────────
  clearAgentEventBuffer();

  // ── Agent lookup cache ─────────────────────────────────────────────
  clearAgentLookupCache();

  // ── Tool registry (replace with fresh instance) ────────────────────
  setToolRegistry(new ToolRegistry());

  // NOTE: EventHandlerRegistry is NOT reset — handlers are registered at
  // module load time and cannot be replayed after singleton replacement.

  // ── Command registry (clear entries) ───────────────────────────────
  commandRegistry.clear();
}

/**
 * Convenience: reset only the part ID counter.
 * Re-exported for tests that only need this specific reset.
 */
export { _resetPartCounter } from "@/state/parts/id.ts";

/**
 * Convenience: reset only the pipeline debug cache.
 * Re-exported for tests that only need this specific reset.
 */
export { resetPipelineDebugCache } from "@/services/events/pipeline-logger.ts";

/**
 * Convenience: reset only the runtime parity metrics.
 * Re-exported for tests that only need this specific reset.
 */
export { resetRuntimeParityMetrics } from "@/services/workflows/runtime-parity-observability.ts";

/**
 * Convenience: reset only the active sessions registry.
 * Re-exported for tests that only need this specific reset.
 */
export { clearActiveSessions } from "@/services/agent-discovery/session.ts";

/**
 * Convenience: reset only the provider discovery cache.
 * Re-exported for tests that only need this specific reset.
 */
export { clearProviderDiscoverySessionCache } from "@/services/config/provider-discovery-cache.ts";

/**
 * Convenience: reset only the conversation history buffer.
 * Re-exported for tests that only need this specific reset.
 */
export { clearHistoryBuffer } from "@/state/chat/shared/helpers/conversation-history-buffer.ts";

/**
 * Convenience: reset only the agent event buffer.
 * Re-exported for tests that only need this specific reset.
 */
export { clearAgentEventBuffer } from "@/state/streaming/pipeline-agents/buffer.ts";

/**
 * Convenience: reset only the agent lookup cache.
 * Re-exported for tests that only need this specific reset.
 */
export { clearAgentLookupCache } from "@/services/workflows/dsl/agent-resolution.ts";
