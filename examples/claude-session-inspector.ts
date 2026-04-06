/**
 * Claude Agent SDK – Session Inspector & Resume Demo
 *
 * Demonstrates how to inspect and interact with local Claude Code sessions
 * using the Claude Agent SDK's session management APIs.
 *
 * The Claude Agent SDK does NOT support attaching to a *running* Claude Code
 * process (unlike Copilot SDK's server mode). Instead, sessions are persisted
 * as JSONL files on disk (~/.claude/projects/<encoded-cwd>/<session-id>.jsonl).
 * The SDK can:
 *
 *   1. listSessions()       – discover past sessions with metadata
 *   2. getSessionMessages()  – read the full transcript of any session
 *   3. getSessionInfo()      – look up a single session by ID
 *   4. resume / continue     – start a NEW SDK process that continues where
 *                              a prior session left off (full context preserved)
 *
 * Usage:
 *   # List sessions for the current project
 *   bun run examples/claude-session-inspector.ts list
 *
 *   # List sessions for a specific directory
 *   bun run examples/claude-session-inspector.ts list /path/to/project
 *
 *   # Read messages from a specific session
 *   bun run examples/claude-session-inspector.ts read <session-id>
 *
 *   # Resume a session with a follow-up prompt
 *   bun run examples/claude-session-inspector.ts resume <session-id> "your follow-up prompt"
 *
 *   # Continue the most recent session with a follow-up prompt
 *   bun run examples/claude-session-inspector.ts continue "your follow-up prompt"
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY env var (only needed for resume/continue commands)
 *   - Claude Code must have been used in the target directory at least once
 */

import {
  listSessions,
  getSessionMessages,
  getSessionInfo,
  query,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function printSessionRow(s: SDKSessionInfo, index: number): void {
  const modified = formatDate(s.lastModified);
  const title = s.customTitle ?? truncate(s.firstPrompt ?? s.summary);
  const branch = s.gitBranch ? ` (${s.gitBranch})` : "";
  console.log(`  ${index + 1}. [${modified}]${branch}`);
  console.log(`     ${title}`);
  console.log(`     ID: ${s.sessionId}`);
  console.log();
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdList(dir?: string): Promise<void> {
  const sessions = await listSessions({ dir: dir ?? process.cwd(), limit: 15 });

  if (sessions.length === 0) {
    console.log("No sessions found." + (dir ? "" : " Try specifying a project directory."));
    return;
  }

  console.log(`\n📋 Found ${sessions.length} session(s):\n`);
  sessions.forEach(printSessionRow);
}

async function cmdRead(sessionId: string): Promise<void> {
  const info = await getSessionInfo(sessionId);
  if (!info) {
    console.error(`Session ${sessionId} not found.`);
    process.exit(1);
  }

  console.log(`\n📖 Session: ${info.customTitle ?? info.summary}`);
  console.log(`   ID: ${info.sessionId}`);
  console.log(`   Last modified: ${formatDate(info.lastModified)}`);
  if (info.gitBranch) console.log(`   Branch: ${info.gitBranch}`);
  if (info.cwd) console.log(`   Working dir: ${info.cwd}`);
  console.log();

  const messages = await getSessionMessages(sessionId, { limit: 50 });

  if (messages.length === 0) {
    console.log("  (no messages)");
    return;
  }

  for (const msg of messages) {
    const role = msg.type === "user" ? "👤 User" : "🤖 Assistant";
    const payload = msg.message as Record<string, unknown>;

    let text = "";
    if (typeof payload?.content === "string") {
      text = payload.content;
    } else if (Array.isArray(payload?.content)) {
      text = (payload.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text")
        .map((b) => b.text as string)
        .join("\n");
    }

    if (text) {
      console.log(`${role}:`);
      console.log(`  ${truncate(text, 200)}`);
      console.log();
    }
  }
}

async function cmdResume(sessionId: string, prompt: string): Promise<void> {
  const info = await getSessionInfo(sessionId);
  if (!info) {
    console.error(`Session ${sessionId} not found.`);
    process.exit(1);
  }

  console.log(`\n🔄 Resuming session: ${info.customTitle ?? info.summary}`);
  console.log(`   Following up with: "${prompt}"\n`);

  for await (const message of query({
    prompt,
    options: {
      resume: sessionId,
      allowedTools: ["Read", "Glob", "Grep"],
    },
  })) {
    if (message.type === "assistant") {
      const content = message.message.content;
      for (const block of content) {
        if (block.type === "text") {
          process.stdout.write(block.text);
        }
      }
    }
    if (message.type === "result") {
      console.log(`\n\n✅ Done (${message.subtype})`);
      if (message.session_id) {
        console.log(`   Session ID: ${message.session_id}`);
      }
    }
  }
}

async function cmdContinue(prompt: string): Promise<void> {
  console.log(`\n🔄 Continuing most recent session…`);
  console.log(`   Following up with: "${prompt}"\n`);

  for await (const message of query({
    prompt,
    options: {
      continue: true,
      allowedTools: ["Read", "Glob", "Grep"],
    },
  })) {
    if (message.type === "assistant") {
      const content = message.message.content;
      for (const block of content) {
        if (block.type === "text") {
          process.stdout.write(block.text);
        }
      }
    }
    if (message.type === "result") {
      console.log(`\n\n✅ Done (${message.subtype})`);
      if (message.session_id) {
        console.log(`   Session ID: ${message.session_id}`);
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "list":
    await cmdList(args[0]);
    break;

  case "read":
    if (!args[0]) {
      console.error("Usage: bun run examples/claude-session-inspector.ts read <session-id>");
      process.exit(1);
    }
    await cmdRead(args[0]);
    break;

  case "resume":
    if (!args[0] || !args[1]) {
      console.error(
        'Usage: bun run examples/claude-session-inspector.ts resume <session-id> "prompt"'
      );
      process.exit(1);
    }
    await cmdResume(args[0], args[1]);
    break;

  case "continue":
    if (!args[0]) {
      console.error('Usage: bun run examples/claude-session-inspector.ts continue "prompt"');
      process.exit(1);
    }
    await cmdContinue(args[0]);
    break;

  default:
    console.log(`
Claude Agent SDK – Session Inspector & Resume Demo

Commands:
  list [dir]                         List sessions (default: cwd)
  read <session-id>                  Read messages from a session
  resume <session-id> "prompt"       Resume a session with a follow-up
  continue "prompt"                  Continue the most recent session

Note: The Claude Agent SDK cannot attach to a RUNNING Claude Code process.
Sessions are JSONL files on disk. "resume" starts a new SDK process that
loads the prior conversation history, giving the agent full context.

Examples:
  bun run examples/claude-session-inspector.ts list
  bun run examples/claude-session-inspector.ts list /path/to/project
  bun run examples/claude-session-inspector.ts read abc-123-def
  bun run examples/claude-session-inspector.ts resume abc-123 "now fix the tests"
  bun run examples/claude-session-inspector.ts continue "what did you change?"
`);
}
