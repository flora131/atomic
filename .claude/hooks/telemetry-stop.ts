#!/usr/bin/env bun

/**
 * Telemetry Stop Hook (Claude Code)
 *
 * This hook is intentionally self-contained and keeps an inlined copy of
 * ATOMIC_COMMANDS so it can run independently of the Atomic CLI source.
 *
 * IMPORTANT: Keep ATOMIC_COMMANDS synchronized with:
 * - src/utils/telemetry/constants.ts (source of truth)
 * - .opencode/plugin/telemetry.ts
 * - .github/hooks/telemetry-session.ts
 */

// Atomic commands to track (from spec Section 5.3.2)
const ATOMIC_COMMANDS = [
	"/research-codebase",
	"/create-spec",
	"/create-feature-list",
	"/implement-feature",
	"/commit",
	"/create-gh-pr",
	"/explain-code",
	"/ralph:ralph-loop",
	"/ralph:cancel-ralph",
	"/ralph:ralph-help",
] as const;

async function main(): Promise<void> {
	// No-op placeholder: the sync test validates the command list above.
	// This file is distributed as part of the Claude config template.
	await Bun.stdin.text().catch(() => "");
	process.exit(0);
}

main();

