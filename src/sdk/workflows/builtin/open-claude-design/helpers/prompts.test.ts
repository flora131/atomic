import { test, expect, describe } from "bun:test";
import {
  buildDesignSystemLocatorPrompt,
  buildDesignSystemAnalyzerPrompt,
  buildDesignSystemBuilderPrompt,
  buildWebCapturePrompt,
  buildFileParsePrompt,
  buildCodebaseScanPrompt,
  buildGeneratorPrompt,
  buildRefinePrompt,
  buildCritiquePrompt,
  buildScreenshotValidationPrompt,
  buildExportPrompt,
  type GeneratorContext,
  type RefineContext,
  type ExportContext,
} from "./prompts";
import { createDefaultDesignSystem } from "./design-system";
import type { DesignSystemContext } from "./design-system";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const sampleDs: DesignSystemContext = createDefaultDesignSystem("Test Design System");

const TRAILING_PROSE_REMINDER = "End your response with prose";

// ---------------------------------------------------------------------------
// buildDesignSystemLocatorPrompt
// ---------------------------------------------------------------------------

describe("buildDesignSystemLocatorPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildDesignSystemLocatorPrompt("/my/project");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the root path", () => {
    const prompt = buildDesignSystemLocatorPrompt("/my/project");
    expect(prompt).toContain("/my/project");
  });

  test("mentions CSS/SCSS files", () => {
    const prompt = buildDesignSystemLocatorPrompt("/root");
    const lower = prompt.toLowerCase();
    expect(lower.includes("css") || lower.includes("scss")).toBe(true);
  });

  test("mentions Tailwind config", () => {
    const prompt = buildDesignSystemLocatorPrompt("/root");
    expect(prompt.toLowerCase()).toContain("tailwind");
  });

  test("mentions design tokens", () => {
    const prompt = buildDesignSystemLocatorPrompt("/root");
    const lower = prompt.toLowerCase();
    expect(lower.includes("token") || lower.includes("theme")).toBe(true);
  });

  test("mentions .impeccable.md", () => {
    const prompt = buildDesignSystemLocatorPrompt("/root");
    expect(prompt).toContain("impeccable");
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildDesignSystemLocatorPrompt("/root");
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });

  test("does not end with a tool call phrase", () => {
    const prompt = buildDesignSystemLocatorPrompt("/root");
    expect(prompt.endsWith("tool call")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildDesignSystemAnalyzerPrompt
// ---------------------------------------------------------------------------

describe("buildDesignSystemAnalyzerPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildDesignSystemAnalyzerPrompt("/root");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the root path", () => {
    const prompt = buildDesignSystemAnalyzerPrompt("/root");
    expect(prompt).toContain("/root");
  });

  test("mentions CSS custom properties / variables", () => {
    const prompt = buildDesignSystemAnalyzerPrompt("/root");
    const lower = prompt.toLowerCase();
    expect(lower.includes("css") || lower.includes("variable") || lower.includes("custom propert")).toBe(true);
  });

  test("mentions color palettes or typography", () => {
    const prompt = buildDesignSystemAnalyzerPrompt("/root");
    const lower = prompt.toLowerCase();
    expect(lower.includes("color") || lower.includes("typography") || lower.includes("font")).toBe(true);
  });

  test("mentions spacing", () => {
    const prompt = buildDesignSystemAnalyzerPrompt("/root");
    expect(prompt.toLowerCase()).toContain("spacing");
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildDesignSystemAnalyzerPrompt("/root");
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildDesignSystemBuilderPrompt
// ---------------------------------------------------------------------------

describe("buildDesignSystemBuilderPrompt", () => {
  const locatorOutput = "## Implementation\n- `/root/tailwind.config.js`";
  const analyzerOutput = "## Colors\n- primary: #6366f1";

  test("returns a non-empty string", () => {
    const prompt = buildDesignSystemBuilderPrompt({ locatorOutput, analyzerOutput });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes locator output", () => {
    const prompt = buildDesignSystemBuilderPrompt({ locatorOutput, analyzerOutput });
    expect(prompt).toContain(locatorOutput);
  });

  test("includes analyzer output", () => {
    const prompt = buildDesignSystemBuilderPrompt({ locatorOutput, analyzerOutput });
    expect(prompt).toContain(analyzerOutput);
  });

  test("mentions design-system.json output path", () => {
    const prompt = buildDesignSystemBuilderPrompt({ locatorOutput, analyzerOutput });
    expect(prompt).toContain("design-system.json");
  });

  test("mentions .impeccable.md", () => {
    const prompt = buildDesignSystemBuilderPrompt({ locatorOutput, analyzerOutput });
    expect(prompt).toContain("impeccable");
  });

  test("mentions AskUserQuestion or user approval", () => {
    const prompt = buildDesignSystemBuilderPrompt({ locatorOutput, analyzerOutput });
    const lower = prompt.toLowerCase();
    expect(lower.includes("ask") || lower.includes("approval") || lower.includes("approve")).toBe(true);
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildDesignSystemBuilderPrompt({ locatorOutput, analyzerOutput });
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildWebCapturePrompt
// ---------------------------------------------------------------------------

describe("buildWebCapturePrompt", () => {
  const url = "https://example.com";

  test("returns a non-empty string", () => {
    const prompt = buildWebCapturePrompt(url);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the URL", () => {
    const prompt = buildWebCapturePrompt(url);
    expect(prompt).toContain(url);
  });

  test("mentions playwright", () => {
    const prompt = buildWebCapturePrompt(url);
    expect(prompt.toLowerCase()).toContain("playwright");
  });

  test("mentions screenshot", () => {
    const prompt = buildWebCapturePrompt(url);
    expect(prompt.toLowerCase()).toContain("screenshot");
  });

  test("mentions DOM or CSS extraction", () => {
    const prompt = buildWebCapturePrompt(url);
    const lower = prompt.toLowerCase();
    expect(lower.includes("dom") || lower.includes("css") || lower.includes("extract")).toBe(true);
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildWebCapturePrompt(url);
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildFileParsePrompt
// ---------------------------------------------------------------------------

describe("buildFileParsePrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildFileParsePrompt("/path/to/design.png");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the file path", () => {
    const prompt = buildFileParsePrompt("/path/to/design.png");
    expect(prompt).toContain("/path/to/design.png");
  });

  test("mentions images", () => {
    const prompt = buildFileParsePrompt("/path/to/file.png");
    expect(prompt.toLowerCase()).toContain("image");
  });

  test("mentions color or visual", () => {
    const prompt = buildFileParsePrompt("/path/to/file.png");
    const lower = prompt.toLowerCase();
    expect(lower.includes("color") || lower.includes("visual") || lower.includes("layout")).toBe(true);
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildFileParsePrompt("/any/file.pdf");
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildCodebaseScanPrompt
// ---------------------------------------------------------------------------

describe("buildCodebaseScanPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildCodebaseScanPrompt("src/components", "/root");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the reference path", () => {
    const prompt = buildCodebaseScanPrompt("src/components", "/root");
    expect(prompt).toContain("src/components");
  });

  test("includes the root path", () => {
    const prompt = buildCodebaseScanPrompt("src/components", "/root");
    expect(prompt).toContain("/root");
  });

  test("mentions component structure", () => {
    const prompt = buildCodebaseScanPrompt("src/components", "/root");
    const lower = prompt.toLowerCase();
    expect(lower.includes("component") || lower.includes("style") || lower.includes("pattern")).toBe(true);
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildCodebaseScanPrompt("src", "/root");
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildGeneratorPrompt
// ---------------------------------------------------------------------------

describe("buildGeneratorPrompt", () => {
  const context: GeneratorContext = {
    prompt: "Create a modern landing page",
    reference: "https://example.com",
    designSystem: sampleDs,
    outputType: "landing-page",
    designDir: "/root/.open-claude-design/output-123",
  };

  test("returns a non-empty string", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the user prompt", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(prompt).toContain("Create a modern landing page");
  });

  test("includes the reference", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(prompt).toContain("https://example.com");
  });

  test("includes design system JSON", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(prompt).toContain(sampleDs.name);
  });

  test("includes output type", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(prompt).toContain("landing-page");
  });

  test("includes output directory", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(prompt).toContain("/root/.open-claude-design/output-123");
  });

  test("mentions impeccable skill", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(prompt).toContain("impeccable");
  });

  test("includes output-type specific instructions for landing-page", () => {
    const prompt = buildGeneratorPrompt(context);
    const lower = prompt.toLowerCase();
    expect(lower.includes("cta") || lower.includes("marketing") || lower.includes("scroll")).toBe(true);
  });

  test("includes output-type specific instructions for prototype", () => {
    const protoCtx: GeneratorContext = { ...context, outputType: "prototype" };
    const prompt = buildGeneratorPrompt(protoCtx);
    const lower = prompt.toLowerCase();
    expect(lower.includes("interact") || lower.includes("hover") || lower.includes("transition")).toBe(true);
  });

  test("includes output-type specific instructions for wireframe", () => {
    const wireCtx: GeneratorContext = { ...context, outputType: "wireframe" };
    const prompt = buildGeneratorPrompt(wireCtx);
    const lower = prompt.toLowerCase();
    expect(lower.includes("grayscale") || lower.includes("layout") || lower.includes("placeholder")).toBe(true);
  });

  test("includes output-type specific instructions for mockup", () => {
    const mockupCtx: GeneratorContext = { ...context, outputType: "mockup" };
    const prompt = buildGeneratorPrompt(mockupCtx);
    const lower = prompt.toLowerCase();
    expect(lower.includes("color") || lower.includes("detail") || lower.includes("real content")).toBe(true);
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildGeneratorPrompt(context);
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildRefinePrompt
// ---------------------------------------------------------------------------

describe("buildRefinePrompt", () => {
  const context: RefineContext = {
    prompt: "Make the hero section bolder",
    designDir: "/root/.open-claude-design/output-123",
    designSystem: sampleDs,
    iteration: 2,
    validationFeedback: "Layout breaks at mobile viewport",
  };

  test("returns a non-empty string", () => {
    const prompt = buildRefinePrompt(context);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes original prompt", () => {
    const prompt = buildRefinePrompt(context);
    expect(prompt).toContain("Make the hero section bolder");
  });

  test("includes iteration number", () => {
    const prompt = buildRefinePrompt(context);
    expect(prompt).toContain("2");
  });

  test("includes maximum iterations (8)", () => {
    const prompt = buildRefinePrompt(context);
    expect(prompt).toContain("8");
  });

  test("includes validation feedback when provided", () => {
    const prompt = buildRefinePrompt(context);
    expect(prompt).toContain("Layout breaks at mobile viewport");
  });

  test("handles missing validationFeedback gracefully", () => {
    const noFeedbackCtx: RefineContext = { ...context, validationFeedback: undefined };
    expect(() => buildRefinePrompt(noFeedbackCtx)).not.toThrow();
    const prompt = buildRefinePrompt(noFeedbackCtx);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes design system reference", () => {
    const prompt = buildRefinePrompt(context);
    expect(prompt).toContain(sampleDs.name);
  });

  test("includes impeccable or critique skill", () => {
    const prompt = buildRefinePrompt(context);
    expect(prompt.toLowerCase()).toContain("impeccable");
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildRefinePrompt(context);
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildCritiquePrompt
// ---------------------------------------------------------------------------

describe("buildCritiquePrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the design directory", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(prompt).toContain("/root/design");
  });

  test("mentions First Impression", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    const lower = prompt.toLowerCase();
    expect(lower.includes("first impression") || lower.includes("impression")).toBe(true);
  });

  test("mentions usability", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(prompt.toLowerCase()).toContain("usabilit");
  });

  test("mentions visual hierarchy", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(prompt.toLowerCase()).toContain("hierarch");
  });

  test("mentions accessibility", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(prompt.toLowerCase()).toContain("accessib");
  });

  test("mentions severity levels (Critical, Moderate, Minor)", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(prompt.toLowerCase()).toContain("critical");
  });

  test("mentions critique skill", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(prompt.toLowerCase()).toContain("critique");
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildCritiquePrompt("/root/design", sampleDs);
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildScreenshotValidationPrompt
// ---------------------------------------------------------------------------

describe("buildScreenshotValidationPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes the design directory", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    expect(prompt).toContain("/root/design");
  });

  test("mentions playwright skill", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    expect(prompt.toLowerCase()).toContain("playwright");
  });

  test("mentions mobile viewport (375px)", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    expect(prompt).toContain("375");
  });

  test("mentions tablet viewport (768px)", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    expect(prompt).toContain("768");
  });

  test("mentions desktop viewport (1440px)", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    expect(prompt).toContain("1440");
  });

  test("mentions visual issues or rendering", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    const lower = prompt.toLowerCase();
    expect(lower.includes("render") || lower.includes("layout") || lower.includes("visual")).toBe(true);
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildScreenshotValidationPrompt("/root/design");
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// buildExportPrompt
// ---------------------------------------------------------------------------

describe("buildExportPrompt", () => {
  const context: ExportContext = {
    designDir: "/root/.open-claude-design/output-123",
    finalPath: "/root/designs/my-design",
    designSystem: sampleDs,
  };

  test("returns a non-empty string", () => {
    const prompt = buildExportPrompt(context);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes design directory", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt).toContain("/root/.open-claude-design/output-123");
  });

  test("includes final path", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt).toContain("/root/designs/my-design");
  });

  test("mentions design-intent.md", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt).toContain("design-intent");
  });

  test("mentions component-specs.md", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt).toContain("component-specs");
  });

  test("mentions interaction-specs.md", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt).toContain("interaction-specs");
  });

  test("mentions accessibility-notes.md", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt).toContain("accessibility-notes");
  });

  test("mentions extract skill", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt.toLowerCase()).toContain("extract");
  });

  test("ends with trailing prose reminder", () => {
    const prompt = buildExportPrompt(context);
    expect(prompt).toContain(TRAILING_PROSE_REMINDER);
  });
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

describe("exported types", () => {
  test("GeneratorContext is usable as a type", () => {
    const ctx: GeneratorContext = {
      prompt: "test",
      reference: "",
      designSystem: sampleDs,
      outputType: "prototype",
      designDir: "/tmp",
    };
    expect(ctx.outputType).toBe("prototype");
  });

  test("RefineContext is usable as a type", () => {
    const ctx: RefineContext = {
      prompt: "refine",
      designDir: "/tmp",
      designSystem: sampleDs,
      iteration: 1,
    };
    expect(ctx.iteration).toBe(1);
  });

  test("ExportContext is usable as a type", () => {
    const ctx: ExportContext = {
      designDir: "/tmp",
      finalPath: "/out",
      designSystem: sampleDs,
    };
    expect(ctx.finalPath).toBe("/out");
  });
});
