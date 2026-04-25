/**
 * generate-product-hunt-assets.test.ts
 *
 * Verifies the HTML/CSS render pipeline for Product Hunt assets.
 * Tests existence of required files, structure, and that the generate script
 * produces valid PNG output.
 */

import { test, expect, describe } from "bun:test";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const SHARED = join(ROOT, "_shared");
const SLIDES = join(ROOT, "slides");
const FONTS = join(SHARED, "fonts");

// ============================================================
// Shared design system files
// ============================================================

describe("shared design system files exist", () => {
  test("tokens.css exists and is non-empty", () => {
    const path = join(SHARED, "tokens.css");
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(500);
  });

  test("components.css exists and is non-empty", () => {
    const path = join(SHARED, "components.css");
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(500);
  });

  test("fonts.css exists and is non-empty", () => {
    const path = join(SHARED, "fonts.css");
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(100);
  });
});

// ============================================================
// Self-hosted font files
// ============================================================

describe("self-hosted font woff2 files exist", () => {
  const fonts = [
    "bricolage-grotesque.woff2",
    "geist-sans.woff2",
    "jetbrains-mono.woff2",
  ];

  for (const font of fonts) {
    test(`${font} is present and non-empty`, () => {
      const path = join(FONTS, font);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(10_000);
    });
  }
});

// ============================================================
// tokens.css — required custom properties
// ============================================================

describe("tokens.css contains required design tokens", () => {
  const tokensContent = readFileSync(join(SHARED, "tokens.css"), "utf8");

  const requiredTokens = [
    "--mocha-base",
    "--mocha-surface0",
    "--mocha-text",
    "--mocha-subtext0",
    "--warm-maroon",
    "--warm-red",
    "--warm-peach",
    "--cool-sapphire",
    "--cool-sky",
    "--cool-blue",
    "--cool-teal",
    "--bridge-mauve",
    "--cream",
    "--space-4",
    "--font-display",
    "--font-body",
    "--font-mono",
  ];

  for (const token of requiredTokens) {
    test(`defines ${token}`, () => {
      expect(tokensContent).toContain(token);
    });
  }
});

// ============================================================
// components.css — required component classes
// ============================================================

describe("components.css contains required component classes", () => {
  const componentsContent = readFileSync(join(SHARED, "components.css"), "utf8");

  const requiredClasses = [
    ".slide",
    ".bubble-text",
    ".liquid-silk",
    ".film-grain",
    ".sticker",
    ".tui-pane",
    ".wordmark",
    ".headline",
    ".subhead",
  ];

  for (const cls of requiredClasses) {
    test(`defines ${cls}`, () => {
      expect(componentsContent).toContain(cls);
    });
  }

  test("bubble-text does NOT use -webkit-background-clip: text with gradient (banned)", () => {
    // Find the .bubble-text rule block
    const bubbleStart = componentsContent.indexOf(".bubble-text {");
    const bubbleContent = componentsContent.slice(bubbleStart, bubbleStart + 800);
    // Must not have linear/radial gradient on the text fill
    // (the ::before highlight layer may use background-clip for the overlay, that's OK)
    // The main rule must not contain a gradient fill color
    expect(bubbleContent).not.toContain("background: linear-gradient");
  });

  test("components.css does not use border-left or border-right > 1px as accent", () => {
    // Detect any border-left/right with px > 1
    const borderMatches = componentsContent.match(/border-(left|right):\s*[2-9]\d*px/g);
    expect(borderMatches).toBeNull();
  });
});

// ============================================================
// fonts.css — @font-face declarations
// ============================================================

describe("fonts.css declares required font families", () => {
  const fontsContent = readFileSync(join(SHARED, "fonts.css"), "utf8");

  test("declares Bricolage Grotesque", () => {
    expect(fontsContent).toContain("'Bricolage Grotesque'");
  });

  test("declares Geist Sans", () => {
    expect(fontsContent).toContain("'Geist Sans'");
  });

  test("declares JetBrains Mono", () => {
    expect(fontsContent).toContain("'JetBrains Mono'");
  });

  test("references local woff2 files", () => {
    expect(fontsContent).toContain(".woff2");
  });
});

// ============================================================
// Slide HTML files
// ============================================================

describe("placeholder slide HTML files exist and link shared CSS", () => {
  const slideFiles = [
    "01-hero.html",
    "02-workflow-as-code.html",
    "03-before-after.html",
    "04-use-case-carousel.html",
    "05-architecture.html",
    "06-safety-devcontainer.html",
  ];

  for (const slideFile of slideFiles) {
    test(`${slideFile} exists`, () => {
      expect(existsSync(join(SLIDES, slideFile))).toBe(true);
    });

    test(`${slideFile} links all three shared CSS files`, () => {
      const content = readFileSync(join(SLIDES, slideFile), "utf8");
      expect(content).toContain("_shared/fonts.css");
      expect(content).toContain("_shared/tokens.css");
      expect(content).toContain("_shared/components.css");
    });

    test(`${slideFile} has 1270 viewport width`, () => {
      const content = readFileSync(join(SLIDES, slideFile), "utf8");
      expect(content).toContain("1270");
    });
  }
});

// ============================================================
// PNG output files
// ============================================================

describe("PNG output files are present and correctly sized", () => {
  const pngFiles = [
    "01-hero-image.png",
    "02-workflow-as-code.png",
    "03-before-after.png",
    "04-use-case-carousel.png",
    "05-architecture-diagram.png",
    "06-safety-devcontainer.png",
  ];

  for (const pngFile of pngFiles) {
    test(`${pngFile} exists and is at least 200KB`, () => {
      const path = join(ROOT, pngFile);
      expect(existsSync(path)).toBe(true);
      // 2x deviceScaleFactor PNGs should be well above 200KB
      expect(statSync(path).size).toBeGreaterThan(200_000);
    });
  }
});

// ============================================================
// generate-product-hunt-assets.ts — script structure
// ============================================================

describe("generate-product-hunt-assets.ts pipeline script", () => {
  const scriptContent = readFileSync(join(ROOT, "generate-product-hunt-assets.ts"), "utf8");

  test("imports from playwright", () => {
    expect(scriptContent).toContain("playwright");
  });

  test("uses deviceScaleFactor of 2 for crisp output", () => {
    // Script may use a constant (DEVICE_SCALE_FACTOR = 2) or inline literal
    expect(scriptContent).toMatch(/DEVICE_SCALE_FACTOR\s*=\s*2|deviceScaleFactor:\s*2/);
  });

  test("waits for document.fonts.ready", () => {
    expect(scriptContent).toContain("document.fonts.ready");
  });

  test("renders exactly 6 slides", () => {
    // Count SlideConfig entries via html: keys (inside the slides array literal only)
    const slidesArrayMatch = scriptContent.match(/const slides[^=]*=\s*\[([\s\S]*?)\];/);
    expect(slidesArrayMatch).not.toBeNull();
    const slidesArray = slidesArrayMatch![1];
    const htmlEntries = slidesArray.match(/\bhtml:/g);
    expect(htmlEntries?.length).toBe(6);
  });

  test("viewport is 1270x760", () => {
    expect(scriptContent).toContain("1270");
    expect(scriptContent).toContain("760");
  });
});
