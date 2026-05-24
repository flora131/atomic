import type { WorkflowInputEntry } from "../extension/render-result.js";
import type { GraphTheme } from "./graph-theme.js";
import { paint } from "./color-utils.js";
import {
  formatReviewValue,
  renderWrappedPrefixedLines,
  truncateToWidth,
  visibleWidth,
  wrapPlainText,
} from "./text-helpers.js";

export interface SubmitPaneRenderOpts {
  workflowName: string;
  fields: readonly WorkflowInputEntry[];
  rawText: Record<string, string>;
  theme: GraphTheme;
  width: number;
}

export interface SubmitControlsRenderOpts {
  invalidFieldNames: readonly string[];
  submitChoiceIdx: number;
  theme: GraphTheme;
  width: number;
}

export function renderWorkflowFormFooterHints(theme: GraphTheme, width: number): string {
  const hints = [
    "Enter to select · ↑/↓ to navigate · Tab to switch input fields · Esc to cancel",
    "Enter · ↑/↓ · Tab · Esc",
    "Enter · Tab · Esc",
    "Esc",
  ];
  const selected = hints.find((hint) => visibleWidth(hint) <= width) ?? hints[hints.length - 1]!;
  return paint(truncateToWidth(selected, width, "…"), theme.dim);
}

export function renderAskChoiceRows(
  index: number,
  label: string,
  active: boolean,
  theme: GraphTheme,
  width: number,
): string[] {
  const plainPrefix = `${active ? "❯ " : "  "}${index}. `;
  const firstPrefix = `${active ? paint("❯ ", theme.accent) : "  "}${index}. `;
  return renderWrappedPrefixedLines({
    text: label,
    width,
    plainPrefix,
    firstPrefix,
    styleLine: (line) => active
      ? paint(line, theme.accent, { bold: true })
      : paint(line, theme.textMuted),
  });
}

export function renderSubmitReview(opts: SubmitPaneRenderOpts): string[] {
  const { workflowName, fields, rawText, theme, width } = opts;
  const out: string[] = [paint("Review your inputs", theme.accent, { bold: true }), ""];
  out.push(truncateToWidth(paint("/workflow ", theme.dim) + paint(workflowName, theme.text), width, "…", true));
  for (const field of fields) {
    out.push(truncateToWidth(paint(" ● ", theme.dim) + paint(field.name, theme.textMuted), width, "…", true));
    out.push(...renderReviewValueRows(field, rawText[field.name] ?? "", theme, width));
  }
  return out;
}

export function renderSubmitControls(opts: SubmitControlsRenderOpts): string[] {
  const { invalidFieldNames, submitChoiceIdx, theme, width } = opts;
  const invalidCount = invalidFieldNames.length;
  const promptText = invalidCount === 0
    ? "Ready to submit your inputs?"
    : `Answer remaining inputs before submitting: ${invalidFieldNames.join(", ")}`;
  const promptColor = invalidCount === 0 ? theme.textMuted : theme.warning;
  const submitLabel = invalidCount === 0
    ? "Submit answers"
    : `Submit answers (${invalidCount} missing)`;
  return [
    ...wrapPlainText(promptText, width).map((line) => paint(line, promptColor)),
    "",
    ...renderAskChoiceRows(1, submitLabel, submitChoiceIdx === 0, theme, width),
    ...renderAskChoiceRows(2, "Cancel", submitChoiceIdx === 1, theme, width),
    "",
    renderWorkflowFormFooterHints(theme, width),
  ];
}

function renderReviewValueRows(
  field: WorkflowInputEntry,
  raw: string,
  theme: GraphTheme,
  width: number,
): string[] {
  const plainPrefix = "   → ";
  const firstPrefix = "   " + paint("→ ", theme.dim);
  return renderWrappedPrefixedLines({
    text: formatFieldReviewValue(field, raw),
    width,
    plainPrefix,
    firstPrefix,
    styleLine: (line) => paint(line, theme.text),
  });
}

function formatFieldReviewValue(field: WorkflowInputEntry, raw: string): string {
  if (field.type === "boolean") {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length === 0) return formatReviewValue(raw);
    return normalized === "true" || normalized === "1" ? "on" : "off";
  }
  return formatReviewValue(raw);
}
