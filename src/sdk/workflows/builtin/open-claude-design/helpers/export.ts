/**
 * Export helpers for the open-claude-design workflow.
 *
 * Provides utilities for creating timestamped output directories,
 * filtering sensitive files, and copying design artifacts safely.
 */

import path from "node:path";
import { mkdir, readdir, stat } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DESIGN_OUTPUT_BASE = ".open-claude-design";
export const OUTPUT_PREFIX = "output";
export const EXPORT_PREFIX = "export";

/** File patterns that should never be included in exports */
const SENSITIVE_PATTERNS = [
  ".env",
  ".env.local",
  ".env.production",
  "credentials",
  "secret",
  ".key",
  ".pem",
  ".p12",
  "id_rsa",
  "id_ed25519",
];

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Returns current timestamp in `YYYY-MM-DDTHH-mm-ss` format.
 * No colons or periods — filesystem-safe.
 */
export function getTimestamp(): string {
  return new Date()
    .toISOString()
    .slice(0, 19) // "YYYY-MM-DDTHH:mm:ss"
    .replace(/:/g, "-"); // "YYYY-MM-DDTHH-mm-ss"
}

/**
 * Returns the timestamped output directory path (does NOT create it).
 * Result: `<root>/.open-claude-design/output-<timestamp>`
 */
export function getTimestampedOutputDir(root: string): string {
  return path.join(root, DESIGN_OUTPUT_BASE, `${OUTPUT_PREFIX}-${getTimestamp()}`);
}

/**
 * Returns the timestamped export directory path (does NOT create it).
 * Result: `<root>/.open-claude-design/export-<timestamp>`
 */
export function getTimestampedExportDir(root: string): string {
  return path.join(root, DESIGN_OUTPUT_BASE, `${EXPORT_PREFIX}-${getTimestamp()}`);
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/**
 * Create a directory recursively if it doesn't exist.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// Sensitive file filtering
// ---------------------------------------------------------------------------

/**
 * Check if a file path matches any sensitive pattern.
 * Case-insensitive check against the basename.
 */
export function isSensitiveFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return SENSITIVE_PATTERNS.some((pattern) => base.includes(pattern.toLowerCase()));
}

/**
 * Filter out files matching sensitive patterns.
 */
export function filterSensitiveFiles(files: string[]): string[] {
  return files.filter((f) => !isSensitiveFile(f));
}

// ---------------------------------------------------------------------------
// File copy helpers
// ---------------------------------------------------------------------------

/**
 * Copy all non-sensitive files from sourceDir to targetDir recursively.
 * Returns list of copied file paths (absolute target paths).
 * Handles nested directories recursively.
 * Returns empty array for non-existent or empty source directories.
 */
export async function copyDesignFiles(
  sourceDir: string,
  targetDir: string,
): Promise<string[]> {
  // Handle non-existent source directory gracefully
  try {
    const sourceStat = await stat(sourceDir);
    if (!sourceStat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const copied: string[] = [];

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectory
      await ensureDir(targetPath);
      const subCopied = await copyDesignFiles(sourcePath, targetPath);
      copied.push(...subCopied);
    } else if (entry.isFile()) {
      // Skip sensitive files
      if (isSensitiveFile(entry.name)) {
        continue;
      }
      // Copy using Bun.write for efficiency
      await Bun.write(targetPath, Bun.file(sourcePath));
      copied.push(targetPath);
    }
  }

  return copied;
}

// ---------------------------------------------------------------------------
// Composite helpers
// ---------------------------------------------------------------------------

/**
 * Create both the timestamped output and export directories using the SAME
 * timestamp and return their paths.
 */
export async function ensureOutputDirs(
  root: string,
): Promise<{ outputDir: string; exportDir: string }> {
  // Use a single timestamp so both dirs share the same identifier
  const ts = getTimestamp();
  const outputDir = path.join(root, DESIGN_OUTPUT_BASE, `${OUTPUT_PREFIX}-${ts}`);
  const exportDir = path.join(root, DESIGN_OUTPUT_BASE, `${EXPORT_PREFIX}-${ts}`);

  await ensureDir(outputDir);
  await ensureDir(exportDir);

  return { outputDir, exportDir };
}
