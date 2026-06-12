export type ReleaseKind = "release" | "prerelease";
export type ReleaseStatus = "completed" | "blocked" | "failed";

export type ValidatedRelease = {
  readonly kind: ReleaseKind;
  readonly version: string;
  readonly branch: string;
};

export type PublishReleaseOutput = {
  readonly status: ReleaseStatus;
  readonly target_version: string;
  readonly release_kind: ReleaseKind;
  readonly branch: string;
  readonly pr_url?: string;
  readonly tag?: string;
  readonly summary: string;
};

export const releaseVersionPattern = /^\d+\.\d+\.\d+$/;
export const prereleaseVersionPattern = /^\d+\.\d+\.\d+-alpha\.[1-9]\d*$/;

const statusMarkerPattern = /^([A-Z][A-Z_]*_STATUS): [a-z][a-z0-9_-]*$/u;

export function validateReleaseRequest(kind: ReleaseKind, version: string): ValidatedRelease {
  if (version.startsWith("v")) {
    throw new Error(`target_version must not include a leading "v"; received ${version}`);
  }

  const matches = kind === "release" ? releaseVersionPattern.test(version) : prereleaseVersionPattern.test(version);

  if (!matches) {
    const expected = kind === "release" ? "MAJOR.MINOR.PATCH" : "MAJOR.MINOR.PATCH-alpha.REVISION";
    throw new Error(`target_version ${JSON.stringify(version)} is not valid for ${kind}; expected ${expected}`);
  }

  return {
    kind,
    version,
    branch: `${kind}/${version}`,
  };
}

export function cleanUrl(url: string): string {
  return url.replace(/[),.;]+$/u, "");
}

function urlsIn(text: string): readonly string[] {
  return (text.match(/https?:\/\/\S+/gu) ?? []).map(cleanUrl);
}

function firstUrl(text: string): string | undefined {
  return urlsIn(text)[0];
}

export function firstPrUrl(text: string): string | undefined {
  return urlsIn(text).find((url) => url.includes("/pull/")) ?? firstUrl(text);
}

export function firstActionsUrl(text: string): string | undefined {
  return urlsIn(text).find((url) => url.includes("/actions/runs/")) ?? firstUrl(text);
}

export function firstNonEmptyLine(text: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

export function hasLeadingStatus(text: string, successMarker: string): boolean {
  return firstNonEmptyLine(text) === successMarker;
}

export function hasStatusMarker(text: string, successMarker: string): boolean {
  const expected = statusMarkerPattern.exec(successMarker);
  if (expected === null) return false;

  const statusKey = expected[1];
  let lastStatusForKey: string | undefined;

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const marker = statusMarkerPattern.exec(trimmed);
    if (marker !== null && marker[1] === statusKey) {
      lastStatusForKey = trimmed;
    }
  }

  return lastStatusForKey === successMarker;
}
