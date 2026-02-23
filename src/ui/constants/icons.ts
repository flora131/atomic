/**
 * Central Icon Constants Module
 *
 * Single source of truth for all shared Unicode icon characters used in the TUI.
 * Components import from this module instead of defining inline icon literals.
 *
 * Tool-specific icons (≡, △, $, ►, ◆, ★, ▶, §, ◉) remain in src/ui/tools/registry.ts.
 * Banner block art remains in src/utils/banner/constants.ts.
 */

// ── Status Indicators ──────────────────────────────────────────
export const STATUS = {
  pending: "○", // U+25CB White Circle
  active: "●", // U+25CF Black Circle
  error: "✗", // U+2717 Ballot X
  background: "●", // U+25CF Black Circle (same as active, colored via theme)
  selected: "◉", // U+25C9 Fisheye
  success: "✓", // U+2713 Check Mark
} as const;

// ── Tree Drawing ───────────────────────────────────────────────
export const TREE = {
  branch: "├─", // U+251C + U+2500
  lastBranch: "└─", // U+2514 + U+2500
  vertical: "│ ", // U+2502
  space: "  ",
} as const;

// ── Connectors ─────────────────────────────────────────────────
export const CONNECTOR = {
  subStatus: "╰", // U+2570 Rounded bottom-left
  horizontal: "─", // U+2500
  roundedTopLeft: "╭", // U+256D
  roundedTopRight: "╮", // U+256E
} as const;

// ── Arrows ─────────────────────────────────────────────────────
export const ARROW = {
  right: "→", // U+2192
  up: "↑", // U+2191
  down: "↓", // U+2193
} as const;

// ── Prompt & Selection ─────────────────────────────────────────
export const PROMPT = {
  cursor: "❯", // U+276F Heavy right-pointing angle
  editPrefix: "›", // U+203A Single right-pointing angle
} as const;

// ── Spinner Frames (Braille) ───────────────────────────────────
export const SPINNER_FRAMES = [
  "⣾",
  "⣽",
  "⣻",
  "⢿",
  "⡿",
  "⣟",
  "⣯",
  "⣷",
] as const;

export const SPINNER_COMPLETE = "⣿"; // U+28FF Full braille block

// ── Progress Bar ───────────────────────────────────────────────
export const PROGRESS = {
  filled: "█", // U+2588 Full block
  empty: "░", // U+2591 Light shade
} as const;

// ── Checkbox ───────────────────────────────────────────────────
export const CHECKBOX = {
  checked: "✔", // U+2714 Heavy Check Mark
  unchecked: "○", // U+25CB White Circle
} as const;

// ── Scrollbar ──────────────────────────────────────────────────
export const SCROLLBAR = {
  thumb: "█", // U+2588 Full block
  track: "│", // U+2502 Box Drawings Light Vertical
} as const;

// ── Task List ──────────────────────────────────────────────────
export const TASK = {
  completed: "✓", // U+2713 Check Mark
  active: "▸", // U+25B8 Right-pointing small triangle
  pending: "○", // U+25CB White Circle
  error: "✗", // U+2717 Ballot X
  track: "│", // U+2502 Vertical line (left rail)
  trackEnd: "╰", // U+2570 Rounded bottom-left
  trackDot: "├", // U+251C Tee right
  barFilled: "━", // U+2501 Heavy horizontal
  barEmpty: "╌", // U+254C Light double dash horizontal
} as const;

// ── Separator ──────────────────────────────────────────────────
export const SEPARATOR = {
  line: "────", // 4x U+2500
} as const;

// ── Misc ───────────────────────────────────────────────────────
export const MISC = {
  separator: "·", // U+00B7 Middle dot
  ellipsis: "…", // U+2026 Horizontal ellipsis
  warning: "⚠", // U+26A0 Warning sign
  thinking: "∴", // U+2234 Therefore
  queue: "⋮", // U+22EE Vertical ellipsis
  collapsed: "▾", // U+25BE Down-pointing small triangle
} as const;
