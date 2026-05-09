/**
 * Capsule source fixture for the realistic re-entry e2e test (issue-898 iteration-5).
 *
 * When built with `Bun.build({ external: ["@opentui/*"] })`, this file becomes
 * a capsule .mjs that inlines auto-dispatch.ts from @bastani/atomic-sdk/workflows.
 * Importing the capsule fires auto-dispatch.ts's TLA, which exercises the
 * idempotency sentinel.
 *
 * Intentionally does NOT export a WorkflowDefinition as default so that
 * runOrchestratorEntry throws InvalidWorkflowError (silently caught by
 * auto-dispatch.ts), allowing the harness process to continue past the
 * _orchestrator-entry branch without launching the TUI.
 */
import "@bastani/atomic-sdk/workflows";

export const capsuleId = "reentry-test-capsule";
