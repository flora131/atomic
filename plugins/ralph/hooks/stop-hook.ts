#!/usr/bin/env bun

import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import assert from "node:assert";
import { unlink } from "node:fs/promises";

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: "Stop";
  stop_hook_active: boolean;
}

interface TranscriptMessage {
  role: string;
  message: {
    content: Array<{ type: string; text?: string }>;
  };
}

interface FeatureItem {
  passes?: boolean;
}

// Read hook input from stdin using Node's readline
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Parse markdown frontmatter (YAML between ---) and extract values
function parseFrontmatter(content: string): Record<string, string> {
  // Handle both Unix (\n) and Windows (\r\n) line endings
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return {};

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Strip surrounding quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

// Extract prompt text (everything after the closing ---)
function extractPromptText(content: string): string {
  // Handle both Unix (\n) and Windows (\r\n) line endings
  const lines = content.split(/\r?\n/);
  let dashCount = 0;
  const promptLines: string[] = [];

  for (const line of lines) {
    if (line === "---") {
      dashCount++;
      continue;
    }
    if (dashCount >= 2) {
      promptLines.push(line);
    }
  }

  return promptLines.join("\n");
}

// Check if all features are passing
async function testAllFeaturesPassing(
  featureListPath: string,
): Promise<boolean> {
  const featureFile = Bun.file(featureListPath);
  assert(
    featureFile.exists(),
    `Feature list file not found at path: ${featureListPath}`,
  );

  try {
    const content = await featureFile.text();
    const features: FeatureItem[] = JSON.parse(content);

    const totalFeatures = features.length;
    if (totalFeatures === 0) {
      console.error("ERROR: research/feature-list.json is empty.");
      return false;
    }

    const passingFeatures = features.filter((f) => f.passes === true).length;
    const failingFeatures = totalFeatures - passingFeatures;

    console.error(
      `Feature Progress: ${passingFeatures} / ${totalFeatures} passing (${failingFeatures} remaining)`,
    );

    return failingFeatures === 0;
  } catch {
    console.error("ERROR: Failed to parse research/feature-list.json");
    return false;
  }
}

// Extract text from <promise> tags
function extractPromiseText(text: string): string {
  const match = text.match(/<promise>([\s\S]*?)<\/promise>/);
  if (!match || !match[1]) return "";
  return match[1].trim().replace(/\s+/g, " ");
}

// Helper to append to debug log
async function debugAppend(msg: string) {
  const file = Bun.file("stop-hook-debug.log");
  const existing = (await file.exists()) ? await file.text() : "";
  await Bun.write("stop-hook-debug.log", existing + msg + "\n");
}

async function main() {
  await Bun.write("stop-hook-debug.log", "STARTED\n");

  // Step 1: Read stdin
  const hookInputRaw = await readStdin();
  await debugAppend(`STDIN READ: ${hookInputRaw.slice(0, 200)}`);
  let hookInput: StopHookInput;
  try {
    hookInput = JSON.parse(hookInputRaw);
    await debugAppend("JSON PARSED OK");
  } catch {
    await debugAppend("JSON PARSE FAILED - exiting");
    process.exit(0);
  }

  // Step 2: Check if ralph-loop is active
  const RALPH_STATE_FILE = ".claude/ralph-loop.local.md";
  const stateFile = Bun.file(RALPH_STATE_FILE);

  if (!(await stateFile.exists())) {
    await debugAppend("STATE FILE NOT FOUND - exiting");
    process.exit(0);
  }
  await debugAppend("STATE FILE EXISTS");

  // Step 3: Read and parse state file
  const stateContent = await stateFile.text();
  const frontmatter = parseFrontmatter(stateContent);
  await debugAppend(`FRONTMATTER: ${JSON.stringify(frontmatter)}`);

  const iterationStr = frontmatter["iteration"] || "";
  const maxIterationsStr = frontmatter["max_iterations"] || "";
  const completionPromise = frontmatter["completion_promise"] || "";
  const featureListPath =
    frontmatter["feature_list_path"] || "research/feature-list.json";

  // Step 4: Validate numeric fields
  if (!/^\d+$/.test(iterationStr)) {
    await debugAppend(`ITERATION INVALID: '${iterationStr}' - exiting`);
    console.error("⚠️  Ralph loop: State file corrupted");
    console.error(
      `   Problem: 'iteration' field is not a valid number (got: '${iterationStr}')`,
    );
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }

  if (!/^\d+$/.test(maxIterationsStr)) {
    await debugAppend(`MAX_ITERATIONS INVALID: '${maxIterationsStr}' - exiting`);
    console.error("⚠️  Ralph loop: State file corrupted");
    console.error(
      `   Problem: 'max_iterations' field is not a valid number (got: '${maxIterationsStr}')`,
    );
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }
  await debugAppend("NUMERIC VALIDATION PASSED");

  const iteration = parseInt(iterationStr, 10);
  const maxIterations = parseInt(maxIterationsStr, 10);

  // Step 5: Check if max iterations reached
  if (maxIterations > 0 && iteration >= maxIterations) {
    await debugAppend("MAX ITERATIONS REACHED - exiting");
    console.error(`🛑 Ralph loop: Max iterations (${maxIterations}) reached.`);
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }
  await debugAppend("MAX ITERATIONS CHECK PASSED");

  // Step 6: Check if all features are passing (only when max_iterations = 0, i.e., infinite mode)
  const featureFileExists = await Bun.file(featureListPath).exists();
  await debugAppend(`FEATURE FILE EXISTS: ${featureFileExists}`);
  if (
    maxIterations === 0 &&
    featureFileExists &&
    (await testAllFeaturesPassing(featureListPath))
  ) {
    await debugAppend("ALL FEATURES PASSING - exiting");
    console.error("✅ All features passing! Exiting loop.");
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }
  await debugAppend("FEATURE CHECK PASSED (continuing)");

  // Step 7: Get transcript path and read last assistant message
  const transcriptPath = hookInput.transcript_path;
  const transcriptFile = Bun.file(transcriptPath);
  await debugAppend(`TRANSCRIPT PATH: ${transcriptPath}`);

  if (!(await transcriptFile.exists())) {
    await debugAppend("TRANSCRIPT FILE NOT FOUND - exiting");
    console.error("⚠️  Ralph loop: Transcript file not found");
    console.error(`   Expected: ${transcriptPath}`);
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }
  await debugAppend("TRANSCRIPT FILE EXISTS");

  const transcriptContent = await transcriptFile.text();
  // Handle both Unix (\n) and Windows (\r\n) line endings
  const lines = transcriptContent.split(/\r?\n/).filter((line: string) => line.trim());
  await debugAppend(`Total lines in transcript = ${lines.length}`);

  // Find all assistant messages by searching for the substring (like bash grep)
  // Debug: log first line to see structure
  if (lines.length > 0) {
    await debugAppend(`FIRST LINE SAMPLE: ${lines[0]!.slice(0, 300)}`);
  }
  const assistantLines = lines.filter((line: string) => {
    return line.includes('"role":"assistant"');
  });

  await debugAppend(`Assistant lines found = ${assistantLines.length}`);

  if (assistantLines.length === 0) {
    await debugAppend("NO ASSISTANT MESSAGES - exiting");
    console.error("⚠️  Ralph loop: No assistant messages found in transcript");
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }

  // Extract last assistant message
  const lastLine = assistantLines[assistantLines.length - 1]!;
  let lastOutput = "";

  try {
    const parsed: TranscriptMessage = JSON.parse(lastLine);
    const textContents = parsed.message.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!);
    lastOutput = textContents.join("\n");
    await debugAppend(`lastOutput length = ${lastOutput.length}`);
  } catch (error) {
    await debugAppend(`PARSE ERROR: ${error}`);
    await debugAppend(`lastLine = ${lastLine.slice(0, 500)}`);
    console.error("⚠️  Ralph loop: Failed to parse assistant message JSON");
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }

  if (!lastOutput) {
    await debugAppend("NO TEXT CONTENT - exiting");
    console.error("⚠️  Ralph loop: Assistant message contained no text content");
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }

  await debugAppend("SUCCESS - all checks passed");

  // Step 8: Check for completion promise (only if set)
  if (completionPromise && completionPromise !== "null") {
    const promiseText = extractPromiseText(lastOutput);
    await debugAppend(`PROMISE TEXT: '${promiseText}'`);
    await debugAppend(`COMPLETION PROMISE: '${completionPromise}'`);

    // Use literal string comparison (not pattern matching)
    if (promiseText && promiseText === completionPromise) {
      await debugAppend("PROMISE MATCHED - exiting loop");
      console.error(`✅ Ralph loop: Detected <promise>${completionPromise}</promise>`);
      await unlink(RALPH_STATE_FILE);
      process.exit(0);
    }
  }

  // Step 9: Not complete - continue loop with SAME PROMPT
  const nextIteration = iteration + 1;

  // Extract prompt (everything after the closing ---)
  const promptText = extractPromptText(stateContent);
  await debugAppend(`PROMPT TEXT LENGTH: ${promptText.length}`);

  if (!promptText) {
    await debugAppend("NO PROMPT TEXT - exiting");
    console.error("⚠️  Ralph loop: State file corrupted or incomplete");
    console.error("   Problem: No prompt text found");
    await unlink(RALPH_STATE_FILE);
    process.exit(0);
  }

  // Step 10: Update iteration in frontmatter
  const updatedContent = stateContent.replace(
    /^iteration: .*/m,
    `iteration: ${nextIteration}`,
  );
  await Bun.write(RALPH_STATE_FILE, updatedContent);
  await debugAppend(`UPDATED ITERATION TO: ${nextIteration}`);

  // Step 11: Build system message with iteration count and completion promise info
  let systemMsg: string;
  if (completionPromise && completionPromise !== "null") {
    systemMsg = `🔄 Ralph iteration ${nextIteration} | To stop: output <promise>${completionPromise}</promise> (ONLY when statement is TRUE - do not lie to exit!)`;
  } else {
    systemMsg = `🔄 Ralph iteration ${nextIteration} | No completion promise set - loop runs indefinitely`;
  }

  // Output JSON to block the stop and feed prompt back
  const output: HookJSONOutput = {
    decision: "block",
    reason: promptText,
    systemMessage: systemMsg,
  };

  await debugAppend("OUTPUTTING BLOCK JSON");
  console.log(JSON.stringify(output));
}

main();
