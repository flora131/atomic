/**
 * Renders the 3 gradient preview HTMLs to PNG (1270x760 @ 2x DPR).
 * Run: bun run assets/product-hunt/_gradient-previews/render.ts
 */
import { chromium } from "playwright";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL(".", import.meta.url).pathname;
const VIEWPORT_WIDTH = 1270;
const VIEWPORT_HEIGHT = 760;
const DEVICE_SCALE_FACTOR = 2;

const previews = [
  { html: "option-a.html", png: "option-a.png" },
  { html: "option-b.html", png: "option-b.png" },
  { html: "option-c.html", png: "option-c.png" },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  deviceScaleFactor: DEVICE_SCALE_FACTOR,
});
const page = await context.newPage();

try {
  for (const p of previews) {
    const fileUrl = pathToFileURL(join(ROOT, p.html)).toString();
    console.log(`  Rendering ${p.html} → ${p.png}`);
    await page.goto(fileUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(ROOT, p.png),
      type: "png",
      fullPage: false,
      clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    });
  }
} finally {
  await context.close();
  await browser.close();
}
console.log("Done.");
