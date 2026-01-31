import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ATOMIC_COMMANDS } from "../../src/utils/telemetry/constants";

/**
 * Tests to verify ATOMIC_COMMANDS is synchronized across all locations:
 * 1. src/utils/telemetry/constants.ts (source of truth)
 * 2. src/sdk/opencode-hooks.ts (inlined copy - SDK hook handlers)
 * 3. src/sdk/copilot-hooks.ts (inlined copy - SDK hook handlers)
 *
 * Note: All agent hooks have been migrated to SDK native handlers:
 * - Claude: src/sdk/claude-hooks.ts (uses telemetry-session module directly)
 * - OpenCode: src/sdk/opencode-hooks.ts (has inlined copy of commands)
 * - Copilot: src/sdk/copilot-hooks.ts (has inlined copy of commands)
 *
 * These tests prevent accidental desynchronization when updating command lists.
 */

// Helper to extract commands from TypeScript file
function extractTypeScriptCommands(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");

  // Match the ATOMIC_COMMANDS array in TypeScript
  // Pattern: const ATOMIC_COMMANDS = [\n  "command",\n  "command",\n] as const
  // Also handle without 'as const'
  const arrayMatch = content.match(/const ATOMIC_COMMANDS\s*=\s*\[\s*([\s\S]*?)\s*\](?:\s*as const)?;?/);

  if (!arrayMatch || !arrayMatch[1]) {
    throw new Error(`Could not find ATOMIC_COMMANDS array in TypeScript file: ${filePath}`);
  }

  const arrayContent = arrayMatch[1];

  // Extract quoted strings (both single and double quotes)
  const commandMatches = arrayContent.match(/["']([^"']+)["']/g);

  if (!commandMatches) {
    return [];
  }

  // Remove quotes and return
  return commandMatches.map(cmd => cmd.slice(1, -1));
}

test("ATOMIC_COMMANDS in OpenCode hooks matches source of truth", () => {
  const projectRoot = join(__dirname, "../..");

  // Source of truth
  const sourceCommands = [...ATOMIC_COMMANDS];

  // Extract from OpenCode SDK hooks
  const openCodeFilePath = join(projectRoot, "src/sdk/opencode-hooks.ts");
  const openCodeCommands = extractTypeScriptCommands(openCodeFilePath);

  // Verify OpenCode hooks matches the source of truth
  expect(openCodeCommands).toEqual(sourceCommands);
});

test("ATOMIC_COMMANDS in Copilot hooks matches source of truth", () => {
  const projectRoot = join(__dirname, "../..");

  // Source of truth
  const sourceCommands = [...ATOMIC_COMMANDS];

  // Extract from Copilot SDK hooks
  const copilotFilePath = join(projectRoot, "src/sdk/copilot-hooks.ts");
  const copilotCommands = extractTypeScriptCommands(copilotFilePath);

  // Verify Copilot hooks matches the source of truth
  expect(copilotCommands).toEqual(sourceCommands);
});

test("ATOMIC_COMMANDS is not empty", () => {
  expect(ATOMIC_COMMANDS.length).toBeGreaterThan(5);
});
