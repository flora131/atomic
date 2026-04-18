import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  createDefaultDesignSystem,
  validateDesignSystem,
  loadDesignSystem,
  persistDesignSystem,
  getDesignSystemPath,
  DESIGN_SYSTEM_FILENAME,
  DESIGN_OUTPUT_DIR,
  type DesignSystemContext,
  type DesignSystemColors,
  type DesignSystemTypography,
  type DesignSystemSpacing,
  type DesignSystemComponent,
  type ImportContext,
} from "./design-system";

describe("constants", () => {
  test("DESIGN_SYSTEM_FILENAME is design-system.json", () => {
    expect(DESIGN_SYSTEM_FILENAME).toBe("design-system.json");
  });

  test("DESIGN_OUTPUT_DIR is .open-claude-design", () => {
    expect(DESIGN_OUTPUT_DIR).toBe(".open-claude-design");
  });
});

describe("createDefaultDesignSystem", () => {
  test("returns a valid DesignSystemContext with default name", () => {
    const ds = createDefaultDesignSystem();
    expect(ds).toBeDefined();
    expect(typeof ds.version).toBe("number");
    expect(typeof ds.name).toBe("string");
    expect(ds.name.length).toBeGreaterThan(0);
  });

  test("uses provided name", () => {
    const ds = createDefaultDesignSystem("My Design System");
    expect(ds.name).toBe("My Design System");
  });

  test("has required colors (primary, secondary, background, text)", () => {
    const ds = createDefaultDesignSystem();
    expect(typeof ds.colors.primary).toBe("string");
    expect(typeof ds.colors.secondary).toBe("string");
    expect(typeof ds.colors.background).toBe("string");
    expect(typeof ds.colors.text).toBe("string");
  });

  test("has typography with fontFamily (heading, body) and scale (h1, h2, body, small)", () => {
    const ds = createDefaultDesignSystem();
    expect(typeof ds.typography.fontFamily.heading).toBe("string");
    expect(typeof ds.typography.fontFamily.body).toBe("string");
    expect(typeof ds.typography.scale.h1).toBe("string");
    expect(typeof ds.typography.scale.h2).toBe("string");
    expect(typeof ds.typography.scale.body).toBe("string");
    expect(typeof ds.typography.scale.small).toBe("string");
  });

  test("has spacing with xs, sm, md, lg, xl", () => {
    const ds = createDefaultDesignSystem();
    expect(typeof ds.spacing.xs).toBe("string");
    expect(typeof ds.spacing.sm).toBe("string");
    expect(typeof ds.spacing.md).toBe("string");
    expect(typeof ds.spacing.lg).toBe("string");
    expect(typeof ds.spacing.xl).toBe("string");
  });

  test("has components as an array", () => {
    const ds = createDefaultDesignSystem();
    expect(Array.isArray(ds.components)).toBe(true);
  });

  test("uses Inter as default font", () => {
    const ds = createDefaultDesignSystem();
    // Default font should reference Inter
    const heading = ds.typography.fontFamily.heading.toLowerCase();
    const body = ds.typography.fontFamily.body.toLowerCase();
    expect(heading.includes("inter") || body.includes("inter")).toBe(true);
  });

  test("passes validateDesignSystem", () => {
    const ds = createDefaultDesignSystem();
    expect(validateDesignSystem(ds)).toBe(true);
  });
});

describe("validateDesignSystem", () => {
  const validDs: DesignSystemContext = {
    version: 1,
    name: "Test Design System",
    colors: {
      primary: "#000000",
      secondary: "#111111",
      background: "#ffffff",
      text: "#333333",
    },
    typography: {
      fontFamily: { heading: "Inter", body: "Inter" },
      scale: { h1: "2rem", h2: "1.5rem", body: "1rem", small: "0.75rem" },
    },
    spacing: {
      xs: "4px",
      sm: "8px",
      md: "16px",
      lg: "24px",
      xl: "32px",
    },
    components: [],
  };

  test("returns true for a valid design system", () => {
    expect(validateDesignSystem(validDs)).toBe(true);
  });

  test("returns false for null", () => {
    expect(validateDesignSystem(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(validateDesignSystem(undefined)).toBe(false);
  });

  test("returns false for a non-object (string)", () => {
    expect(validateDesignSystem("not a design system")).toBe(false);
  });

  test("returns false when version is not a number", () => {
    expect(validateDesignSystem({ ...validDs, version: "1" })).toBe(false);
  });

  test("returns false when name is not a string", () => {
    expect(validateDesignSystem({ ...validDs, name: 42 })).toBe(false);
  });

  test("returns false when colors is missing", () => {
    const { colors: _colors, ...rest } = validDs;
    expect(validateDesignSystem(rest)).toBe(false);
  });

  test("returns false when colors.primary is missing", () => {
    const ds = { ...validDs, colors: { secondary: "#111", background: "#fff", text: "#333" } };
    expect(validateDesignSystem(ds)).toBe(false);
  });

  test("returns false when colors.secondary is missing", () => {
    const ds = { ...validDs, colors: { primary: "#000", background: "#fff", text: "#333" } };
    expect(validateDesignSystem(ds)).toBe(false);
  });

  test("returns false when colors.background is missing", () => {
    const ds = { ...validDs, colors: { primary: "#000", secondary: "#111", text: "#333" } };
    expect(validateDesignSystem(ds)).toBe(false);
  });

  test("returns false when colors.text is missing", () => {
    const ds = { ...validDs, colors: { primary: "#000", secondary: "#111", background: "#fff" } };
    expect(validateDesignSystem(ds)).toBe(false);
  });

  test("returns false when typography is missing", () => {
    const { typography: _typography, ...rest } = validDs;
    expect(validateDesignSystem(rest)).toBe(false);
  });

  test("returns false when typography.fontFamily is missing", () => {
    const ds = { ...validDs, typography: { scale: validDs.typography.scale } };
    expect(validateDesignSystem(ds)).toBe(false);
  });

  test("returns false when typography.scale is missing", () => {
    const ds = { ...validDs, typography: { fontFamily: validDs.typography.fontFamily } };
    expect(validateDesignSystem(ds)).toBe(false);
  });

  test("returns false when spacing is missing", () => {
    const { spacing: _spacing, ...rest } = validDs;
    expect(validateDesignSystem(rest)).toBe(false);
  });

  test("returns false when spacing.xs is missing", () => {
    const { xs: _xs, ...spacingRest } = validDs.spacing;
    expect(validateDesignSystem({ ...validDs, spacing: spacingRest })).toBe(false);
  });

  test("returns false when spacing.sm is missing", () => {
    const { sm: _sm, ...spacingRest } = validDs.spacing;
    expect(validateDesignSystem({ ...validDs, spacing: spacingRest })).toBe(false);
  });

  test("returns false when spacing.md is missing", () => {
    const { md: _md, ...spacingRest } = validDs.spacing;
    expect(validateDesignSystem({ ...validDs, spacing: spacingRest })).toBe(false);
  });

  test("returns false when spacing.lg is missing", () => {
    const { lg: _lg, ...spacingRest } = validDs.spacing;
    expect(validateDesignSystem({ ...validDs, spacing: spacingRest })).toBe(false);
  });

  test("returns false when spacing.xl is missing", () => {
    const { xl: _xl, ...spacingRest } = validDs.spacing;
    expect(validateDesignSystem({ ...validDs, spacing: spacingRest })).toBe(false);
  });

  test("returns false when components is not an array", () => {
    expect(validateDesignSystem({ ...validDs, components: {} })).toBe(false);
  });

  test("returns true when components has entries", () => {
    const ds = {
      ...validDs,
      components: [{ name: "Button", variants: ["primary", "secondary"] }],
    };
    expect(validateDesignSystem(ds)).toBe(true);
  });

  test("returns true when optional source is present", () => {
    const ds = {
      ...validDs,
      source: { framework: "tailwind", configPath: "tailwind.config.js" },
    };
    expect(validateDesignSystem(ds)).toBe(true);
  });

  test("returns false for an empty object", () => {
    expect(validateDesignSystem({})).toBe(false);
  });
});

describe("getDesignSystemPath", () => {
  test("returns correct path under root", () => {
    const result = getDesignSystemPath("/my/project");
    expect(result).toBe("/my/project/.open-claude-design/design-system.json");
  });

  test("uses DESIGN_OUTPUT_DIR and DESIGN_SYSTEM_FILENAME constants", () => {
    const result = getDesignSystemPath("/root");
    expect(result).toContain(DESIGN_OUTPUT_DIR);
    expect(result.endsWith(DESIGN_SYSTEM_FILENAME)).toBe(true);
  });
});

describe("loadDesignSystem", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "design-system-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("reads and parses a valid design system JSON file", async () => {
    const ds: DesignSystemContext = {
      version: 1,
      name: "My Design System",
      colors: { primary: "#fff", secondary: "#000", background: "#eee", text: "#111" },
      typography: {
        fontFamily: { heading: "Inter", body: "Inter" },
        scale: { h1: "2rem", h2: "1.5rem", body: "1rem", small: "0.75rem" },
      },
      spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
      components: [],
    };
    const filePath = path.join(tmpDir, "design-system.json");
    await Bun.write(filePath, JSON.stringify(ds));

    const loaded = await loadDesignSystem(filePath);
    expect(loaded.name).toBe("My Design System");
    expect(loaded.version).toBe(1);
    expect(loaded.colors.primary).toBe("#fff");
  });

  test("throws when file contains invalid JSON structure", async () => {
    const filePath = path.join(tmpDir, "design-system.json");
    await Bun.write(filePath, JSON.stringify({ name: "bad", version: "not-a-number" }));

    await expect(loadDesignSystem(filePath)).rejects.toThrow();
  });

  test("throws when file does not exist", async () => {
    const filePath = path.join(tmpDir, "nonexistent.json");
    await expect(loadDesignSystem(filePath)).rejects.toThrow();
  });

  test("throws when file contains malformed JSON", async () => {
    const filePath = path.join(tmpDir, "malformed.json");
    await Bun.write(filePath, "{ this is not valid json }");
    await expect(loadDesignSystem(filePath)).rejects.toThrow();
  });
});

describe("persistDesignSystem", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "design-system-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("extracts JSON from ```json fenced block and writes to file", async () => {
    const ds: DesignSystemContext = {
      version: 1,
      name: "Extracted System",
      colors: { primary: "#abc", secondary: "#def", background: "#fff", text: "#000" },
      typography: {
        fontFamily: { heading: "Inter", body: "Inter" },
        scale: { h1: "2rem", h2: "1.5rem", body: "1rem", small: "0.75rem" },
      },
      spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
      components: [{ name: "Button", variants: ["primary"] }],
    };

    const builderOutput = `Here is your design system:
\`\`\`json
${JSON.stringify(ds, null, 2)}
\`\`\`
That's the complete design system.`;

    const outputPath = path.join(tmpDir, "design-system.json");
    const result = await persistDesignSystem(builderOutput, outputPath);

    expect(result.name).toBe("Extracted System");
    expect(result.colors.primary).toBe("#abc");

    // Verify file was written
    const written = await Bun.file(outputPath).text();
    const parsed = JSON.parse(written);
    expect(parsed.name).toBe("Extracted System");
  });

  test("extracts raw JSON object when no fences are present", async () => {
    const ds: DesignSystemContext = {
      version: 1,
      name: "Raw JSON System",
      colors: { primary: "#111", secondary: "#222", background: "#fff", text: "#000" },
      typography: {
        fontFamily: { heading: "Inter", body: "Inter" },
        scale: { h1: "2rem", h2: "1.5rem", body: "1rem", small: "0.75rem" },
      },
      spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
      components: [],
    };

    const outputPath = path.join(tmpDir, "design-system.json");
    const result = await persistDesignSystem(JSON.stringify(ds), outputPath);

    expect(result.name).toBe("Raw JSON System");
  });

  test("creates a default design system when parsing fails", async () => {
    const outputPath = path.join(tmpDir, "design-system.json");
    const result = await persistDesignSystem("This is not JSON at all, just text output.", outputPath);

    // Should return a valid (default) design system
    expect(validateDesignSystem(result)).toBe(true);

    // Verify file was written
    const written = await Bun.file(outputPath).text();
    const parsed = JSON.parse(written);
    expect(validateDesignSystem(parsed)).toBe(true);
  });

  test("creates parent directories if they do not exist", async () => {
    const nestedPath = path.join(tmpDir, ".open-claude-design", "design-system.json");
    const ds: DesignSystemContext = {
      version: 1,
      name: "Nested System",
      colors: { primary: "#000", secondary: "#111", background: "#fff", text: "#333" },
      typography: {
        fontFamily: { heading: "Inter", body: "Inter" },
        scale: { h1: "2rem", h2: "1.5rem", body: "1rem", small: "0.75rem" },
      },
      spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
      components: [],
    };

    const builderOutput = `\`\`\`json\n${JSON.stringify(ds)}\n\`\`\``;
    const result = await persistDesignSystem(builderOutput, nestedPath);

    expect(result.name).toBe("Nested System");

    // Verify file was written at nested path
    const written = await Bun.file(nestedPath).text();
    expect(JSON.parse(written).name).toBe("Nested System");
  });

  test("writes formatted JSON (pretty-printed)", async () => {
    const ds: DesignSystemContext = {
      version: 1,
      name: "Pretty System",
      colors: { primary: "#000", secondary: "#111", background: "#fff", text: "#333" },
      typography: {
        fontFamily: { heading: "Inter", body: "Inter" },
        scale: { h1: "2rem", h2: "1.5rem", body: "1rem", small: "0.75rem" },
      },
      spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
      components: [],
    };

    const outputPath = path.join(tmpDir, "design-system.json");
    await persistDesignSystem(`\`\`\`json\n${JSON.stringify(ds)}\n\`\`\``, outputPath);

    const written = await Bun.file(outputPath).text();
    // Formatted JSON should contain newlines and indentation
    expect(written).toContain("\n");
    expect(written).toContain("  ");
  });
});
