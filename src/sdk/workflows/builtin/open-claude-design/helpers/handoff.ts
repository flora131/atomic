/**
 * Deterministic handoff bundle packager for the open-claude-design workflow.
 *
 * This module is the final step of the workflow. It packages the design output
 * into a Claude Code handoff bundle — a directory structure containing all the
 * information a coding agent needs to implement the design as production code.
 *
 * No LLM call is made here. All output is fully determined by the inputs.
 * This mirrors the pattern established in deep-research-codebase/helpers/scratch.ts.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

import type { DesignSystemContext } from "./design-system";
import { copyDesignFiles } from "./export";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PackageHandoffOptions {
  designDir: string;
  finalPath: string;
  designSystem: DesignSystemContext;
  exporterNotes: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const HANDOFF_DIR_NAME = "handoff";

export const HANDOFF_SUBDIRS = ["design"] as const;

export const HANDOFF_FILES = [
  "design-system.json",
  "design-intent.md",
  "component-specs.md",
  "interaction-specs.md",
  "accessibility-notes.md",
  "handoff-prompt.md",
] as const;

/** File name patterns that should never be included in the handoff bundle. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\.env(\.|$)/i,
  /credentials/i,
  /secret/i,
  /\.key$/i,
  /\.pem$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.p12$/i,
];

// ─── isSensitiveFile ─────────────────────────────────────────────────────────

/**
 * Check if a file name should be excluded from the handoff bundle.
 * Sensitive patterns: .env, credentials, secret, .key, .pem, id_rsa, id_ed25519, .p12.
 */
export function isSensitiveFile(fileName: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(fileName));
}

// ─── extractSection ──────────────────────────────────────────────────────────

/**
 * Extract a markdown section from a text by heading name.
 *
 * Looks for `## {sectionName}` or `# {sectionName}` and extracts content
 * until the next heading of equal or higher level.
 * Returns an empty string if the section is not found.
 */
export function extractSection(text: string, sectionName: string): string {
  if (!text.trim()) return "";

  const lines = text.split("\n");
  let headingLevel = 0;
  let headingIndex = -1;

  // Find the heading that matches the sectionName (level 1 or 2)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h2Match = line.match(/^(#{1,2})\s+(.+)$/);
    if (h2Match) {
      const level = h2Match[1]!.length;
      const title = h2Match[2]!.trim();
      if (title.toLowerCase() === sectionName.toLowerCase()) {
        headingLevel = level;
        headingIndex = i;
        break;
      }
    }
  }

  if (headingIndex === -1) return "";

  // Collect content lines until a heading of equal or higher level (i.e., fewer or equal # chars)
  const contentLines: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const nextHeadingMatch = line.match(/^(#{1,6})\s/);
    if (nextHeadingMatch) {
      const nextLevel = nextHeadingMatch[1]!.length;
      if (nextLevel <= headingLevel) {
        break;
      }
    }
    contentLines.push(line);
  }

  return contentLines.join("\n").trim();
}

// ─── generateHandoffPrompt ───────────────────────────────────────────────────

/**
 * Generate the `handoff-prompt.md` content.
 *
 * Produces a self-contained prompt that can be fed directly to Claude Code
 * or the `ralph` workflow to implement the design as production code.
 */
export function generateHandoffPrompt(
  designSystem: DesignSystemContext,
  exporterNotes: string,
): string {
  const designIntent = extractSection(exporterNotes, "Design Intent").trim();
  const componentSection = extractSection(exporterNotes, "Component Specifications").trim();

  // Fall back to listing design system components when exporter notes don't have a component section
  const componentList =
    componentSection ||
    designSystem.components
      .map(
        (c) =>
          `- ${c.name}${c.variants && c.variants.length > 0 ? ` (variants: ${c.variants.join(", ")})` : ""}`,
      )
      .join("\n");

  const contextContent =
    designIntent ||
    "Refer to `design-intent.md` in this bundle for the full design intent and rationale.";

  return [
    `# Design Handoff — ${designSystem.name}`,
    ``,
    `## Context`,
    contextContent,
    ``,
    `## Design System`,
    `This project uses a custom design system defined in \`design-system.json\`.`,
    `Key tokens: primary color (${designSystem.colors.primary}), font family (${designSystem.typography.fontFamily.heading}), spacing base (${designSystem.spacing.md}).`,
    ``,
    `## Components to Implement`,
    componentList || "_No components specified._",
    ``,
    `## Instructions`,
    `Implement this design as production code, following the design system tokens`,
    `and component specifications in this bundle. Refer to design-intent.md for`,
    `the reasoning behind design decisions.`,
  ].join("\n");
}

// ─── packageHandoffBundle ────────────────────────────────────────────────────

/**
 * Main bundler function.
 *
 * Creates the complete handoff directory structure and returns the absolute
 * path to the handoff directory so the caller can surface it to the user.
 *
 * Directory layout created:
 *   finalPath/handoff/
 *   finalPath/handoff/design/        ← design files (HTML/CSS/JS), no sensitive files
 *   finalPath/handoff/design-system.json
 *   finalPath/handoff/design-intent.md
 *   finalPath/handoff/component-specs.md
 *   finalPath/handoff/interaction-specs.md
 *   finalPath/handoff/accessibility-notes.md
 *   finalPath/handoff/handoff-prompt.md
 */
export async function packageHandoffBundle(opts: PackageHandoffOptions): Promise<string> {
  const { designDir, finalPath, designSystem, exporterNotes } = opts;

  // Step a: Create finalPath/handoff/ directory
  const handoffDir = path.join(finalPath, HANDOFF_DIR_NAME);
  await mkdir(handoffDir, { recursive: true });

  // Step b: Create finalPath/handoff/design/ subdirectory
  const designSubDir = path.join(handoffDir, "design");
  await mkdir(designSubDir, { recursive: true });

  // Step c: Recursively copy design files (HTML/CSS/JS + nested assets/) from
  //         designDir to handoff/design/, filtering out sensitive files.
  //         Uses copyDesignFiles from export.ts which handles subdirectories.
  await copyDesignFiles(designDir, designSubDir);

  // Step d: Write design-system.json — serialize designSystem as formatted JSON
  await Bun.write(
    path.join(handoffDir, "design-system.json"),
    JSON.stringify(designSystem, null, 2),
  );

  // Step e: Write design-intent.md — extract design intent from exporterNotes
  const designIntent = extractSection(exporterNotes, "Design Intent");
  await Bun.write(
    path.join(handoffDir, "design-intent.md"),
    designIntent ||
      "# Design Intent\n\n_No design intent was provided by the exporter stage._\n",
  );

  // Step f: Write component-specs.md — extract component specifications
  const componentSpecs = extractSection(exporterNotes, "Component Specifications");
  await Bun.write(
    path.join(handoffDir, "component-specs.md"),
    componentSpecs ||
      "# Component Specifications\n\n_No component specifications were provided by the exporter stage._\n",
  );

  // Step g: Write interaction-specs.md — extract interaction specs
  const interactionSpecs = extractSection(exporterNotes, "Interaction Specifications");
  await Bun.write(
    path.join(handoffDir, "interaction-specs.md"),
    interactionSpecs ||
      "# Interaction Specifications\n\n_No interaction specifications were provided by the exporter stage._\n",
  );

  // Step h: Write accessibility-notes.md — extract accessibility notes
  const accessibilityNotes = extractSection(exporterNotes, "Accessibility Notes");
  await Bun.write(
    path.join(handoffDir, "accessibility-notes.md"),
    accessibilityNotes ||
      "# Accessibility Notes\n\n_No accessibility notes were provided by the exporter stage._\n",
  );

  // Step i: Write handoff-prompt.md — generate the self-contained prompt
  const handoffPrompt = generateHandoffPrompt(designSystem, exporterNotes);
  await Bun.write(path.join(handoffDir, "handoff-prompt.md"), handoffPrompt);

  return handoffDir;
}
