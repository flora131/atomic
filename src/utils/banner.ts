/**
 * Banner display utility for atomic CLI
 */

import { join, dirname } from "path";
import { htmlToAnsi, stripAnsi } from "./html-to-ansi";
import { supportsTrueColor } from "./detect";

/**
 * Get the path to assets directory
 * Works both in development and when compiled
 */
function getAssetsDir(): string {
  // When running with bun directly, import.meta.dir points to src/utils
  // When compiled, assets are embedded
  return join(dirname(import.meta.dir), "assets");
}

/**
 * Load the ASCII logo from file
 */
async function loadLogo(): Promise<string> {
  const logoPath = join(getAssetsDir(), "atomic-logo.txt");
  return await Bun.file(logoPath).text();
}

/**
 * Load and convert the spirit HTML to ANSI
 */
async function loadSpirit(): Promise<string> {
  const spiritPath = join(getAssetsDir(), "atomic-spirit.html");
  const html = await Bun.file(spiritPath).text();
  return htmlToAnsi(html);
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
 * Display the atomic banner
 *
 * Shows the ASCII logo on the left and the colorized spirit on the right.
 * Falls back to logo-only if true color is not supported.
 *
 * @param showSpirit Whether to show the spirit alongside the logo
 */
export async function displayBanner(showSpirit: boolean = true): Promise<void> {
  const logo = await loadLogo();

  if (showSpirit && supportsTrueColor()) {
    const spirit = await loadSpirit();
    console.log(combineSideBySide(logo, spirit));
  } else {
    // Just show the logo without colors
    console.log(logo);
  }
}

/**
 * Display only the logo (no spirit)
 */
export async function displayLogoOnly(): Promise<void> {
  const logo = await loadLogo();
  console.log(logo);
}
