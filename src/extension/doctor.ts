/**
 * Doctor report builder for /workflows-doctor.
 *
 * Pure function — takes discovery result + sibling status, returns formatted
 * string.  Kept separate from index.ts so tests can exercise output without
 * spinning up a full ExtensionAPI mock.
 *
 * cross-ref: src/extension/discovery.ts
 *            src/extension/index.ts (wires execute)
 */

import type { DiscoveryResult } from "./discovery.js";
import type { ConfigLoadResult } from "./config-loader.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Presence/absence of optional oh-my-pi runtime capabilities.
 * True = the surface was detected on the ExtensionAPI object or command context.
 */
export interface DoctorSiblingStatus {
  /** True when task delegation can be reached through the host runtime. */
  readonly taskDelegation: boolean;
  /** True when the host event bus can emit workflow-scoped MCP events. */
  readonly mcpScopeEvents: boolean;
  /** True when session naming is available for child-session correlation. */
  readonly sessionNaming: boolean;
  /** True when ctx.ui is present — HIL dialog adapter is available. */
  readonly hil: boolean;
  /** True when ctx.ui.custom is present — custom overlay panel available. */
  readonly uiCustom: boolean;
  /** True when pi.registerShortcut is present — F2 and other shortcuts available. */
  readonly shortcut: boolean;
  /** True when pi.appendEntry is present — persistence transcript available. */
  readonly persistenceAppendEntry: boolean;
  /** True when the SDK AgentSession adapter is configured. */
  readonly agentSessionAdapter?: boolean;
  readonly execAbortable?: boolean;
  readonly promptAdapter?: boolean;
  readonly completeAdapter?: boolean;
  readonly subagentAdapterVia?: "unavailable" | "task tool";
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Default tunable values per RFC. */
const DEFAULTS = {
  persistRuns: true,
  resumeInFlight: "ask" as const,
  defaultConcurrency: 4,
  maxDepth: 4,
  statusFile: false,
} as const;

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable doctor report string.
 *
 * Deterministic: same inputs → same output.  No I/O.
 *
 * @param discovery  - Result from discoverBundledWorkflows().
 * @param siblings   - Detected sibling availability (structural checks on pi).
 * @param configLoad - Optional result from loadWorkflowConfig().
 * @returns Multi-line report string suitable for ctx.reply / ctx.print.
 */
export function buildDoctorReport(
  discovery: DiscoveryResult,
  siblings: DoctorSiblingStatus,
  configLoad?: ConfigLoadResult | null,
): string {
  const lines: string[] = [
    "atomic-workflows doctor report",
    "──────────────────────────────",
  ];

  // Registry count
  const count = discovery.registry.names().length;
  lines.push(`Registry: ${count} workflow(s) loaded`);

  // Bundled sources
  if (discovery.sources.length > 0) {
    lines.push(`Bundled sources (${discovery.sources.length}):`);
    for (const src of discovery.sources) {
      lines.push(`  [${src.kind}] ${src.id} — ${src.name}`);
    }
  } else {
    lines.push("Bundled sources: (none)");
  }

  // Discovery diagnostics
  if (discovery.errors.length > 0) {
    lines.push(`Discovery diagnostics (${discovery.errors.length}):`);
    for (const diag of discovery.errors) {
      const src = diag.source ? ` (${diag.source})` : "";
      lines.push(`  [${diag.level}] ${diag.code}${src}: ${diag.message}`);
    }
  } else {
    lines.push("Discovery diagnostics: (none)");
  }

  // Config diagnostics
  if (configLoad == null) {
    lines.push("Config diagnostics: (not loaded)");
  } else if (configLoad.diagnostics.length > 0) {
    lines.push(`Config diagnostics (${configLoad.diagnostics.length}):`);
    for (const diag of configLoad.diagnostics) {
      const src = diag.source ? ` (${diag.source})` : "";
      lines.push(`  [${diag.level}] ${diag.code}${src}: ${diag.message}`);
    }
  } else {
    lines.push("Config diagnostics: (none)");
  }

  // Effective tunables
  const cfg = configLoad?.config ?? null;
  lines.push("Tunables:");
  lines.push(`  persistRuns        — ${cfg?.persistRuns ?? DEFAULTS.persistRuns}`);
  lines.push(`  resumeInFlight     — ${cfg?.resumeInFlight ?? DEFAULTS.resumeInFlight}`);
  lines.push(`  defaultConcurrency — ${cfg?.defaultConcurrency ?? DEFAULTS.defaultConcurrency}`);
  lines.push(`  maxDepth           — ${cfg?.maxDepth ?? DEFAULTS.maxDepth}`);
  lines.push(`  statusFile         — ${cfg?.statusFile ?? DEFAULTS.statusFile}`);

  // Configured workflow entries
  const workflows = cfg?.workflows;
  const workflowEntries = workflows ? Object.entries(workflows) : [];
  if (workflowEntries.length > 0) {
    lines.push(`Configured workflows (${workflowEntries.length}):`);
    for (const [name, entry] of workflowEntries) {
      lines.push(`  ${name} → ${entry.path}`);
    }
  } else {
    lines.push("Configured workflows: (none configured)");
  }

  // Host/runtime capabilities
  lines.push("Capabilities:");
  lines.push(`  task delegation — ${siblings.taskDelegation ? "available" : "unavailable"}`);
  lines.push(`  mcp scope evts  — ${siblings.mcpScopeEvents ? "known" : "unknown"}`);
  lines.push(`  session naming  — ${siblings.sessionNaming ? "present" : "unavailable"}`);
  // hil (pi.ui dialogs): available / unavailable
  lines.push(`  hil            — ${siblings.hil ? "available" : "unavailable"}`);

  // ui.custom (custom overlay UI): available / unavailable
  lines.push(`  ui.custom      — ${siblings.uiCustom ? "available" : "unavailable"}`);

  // shortcut registration: available / unavailable
  lines.push(`  shortcut       — ${siblings.shortcut ? "available" : "unavailable"}`);

  // persistence appendEntry: appendEntry available / unavailable
  lines.push(`  persistence    — ${siblings.persistenceAppendEntry ? "appendEntry available" : "unavailable"}`);
  lines.push(`  exec abortable — ${siblings.execAbortable ? "yes" : "unavailable"}`);

  // Runtime adapter capabilities
  lines.push("Runtime adapters:");
  lines.push(`  exec             — ${siblings.execAbortable ? "available" : "unavailable"}`);
  lines.push(`  prompt adapter   — ${siblings.promptAdapter ? "configured" : "unconfigured"}`);
  lines.push(`  complete adapter — ${siblings.completeAdapter ? "configured" : "unconfigured"}`);
  const subagentStatus =
    siblings.subagentAdapterVia === "task tool"
      ? "configured via task tool"
      : "unavailable";
  lines.push(`  subagent adapter — ${subagentStatus}`);
  lines.push(`  agent session    — ${siblings.agentSessionAdapter ? "configured via oh-my-pi SDK" : "unconfigured"}`);

  return lines.join("\n");
}
