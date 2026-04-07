/**
 * Deterministic working-tree probes used by the Ralph loop.
 *
 * The reviewer and debugger sub-agents both benefit from knowing exactly which
 * files were touched in the current iteration. Asking an LLM to figure that
 * out via tool calls is expensive and lossy, so we capture `git status -s`
 * directly from the workflow runner and inject it into prompts.
 *
 * Failures (no git binary, not a repo, command non-zero) collapse to "" so
 * the prompts can fall back to the "working tree clean" branch.
 */

/**
 * Run `git status -s` from the given cwd. Returns trimmed stdout, or "" on
 * any error. Never throws.
 */
export async function safeGitStatusS(
  cwd: string = process.cwd(),
): Promise<string> {
  try {
    const proc = Bun.spawn({
      cmd: ["git", "status", "-s"],
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return "";
    return stdout;
  } catch {
    return "";
  }
}
