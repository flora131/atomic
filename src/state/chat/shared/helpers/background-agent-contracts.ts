/**
 * Background Agent UX Contracts (Issue #258)
 *
 * Canonical behavior contracts for background-agent footer and termination flow.
 * These contracts eliminate UX ambiguity and provide a stable specification
 * for parity tests across providers and runtime modes.
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

