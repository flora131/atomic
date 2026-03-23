/**
 * Inter-Stage Output Truncation
 *
 * Truncates stage `rawResponse` output to a configurable byte limit before
 * it is forwarded to downstream stages. The truncation is byte-aware (UTF-8)
 * and appends a notice so downstream stages know the output was trimmed.
 *
 * The stage's `parseOutput` function always receives the full untruncated
 * response — truncation only affects what is stored in `stageOutputs` for
 * downstream consumption via `StageContext`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Truncation notice template. The placeholder is replaced with the original byte count. */
const TRUNCATION_NOTICE = "\n\n[truncated: output was %ORIGINAL% bytes, limited to %LIMIT% bytes]";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of a truncation attempt. Contains the (possibly truncated) text
 * and whether truncation was actually applied.
 */
export interface TruncationResult {
  /** The output text, truncated if it exceeded `maxBytes`. */
  readonly text: string;
  /** Whether truncation was applied. */
  readonly truncated: boolean;
  /** Original byte length of the input (before truncation). Only set when truncated. */
  readonly originalByteLength?: number;
}

/**
 * Truncate a stage's raw response to fit within `maxBytes` (UTF-8).
 *
 * When the response exceeds the limit, the text is cut at a valid UTF-8
 * character boundary and a truncation notice is appended. The notice
 * itself counts toward the limit, so the actual content may be slightly
 * shorter than `maxBytes`.
 *
 * @param response - The full raw response text from a stage session.
 * @param maxBytes - Maximum byte size. Values ≤ 0 or Infinity disable truncation.
 * @returns A `TruncationResult` indicating what happened.
 */
export function truncateStageOutput(response: string, maxBytes: number): TruncationResult {
  // Disabled: non-positive or Infinity means no limit
  if (maxBytes <= 0 || !Number.isFinite(maxBytes)) {
    return { text: response, truncated: false };
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(response);
  const originalByteLength = encoded.length;

  // Fits within the limit — no truncation needed
  if (originalByteLength <= maxBytes) {
    return { text: response, truncated: false };
  }

  // Build the notice so we can account for its byte size
  const notice = TRUNCATION_NOTICE
    .replace("%ORIGINAL%", String(originalByteLength))
    .replace("%LIMIT%", String(maxBytes));
  const noticeBytes = encoder.encode(notice).length;

  // Content budget is the limit minus the notice
  const contentBudget = Math.max(0, maxBytes - noticeBytes);

  // Find the cut point that fits within the content budget
  // Use binary search to handle multi-byte characters correctly
  const cutPoint = findUtf8CutPoint(response, contentBudget, encoder);

  const truncatedText = response.slice(0, cutPoint) + notice;

  return {
    text: truncatedText,
    truncated: true,
    originalByteLength,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Find the largest character index `i` such that `encode(text.slice(0, i))`
 * fits within `maxBytes`. Uses binary search for efficiency and avoids
 * splitting UTF-16 surrogate pairs.
 */
function findUtf8CutPoint(
  text: string,
  maxBytes: number,
  encoder: TextEncoder,
): number {
  if (maxBytes <= 0) {
    return 0;
  }

  let lo = 0;
  let hi = text.length;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (encoder.encode(text.slice(0, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  // Avoid splitting a surrogate pair: if we landed on a low surrogate,
  // step back to exclude the orphaned high surrogate before it.
  if (lo > 0 && lo < text.length) {
    const code = text.charCodeAt(lo - 1);
    // 0xD800–0xDBFF = high surrogate; if the char at lo-1 is a high surrogate,
    // the matching low surrogate at lo was excluded — back up by one.
    if (code >= 0xd800 && code <= 0xdbff) {
      lo--;
    }
  }

  return lo;
}
