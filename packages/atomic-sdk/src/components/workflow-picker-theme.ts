/**
 * workflow-picker-theme.ts
 *
 * Pure theme types and builder for WorkflowPickerPanel.
 * No React deps — safe to import in tests and non-UI contexts.
 */

import { type TerminalTheme } from "../runtime/theme.ts";

/**
 * Extended palette used by the workflow picker. Derived from
 * {@link TerminalTheme} via {@link buildPickerTheme}.
 */
export interface PickerTheme {
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  surface: string;
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

export function buildPickerTheme(base: TerminalTheme): PickerTheme {
  return {
    background: base.bg,
    backgroundPanel: base.backgroundPanel,
    backgroundElement: base.backgroundElement,
    surface: base.surface,
    text: base.text,
    textMuted: base.textMuted,
    textDim: base.dim,
    primary: base.accent,
    success: base.success,
    error: base.error,
    warning: base.warning,
    info: base.info,
    mauve: base.mauve,
    border: base.borderDim,
    borderActive: base.border,
  };
}
