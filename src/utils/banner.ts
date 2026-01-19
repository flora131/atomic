/**
 * Banner display utility for atomic CLI
 *
 * Uses pre-computed constants for zero file I/O at runtime.
 * Implements responsive sizing based on terminal width.
 */

import { LOGO, SPIRIT } from "../generated/banner-assets";
import { stripAnsi } from "./html-to-ansi";
import { supportsTrueColor } from "./detect";

/** Short ASCII logo for narrower terminals */
const SHORT_LOGO = `
 █████╗ ████████╗ ██████╗ ███╗   ███╗██╗ ██████╗
██╔══██╗   ██║   ██╔═══██╗████╗ ████║██║██╔════╝
███████║   ██║   ██║   ██║██╔████╔██║██║██║
██╔══██║   ██║   ██║   ██║██║╚██╔╝██║██║██║
██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║██║╚██████╗
╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝
`.trim();

/** Tiny ASCII logo for very narrow terminals */
const TINY_LOGO = "ATOMIC";

/** Minimum width for full logo + spirit side-by-side */
const FULL_BANNER_MIN_WIDTH = 180;
/** Minimum width for logo only (full size) */
const LOGO_MIN_WIDTH = 50;
/** Minimum width for short logo */
const SHORT_LOGO_MIN_WIDTH = 30;

/**
 * Get terminal width, with fallback for non-TTY environments
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Combine logo and spirit side by side
 *
 * @param logo The ASCII logo text
 * @param spirit The ANSI-colored spirit text
 * @param gap Number of spaces between logo and spirit
 */
function combineSideBySide(
  logo: string,
  spirit: string,
  gap: number = 2
): string {
  const logoLines = logo.split("\n");
  const spiritLines = spirit.split("\n");

  // Calculate max visible width of logo (excluding ANSI codes)
  const logoWidth = Math.max(...logoLines.map((l) => stripAnsi(l).length));

  const maxLines = Math.max(logoLines.length, spiritLines.length);
  const combined: string[] = [];
  const gapStr = " ".repeat(gap);

  for (let i = 0; i < maxLines; i++) {
    const logoLine = logoLines[i] || "";
    const spiritLine = spiritLines[i] || "";

    // Pad logo line to consistent width
    const visibleLen = stripAnsi(logoLine).length;
    const padding = " ".repeat(logoWidth - visibleLen);

    combined.push(`${logoLine}${padding}${gapStr}${spiritLine}`);
  }

  return combined.join("\n");
}

/**
 * Select appropriate logo based on terminal width
 */
function selectLogo(termWidth: number): string {
  if (termWidth >= LOGO_MIN_WIDTH) {
    return LOGO;
  } else if (termWidth >= SHORT_LOGO_MIN_WIDTH) {
    return SHORT_LOGO;
  }
  return TINY_LOGO;
}

/**
 * Display the atomic banner
 *
 * Shows the ASCII logo on the left and the colorized spirit on the right.
 * Adapts to terminal width:
 * - Wide terminals (>=180 cols): Logo + Spirit side-by-side
 * - Normal terminals (>=50 cols): Logo only
 * - Narrow terminals (>=30 cols): Short logo
 * - Very narrow (<30 cols): Tiny logo
 *
 * Falls back to logo-only if true color is not supported or NO_COLOR is set.
 *
 * @param showSpirit Whether to show the spirit alongside the logo (if terminal is wide enough)
 */
export function displayBanner(showSpirit: boolean = true): void {
  const termWidth = getTerminalWidth();
  const canShowSpirit =
    showSpirit && supportsTrueColor() && termWidth >= FULL_BANNER_MIN_WIDTH;

  if (canShowSpirit) {
    console.log(combineSideBySide(LOGO, SPIRIT));
  } else {
    // Show logo only, selecting size based on terminal width
    console.log(selectLogo(termWidth));
  }
}

/**
 * Display only the logo (no spirit)
 */
export function displayLogoOnly(): void {
  const termWidth = getTerminalWidth();
  console.log(selectLogo(termWidth));
}
