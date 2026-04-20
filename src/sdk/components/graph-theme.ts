// ─── Graph Theme ──────────────────────────────────

import type { TerminalTheme } from "../runtime/theme.ts";
import { lerpColor } from "./color-utils.ts";

export interface GraphTheme {
  background: string;
  backgroundElement: string;
  text: string;
  textMuted: string;
  textDim: string;
  primary: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  mauve: string;
  border: string;
  borderActive: string;
}

export function deriveGraphTheme(t: TerminalTheme): GraphTheme {
  return {
    background: t.bg,
    backgroundElement: t.surface,
    text: t.text,
    textMuted: lerpColor(t.text, t.bg, 0.3),
    textDim: t.dim,
    primary: t.accent,
    success: t.success,
    error: t.error,
    warning: t.warning,
    info: t.accent,
    mauve: t.mauve,
    border: t.borderDim,
    borderActive: t.border,
  };
}
