import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  packageHandoffBundle,
  generateHandoffPrompt,
  extractSection,
  isSensitiveFile,
  HANDOFF_DIR_NAME,
  HANDOFF_SUBDIRS,
  HANDOFF_FILES,
  type PackageHandoffOptions,
} from "./handoff";

// A minimal valid DesignSystemContext for testing
const sampleDesignSystem = {
  version: 1,
  name: "Test Design System",
  colors: {
    primary: "#4a90e2",
    secondary: "#667eea",
    background: "#f8f9fa",
    text: "#2c3e50",
  },
  typography: {
    fontFamily: { heading: "Inter", body: "Inter" },
    scale: { h1: "2rem", h2: "1.5rem", body: "1rem", small: "0.75rem" },
  },
  spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  components: [
    { name: "Button", variants: ["primary", "secondary"] },
    { name: "Card", variants: ["default", "elevated"] },
  ],
};

const sampleExporterNotes = `## Design Intent
This design uses a clean, minimal aesthetic to communicate clarity and trust.
The primary blue evokes reliability.

## Component Specifications
- Button: primary and secondary variants with hover states
- Card: default and elevated with shadow transitions

## Interaction Specifications
- Hover states use 200ms ease transitions
- Focus rings use 3px offset for accessibility

## Accessibility Notes
- All interactive elements meet WCAG AA contrast ratio
- Focus indicators are always visible`;

describe("constants", () => {
  test("HANDOFF_DIR_NAME is 'handoff'", () => {
    expect(HANDOFF_DIR_NAME).toBe("handoff");
  });

  test("HANDOFF_SUBDIRS contains 'design'", () => {
    expect(HANDOFF_SUBDIRS).toContain("design");
  });

  test("HANDOFF_FILES contains all required file names", () => {
    expect(HANDOFF_FILES).toContain("design-system.json");
    expect(HANDOFF_FILES).toContain("design-intent.md");
    expect(HANDOFF_FILES).toContain("component-specs.md");
    expect(HANDOFF_FILES).toContain("interaction-specs.md");
    expect(HANDOFF_FILES).toContain("accessibility-notes.md");
    expect(HANDOFF_FILES).toContain("handoff-prompt.md");
  });

  test("HANDOFF_FILES has exactly 6 entries", () => {
    expect(HANDOFF_FILES.length).toBe(6);
  });
});

describe("isSensitiveFile", () => {
  test("returns true for .env file", () => {
    expect(isSensitiveFile(".env")).toBe(true);
  });

  test("returns true for .env.local", () => {
    expect(isSensitiveFile(".env.local")).toBe(true);
  });

  test("returns true for credentials file", () => {
    expect(isSensitiveFile("credentials.json")).toBe(true);
  });

  test("returns true for secret file", () => {
    expect(isSensitiveFile("secret.txt")).toBe(true);
  });

  test("returns true for .key file", () => {
    expect(isSensitiveFile("server.key")).toBe(true);
  });

  test("returns true for .pem file", () => {
    expect(isSensitiveFile("cert.pem")).toBe(true);
  });

  test("returns true for id_rsa", () => {
    expect(isSensitiveFile("id_rsa")).toBe(true);
  });

  test("returns true for id_ed25519", () => {
    expect(isSensitiveFile("id_ed25519")).toBe(true);
  });

  test("returns true for .p12 file", () => {
    expect(isSensitiveFile("keystore.p12")).toBe(true);
  });

  test("returns false for index.html", () => {
    expect(isSensitiveFile("index.html")).toBe(false);
  });

  test("returns false for styles.css", () => {
    expect(isSensitiveFile("styles.css")).toBe(false);
  });

  test("returns false for script.js", () => {
    expect(isSensitiveFile("script.js")).toBe(false);
  });

  test("returns false for README.md", () => {
    expect(isSensitiveFile("README.md")).toBe(false);
  });

  test("returns false for design-system.json", () => {
    expect(isSensitiveFile("design-system.json")).toBe(false);
  });

  test("is case-insensitive for .ENV", () => {
    expect(isSensitiveFile(".ENV")).toBe(true);
  });

  test("is case-insensitive for CREDENTIALS.json", () => {
    expect(isSensitiveFile("CREDENTIALS.json")).toBe(true);
  });
});

describe("extractSection", () => {
  const sampleText = `# Introduction
Some intro text here.

## Design Intent
This is the design intent section.
It spans multiple lines.

## Component Specifications
Component details go here.
- Button
- Card

## Interaction Specifications
Interaction details here.

# Top Level Section
Top level content.`;

  test("extracts content of a level-2 section", () => {
    const result = extractSection(sampleText, "Design Intent");
    expect(result).toContain("This is the design intent section.");
    expect(result).toContain("It spans multiple lines.");
  });

  test("stops extraction at the next heading of equal level", () => {
    const result = extractSection(sampleText, "Design Intent");
    expect(result).not.toContain("Component Specifications");
    expect(result).not.toContain("Component details go here.");
  });

  test("extracts the component specifications section", () => {
    const result = extractSection(sampleText, "Component Specifications");
    expect(result).toContain("Component details go here.");
    expect(result).toContain("Button");
  });

  test("returns empty string when section is not found", () => {
    const result = extractSection(sampleText, "Nonexistent Section");
    expect(result).toBe("");
  });

  test("returns empty string for empty text", () => {
    const result = extractSection("", "Design Intent");
    expect(result).toBe("");
  });

  test("handles section at end of text (no following heading)", () => {
    const result = extractSection(sampleText, "Interaction Specifications");
    expect(result).toContain("Interaction details here.");
  });

  test("handles level-1 heading sections", () => {
    const result = extractSection(sampleText, "Introduction");
    expect(result).toContain("Some intro text here.");
  });
});

describe("generateHandoffPrompt", () => {
  test("returns a non-empty string", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("includes the design system name in the heading", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("Test Design System");
  });

  test("includes a Context section", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("## Context");
  });

  test("includes a Design System section", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("## Design System");
  });

  test("includes the primary color from design system", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("#4a90e2");
  });

  test("includes the font family from design system", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("Inter");
  });

  test("includes the spacing md from design system", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("16px");
  });

  test("includes a Components to Implement section", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("## Components to Implement");
  });

  test("includes component names from design system when no exporter notes provided", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, "");
    expect(result).toContain("Button");
    expect(result).toContain("Card");
  });

  test("includes an Instructions section", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("## Instructions");
  });

  test("instructions mention design-system.json", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("design-system.json");
  });

  test("instructions mention design-intent.md", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("design-intent.md");
  });

  test("starts with # Design Handoff heading", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result.startsWith("# Design Handoff")).toBe(true);
  });

  test("includes design-system.json reference in Design System section", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, sampleExporterNotes);
    expect(result).toContain("design-system.json");
  });

  test("handles empty exporter notes gracefully", () => {
    const result = generateHandoffPrompt(sampleDesignSystem, "");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("## Instructions");
  });
});

describe("packageHandoffBundle", () => {
  let tmpDir: string;
  let designDir: string;
  let finalPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "handoff-test-"));
    designDir = path.join(tmpDir, "design-output");
    finalPath = path.join(tmpDir, "export");

    // Create the design directory with some design files
    await Bun.write(path.join(designDir, "index.html"), "<html><body>Design</body></html>");
    await Bun.write(path.join(designDir, "styles.css"), "body { color: red; }");
    await Bun.write(path.join(designDir, "script.js"), "console.log('hello');");

    // Add a sensitive file that should be excluded
    await Bun.write(path.join(designDir, ".env"), "SECRET=password");
    await Bun.write(path.join(designDir, "credentials.json"), '{"key":"value"}');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns the handoff directory path", async () => {
    const result = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("handoff");
  });

  test("creates the handoff directory", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const handoffStat = await stat(handoffPath);
    expect(handoffStat.isDirectory()).toBe(true);
  });

  test("creates the design/ subdirectory", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const designSubDir = path.join(handoffPath, "design");
    const designStat = await stat(designSubDir);
    expect(designStat.isDirectory()).toBe(true);
  });

  test("copies HTML files to handoff/design/", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const htmlContent = await Bun.file(path.join(handoffPath, "design", "index.html")).text();
    expect(htmlContent).toContain("<html>");
  });

  test("copies CSS files to handoff/design/", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const cssContent = await Bun.file(path.join(handoffPath, "design", "styles.css")).text();
    expect(cssContent).toContain("color: red");
  });

  test("copies JS files to handoff/design/", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const jsContent = await Bun.file(path.join(handoffPath, "design", "script.js")).text();
    expect(jsContent).toContain("console.log");
  });

  test("excludes .env sensitive file from handoff/design/", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const envFile = Bun.file(path.join(handoffPath, "design", ".env"));
    expect(await envFile.exists()).toBe(false);
  });

  test("excludes credentials.json sensitive file from handoff/design/", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const credFile = Bun.file(path.join(handoffPath, "design", "credentials.json"));
    expect(await credFile.exists()).toBe(false);
  });

  test("writes design-system.json to handoff root", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const dsFile = await Bun.file(path.join(handoffPath, "design-system.json")).text();
    const parsed = JSON.parse(dsFile);
    expect(parsed.name).toBe("Test Design System");
    expect(parsed.colors.primary).toBe("#4a90e2");
  });

  test("writes design-system.json as formatted JSON", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const dsFile = await Bun.file(path.join(handoffPath, "design-system.json")).text();
    expect(dsFile).toContain("\n");
    expect(dsFile).toContain("  ");
  });

  test("writes design-intent.md to handoff root", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "design-intent.md")).text();
    expect(file.length).toBeGreaterThan(0);
  });

  test("design-intent.md contains extracted Design Intent content", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "design-intent.md")).text();
    expect(file).toContain("clean, minimal aesthetic");
  });

  test("writes component-specs.md to handoff root", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "component-specs.md")).text();
    expect(file.length).toBeGreaterThan(0);
  });

  test("component-specs.md contains extracted Component Specifications content", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "component-specs.md")).text();
    expect(file).toContain("Button");
  });

  test("writes interaction-specs.md to handoff root", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "interaction-specs.md")).text();
    expect(file.length).toBeGreaterThan(0);
  });

  test("interaction-specs.md contains extracted Interaction Specifications content", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "interaction-specs.md")).text();
    expect(file).toContain("200ms");
  });

  test("writes accessibility-notes.md to handoff root", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "accessibility-notes.md")).text();
    expect(file.length).toBeGreaterThan(0);
  });

  test("accessibility-notes.md contains extracted Accessibility Notes content", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "accessibility-notes.md")).text();
    expect(file).toContain("WCAG");
  });

  test("writes handoff-prompt.md to handoff root", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "handoff-prompt.md")).text();
    expect(file.length).toBeGreaterThan(0);
  });

  test("handoff-prompt.md contains the design system name", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const file = await Bun.file(path.join(handoffPath, "handoff-prompt.md")).text();
    expect(file).toContain("Test Design System");
  });

  test("creates all HANDOFF_FILES in the handoff directory", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    for (const fileName of HANDOFF_FILES) {
      const fileStat = await stat(path.join(handoffPath, fileName));
      expect(fileStat.isFile()).toBe(true);
    }
  });

  test("works when exporter notes are empty (placeholder content written)", async () => {
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: "",
    });
    // All files should still be written
    for (const fileName of HANDOFF_FILES) {
      const fileStat = await stat(path.join(handoffPath, fileName));
      expect(fileStat.isFile()).toBe(true);
    }
  });

  test("copies nested subdirectories (e.g., assets/) to handoff/design/", async () => {
    // Create a nested assets directory with files
    const assetsDir = path.join(designDir, "assets");
    await Bun.write(path.join(assetsDir, "logo.png"), "fake-png-data");
    await Bun.write(path.join(assetsDir, "icon.svg"), "<svg></svg>");

    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });

    const logoFile = Bun.file(path.join(handoffPath, "design", "assets", "logo.png"));
    expect(await logoFile.exists()).toBe(true);
    expect(await logoFile.text()).toBe("fake-png-data");

    const iconFile = Bun.file(path.join(handoffPath, "design", "assets", "icon.svg"));
    expect(await iconFile.exists()).toBe(true);
    expect(await iconFile.text()).toBe("<svg></svg>");
  });

  test("excludes sensitive files from nested subdirectories", async () => {
    const assetsDir = path.join(designDir, "assets");
    await Bun.write(path.join(assetsDir, "logo.png"), "fake-png-data");
    await Bun.write(path.join(assetsDir, ".env"), "NESTED_SECRET=bad");

    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });

    const logoFile = Bun.file(path.join(handoffPath, "design", "assets", "logo.png"));
    expect(await logoFile.exists()).toBe(true);

    const envFile = Bun.file(path.join(handoffPath, "design", "assets", ".env"));
    expect(await envFile.exists()).toBe(false);
  });

  test("creates finalPath directories if they do not exist", async () => {
    const nestedFinalPath = path.join(tmpDir, "nested", "deep", "export");
    const handoffPath = await packageHandoffBundle({
      designDir,
      finalPath: nestedFinalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    });
    const handoffStat = await stat(handoffPath);
    expect(handoffStat.isDirectory()).toBe(true);
  });

  test("returned path ends with /handoff", () => {
    return packageHandoffBundle({
      designDir,
      finalPath,
      designSystem: sampleDesignSystem,
      exporterNotes: sampleExporterNotes,
    }).then((result) => {
      expect(result.endsWith(path.sep + "handoff") || result.endsWith("/handoff")).toBe(true);
    });
  });
});
