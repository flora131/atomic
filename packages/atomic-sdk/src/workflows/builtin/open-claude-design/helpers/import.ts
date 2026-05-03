/**
 * Import handler — input type detection and aggregation.
 *
 * Classifies the user's `--reference` input as a URL, file path, or
 * neither, and aggregates all import sources into a structured context
 * object that the generator consumes.
 */

/** Aggregated import context passed to the generator stage. */
export interface ImportContext {
  /** The user's free-form design prompt. */
  prompt: string;
  /** Raw reference string (URL, file path, or empty). */
  reference: string;
  /** Extracted content from a web URL capture, or null. */
  webCapture: string | null;
  /** Extracted content from a parsed file, or null. */
  fileParse: string | null;
}

/** Check whether the reference string looks like a URL. */
export function isUrl(reference: string): boolean {
  if (!reference.trim()) return false;
  return /^https?:\/\//i.test(reference.trim());
}

/** Check whether the reference string looks like a file path. */
export function isFilePath(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed) return false;
  if (isUrl(trimmed)) return false;
  // Looks like a path: starts with /, ./, ~/, or contains file extension
  return /^[./~]/.test(trimmed) || /\.\w{1,6}$/.test(trimmed);
}

/**
 * Aggregate all import results into a single context object.
 * Pure deterministic function — no LLM call.
 */
export function aggregateImportResults(opts: {
  prompt: string;
  reference: string;
  webCapture: string | null;
  fileParse: string | null;
}): ImportContext {
  return {
    prompt: opts.prompt,
    reference: opts.reference,
    webCapture: opts.webCapture,
    fileParse: opts.fileParse,
  };
}
