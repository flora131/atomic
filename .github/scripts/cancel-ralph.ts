#!/usr/bin/env bun

/**
 * Cancel Ralph Loop Script - TypeScript Version
 *
 * Removes state file, continue flag, archives state, and kills any spawned processes.
 * Converted from: .github/scripts/cancel-ralph.sh
 *
 * Usage: bun run .github/scripts/cancel-ralph.ts
 *
 * Reference implementations:
 * - YAML frontmatter parsing: .opencode/plugin/ralph.ts:119-168
 * - State file format: .github/scripts/ralph-loop.ts
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================================
// CONSTANTS
// ============================================================================

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_CONTINUE_FILE = ".github/ralph-continue.flag";
const RALPH_LOG_DIR = ".github/logs";

// ============================================================================
// INTERFACES
// ============================================================================

interface RalphState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  startedAt: string;
  prompt: string;
}

// ============================================================================
// YAML FRONTMATTER PARSING
// Reference: .opencode/plugin/ralph.ts:119-168
// ============================================================================

function parseRalphState(): RalphState | null {
  if (!existsSync(RALPH_STATE_FILE)) {
    return null;
  }

  try {
    // Normalize line endings to LF for cross-platform compatibility
    const content = readFileSync(RALPH_STATE_FILE, "utf-8").replace(/\r\n/g, "\n");

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return null;
    }

    const [, frontmatter, prompt] = frontmatterMatch;

    // Parse frontmatter values
    const getValue = (key: string): string | null => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
      if (!match) return null;
      // Remove surrounding quotes if present
      return match[1].replace(/^["'](.*)["']$/, "$1");
    };

    const active = getValue("active") === "true";
    const iteration = parseInt(getValue("iteration") || "1", 10);
    const maxIterations = parseInt(getValue("max_iterations") || "0", 10);
    const completionPromise = getValue("completion_promise");
    const featureListPath = getValue("feature_list_path") || "research/feature-list.json";
    const startedAt = getValue("started_at") || new Date().toISOString();

    return {
      active,
      iteration,
      maxIterations,
      completionPromise:
        completionPromise === "null" || !completionPromise ? null : completionPromise,
      featureListPath,
      startedAt,
      prompt: prompt.trim(),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// ARCHIVE STATE FILE
// ============================================================================

function archiveState(state: RalphState): string {
  // Ensure log directory exists
  if (!existsSync(RALPH_LOG_DIR)) {
    mkdirSync(RALPH_LOG_DIR, { recursive: true });
  }

  // Generate timestamp for archive filename
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  const archiveFile = join(RALPH_LOG_DIR, `ralph-loop-cancelled-${timestamp}.md`);

  // Write archived state with cancellation metadata
  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

  const content = `---
active: false
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
cancelled_at: "${now.toISOString().replace(/\.\d{3}Z$/, "Z")}"
stop_reason: "user_cancelled"
---

${state.prompt}
`;

  writeFileSync(archiveFile, content, "utf-8");
  return archiveFile;
}

// ============================================================================
// KILL ORPHANED PROCESSES
// ============================================================================

async function killOrphanedProcesses(): Promise<{ copilotKilled: boolean; sleepKilled: boolean }> {
  let copilotKilled = false;
  let sleepKilled = false;

  // Kill copilot processes
  try {
    await Bun.$`pkill -f "copilot"`.quiet().nothrow();
    copilotKilled = true;
  } catch {
    // pkill returns non-zero if no processes matched, which is fine
  }

  // Kill sleep processes waiting to spawn copilot
  try {
    await Bun.$`pkill -f "sleep.*copilot"`.quiet().nothrow();
    sleepKilled = true;
  } catch {
    // pkill returns non-zero if no processes matched, which is fine
  }

  return { copilotKilled, sleepKilled };
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  // Check if Ralph loop is active
  const state = parseRalphState();

  if (!state) {
    console.log("No active Ralph loop found.");
    console.log("");
    console.log("Checking for orphaned Ralph processes...");

    const { copilotKilled } = await killOrphanedProcesses();

    if (copilotKilled) {
      console.log("Killed orphaned copilot-cli processes.");
    } else {
      console.log("No orphaned processes found.");
    }

    process.exit(0);
  }

  // Archive state file
  const archiveFile = archiveState(state);

  // Remove state files
  try {
    unlinkSync(RALPH_STATE_FILE);
  } catch {
    // File may not exist
  }

  try {
    unlinkSync(RALPH_CONTINUE_FILE);
  } catch {
    // File may not exist
  }

  // Kill spawned processes
  console.log("Stopping spawned processes...");
  await killOrphanedProcesses();

  // Print summary
  console.log(`Cancelled Ralph loop (was at iteration ${state.iteration})`);
  console.log("");
  console.log("Details:");
  console.log(`  Started at: ${state.startedAt}`);

  // Truncate prompt for display
  const promptDisplay =
    state.prompt.length > 80 ? state.prompt.substring(0, 80) + "..." : state.prompt;
  console.log(`  Prompt: ${promptDisplay}`);
  console.log(`  State archived to: ${archiveFile}`);
  console.log("");
  console.log("All Ralph processes have been terminated.");

  process.exit(0);
}

main();
