/**
 * Script to generate pre-computed banner assets
 *
 * Run with: bun run scripts/generate-banner-assets.ts
 */

import { htmlToAnsi } from "../src/utils/html-to-ansi";

// Read the logo
const logo = await Bun.file("./src/assets/atomic-logo.txt").text();

// Read and convert the spirit HTML to ANSI
const spiritHtml = await Bun.file("./src/assets/atomic-spirit.html").text();
const spirit = htmlToAnsi(spiritHtml);

// Generate the TypeScript file
const output = `/**
 * Pre-computed banner assets for atomic CLI
 *
 * These constants are pre-computed to avoid runtime file I/O and HTML parsing.
 * DO NOT edit manually - regenerate using: bun run scripts/generate-banner-assets.ts
 */

/**
 * ASCII art logo for atomic CLI
 */
export const LOGO = ${JSON.stringify(logo)};

/**
 * ANSI-colored spirit art for atomic CLI
 * Pre-converted from HTML with RGB styles to ANSI escape codes
 */
export const SPIRIT = ${JSON.stringify(spirit)};
`;

await Bun.write("./src/generated/banner-assets.ts", output);
console.log("Generated src/generated/banner-assets.ts");
