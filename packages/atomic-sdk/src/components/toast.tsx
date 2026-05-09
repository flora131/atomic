/** @jsxImportSource @opentui/react */
/**
 * Toast — top-right notification card, nvim-style.
 *
 * Renders a stack of severity-colored cards anchored to the top-right of
 * the parent container. The PanelStore is the source of truth — this
 * component only renders; auto-dismissal is owned by the store's setTimeout.
 */

import { useStore, useGraphTheme, useStoreVersion } from "./orchestrator-panel-contexts.ts";
import type { GraphTheme } from "./graph-theme.ts";
import type { ToastEntry, ToastKind } from "./orchestrator-panel-store.ts";

const TOAST_WIDTH = 56;
const MAX_VISIBLE_TOASTS = 3;
const MAX_MESSAGE_CHARS = TOAST_WIDTH - 4; // minus border (2) + padding (2)

interface SeverityStyle {
  color: string;
  icon: string;
  label: string;
}

function severityStyle(kind: ToastKind, theme: GraphTheme): SeverityStyle {
  switch (kind) {
    case "error":
      return { color: theme.error, icon: "✗", label: "ERROR" };
    case "warning":
      return { color: theme.warning, icon: "⚠", label: "WARN" };
    case "info":
      return { color: theme.info, icon: "ℹ", label: "INFO" };
  }
}

/** Truncate to fit a single line; preserves the head of the message. */
function clip(message: string, max: number): string {
  if (message.length <= max) return message;
  return `${message.slice(0, max - 1)}…`;
}

interface ToastCardProps {
  entry: ToastEntry;
}

function ToastCard({ entry }: ToastCardProps) {
  const theme = useGraphTheme();
  const { color, icon, label } = severityStyle(entry.kind, theme);
  const bg = theme.backgroundElement;

  return (
    <box
      width={TOAST_WIDTH}
      border
      borderStyle="rounded"
      borderColor={color}
      backgroundColor={bg}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <text>
        <span fg={color} bg={bg}>{icon} </span>
        <span fg={theme.textMuted} bg={bg}>{label}</span>
      </text>
      <text>
        <span fg={theme.text} bg={bg}>{clip(entry.message, MAX_MESSAGE_CHARS)}</span>
      </text>
    </box>
  );
}

/**
 * Toast stack — top-right anchored. Newest at the top (reverse chronological).
 * Renders nothing when no toasts are active.
 */
export function ToastStack() {
  const store = useStore();
  useStoreVersion(store);

  if (store.toasts.length === 0) return null;

  // Show only the most recent N toasts; newest on top of the stack.
  const visible = store.toasts.slice(-MAX_VISIBLE_TOASTS).slice().reverse();

  return (
    <box position="absolute" top={1} right={1} flexDirection="column">
      {visible.map((entry) => (
        <ToastCard key={entry.id} entry={entry} />
      ))}
    </box>
  );
}
