import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  cleanUrl,
  firstActionsUrl,
  firstNonEmptyLine,
  firstPrUrl,
  hasLeadingStatus,
  hasStatusMarker,
  prereleaseVersionPattern,
  releaseVersionPattern,
  validateReleaseRequest,
} from "../../.atomic/workflows/lib/publish-release-helpers.js";

describe("publish-release version validation", () => {
  test("accepts stable release versions only for release requests", () => {
    assert.equal(releaseVersionPattern.test("1.2.3"), true);
    assert.equal(releaseVersionPattern.test("1.2.3-alpha.1"), false);

    assert.deepEqual(validateReleaseRequest("release", "1.2.3"), {
      kind: "release",
      version: "1.2.3",
      branch: "release/1.2.3",
    });
    assert.throws(
      () => validateReleaseRequest("release", "1.2.3-alpha.1"),
      /expected MAJOR\.MINOR\.PATCH/u,
    );
  });

  test("accepts alpha prerelease revisions starting at one only for prerelease requests", () => {
    assert.equal(prereleaseVersionPattern.test("1.2.3-alpha.1"), true);
    assert.equal(prereleaseVersionPattern.test("1.2.3-alpha.0"), false);
    assert.equal(prereleaseVersionPattern.test("1.2.3-beta.1"), false);
    assert.equal(prereleaseVersionPattern.test("1.2.3"), false);

    assert.deepEqual(validateReleaseRequest("prerelease", "1.2.3-alpha.1"), {
      kind: "prerelease",
      version: "1.2.3-alpha.1",
      branch: "prerelease/1.2.3-alpha.1",
    });
    assert.throws(
      () => validateReleaseRequest("prerelease", "1.2.3"),
      /expected MAJOR\.MINOR\.PATCH-alpha\.REVISION/u,
    );
  });

  test("rejects versions with a leading v before applying kind-specific validation", () => {
    assert.throws(
      () => validateReleaseRequest("release", "v1.2.3"),
      /must not include a leading "v"/u,
    );
    assert.throws(
      () => validateReleaseRequest("prerelease", "v1.2.3-alpha.1"),
      /must not include a leading "v"/u,
    );
  });
});

describe("publish-release URL extraction", () => {
  test("strips trailing punctuation from URLs", () => {
    assert.equal(
      cleanUrl("https://github.com/earendil-works/pi-mono/pull/123),.;"),
      "https://github.com/earendil-works/pi-mono/pull/123",
    );
  });

  test("selects the first pull request URL before falling back to the first URL", () => {
    const text = [
      "Issue: https://github.com/earendil-works/pi-mono/issues/99",
      "PR: https://github.com/earendil-works/pi-mono/pull/123.",
      "Later PR: https://github.com/earendil-works/pi-mono/pull/456",
    ].join("\n");

    assert.equal(firstPrUrl(text), "https://github.com/earendil-works/pi-mono/pull/123");
    assert.equal(firstPrUrl("Docs: https://example.com/release-notes;"), "https://example.com/release-notes");
  });

  test("selects the first actions run URL before falling back to the first URL", () => {
    const text = [
      "Workflow: https://github.com/earendil-works/pi-mono/actions/workflows/publish.yml",
      "Run: https://github.com/earendil-works/pi-mono/actions/runs/987654321)",
      "Later run: https://github.com/earendil-works/pi-mono/actions/runs/123456789",
    ].join("\n");

    assert.equal(firstActionsUrl(text), "https://github.com/earendil-works/pi-mono/actions/runs/987654321");
    assert.equal(firstActionsUrl("Docs: https://example.com/actions."), "https://example.com/actions");
  });
});

describe("publish-release status parsing", () => {
  test("finds the first non-empty line while trimming whitespace and handling CRLF", () => {
    assert.equal(firstNonEmptyLine("\r\n  \r\n  CHECK_STATUS: passed  \r\nbody"), "CHECK_STATUS: passed");
    assert.equal(firstNonEmptyLine("\n\n"), "");
  });

  test("keeps exact leading-status behavior available for strict checks", () => {
    assert.equal(hasLeadingStatus("\n  CHECK_STATUS: passed  \nbody", "CHECK_STATUS: passed"), true);
    assert.equal(hasLeadingStatus("Preamble\nCHECK_STATUS: passed", "CHECK_STATUS: passed"), false);
    assert.equal(hasLeadingStatus("CHECK_STATUS: passed with prose", "CHECK_STATUS: passed"), false);
  });

  test("accepts a standalone status marker even when the model adds a preamble", () => {
    const text = [
      "I verified the PR state before reporting success.",
      "MERGE_STATUS: merged",
      "MERGE_STATE: MERGED",
      "MERGE_COMMIT: abc123",
    ].join("\n");

    assert.equal(hasStatusMarker(text, "MERGE_STATUS: merged"), true);
  });

  test("uses the last standalone marker for the same status key", () => {
    assert.equal(
      hasStatusMarker("MERGE_STATUS: merged\nMERGE_STATUS: blocked", "MERGE_STATUS: merged"),
      false,
    );
    assert.equal(
      hasStatusMarker("MERGE_STATUS: blocked\nMERGE_STATUS: merged", "MERGE_STATUS: merged"),
      true,
    );
  });

  test("rejects inline, bulleted, partial, and wrong-key status mentions", () => {
    assert.equal(hasStatusMarker("Result: MERGE_STATUS: merged", "MERGE_STATUS: merged"), false);
    assert.equal(hasStatusMarker("- MERGE_STATUS: merged", "MERGE_STATUS: merged"), false);
    assert.equal(hasStatusMarker("MERGE_STATUS: merged after verification", "MERGE_STATUS: merged"), false);
    assert.equal(hasStatusMarker("PUBLISH_STATUS: merged", "MERGE_STATUS: merged"), false);
  });
});
