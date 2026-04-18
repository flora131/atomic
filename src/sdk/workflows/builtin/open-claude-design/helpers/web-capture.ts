/**
 * Web capture / reference classification helper for the open-claude-design workflow.
 *
 * Provides pure utility functions (no side effects, no file I/O) for:
 *   1. Detecting whether a reference string is a URL.
 *   2. Detecting whether a reference string looks like a file path.
 *   3. Classifying an arbitrary reference string into one of four categories.
 *   4. Returning standard viewport sizes for screenshot validation.
 */

/** The type of a user-provided design reference. */
export type ReferenceType = "url" | "file" | "codebase" | "none";

/**
 * Returns true if `ref` is an HTTP or HTTPS URL.
 * Handles `http://`, `https://` (case-insensitive) and bare `www.` prefixes.
 */
export function isUrl(ref: string): boolean {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^www\./i.test(trimmed)) return true;
  return false;
}

/** File extensions that indicate a file path rather than a codebase path. */
const FILE_EXTENSIONS = new Set<string>([
  "html", "css", "png", "jpg", "jpeg", "gif", "svg", "webp",
  "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt",
  "txt", "md", "zip", "tar", "gz",
]);

/**
 * Returns true if `ref` looks like a concrete file path (not a directory):
 *   - Has a recognized file extension (e.g., .html, .png, .pdf) regardless of prefix
 *   - Starts with `./`, `../`, or `~/` AND has a recognized file extension
 *   - Starts with `/` AND has a recognized file extension
 *
 * Absolute or relative paths WITHOUT a recognized file extension are treated as
 * codebase/directory references (returned as false), so they route to the
 * codebase-scanner agent instead of the file-parser agent.
 *
 * Does NOT return true for URLs.
 */
export function isFilePath(ref: string): boolean {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return false;
  // A URL is never a file path.
  if (isUrl(trimmed)) return false;

  // Check for a recognized file extension.
  const hasFileExtension = (() => {
    const dot = trimmed.lastIndexOf(".");
    if (dot > 0 && dot < trimmed.length - 1) {
      const ext = trimmed.slice(dot + 1).toLowerCase();
      return FILE_EXTENSIONS.has(ext);
    }
    return false;
  })();

  // Paths with a recognized file extension are always file paths.
  if (hasFileExtension) return true;

  // Paths with explicit prefixes but NO recognized file extension are
  // treated as directory/codebase references, not files.
  return false;
}

/**
 * Classify a reference string into one of four categories:
 *   - `"none"`     — empty or whitespace-only
 *   - `"url"`      — an HTTP/HTTPS URL or www. address
 *   - `"file"`     — a file path (absolute, relative, home, or by extension)
 *   - `"codebase"` — everything else (assumed to be a path within the codebase)
 */
export function classifyReference(ref: string): ReferenceType {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return "none";
  if (isUrl(trimmed)) return "url";
  if (isFilePath(trimmed)) return "file";
  return "codebase";
}

/** A named viewport size used for screenshot / design validation. */
export type ViewportSize = {
  name: string;
  width: number;
  height: number;
};

/**
 * Returns the standard set of viewport sizes used for screenshot validation
 * in the open-claude-design workflow. Each call returns a fresh array.
 */
export function getViewportSizes(): ViewportSize[] {
  return [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];
}
