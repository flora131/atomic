/** Maximum number of lines in tool output before truncation */
const MAX_OUTPUT_LINES = 2000;
/** Maximum byte size of tool output before truncation */
const MAX_OUTPUT_BYTES = 50_000; // 50KB

/**
 * Truncate tool output to prevent oversized results from consuming
 * the LLM's context window. Matches OpenCode's Truncate.output() behavior.
 *
 * When truncation occurs, a notice is appended indicating how much was removed.
 */
export function truncateToolOutput(output: string): string {
  const lines = output.split("\n");

  // Truncate by line count
  if (lines.length > MAX_OUTPUT_LINES) {
    const truncated = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
    return `${truncated}\n\n[truncated: ${lines.length - MAX_OUTPUT_LINES} lines omitted]`;
  }

  // Truncate by byte size
  const byteLength = new TextEncoder().encode(output).length;
  if (byteLength > MAX_OUTPUT_BYTES) {
    // Binary search for the cut point that fits within the byte limit
    let lo = 0;
    let hi = output.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (new TextEncoder().encode(output.slice(0, mid)).length <= MAX_OUTPUT_BYTES) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return `${output.slice(0, lo)}\n\n[truncated: output exceeded ${MAX_OUTPUT_BYTES} bytes]`;
  }

  return output;
}
