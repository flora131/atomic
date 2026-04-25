/**
 * generate-product-hunt-assets.ts
 *
 * Renders all 7 Product Hunt slide HTMLs to 1270x760 PNG using Playwright/Chromium.
 * Replaces the old SVG-only pipeline (generate-product-hunt-assets.ts + rasterize-product-hunt-assets.ts).
 *
 * Usage:
 *   bun run assets/product-hunt/generate-product-hunt-assets.ts
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL(".", import.meta.url).pathname;
const SLIDES_DIR = join(ROOT, "slides");
const OUT_DIR = ROOT;

const VIEWPORT_WIDTH = 1270;
const VIEWPORT_HEIGHT = 760;
const DEVICE_SCALE_FACTOR = 2;

type SlideConfig = {
  html: string;
  png: string;
};

const slides: SlideConfig[] = [
  { html: "01-hero.html",                 png: "01-hero-image.png" },
  { html: "02-workflow-as-code.html",     png: "02-workflow-as-code.png" },
  { html: "03-before-after.html",         png: "03-before-after.png" },
  { html: "04-use-case-carousel.html",    png: "04-use-case-carousel.png" },
  { html: "05-architecture.html",         png: "05-architecture-diagram.png" },
  { html: "06-safety-devcontainer.html",  png: "06-safety-devcontainer.png" },
  { html: "07-workflow-skill-creator.html", png: "07-workflow-skill-creator.png" },
];

function verifySlideFiles(): void {
  for (const slide of slides) {
    const htmlPath = join(SLIDES_DIR, slide.html);
    if (!existsSync(htmlPath)) {
      throw new Error(`Missing slide HTML: ${htmlPath}`);
    }
  }
}

async function renderSlides(): Promise<void> {
  verifySlideFiles();
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  const page = await context.newPage();

  try {
    for (const slide of slides) {
      const htmlPath = join(SLIDES_DIR, slide.html);
      const pngPath = join(OUT_DIR, slide.png);
      const fileUrl = pathToFileURL(htmlPath).toString();

      console.log(`  Rendering ${slide.html} → ${slide.png}`);

      await page.goto(fileUrl, { waitUntil: "networkidle" });

      // Wait for fonts to finish loading before screenshotting
      await page.evaluate(() => document.fonts.ready);

      await page.screenshot({
        path: pngPath,
        type: "png",
        fullPage: false,
        clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

console.log("Rendering Product Hunt assets...");
console.log(`  Slides dir : ${SLIDES_DIR}`);
console.log(`  Output dir : ${OUT_DIR}`);
console.log(`  Viewport   : ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} @${DEVICE_SCALE_FACTOR}x`);
console.log("");

await renderSlides();

console.log(`\nDone — rendered ${slides.length} slides to ${OUT_DIR}`);
