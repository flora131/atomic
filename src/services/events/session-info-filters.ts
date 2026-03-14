/**
 * Determines whether a trimmed string is likely a bare filesystem path.
 *
 * Used to suppress file-path info messages from agent SDKs that are
 * operational metadata rather than user-facing content.
 *
 * Covers:
 * - Windows absolute paths: C:\dev\file.ts
 * - POSIX absolute paths: /home/user/file.ts
 * - Home-relative paths: ~/project/file.ts
 * - Relative paths with directory separators: ./file.ts, ../dir/file.ts
 */
export function isLikelyFilePath(value: string): boolean {
  if (value.length === 0) return false;
  // Must not contain spaces (bare paths only, not sentences)
  if (value.includes(" ")) return false;
  // Windows absolute path (e.g., C:\dev\file.ts)
  if (/^[A-Za-z]:\\/.test(value)) return true;
  // POSIX absolute path (e.g., /tmp, /home/user/file.ts)
  if (value.startsWith("/") && value.length > 1) return true;
  // Home-relative path
  if (value.startsWith("~/")) return true;
  // Dot-relative path
  if (/^\.{1,2}[\\/]/.test(value)) return true;
  return false;
}
