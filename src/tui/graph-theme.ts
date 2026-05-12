/**
 * Catppuccin Mocha role-mapped tokens for the orchestrator overlay.
 *
 * cross-ref: DESIGN.md §2 (Colors), §4 (Elevation), §5 (Components)
 *            PRODUCT.md (Aesthetic Direction — Catppuccin Mocha canonical)
 *
 * Roles, not raw hex, are referenced by every renderer. A render-time
 * `deriveGraphTheme()` accepts an optional terminal-resolved theme so
 * adaptive palettes (light fallback, NO_COLOR pass-through) can supply
 * overrides without forking the renderer.
 */

// ---------------------------------------------------------------------------
// Canonical palette (Catppuccin Mocha)
// ---------------------------------------------------------------------------

const MOCHA = {
  crust: "#11111b",
  mantle: "#181825",
  base: "#1e1e2e",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  overlay1: "#7f849c",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  blue: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  red: "#f38ba8",
  mauve: "#cba6f7",
  sky: "#89dceb",
} as const;

/**
 * Optional generic theme overrides accepted by `deriveGraphTheme`.
 * Keys mirror the role names below; any field omitted falls back to Mocha.
 */
export interface GenericTheme {
  bg?: string;
  backgroundPanel?: string;
  backgroundElement?: string;
  surface?: string;
  selection?: string;
  border?: string;
  borderDim?: string;
  borderActive?: string;
  text?: string;
  textMuted?: string;
  dim?: string;
  accent?: string;
  mauve?: string;
  success?: string;
  warning?: string;
  info?: string;
  error?: string;
}

/**
 * Role-mapped tokens consumed by every renderer in `src/tui/`.
 *
 * The `border*` family is split into three steps so components can pick
 * the right tonal weight: `borderDim` for quiet rules, `border` for the
 * default, `borderActive` for emphasised panels. Status colors map
 * one-to-one to the orchestrator's session vocabulary (DESIGN.md
 * "Status-Is-Truth" — never used decoratively).
 */
export interface GraphTheme {
  /** Strata, deepest first */
  bg: string;
  backgroundPanel: string;
  backgroundElement: string;
  surface: string;
  selection: string;

  /** Borders, dimmest first */
  border: string;
  borderDim: string;
  borderActive: string;

  /** Text, brightest first */
  text: string;
  textMuted: string;
  dim: string;

  /** Accents */
  accent: string;
  mauve: string;

  /** Statuses */
  success: string;
  warning: string;
  info: string;
  error: string;
}

export function deriveGraphTheme(theme: GenericTheme = {}): GraphTheme {
  return {
    bg: theme.bg ?? MOCHA.base,
    backgroundPanel: theme.backgroundPanel ?? MOCHA.surface0,
    backgroundElement: theme.backgroundElement ?? MOCHA.surface0,
    surface: theme.surface ?? MOCHA.crust,
    selection: theme.selection ?? MOCHA.surface1,

    border: theme.border ?? MOCHA.overlay0,
    borderDim: theme.borderDim ?? MOCHA.surface2,
    borderActive: theme.borderActive ?? MOCHA.overlay1,

    text: theme.text ?? MOCHA.text,
    textMuted: theme.textMuted ?? MOCHA.subtext0,
    dim: theme.dim ?? MOCHA.overlay1,

    accent: theme.accent ?? MOCHA.blue,
    mauve: theme.mauve ?? MOCHA.mauve,

    success: theme.success ?? MOCHA.green,
    warning: theme.warning ?? MOCHA.yellow,
    info: theme.info ?? MOCHA.sky,
    error: theme.error ?? MOCHA.red,
  };
}
