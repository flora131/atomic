import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = new URL(".", import.meta.url).pathname;

const files = [
  "01-hero-image",
  "02-workflow-as-code",
  "03-before-after",
  "04-use-case-carousel",
  "05-architecture-diagram",
  "06-safety-devcontainer",
] as const;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1270, height: 760 },
  deviceScaleFactor: 1,
});

for (const file of files) {
  const svgPath = join(root, `${file}.svg`);
  if (!existsSync(svgPath)) {
    throw new Error(`Missing ${svgPath}`);
  }
  await page.goto(pathToFileURL(svgPath).toString(), { waitUntil: "load" });
  await page.screenshot({
    path: join(root, `${file}.png`),
    type: "png",
    fullPage: false,
  });
}

await browser.close();
console.log(`Rasterized ${files.length} Product Hunt PNG assets.`);
