/**
 * Minimal POSIX shell-quoting helper.
 *
 * Single-quotes each argument so the result is safe to pass as a single
 * command string to `tmux new-window -e` / `Bun.spawn(["sh", "-c", cmd])`.
 * Embedded single quotes are escaped via the classic `'\''` sequence.
 *
 * Defense-in-depth: argv contents come from controlled adapters whose
 * output is constrained, but quoting is cheap (RFC §9 Q12).
 *
 * @example
 * shellQuote(["claude", "--resume", "id with spaces"]);
 * // → "claude '--resume' 'id with spaces'"
 */
export function shellQuote(argv: readonly string[]): string {
  return argv
    .map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
    .join(" ");
}
