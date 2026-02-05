import { test, expect } from "bun:test";
import { ATOMIC_COMMANDS } from "../../src/utils/telemetry/constants";

/**
 * Tests to verify ATOMIC_COMMANDS consistency.
 *
 * Note: The SDK hook files (opencode-hooks.ts, copilot-hooks.ts) were removed
 * as part of the SDK migration. Hooks are now integrated directly into
 * the SDK clients (claude-client.ts, opencode-client.ts, copilot-client.ts).
 *
 * The telemetry ATOMIC_COMMANDS is now only used by the UI layer for
 * command detection, not by SDK hooks.
 */

test("ATOMIC_COMMANDS is not empty", () => {
  expect(ATOMIC_COMMANDS.length).toBeGreaterThan(5);
});

test("ATOMIC_COMMANDS are all slash commands", () => {
  // All ATOMIC_COMMANDS should be slash commands
  for (const cmd of ATOMIC_COMMANDS) {
    expect(cmd.startsWith("/")).toBe(true);
  }
});

test("ATOMIC_COMMANDS entries are unique", () => {
  const uniqueCommands = new Set(ATOMIC_COMMANDS);
  expect(uniqueCommands.size).toBe(ATOMIC_COMMANDS.length);
});
