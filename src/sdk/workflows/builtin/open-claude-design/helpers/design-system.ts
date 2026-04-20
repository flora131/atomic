/**
 * Design.md persistence — loading, saving, and reading design system data.
 *
 * The Design.md file is a structured markdown document containing design
 * tokens (colors, typography, spacing, components) extracted from the
 * codebase and approved by the user via HIL. It serves as the single
 * source of truth for all generation and refinement stages.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { DESIGN_SYSTEM_FILENAME, IMPECCABLE_FILENAME } from "./constants.ts";

/** Structured representation of the design system data. */
export interface DesignSystemData {
  /** Raw markdown content of Design.md. */
  raw: string;
  /** Absolute path to the Design.md file. */
  path: string;
}

/**
 * Load an existing Design.md from the given path.
 * Used when the user provides `--design-system=<path>`.
 */
export async function loadDesignSystem(
  designSystemPath: string,
): Promise<DesignSystemData> {
  const resolved = path.resolve(designSystemPath);
  const raw = await readFile(resolved, "utf-8");
  return { raw, path: resolved };
}

/**
 * Persist the design system builder's output as Design.md in the project root.
 *
 * The builder stage produces a visible session where the agent constructs
 * the Design.md content interactively with the user. We read the transcript
 * and extract the final Design.md content that the agent wrote.
 *
 * For simplicity, the agent in the builder stage is instructed to write
 * Design.md directly to disk. This function reads it back to populate
 * the DesignSystemData for downstream stages.
 */
export async function persistDesignSystem(
  root: string,
): Promise<DesignSystemData> {
  const designPath = path.join(root, DESIGN_SYSTEM_FILENAME);
  const raw = await readFile(designPath, "utf-8");
  return { raw, path: designPath };
}

/**
 * Read the existing .impeccable.md brand context file, if present.
 * Returns empty string if the file does not exist.
 */
export async function readImpeccableMd(root: string): Promise<string> {
  try {
    return await readFile(path.join(root, IMPECCABLE_FILENAME), "utf-8");
  } catch {
    return "";
  }
}

/**
 * Derive a URL-safe slug from the user's prompt for directory naming.
 */
export function slugifyPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .substring(0, 60);
  return slug || "design";
}

/**
 * Ensure the scratch directory exists for intermediate workflow outputs.
 */
export async function ensureScratchDir(root: string): Promise<string> {
  const { mkdir } = await import("node:fs/promises");
  const scratchDir = path.join(root, "research", "designs", ".scratch");
  await mkdir(scratchDir, { recursive: true });
  return scratchDir;
}
