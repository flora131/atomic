import { supportsColor } from "./detect";

/**
 * ANSI color and formatting codes for CLI output
 * Respects the NO_COLOR environment variable
 */
const ANSI_CODES = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const;

const NO_COLORS = {
  bold: "",
  dim: "",
  reset: "",
  red: "",
  green: "",
  yellow: "",
} as const;

export const COLORS = supportsColor() ? ANSI_CODES : NO_COLORS;
