/**
 * Design system persistence helpers for the open-claude-design workflow.
 *
 * Provides types, validation, loading, and persistence of design system
 * data to/from disk in JSON format.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DESIGN_SYSTEM_FILENAME = "design-system.json";
export const DESIGN_OUTPUT_DIR = ".open-claude-design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DesignSystemColors {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  [key: string]: string;
}

export interface DesignSystemTypography {
  fontFamily: { heading: string; body: string };
  scale: { h1: string; h2: string; body: string; small: string; [key: string]: string };
}

export interface DesignSystemSpacing {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  [key: string]: string;
}

export interface DesignSystemComponent {
  name: string;
  variants: string[];
  source?: string;
}

export interface DesignSystemContext {
  version: number;
  name: string;
  colors: DesignSystemColors;
  typography: DesignSystemTypography;
  spacing: DesignSystemSpacing;
  components: DesignSystemComponent[];
  source?: { framework: string; configPath?: string };
}

export interface ImportContext {
  prompt: string;
  reference: string;
  designSystem: DesignSystemContext;
}

// ---------------------------------------------------------------------------
// createDefaultDesignSystem
// ---------------------------------------------------------------------------

/**
 * Returns a sensible default design system with neutral colors, Inter fonts,
 * and a standard spacing scale.
 */
export function createDefaultDesignSystem(name = "Default Design System"): DesignSystemContext {
  return {
    version: 1,
    name,
    colors: {
      primary: "#6366f1",
      secondary: "#8b5cf6",
      background: "#ffffff",
      text: "#1f2937",
    },
    typography: {
      fontFamily: {
        heading: "Inter, sans-serif",
        body: "Inter, sans-serif",
      },
      scale: {
        h1: "2.25rem",
        h2: "1.875rem",
        body: "1rem",
        small: "0.875rem",
      },
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
}

// ---------------------------------------------------------------------------
// validateDesignSystem
// ---------------------------------------------------------------------------

/**
 * Type guard that validates the shape of a design system object.
 *
 * Checks for: version (number), name (string), colors (object with primary,
 * secondary, background, text), typography (object with fontFamily and scale),
 * spacing (object with xs, sm, md, lg, xl), and components (array).
 */
export function validateDesignSystem(ds: unknown): ds is DesignSystemContext {
  if (ds === null || ds === undefined || typeof ds !== "object" || Array.isArray(ds)) {
    return false;
  }

  const obj = ds as Record<string, unknown>;

  // version must be a number
  if (typeof obj.version !== "number") return false;

  // name must be a string
  if (typeof obj.name !== "string") return false;

  // colors must be an object with required string keys
  if (
    obj.colors === null ||
    typeof obj.colors !== "object" ||
    Array.isArray(obj.colors)
  ) return false;

  const colors = obj.colors as Record<string, unknown>;
  if (
    typeof colors.primary !== "string" ||
    typeof colors.secondary !== "string" ||
    typeof colors.background !== "string" ||
    typeof colors.text !== "string"
  ) return false;

  // typography must be an object with fontFamily and scale
  if (
    obj.typography === null ||
    typeof obj.typography !== "object" ||
    Array.isArray(obj.typography)
  ) return false;

  const typography = obj.typography as Record<string, unknown>;
  if (
    typography.fontFamily === null ||
    typeof typography.fontFamily !== "object" ||
    Array.isArray(typography.fontFamily)
  ) return false;

  if (
    typography.scale === null ||
    typeof typography.scale !== "object" ||
    Array.isArray(typography.scale)
  ) return false;

  // spacing must be an object with required keys
  if (
    obj.spacing === null ||
    typeof obj.spacing !== "object" ||
    Array.isArray(obj.spacing)
  ) return false;

  const spacing = obj.spacing as Record<string, unknown>;
  if (
    typeof spacing.xs !== "string" ||
    typeof spacing.sm !== "string" ||
    typeof spacing.md !== "string" ||
    typeof spacing.lg !== "string" ||
    typeof spacing.xl !== "string"
  ) return false;

  // components must be an array
  if (!Array.isArray(obj.components)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// getDesignSystemPath
// ---------------------------------------------------------------------------

/**
 * Returns the canonical path for the design system JSON file under `root`.
 */
export function getDesignSystemPath(root: string): string {
  return path.join(root, DESIGN_OUTPUT_DIR, DESIGN_SYSTEM_FILENAME);
}

// ---------------------------------------------------------------------------
// loadDesignSystem
// ---------------------------------------------------------------------------

/**
 * Read design system JSON from disk. Validates the structure and throws if
 * the file is missing, malformed, or does not match the expected shape.
 */
export async function loadDesignSystem(filePath: string): Promise<DesignSystemContext> {
  const raw = await Bun.file(filePath).text();
  const parsed: unknown = JSON.parse(raw);

  if (!validateDesignSystem(parsed)) {
    throw new Error(
      `Invalid design system at ${filePath}: structure does not match DesignSystemContext`,
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// persistDesignSystem
// ---------------------------------------------------------------------------

/**
 * Parse a builder agent's text output to extract a JSON block, validate it,
 * write to `designSystemPath` as formatted JSON, and return the persisted
 * design system.
 *
 * JSON extraction order:
 *  1. Look for ```json...``` fenced blocks
 *  2. Fall back to raw JSON object detection
 *  3. If all parsing fails, write a default design system instead
 */
export async function persistDesignSystem(
  builderOutput: string,
  designSystemPath: string,
): Promise<DesignSystemContext> {
  const ds = extractDesignSystem(builderOutput);

  // Ensure parent directory exists
  await mkdir(path.dirname(designSystemPath), { recursive: true });

  // Write the design system as formatted JSON
  await Bun.write(designSystemPath, JSON.stringify(ds, null, 2));

  return ds;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to extract and validate a DesignSystemContext from builder output.
 * Falls back to a default design system if nothing valid is found.
 */
function extractDesignSystem(builderOutput: string): DesignSystemContext {
  // 1. Try to find a ```json...``` fenced block
  const fenceMatch = builderOutput.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const candidate = tryParseAndValidate(fenceMatch[1]!.trim());
    if (candidate !== null) return candidate;
  }

  // 2. Try to find a raw JSON object in the text (outermost { ... })
  const rawMatch = builderOutput.match(/\{[\s\S]*\}/);
  if (rawMatch) {
    const candidate = tryParseAndValidate(rawMatch[0]);
    if (candidate !== null) return candidate;
  }

  // 3. Fall back to default
  return createDefaultDesignSystem();
}

/**
 * Attempt to JSON.parse a string and validate it as a DesignSystemContext.
 * Returns the parsed object if valid, otherwise null.
 */
function tryParseAndValidate(text: string): DesignSystemContext | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (validateDesignSystem(parsed)) return parsed;
  } catch {
    // ignore parse errors
  }
  return null;
}
