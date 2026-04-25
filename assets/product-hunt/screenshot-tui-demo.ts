/**
 * screenshot-tui-demo.ts
 *
 * Ad-hoc verification script: renders tui-demo.html to a PNG for visual review.
 * Captures the full page (all 5 TUI states stacked vertically).
 *
 * Usage:
 *   bun run assets/product-hunt/screenshot-tui-demo.ts
 */

import { chromium } from "playwright";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";

const ROOT = new URL(".", import.meta.url).pathname;
const DEMO_HTML = join(ROOT, "_shared", "tui-demo.html");
const OUT_DIR = join(ROOT, "_shared");
const OUT_FILE = join(OUT_DIR, "tui-demo-screenshot.png");

// Wide viewport to capture the full demo page
const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 800;
const DEVICE_SCALE_FACTOR = 2;

console.log("Rendering tui-demo.html...");
console.log(`  Source : ${DEMO_HTML}`);
console.log(`  Output : ${OUT_FILE}`);
console.log(`  Scale  : ${DEVICE_SCALE_FACTOR}x`);
console.log("");

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  deviceScaleFactor: DEVICE_SCALE_FACTOR,
});
const page = await context.newPage();

const fileUrl = pathToFileURL(DEMO_HTML).toString();
await page.goto(fileUrl, { waitUntil: "networkidle" });

// Wait for fonts to load
await page.evaluate(() => document.fonts.ready);

// Wait for the first TUI state to be present in the DOM
// (content is inlined, so it's present immediately after load)
await page.waitForSelector(".tui", { timeout: 10_000 });

// Full-page screenshot captures all 5 states
await page.screenshot({
  path: OUT_FILE,
  type: "png",
  fullPage: true,
});

await context.close();
await browser.close();

console.log(`Done — screenshot saved to ${OUT_FILE}`);
