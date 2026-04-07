/**
 * Terminal-native color theme resolution.
 *
 * Queries the terminal for its actual foreground, background, and ANSI palette
 * colors via OSC escape sequences (10, 11, 4). Derives a complete UI theme so
 * the orchestrator panel matches the user's terminal appearance.
 *
 * Falls back to a Tokyo Night preset when queries fail or the terminal doesn't
 * support OSC color reporting.
 */

// ---------------------------------------------------------------------------
// Theme type
// ---------------------------------------------------------------------------

export interface TerminalTheme {
  bg: string;
  surface: string;
  selection: string;
  border: string;
  borderDim: string;
  accent: string;
  text: string;
  dim: string;
  success: string;
  error: string;
  warning: string;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  return (
    "#" +
    clamp(r).toString(16).padStart(2, "0") +
    clamp(g).toString(16).padStart(2, "0") +
    clamp(b).toString(16).padStart(2, "0")
  );
}

/** Relative luminance (simplified — sufficient for dark/light detection). */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Linear interpolation between two colors. t=0 → c1, t=1 → c2. */
function mix(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = parseHex(c1);
  const [r2, g2, b2] = parseHex(c2);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Shift all channels by a fixed amount (positive = lighten, negative = darken). */
function shift(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r + amount, g + amount, b + amount);
}

// ---------------------------------------------------------------------------
// Fallback theme (Tokyo Night)
// ---------------------------------------------------------------------------

export const FALLBACK_THEME: TerminalTheme = {
  bg: "#1a1b26",
  surface: "#24283b",
  selection: "#283457",
  border: "#414868",
  borderDim: "#3b4261",
  accent: "#7aa2f7",
  text: "#c0caf5",
  dim: "#565f89",
  success: "#9ece6a",
  error: "#f7768e",
  warning: "#e0af68",
};

// ---------------------------------------------------------------------------
// Terminal palette querying via OSC 10 / 11 / 4
// ---------------------------------------------------------------------------

const QUERY_TIMEOUT_MS = 200;
const EXPECTED_RESPONSES = 6;

function readWithTimeout(ms: number, expected: number): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";

    const cleanup = () => {
      clearTimeout(timer);
      process.stdin.removeListener("data", handler);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(buffer);
    }, ms);

    const handler = (chunk: Buffer) => {
      buffer += chunk.toString();
      if ((buffer.match(/rgb:/gi) || []).length >= expected) {
        cleanup();
        resolve(buffer);
      }
    };

    process.stdin.on("data", handler);
  });
}

const OSC_NAME_MAP: Record<string, string> = {
  "1": "red",
  "2": "green",
  "3": "yellow",
  "4": "blue",
};

async function queryTerminalPalette(): Promise<Map<string, string>> {
  const palette = new Map<string, string>();
  const wasRaw = process.stdin.isRaw;

  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Batch all OSC queries in a single write
    process.stdout.write(
      "\x1b]10;?\x07" +   // foreground
      "\x1b]11;?\x07" +   // background
      "\x1b]4;1;?\x07" +  // ANSI red
      "\x1b]4;2;?\x07" +  // ANSI green
      "\x1b]4;3;?\x07" +  // ANSI yellow
      "\x1b]4;4;?\x07",   // ANSI blue
    );

    const response = await readWithTimeout(QUERY_TIMEOUT_MS, EXPECTED_RESPONSES);

    // Parse: \x1b]<osc>;<idx>?;rgb:RR[RR]/GG[GG]/BB[BB]
    const pattern =
      /\x1b\](\d+);(?:(\d+);)?rgb:([0-9a-f]{2,4})\/([0-9a-f]{2,4})\/([0-9a-f]{2,4})/gi;
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const osc = match[1];
      const idx = match[2];
      const r = parseInt(match[3]!.slice(0, 2), 16);
      const g = parseInt(match[4]!.slice(0, 2), 16);
      const b = parseInt(match[5]!.slice(0, 2), 16);
      const hex = toHex(r, g, b);

      if (osc === "10") palette.set("fg", hex);
      else if (osc === "11") palette.set("bg", hex);
      else if (osc === "4" && idx && OSC_NAME_MAP[idx]) {
        palette.set(OSC_NAME_MAP[idx], hex);
      }
    }
  } finally {
    try {
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
    } catch {}
  }

  return palette;
}

// ---------------------------------------------------------------------------
// Theme construction from terminal palette
// ---------------------------------------------------------------------------

function buildTheme(palette: Map<string, string>): TerminalTheme {
  const bg = palette.get("bg") ?? FALLBACK_THEME.bg;
  const text = palette.get("fg") ?? FALLBACK_THEME.text;
  const accent = palette.get("blue") ?? FALLBACK_THEME.accent;
  const success = palette.get("green") ?? FALLBACK_THEME.success;
  const error = palette.get("red") ?? FALLBACK_THEME.error;
  const warning = palette.get("yellow") ?? FALLBACK_THEME.warning;

  const isDark = luminance(bg) < 0.5;
  const dir = isDark ? 1 : -1;

  return {
    bg,
    surface: shift(bg, dir * 12),
    selection: mix(bg, accent, 0.25),
    border: mix(bg, text, 0.25),
    borderDim: mix(bg, text, 0.15),
    accent,
    text,
    dim: mix(bg, text, 0.4),
    success,
    error,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the terminal's color theme by querying its palette via OSC sequences.
 * Falls back to Tokyo Night if queries fail or the terminal doesn't support them.
 *
 * Must be called BEFORE creating the OpenTUI renderer (renderer takes over stdin).
 */
export async function resolveTheme(): Promise<TerminalTheme> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return FALLBACK_THEME;
  if (process.env.TERM === "dumb") return FALLBACK_THEME;

  try {
    const palette = await queryTerminalPalette();
    if (palette.size < 2) return FALLBACK_THEME;
    return buildTheme(palette);
  } catch {
    return FALLBACK_THEME;
  }
}
