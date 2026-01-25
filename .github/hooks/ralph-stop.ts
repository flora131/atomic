#!/usr/bin/env bun

/**
 * Ralph Wiggum Session End Hook (Self-Restarting) - TypeScript Version
 *
 * Tracks iterations, checks completion conditions, spawns next session automatically.
 * This hook implements a self-restarting pattern: when the session ends,
 * it spawns a new detached copilot-cli session to continue the loop.
 * No external orchestrator required!
 *
 * Separated from: .github/hooks/stop-hook.ts
 */

import { existsSync, mkdirSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================================
// RALPH LOOP LOGIC
// ============================================================================

interface HookInput {
  timestamp?: string;
  cwd?: string;
  reason?: string;
}

// State file locations
const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_LOG_DIR = ".github/logs";
const RALPH_CONTINUE_FILE = ".github/ralph-continue.flag";

// ============================================================================
// YAML FRONTMATTER PARSING
// Reference: .opencode/plugin/ralph.ts:119-168
// ============================================================================

interface ParsedRalphState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  startedAt: string;
  prompt: string;
}

function parseRalphState(): ParsedRalphState | null {
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

function writeRalphState(state: ParsedRalphState): void {
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

  Bun.write(RALPH_STATE_FILE, content);
}

// Check if all features are passing
// Note: Caller must verify file exists before calling this function
async function checkFeaturesPassing(path: string): Promise<boolean> {
  try {
    const features = (await Bun.file(path).json()) as Array<{ passes?: boolean }>;

    const totalFeatures = features.length;
    if (totalFeatures === 0) {
      return false;
    }

    const passingFeatures = features.filter((f) => f.passes === true).length;
    const failingFeatures = totalFeatures - passingFeatures;

    console.error(`Feature Progress: ${passingFeatures} / ${totalFeatures} passing (${failingFeatures} remaining)`);

    return failingFeatures === 0;
  } catch {
    return false;
  }
}

// Main execution
async function main(): Promise<void> {
  // Read hook input from stdin
  const input = await Bun.stdin.text();

  // Parse input fields
  let timestamp = "";
  let cwd = "";
  let reason = "unknown";

  try {
    const parsed = JSON.parse(input) as HookInput;
    timestamp = parsed?.timestamp || "";
    cwd = parsed?.cwd || "";
    reason = parsed?.reason || "unknown";
  } catch {
    // Continue with defaults if parsing fails
  }

  // Ensure log directory exists
  if (!existsSync(RALPH_LOG_DIR)) {
    mkdirSync(RALPH_LOG_DIR, { recursive: true });
  }

  // Log session end
  const sessionEndEntry = {
    timestamp,
    event: "session_end",
    cwd,
    reason,
  };

  const logFile = join(RALPH_LOG_DIR, "ralph-sessions.jsonl");
  const existingLog = await Bun.file(logFile).text().catch(() => "");
  await Bun.write(logFile, existingLog + JSON.stringify(sessionEndEntry) + "\n");

  // Check if Ralph loop is active and parse state
  const state = parseRalphState();

  if (!state || !state.active) {
    // No active loop - clean exit
    try {
      unlinkSync(RALPH_CONTINUE_FILE);
    } catch {
      // File may not exist
    }
    process.exit(0);
  }

  const iteration = state.iteration;
  const maxIterations = state.maxIterations;
  const featureListPath = state.featureListPath;
  const prompt = state.prompt;

  // Check completion conditions
  let shouldContinue = true;
  let stopReason = "";

  // Check 1: Max iterations reached
  if (maxIterations > 0 && iteration >= maxIterations) {
    shouldContinue = false;
    stopReason = "max_iterations_reached";
    console.error(`Ralph loop: Max iterations (${maxIterations}) reached.`);
  }

  // Check 2: All features passing (only in unlimited mode when feature file exists)
  if (shouldContinue && maxIterations === 0 && existsSync(featureListPath)) {
    if (await checkFeaturesPassing(featureListPath)) {
      shouldContinue = false;
      stopReason = "all_features_passing";
      console.error("Ralph loop: All features passing! Loop complete.");
    }
  }

  // Check 3: Completion promise detected
  // Note: Completion promise detection is handled by the OpenCode plugin or external orchestrator
  // The stop hook focuses on max_iterations and feature-list completion checks

  // Update state and spawn next session (or complete)
  if (shouldContinue) {
    // Increment iteration for next run
    const nextIteration = iteration + 1;

    // Update state file using YAML frontmatter format
    writeRalphState({
      ...state,
      iteration: nextIteration,
    });

    // Keep continue flag for status checking (optional)
    await Bun.write(RALPH_CONTINUE_FILE, prompt);

    console.error(`Ralph loop: Iteration ${iteration} complete. Spawning iteration ${nextIteration}...`);

    // Get current working directory for the spawned process
    const currentDir = process.cwd();

    // Escape prompt for shell (replace single quotes)
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    // Spawn new copilot-cli session in background (detached, survives hook exit)
    // - nohup: prevents SIGHUP when parent exits
    // - sleep 2: brief delay to let current session fully close
    // - Redirects to log file for debugging
    const spawnLogFile = join(RALPH_LOG_DIR, `ralph-spawn-${nextIteration}.log`);

    Bun.spawn(["bash", "-c", `
      sleep 2
      cd '${currentDir}'
      echo '${escapedPrompt}' | copilot --allow-all-tools --allow-all-paths
    `], {
      stdout: Bun.file(spawnLogFile),
      stderr: Bun.file(spawnLogFile),
      stdin: "ignore",
    });

    console.error(`Ralph loop: Spawned background process for iteration ${nextIteration}`);
  } else {
    // Loop complete - clean up
    try {
      unlinkSync(RALPH_CONTINUE_FILE);
    } catch {
      // File may not exist
    }

    // Archive state file in YAML frontmatter format
    const archiveTimestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archiveFile = join(RALPH_LOG_DIR, `ralph-loop-${archiveTimestamp}.md`);

    const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const completionPromiseYaml =
      state.completionPromise === null ? "null" : `"${state.completionPromise}"`;

    const archiveContent = `---
active: false
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
completed_at: "${completedAt}"
stop_reason: "${stopReason}"
---

${state.prompt}
`;

    await Bun.write(archiveFile, archiveContent);

    // Remove active state
    try {
      unlinkSync(RALPH_STATE_FILE);
    } catch {
      // File may not exist
    }

    console.error(`Ralph loop completed. Reason: ${stopReason}`);
    console.error(`State archived to: ${archiveFile}`);
  }

  // Log completion status
  const iterationEndEntry = {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    event: "ralph_iteration_end",
    iteration,
    shouldContinue,
    stopReason,
  };

  const existingLogFinal = await Bun.file(logFile).text().catch(() => "");
  await Bun.write(logFile, existingLogFinal + JSON.stringify(iterationEndEntry) + "\n");

  // Output is ignored for sessionEnd
  process.exit(0);
}

main();
