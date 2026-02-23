/**
 * Background Agent UX Contracts (Issue #258)
 *
 * Canonical behavior contracts for background-agent footer, termination flow,
 * and tree hint wording. These contracts eliminate UX ambiguity and provide
 * a stable specification for parity tests across providers and runtime modes.
 *
 * **CI Enforcement:**
 * These contracts are enforced automatically in CI via parity tests that verify:
 * - Provider matrix parity (Claude, OpenCode, Copilot) — background-agent-provider-parity.test.ts
 * - Dev/prod runtime invariance — background-agent-runtime-parity.test.ts
 * - Issue #258 acceptance criteria — background-agent-acceptance.test.ts
 * - Ctrl+F integration behavior — background-agent-termination-integration.test.ts
 * - Keybinding non-conflict — background-agent-keybinding-nonconflict.test.ts
 * - Parent callback integration — background-agent-parent-callback.test.ts
 *
 * All contract parity tests can be run via: `bun run test:contracts`
 */

// ---------------------------------------------------------------------------
// Termination Decision Contract
// ---------------------------------------------------------------------------

/**
 * Discriminated union describing the outcome of a Ctrl+F keypress
 * against the current background-agent state.
 */
export type BackgroundTerminationDecision =
  | { action: "none" }
  | { action: "warn"; message: string }
  | { action: "terminate"; message: string };

// ---------------------------------------------------------------------------
// Footer Display Contract
// ---------------------------------------------------------------------------

export interface BackgroundFooterContract {
  /** Minimum active agent count before the footer becomes visible. */
  showWhenAgentCountAtLeast: number;
  /** Whether the footer includes a terminate-key hint. */
  includeTerminateHint: boolean;
  /** Exact text for the terminate hint shown in the footer. */
  terminateHintText: string;
  /** Labeling style for the agent count. */
  countFormat: "agents" | "tasks";
}

/** Canonical footer contract instance used at runtime. */
export const BACKGROUND_FOOTER_CONTRACT: BackgroundFooterContract = {
  showWhenAgentCountAtLeast: 1,
  includeTerminateHint: true,
  terminateHintText: "ctrl+f to kill agents",
  countFormat: "agents",
};

// ---------------------------------------------------------------------------
// Tree Hint Contract
// ---------------------------------------------------------------------------

export interface BackgroundTreeHintContract {
  /** Hint shown while at least one background agent is actively running. */
  whenRunning: string;
  /** Hint shown when all background agents have completed. */
  whenComplete: string;
  /** Fallback hint when no background agents exist. */
  defaultHint: string;
}

/** Canonical tree hint contract instance used at runtime. */
export const BACKGROUND_TREE_HINT_CONTRACT: BackgroundTreeHintContract = {
  whenRunning: "background running · ctrl+f to kill agents",
  whenComplete: "background complete · ctrl+o to expand",
  defaultHint: "ctrl+o to expand",
};
