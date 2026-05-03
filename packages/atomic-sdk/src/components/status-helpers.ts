// ─── Status Helpers ───────────────────────────────

import type { GraphTheme } from "./graph-theme.ts";

export function statusColor(status: string, theme: GraphTheme): string {
  return (
    {
      running: theme.warning,
      complete: theme.success,
      pending: theme.textDim,
      error: theme.error,
      awaiting_input: theme.info,
    }[status] ?? theme.textDim
  );
}

export function statusLabel(status: string): string {
  return (
    { running: "running", complete: "done", pending: "waiting", error: "failed", awaiting_input: "input needed" }[status] ??
    status
  );
}

export function statusIcon(status: string): string {
  return { running: "●", complete: "✓", pending: "○", error: "✗", awaiting_input: "?" }[status] ?? "○";
}

// ─── Duration ─────────────────────────────────────

export function fmtDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}
