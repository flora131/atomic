#!/usr/bin/env bun

/**
 * Ralph Wiggum Session Start Hook - TypeScript Version
 *
 * Detects active Ralph loops and logs session information.
 * Converted from: .github/scripts/start-ralph-session.sh
 *
 * Usage: bun run .github/scripts/start-ralph-session.ts
 *
 * Reference implementations:
 * - stdin JSON parsing: .github/hooks/stop-hook.ts:413-429
 * - YAML frontmatter parsing: .opencode/plugin/ralph.ts:119-168
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================================
// CONSTANTS
// ============================================================================

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_LOG_DIR = ".github/logs";

// ============================================================================
// INTERFACES
// ============================================================================

interface HookInput {
  timestamp?: string;
  cwd?: string;
  source?: string;
  initialPrompt?: string;
}

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
// YAML FRONTMATTER WRITING
// Reference: .opencode/plugin/ralph.ts:170-189
// ============================================================================

function writeRalphState(state: RalphState): void {
  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
---

${state.prompt}
`;

  writeFileSync(RALPH_STATE_FILE, content, "utf-8");
}

// ============================================================================
// MAIN
// Reference: .github/hooks/stop-hook.ts:413-429
// ============================================================================

async function main(): Promise<void> {
  // Read hook input from stdin
  const input = await Bun.stdin.text();

  // Parse input fields
  let timestamp = "";
  let cwd = "";
  let source = "unknown";
  let initialPrompt = "";

  try {
    const parsed = JSON.parse(input) as HookInput;
    timestamp = parsed?.timestamp || "";
    cwd = parsed?.cwd || "";
    source = parsed?.source || "unknown";
    initialPrompt = parsed?.initialPrompt || "";
  } catch {
    // Continue with defaults if parsing fails
  }

  // Ensure log directory exists
  if (!existsSync(RALPH_LOG_DIR)) {
    mkdirSync(RALPH_LOG_DIR, { recursive: true });
  }

  // Log session start
  const sessionStartEntry = {
    timestamp,
    event: "session_start",
    cwd,
    source,
    initialPrompt,
  };

  const logFile = join(RALPH_LOG_DIR, "ralph-sessions.jsonl");
  const existingLog = await Bun.file(logFile).text().catch(() => "");
  await Bun.write(logFile, existingLog + JSON.stringify(sessionStartEntry) + "\n");

  // Check if Ralph loop is active
  const state = parseRalphState();

  if (state && state.active) {
    // Output status message (visible to agent via stderr)
    console.error(`Ralph loop active - Iteration ${state.iteration}`);

    if (state.maxIterations > 0) {
      console.error(`  Max iterations: ${state.maxIterations}`);
    } else {
      console.error("  Max iterations: unlimited");
    }

    if (state.completionPromise) {
      console.error(`  Completion promise: ${state.completionPromise}`);
    }

    // Truncate prompt for display (first 100 chars)
    const promptDisplay =
      state.prompt.length > 100 ? state.prompt.substring(0, 100) + "..." : state.prompt;
    console.error(`  Prompt: ${promptDisplay}`);

    // If this is a resume or startup, increment iteration
    if (source === "resume" || source === "startup") {
      const newIteration = state.iteration + 1;

      // Update state file with new iteration
      writeRalphState({
        ...state,
        iteration: newIteration,
      });

      console.error(`Ralph loop continuing at iteration ${newIteration}`);
    }
  }

  // Output is ignored for sessionStart
  process.exit(0);
}

main();
