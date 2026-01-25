import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ATOMIC_COMMANDS } from "../../src/utils/telemetry/constants";

/**
 * Tests to verify ATOMIC_COMMANDS is synchronized across three locations:
 * 1. src/utils/telemetry/constants.ts (source of truth)
 * 2. bin/telemetry-helper.sh (Bash duplicate)
 * 3. .opencode/plugin/telemetry.ts (TypeScript duplicate)
 *
 * These tests prevent accidental desynchronization when updating command lists.
 */

// Helper to extract commands from bash file
function extractBashCommands(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");

  // Match the ATOMIC_COMMANDS array in bash
  // Pattern: ATOMIC_COMMANDS=(\n  "command"\n  "command"\n)
  const arrayMatch = content.match(/ATOMIC_COMMANDS=\(\s*([\s\S]*?)\s*\)/);

  if (!arrayMatch || !arrayMatch[1]) {
    throw new Error("Could not find ATOMIC_COMMANDS array in bash file");
  }

  const arrayContent = arrayMatch[1];

  // Extract quoted strings
  const commandMatches = arrayContent.match(/"([^"]+)"/g);

  if (!commandMatches) {
    return [];
  }

  // Remove quotes and return
  return commandMatches.map(cmd => cmd.slice(1, -1));
}

// Helper to extract commands from TypeScript file
function extractTypeScriptCommands(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");

  // Match the ATOMIC_COMMANDS array in TypeScript
  // Pattern: const ATOMIC_COMMANDS = [\n  "command",\n  "command",\n] as const
  const arrayMatch = content.match(/const ATOMIC_COMMANDS\s*=\s*\[\s*([\s\S]*?)\s*\]\s*as const/);

  if (!arrayMatch || !arrayMatch[1]) {
    throw new Error("Could not find ATOMIC_COMMANDS array in TypeScript file");
  }

  const arrayContent = arrayMatch[1];

  // Extract quoted strings
  const commandMatches = arrayContent.match(/"([^"]+)"/g);

  if (!commandMatches) {
    return [];
  }

  // Remove quotes and return
  return commandMatches.map(cmd => cmd.slice(1, -1));
}

test("ATOMIC_COMMANDS is synchronized across all three locations", () => {
  const projectRoot = join(__dirname, "../..");

  // Source of truth
  const sourceCommands = [...ATOMIC_COMMANDS];

  // Extract from bash file
  const bashFilePath = join(projectRoot, "bin/telemetry-helper.sh");
  const bashCommands = extractBashCommands(bashFilePath);

  // Extract from OpenCode TypeScript file
  const opencodeFilePath = join(projectRoot, ".opencode/plugin/telemetry.ts");
  const opencodeCommands = extractTypeScriptCommands(opencodeFilePath);

  // Verify all three match
  expect(bashCommands).toEqual(sourceCommands);
  expect(opencodeCommands).toEqual(sourceCommands);
});

test("ATOMIC_COMMANDS is not empty", () => {
  expect(ATOMIC_COMMANDS.length).toBeGreaterThan(5);
});
