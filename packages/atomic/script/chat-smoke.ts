/**
 * Cross-platform chat-launch smoke for the published `atomic` binary.
 *
 * Spawns `<atomic-bin> chat -a <agent>` inside a real PTY
 * (forkpty on Unix, ConPTY on Windows) so the chat command's
 * `process.stdin.isTTY` guard sees a terminal and doesn't fall back to
 * `spawnDirect`. Asserts that the stub agent ends up running INSIDE
 * tmux/psmux by greping for the `$TMUX` / `$PSMUX` markers it prints.
 *
 * Replaces the prior shell-only invocation that was non-portable
 * (GNU `timeout` missing on macOS, `Start-Process` allocates pipes not
 * a PTY on Windows). Modeled on opencode's `bun-pty` usage.
 */

import { spawn as ptySpawn } from "bun-pty";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const atomicBin = process.argv[2];
const agent = process.argv[3] ?? "opencode";
if (!atomicBin) {
  console.error("usage: chat-smoke.ts <atomic-bin> [agent]");
  process.exit(2);
}

const stubDir = mkdtempSync(join(tmpdir(), "atomic-chat-smoke-"));

// The stub sleeps long enough to outlive atomic.chatCommand's ~7 follow-up
// tmux calls; if it exits in <60ms the pane closure trips killSessionOnPaneExit
// and every later tmux call sees "no server running".
if (process.platform === "win32") {
  // psmux invokes pane commands via `pwsh -NoProfile -File <ps1>`, so the
  // stub must be a PowerShell script behind a `.cmd` shim Bun.which can find.
  writeFileSync(
    join(stubDir, `${agent}.ps1`),
    `Write-Host "ATOMIC_CHAT_SMOKE TMUX=$($env:TMUX) PSMUX=$($env:PSMUX)"\r\nStart-Sleep -Seconds 5\r\n`,
  );
  writeFileSync(
    join(stubDir, `${agent}.cmd`),
    `@echo off\r\npwsh -NoProfile -File "%~dp0${agent}.ps1" %*\r\n`,
  );
} else {
  const stubPath = join(stubDir, agent);
  writeFileSync(
    stubPath,
    `#!/bin/bash\necho "ATOMIC_CHAT_SMOKE TMUX=\${TMUX:-} PSMUX=\${PSMUX:-}"\nexec sleep 5\n`,
  );
  chmodSync(stubPath, 0o755);
}

// On Windows `process.env` is a case-insensitive proxy, but
// `Object.entries(process.env)` enumerates the OS-cased key ("Path"),
// so a plain-object copy ends up with `env.Path` populated and
// `env.PATH` undefined. Strip any case-variant of "PATH" up front and
// rewrite it under the platform-canonical key — otherwise the augmented
// env we hand bun-pty drops the inherited PATH entirely, and the child
// `atomic.exe` can't find psmux/pwsh on PATH despite the parent having
// them.
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && key.toLowerCase() !== "path") env[key] = value;
}
const pathKey = process.platform === "win32" ? "Path" : "PATH";
env[pathKey] = `${stubDir}${delimiter}${process.env.PATH ?? ""}`;

console.log(`Chat-smoke binary: ${atomicBin}`);
console.log(`Stub agent dir:    ${stubDir}`);

const proc = ptySpawn(atomicBin, ["chat", "-a", agent], {
  name: "xterm-256color",
  cols: 120,
  rows: 40,
  cwd: process.cwd(),
  env,
});

const chunks: string[] = [];
proc.onData((data) => {
  chunks.push(data);
});

const TIMEOUT_MS = Number(process.env.ATOMIC_CHAT_SMOKE_TIMEOUT_MS ?? 8000);
const killTimer = setTimeout(() => {
  try {
    proc.kill();
  } catch {
    // Already exited
  }
}, TIMEOUT_MS);

await new Promise<void>((resolve) => {
  proc.onExit(() => {
    clearTimeout(killTimer);
    resolve();
  });
});

const captured = chunks.join("");
console.log("--- captured chat output ---");
console.log(captured);
console.log("--- assertion ---");

// psmux paints pane content with `\x1B[<n>C` cursor-forward escapes between
// fields instead of literal whitespace, so a regex anchored on `\s+` between
// the marker and the env-var dump never matches on Windows. Strip ANSI/CSI
// escapes once and run all assertions against the clean stream.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const cleaned = captured.replace(ANSI_RE, "");

// Two independent invariants of a healthy chat launch:
//
//   1. agent ran INSIDE the multiplexer — the stub prints `$TMUX` / `$PSMUX`
//      as set by tmux/psmux when it forks the pane process; an empty value
//      means chatCommand fell back to spawnDirect (no tmux at all).
//
//   2. footer rendered — `spawnAttachedFooter` compiles the agent pill
//      to a tmux/psmux format string and applies it via `set-option -g
//      status-left/status-right`. The uppercase agent pill ("OPENCODE")
//      appears verbatim inside the captured PTY stream because tmux
//      paints the status line into the same client terminal.
// psmux separates the marker and `TMUX=…` field with a `\x1B[1C` cursor
// advance rather than a literal space; once ANSI is stripped, the two
// tokens are flush against each other (`ATOMIC_CHAT_SMOKETMUX=…`). Allow
// zero-or-more whitespace between them.
const muxRe = /ATOMIC_CHAT_SMOKE\s*(?:TMUX|PSMUX)=\S*atomic/;
const footerRe = new RegExp(agent.toUpperCase());

const muxOk = muxRe.test(cleaned);
const footerOk = footerRe.test(cleaned);

console.log(
  `${muxOk ? "PASS" : "FAIL"}: stub agent ran inside tmux/psmux session`,
);
console.log(
  `${footerOk ? "PASS" : "FAIL"}: footer pane rendered the ${agent.toUpperCase()} pill`,
);

if (muxOk && footerOk) process.exit(0);

if (!muxOk) {
  console.log("  → chat fell back to spawnDirect (no tmux/psmux pane)");
}
if (!footerOk) {
  console.log(
    `  → footer pane did not paint "${agent.toUpperCase()}" — likely a malformed split-window command`,
  );
}
process.exit(1);
