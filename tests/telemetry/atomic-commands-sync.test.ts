import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ATOMIC_COMMANDS } from "../../src/utils/telemetry/constants";

/**
 * Tests to verify ATOMIC_COMMANDS is synchronized across all locations:
 * 1. src/utils/telemetry/constants.ts (source of truth)
 * 2. .opencode/plugin/telemetry.ts (OpenCode plugin - inlined)
 * 3. .claude/hooks/telemetry-stop.ts (Claude Code hook - inlined)
 * 4. .github/hooks/telemetry-session.ts (Copilot hook - inlined)
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

test("ATOMIC_COMMANDS is synchronized across all TypeScript locations", () => {
  const projectRoot = join(__dirname, "../..");

  // Source of truth
  const sourceCommands = [...ATOMIC_COMMANDS];

  // Extract from OpenCode plugin
  const opencodeFilePath = join(projectRoot, ".opencode/plugin/telemetry.ts");
  const opencodeCommands = extractTypeScriptCommands(opencodeFilePath);

  // Extract from Claude Code hook
  const claudeFilePath = join(projectRoot, ".claude/hooks/telemetry-stop.ts");
  const claudeCommands = extractTypeScriptCommands(claudeFilePath);

  // Extract from Copilot hook
  const copilotFilePath = join(projectRoot, ".github/hooks/telemetry-session.ts");
  const copilotCommands = extractTypeScriptCommands(copilotFilePath);

  // Verify all match the source of truth
  expect(opencodeCommands).toEqual(sourceCommands);
  expect(claudeCommands).toEqual(sourceCommands);
  expect(copilotCommands).toEqual(sourceCommands);
});

test("ATOMIC_COMMANDS is not empty", () => {
  expect(ATOMIC_COMMANDS.length).toBeGreaterThan(5);
});
