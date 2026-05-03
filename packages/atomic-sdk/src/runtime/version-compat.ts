/**
 * Tiny semver comparator used to check a workflow's declared
 * `minSDKVersion` against the bundled CLI {@link VERSION}.
 *
 * Accepts the subset of semver we actually ship: `MAJOR.MINOR.PATCH`
 * with an optional numeric prerelease (e.g. `0.5.21`, `0.5.21-0`).
 * Anything more exotic (build metadata, alpha tags) is treated as a
 * plain string and compared lexicographically on the prerelease tail,
 * which is good enough for "is the installed CLI new enough?".
 *
 * Isolated from the `semver` npm package so the workflow loader stays
 * dependency-free — this check runs for every discovered workflow on
 * every CLI launch.
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

function parseVersion(v: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

/**
 * Return a negative number if `a < b`, positive if `a > b`, 0 if equal.
 * Unparseable inputs compare as equal so we never block a workflow over
 * a typo in its `minSDKVersion` — the visible load error is friendlier
 * than a hard refusal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  // Per semver, a version without a prerelease outranks one with a
  // prerelease at the same MAJOR.MINOR.PATCH (1.0.0 > 1.0.0-0).
  if (pa.prerelease === "" && pb.prerelease !== "") return 1;
  if (pa.prerelease !== "" && pb.prerelease === "") return -1;
  if (pa.prerelease === pb.prerelease) return 0;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * True when the current CLI is new enough to run a workflow that
 * declared `minRequired`. A null/undefined requirement always
 * satisfies — workflows that don't opt in are treated as compatible.
 */
export function satisfiesMinVersion(
  current: string,
  minRequired: string | null | undefined,
): boolean {
  if (!minRequired) return true;
  return compareVersions(current, minRequired) >= 0;
}
