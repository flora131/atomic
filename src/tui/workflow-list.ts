/**
 * `/workflow list` catalogue — chat-surface vocabulary from ui/mockups.html §3.
 *
 * Visual contract:
 *  - One full-width `[ WORKFLOWS ]` mauve band (catalogue accent — distinct
 *    from the blue live-run accent used by `[ BACKGROUND ]` / `[ DISPATCHED ]`).
 *  - One card per workflow:
 *      row 1: ▎ stripe · [tag workflow-name]
 *      row 2: ▎ stripe · muted description
 *      row 3: ▎ stripe · dim "inputs"  ·  signature
 *  - Hint rows pointing at `/workflow <name> …` and `/workflow inputs <name>`.
 *
 * Truncation policy (ui/mockups.html §4):
 *  - workflow name in tag end-truncates with `…`;
 *  - description end-truncates to the row width;
 *  - input signature renders the first 3 inputs inline, then `+N more`.
 *  - optional inputs are marked with a trailing `?`.
 *
 * cross-ref:
 *  - ui/mockups.html §3, §4 (long-description policy)
 *  - src/tui/chat-surface.ts shared primitives
 *  - src/extension/dispatcher.ts list result with `items` metadata
 */

import type { GraphTheme } from "./graph-theme.js";
import {
  renderFlatBand,
  renderTaggedCard,
  renderHintRows,
  ELLIPSIS,
  chatWidth,
} from "./chat-surface.js";
import { hexToAnsi, RESET } from "./color-utils.js";
import { visibleWidth, truncateToWidth } from "./text-helpers.js";

const INLINE_INPUT_LIMIT = 3;
const TAG_NAME_BUDGET = 50;

export interface WorkflowListEntry {
  /** Normalised workflow name — appears in the surface0 tag. */
  name: string;
  /** One-line description. End-truncated to the card body width. */
  description: string;
  /** Declared inputs in registry order. */
  inputs: ReadonlyArray<{ name: string; required?: boolean }>;
}

export interface RenderWorkflowListOpts {
  /** Provide for themed Catppuccin chrome; omit for plain ASCII. */
  theme?: GraphTheme;
  /** Render width (cells). Defaults to `process.stdout.columns`. */
  width?: number;
  /**
   * When true, append the standard hint pair beneath the catalogue.
   * Defaults to true.
   */
  showHints?: boolean;
}

/**
 * Render the workflow catalogue as a `[ WORKFLOWS ]` band followed by
 * one card per registered workflow.
 */
export function renderWorkflowList(
  entries: readonly WorkflowListEntry[],
  opts: RenderWorkflowListOpts = {},
): string {
  const lines: string[] = [];
  const subtitle = `${entries.length} registered`;
  const accent = opts.theme?.mauve;

  lines.push(renderFlatBand({
    label: "WORKFLOWS",
    subtitle,
    accent,
    theme: opts.theme,
    width: opts.width,
  }));
  // Blank line after the band — mirrors the mockup's `.band { padding-bottom }`
  // + first `.card { margin-top }` (ui/mockups.html §3). The band reads as
  // a header, not as the first card's row 0.
  lines.push("");

  if (entries.length === 0) {
    // The blank line emitted after the band already provides spacing
    // before the empty-state line; no extra spacer needed.
    lines.push(emptyState(opts.theme));
    return lines.join("\n");
  }

  // Blank line between cards mirrors the mockup's `.card { margin: 0.25rem 1.1rem }`
  // top/bottom margin — without it the three workflow rows collapse into one
  // visual block (see ui/Screenshot 2026-05-12 "Notice how the spacing is off").
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) lines.push("");
    lines.push(renderWorkflowCard(entries[i]!, opts));
  }

  if (opts.showHints !== false) {
    lines.push("");
    lines.push(
      renderHintRows(
        [
          { command: "/workflow <name> …", hint: "run a workflow" },
          { command: "/workflow inputs <name>", hint: "inspect input schema" },
        ],
        opts.theme,
      ),
    );
  }

  return lines.join("\n");
}

function renderWorkflowCard(
  entry: WorkflowListEntry,
  opts: RenderWorkflowListOpts,
): string {
  const theme = opts.theme;
  const cardWidth = effectiveWidth(opts.width);
  const stripPrefix = 3; // "▎  "
  const interior = Math.max(8, cardWidth - stripPrefix - 1);
  const accent = theme?.mauve ?? "#000000";

  const tag = truncateToWidth(entry.name, TAG_NAME_BUDGET, ELLIPSIS);

  // Row 2: description (muted)
  const descBudget = Math.max(8, interior - 2);
  const description = truncateToWidth(entry.description, descBudget, ELLIPSIS);
  const row2 = paintMuted(description, theme);

  // Row 3: inputs signature
  const row3 = inputsSignatureRow(entry.inputs, interior, theme);

  return renderTaggedCard({
    tag,
    bodyRows: [row2, row3],
    accent,
    width: opts.width,
    theme,
  });
}

function inputsSignatureRow(
  inputs: ReadonlyArray<{ name: string; required?: boolean }>,
  interior: number,
  theme?: GraphTheme,
): string {
  const dim = theme ? hexToAnsi(theme.dim) : "";
  const text = theme ? hexToAnsi(theme.text) : "";
  const muted = theme ? hexToAnsi(theme.textMuted) : "";
  const reset = theme ? RESET : "";
  const sep = theme ? `  ${muted}·${reset}  ` : "  ·  ";
  const sepPlain = "  ·  ";

  const label = theme ? `${dim}inputs${reset}` : "inputs";
  const labelW = visibleWidth("inputs");

  if (inputs.length === 0) {
    const none = theme ? `${dim}(none)${reset}` : "(none)";
    return `${label}    ${none}`;
  }

  const visible = inputs.slice(0, INLINE_INPUT_LIMIT);
  const overflow = inputs.length - visible.length;

  // Build inline segments with optional `?` marker for optional inputs.
  const segs = visible.map((inp) => {
    const optional = inp.required !== true;
    const name = inp.name;
    if (theme) {
      return optional
        ? `${text}${name}${reset}${dim}?${reset}`
        : `${text}${name}${reset}`;
    }
    return optional ? `${name}?` : name;
  });

  let row = `${label}    ${segs.join(sep)}`;
  if (overflow > 0) {
    const moreText = `+${overflow} more`;
    if (theme) {
      row += `${sep}${dim}${moreText}${reset}`;
    } else {
      row += `${sepPlain}${moreText}`;
    }
  }

  // If the row exceeds budget, fall back to inline name list w/o decoration.
  const inlineLen =
    labelW +
    4 +
    visible.reduce((a, b) => a + b.name.length + (b.required ? 0 : 1), 0) +
    Math.max(0, visible.length - 1) * sepPlain.length +
    (overflow > 0 ? sepPlain.length + `+${overflow} more`.length : 0);
  if (inlineLen > interior) {
    // Drop to a single ellipsis-truncated plain join.
    const flat = inputs.map((i) => (i.required ? i.name : `${i.name}?`)).join(", ");
    const cut = truncateToWidth(flat, Math.max(8, interior - labelW - 4), ELLIPSIS);
    row = theme
      ? `${label}    ${text}${cut}${reset}`
      : `inputs    ${cut}`;
  }
  return row;
}

function paintMuted(text: string, theme?: GraphTheme): string {
  if (!theme) return text;
  return `${hexToAnsi(theme.textMuted)}${text}${RESET}`;
}

function emptyState(theme?: GraphTheme): string {
  if (!theme) return "  no workflows registered";
  return `  ${hexToAnsi(theme.dim)}no workflows registered${RESET}`;
}

/**
 * Resolve the render width for the catalogue surface. Delegates to the
 * shared `chatWidth()` helper which already accounts for the chat host's
 * 2-cell horizontal padding when no explicit width is supplied.
 */
function effectiveWidth(width?: number): number {
  return chatWidth(width);
}
