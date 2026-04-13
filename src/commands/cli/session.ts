/**
 * Session CLI commands — shared between `atomic chat session` and
 * `atomic workflow session`, and the top-level `atomic session` picker.
 *
 * Wraps tmux -L atomic list-sessions / attach-session so users can
 * inspect and reconnect to running atomic sessions without touching
 * tmux directly.
 */

import { select, isCancel, cancel } from "@clack/prompts";
import { createPainter, type PaletteKey } from "../../theme/colors.ts";
import {
  listSessions,
  isTmuxInstalled,
  isInsideAtomicSocket,
  isInsideTmux,
  sessionExists,
  switchClient,
  spawnMuxAttach,
  detachAndAttachAtomic,
  SOCKET_NAME,
} from "../../sdk/workflows/index.ts";
import type { TmuxSession, SessionType } from "../../sdk/runtime/tmux.ts";

/** Scope controls which session types a command shows. */
export type SessionScope = "chat" | "workflow" | "all";

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * Render the session list as a printable string.
 *
 * Layout mirrors the workflow list style — data-first count header,
 * session rows with metadata, dim footer hint.
 */
export function renderSessionList(sessions: TmuxSession[]): string {
  const paint = createPainter();
  const lines: string[] = [];

  if (sessions.length === 0) {
    lines.push("");
    lines.push("  " + paint("text", "no sessions running", { bold: true }));
    lines.push("");
    lines.push("  " + paint("dim", "start one with"));
    lines.push("    " + paint("accent", "atomic chat -a <agent>"));
    lines.push("    " + paint("accent", "atomic workflow -n <name> -a <agent>"));
    lines.push("");
    return lines.join("\n") + "\n";
  }

  const count = sessions.length;
  const noun = count === 1 ? "session" : "sessions";
  lines.push("");
  lines.push(
    "  " + paint("text", String(count), { bold: true }) + " " + paint("dim", noun) +
    paint("dim", ` on tmux -L ${SOCKET_NAME}`),
  );
  lines.push("");

  for (const s of sessions) {
    const status: PaletteKey = s.attached ? "success" : "dim";
    const indicator = s.attached ? "●" : "○";
    const age = formatAge(s.created);
    const agentBadge = s.agent ? "  " + paint("accent", `[${s.agent}]`) : "";

    lines.push(
      "  " +
      paint(status, indicator) + " " +
      paint("text", s.name, { bold: true }) +
      agentBadge +
      paint("dim", "  " + age) +
      (s.attached ? "  " + paint("success", "attached") : ""),
    );
  }

  lines.push("");
  lines.push("  " + paint("dim", "connect: atomic session connect <name>"));
  lines.push("");

  return lines.join("\n") + "\n";
}

/**
 * Format an ISO timestamp (or raw string) as a human-readable relative age.
 */
function formatAge(isoOrRaw: string): string {
  const d = new Date(isoOrRaw);
  if (Number.isNaN(d.getTime())) return isoOrRaw;

  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Filtering ─────────────────────────────────────────────────────────────

/** Map a SessionScope to the SessionType it allows (undefined = no filter). */
const SCOPE_TO_TYPE: Record<SessionScope, SessionType | undefined> = {
  chat: "chat",
  workflow: "workflow",
  all: undefined,
};

/** Filter sessions by scope (chat-only, workflow-only, or all). */
export function filterByScope(sessions: TmuxSession[], scope: SessionScope): TmuxSession[] {
  const required = SCOPE_TO_TYPE[scope];
  if (!required) return sessions;
  return sessions.filter((s) => s.type === required);
}

/** Filter sessions to only those matching at least one of the given agents. */
export function filterByAgent(sessions: TmuxSession[], agents: string[]): TmuxSession[] {
  if (agents.length === 0) return sessions;
  const allowed = new Set(agents.map((a) => a.toLowerCase()));
  return sessions.filter((s) => s.agent !== undefined && allowed.has(s.agent.toLowerCase()));
}

// ─── Session list command ───────────────────────────────────────────────────

export async function sessionListCommand(agents: string[] = [], scope: SessionScope = "all"): Promise<number> {
  if (!isTmuxInstalled()) {
    const paint = createPainter();
    process.stdout.write(
      "\n  " + paint("text", "no sessions running", { bold: true }) +
      "\n\n  " + paint("dim", "tmux is not installed") + "\n\n",
    );
    return 0;
  }

  const sessions = filterByAgent(filterByScope(listSessions(), scope), agents);
  process.stdout.write(renderSessionList(sessions));
  return 0;
}

// ─── Session connect command ────────────────────────────────────────────────

/**
 * Connect to a named session. Handles the three tmux contexts:
 * already on atomic socket → switch-client, inside other tmux → detach+attach,
 * outside tmux → spawn attach.
 */
export async function sessionConnectCommand(sessionName: string): Promise<number> {
  const paint = createPainter();

  if (!isTmuxInstalled()) {
    process.stderr.write(
      paint("error", "Error: tmux is not installed.") + "\n",
    );
    return 1;
  }

  if (!sessionExists(sessionName)) {
    process.stderr.write(
      paint("error", `Error: session '${sessionName}' not found.`) + "\n",
    );
    const sessions = listSessions();
    if (sessions.length > 0) {
      process.stderr.write(
        "\n" + paint("dim", "Available sessions:") + "\n",
      );
      for (const s of sessions) {
        process.stderr.write(
          "  " + paint("dim", "○") + " " + paint("text", s.name) + "\n",
        );
      }
      process.stderr.write("\n");
    }
    return 1;
  }

  if (isInsideAtomicSocket()) {
    switchClient(sessionName);
    return 0;
  }

  if (isInsideTmux()) {
    detachAndAttachAtomic(sessionName);
    return 0;
  }

  const proc = spawnMuxAttach(sessionName);
  return await proc.exited;
}

// ─── Interactive session picker ─────────────────────────────────────────────

/**
 * Show an fzf-style interactive picker for all running atomic sessions.
 * Used by `atomic session connect` (no args).
 */
export async function sessionPickerCommand(agents: string[] = [], scope: SessionScope = "all"): Promise<number> {
  const paint = createPainter();

  if (!isTmuxInstalled()) {
    process.stderr.write(
      paint("error", "Error: tmux is not installed.") + "\n",
    );
    return 1;
  }

  const sessions = filterByAgent(filterByScope(listSessions(), scope), agents);

  if (sessions.length === 0) {
    process.stdout.write(renderSessionList(sessions));
    return 0;
  }

  const selected = await select({
    message: "Connect to session",
    options: sessions.map((s) => {
      const age = formatAge(s.created);
      const tag = s.attached ? " (attached)" : "";
      return {
        value: s.name,
        label: s.name,
        hint: `${age}${tag}`,
      };
    }),
  });

  if (isCancel(selected)) {
    cancel("Cancelled.");
    return 0;
  }

  return sessionConnectCommand(selected as string);
}
