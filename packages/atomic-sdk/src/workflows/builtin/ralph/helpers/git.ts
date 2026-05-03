/**
 * Deterministic changeset probes used by the Ralph loop.
 *
 * The reviewer and debugger sub-agents both benefit from knowing exactly which
 * files were touched by the current work. We compute a diff relative to the
 * parent branch (auto-discovered, defaulting to main) so the changeset
 * includes BOTH committed and uncommitted changes — not just the working tree.
 *
 * Git command failures are captured — not swallowed — so downstream agents
 * can distinguish "nothing changed" from "git broke" and course-correct.
 */

// ─── Internals ──────────────────────────────────────────────────────────────

/** Result of running a single git command. */
interface GitResult {
  /** Trimmed stdout on success, "" on failure. */
  stdout: string;
  /** True when the command exited with code 0. */
  ok: boolean;
  /** Human-readable error context when ok is false. */
  error?: string;
}

/**
 * Run a git command and return both the output and error context.
 *
 * Never throws — call-site code can check `.ok` and propagate `.error`
 * to downstream agents instead of silently producing empty strings.
 */
async function git(
  args: string[],
  cwd: string = process.cwd(),
): Promise<GitResult> {
  try {
    const proc = Bun.spawn({
      cmd: ["git", ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code !== 0) {
      return {
        stdout: "",
        ok: false,
        error: `\`git ${args.join(" ")}\` exited with code ${code}${stderr.trim() ? ": " + stderr.trim() : ""}`,
      };
    }
    return { stdout: stdout.trim(), ok: true };
  } catch (err) {
    return {
      stdout: "",
      ok: false,
      error: `\`git ${args.join(" ")}\` failed to spawn: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Branch discovery ───────────────────────────────────────────────────────

/** Well-known default branch names, tried in order. */
const DEFAULT_BRANCH_CANDIDATES = ["main", "master", "develop"] as const;

/**
 * Discover the parent (base) branch for the current HEAD.
 *
 * Strategy:
 * 1. Find the merge-base between HEAD and each default-branch candidate.
 *    The candidate whose merge-base is closest to HEAD (fewest commits away)
 *    is the winner.
 * 2. If no candidate exists locally, fall back to "main".
 *
 * This handles the common case of feature branches off main/master without
 * requiring configuration.
 */
export async function discoverBaseBranch(
  cwd: string = process.cwd(),
): Promise<string> {
  const branchResult = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const currentBranch = branchResult.stdout;

  let bestCandidate = "main";
  let bestDistance = Infinity;

  for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
    // Skip if we ARE the candidate (reviewing main against itself is useless)
    if (currentBranch === candidate) continue;

    // Check the ref exists
    const refExists = await git(["rev-parse", "--verify", `refs/heads/${candidate}`], cwd);
    if (!refExists.ok) continue;

    const mergeBase = await git(["merge-base", "HEAD", candidate], cwd);
    if (!mergeBase.ok) continue;

    // Count commits from merge-base to HEAD — fewer = closer = better match
    const countResult = await git(["rev-list", "--count", `${mergeBase.stdout}..HEAD`], cwd);
    const distance = parseInt(countResult.stdout, 10);
    if (!Number.isNaN(distance) && distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

// ─── Changeset capture ──────────────────────────────────────────────────────

/** The result of capturing the full changeset for a review. */
export interface BranchChangeset {
  /** The base branch the diff is relative to (e.g. "main") */
  baseBranch: string;
  /**
   * `git diff --stat` output showing files changed, insertions, deletions
   * relative to the merge-base with the parent branch. Includes both
   * committed AND uncommitted changes.
   */
  diffStat: string;
  /**
   * Short list of uncommitted working-tree changes (`git status -s`).
   * Useful for the reviewer to distinguish "already committed" from
   * "still in-flight".
   */
  uncommitted: string;
  /**
   * `git diff --name-status` output listing each changed file with its
   * status (A=added, M=modified, D=deleted, R=renamed).
   */
  nameStatus: string;
  /**
   * Human-readable error messages for any git commands that failed during
   * changeset capture. Empty when everything succeeded. Downstream prompts
   * surface these so the reviewing agent can course-correct (e.g. run the
   * git commands itself, or flag the gap as a finding).
   */
  errors: string[];
}

/**
 * Capture the full changeset for the current branch relative to its parent.
 *
 * Combines:
 * - `git diff <merge-base>..HEAD --stat` (committed changes)
 * - `git diff --stat` (uncommitted staged+unstaged changes)
 * - `git status -s` (working tree snapshot)
 *
 * Into a single {@link BranchChangeset} that gives the reviewer complete
 * visibility into everything this branch has done.
 *
 * Git failures are collected in {@link BranchChangeset.errors} rather than
 * swallowed, so downstream agents see exactly what broke and can compensate.
 */
export async function captureBranchChangeset(
  cwd: string = process.cwd(),
): Promise<BranchChangeset> {
  const errors: string[] = [];

  const baseBranch = await discoverBaseBranch(cwd);
  const mergeBaseResult = await git(["merge-base", "HEAD", baseBranch], cwd);

  if (!mergeBaseResult.ok && mergeBaseResult.error) {
    errors.push(mergeBaseResult.error);
  }

  // Compute the merge-base ref, falling back to baseBranch if merge-base fails
  const baseRef = mergeBaseResult.stdout || baseBranch;

  // Full diff stat: committed changes from branch point through HEAD,
  // plus any uncommitted working-tree changes (the combined diff captures
  // the complete picture)
  const diffStatResult = await git(["diff", `${baseRef}...HEAD`, "--stat"], cwd);
  const uncommittedStatResult = await git(["diff", "--stat"], cwd);
  const uncommittedResult = await git(["status", "-s"], cwd);
  const nameStatusResult = await git(["diff", `${baseRef}...HEAD`, "--name-status"], cwd);

  // Collect errors from each command
  if (!diffStatResult.ok && diffStatResult.error) errors.push(diffStatResult.error);
  if (!uncommittedStatResult.ok && uncommittedStatResult.error) errors.push(uncommittedStatResult.error);
  if (!uncommittedResult.ok && uncommittedResult.error) errors.push(uncommittedResult.error);
  if (!nameStatusResult.ok && nameStatusResult.error) errors.push(nameStatusResult.error);

  // Merge committed + uncommitted stats for a complete picture
  const combinedStat = [diffStatResult.stdout, uncommittedStatResult.stdout]
    .filter(Boolean)
    .join("\n");

  return {
    baseBranch,
    diffStat: combinedStat,
    uncommitted: uncommittedResult.stdout,
    nameStatus: nameStatusResult.stdout,
    errors,
  };
}

