#!/usr/bin/env bun

/**
 * Telemetry Session Hook - Incremental Command Logger
 *
 * Handles userPromptSubmitted: extracts Atomic commands and appends to temp file.
 * The temp file is read and cleared by telemetry-stop.ts on sessionEnd.
 */

import { existsSync } from "fs";

// Atomic commands to track (from spec Section 5.3.2)
// Note: ralph:ralph-loop and ralph:ralph-help replaced by SDK-native /ralph workflow
const ATOMIC_COMMANDS = [
  "/research-codebase",
  "/create-spec",
  "/create-feature-list",
  "/implement-feature",
  "/commit",
  "/create-gh-pr",
  "/explain-code",
  "/ralph",
];

// Temp file for accumulating commands during session
const TEMP_FILE = ".github/telemetry-session-commands.tmp";

/**
 * Extract Atomic commands from a prompt string
 */
function extractCommandsFromPrompt(prompt: string): string[] {
  const commands: string[] = [];
  for (const cmd of ATOMIC_COMMANDS) {
    const regex = new RegExp(`(?:^|\\s)${cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`, "g");
    const matches = prompt.match(regex);
    if (matches) {
      for (const _ of matches) {
        commands.push(cmd);
      }
    }
  }
  return commands;
}

/**
 * Append commands to temp file (one per line)
 */
async function appendCommandsToTemp(commands: string[]): Promise<void> {
  if (commands.length === 0) return;
  const existingContent = existsSync(TEMP_FILE) ? await Bun.file(TEMP_FILE).text().catch(() => "") : "";
  await Bun.write(TEMP_FILE, existingContent + commands.join("\n") + "\n");
}

async function main(): Promise<void> {
  let prompt: string;
  try {
    const stdin = await Bun.stdin.text();
    const input = JSON.parse(stdin) as { prompt?: string };
    prompt = input.prompt ?? "";
  } catch {
    process.exit(0);
  }

  const commands = extractCommandsFromPrompt(prompt);
  if (commands.length > 0) {
    await appendCommandsToTemp(commands);
  }

  process.exit(0);
}

main();
