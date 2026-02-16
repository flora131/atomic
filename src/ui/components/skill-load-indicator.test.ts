import { describe, expect, test } from "bun:test";
import {
  getSkillStatusColorKey,
  getSkillStatusIcon,
  getSkillStatusMessage,
  shouldShowSkillLoad,
  type SkillLoadStatus,
} from "./skill-load-indicator.tsx";
import { STATUS } from "../constants/icons.ts";

// ============================================================================
// Status color mapping
// ============================================================================

describe("getSkillStatusColorKey", () => {
  test("returns accent for loading", () => {
    expect(getSkillStatusColorKey("loading")).toBe("accent");
  });

  test("returns success for loaded", () => {
    expect(getSkillStatusColorKey("loaded")).toBe("success");
  });

  test("returns error for error", () => {
    expect(getSkillStatusColorKey("error")).toBe("error");
  });
});

// ============================================================================
// Status icon mapping
// ============================================================================

describe("getSkillStatusIcon", () => {
  test("returns active dot for loading", () => {
    expect(getSkillStatusIcon("loading")).toBe(STATUS.active);
  });

  test("returns active dot for loaded", () => {
    expect(getSkillStatusIcon("loaded")).toBe(STATUS.active);
  });

  test("returns error icon for error", () => {
    expect(getSkillStatusIcon("error")).toBe(STATUS.error);
  });
});

// ============================================================================
// Status message mapping
// ============================================================================

describe("getSkillStatusMessage", () => {
  test("returns loading message", () => {
    expect(getSkillStatusMessage("loading")).toBe("Loading skill...");
  });

  test("returns success message for loaded", () => {
    expect(getSkillStatusMessage("loaded")).toBe("Successfully loaded skill");
  });

  test("includes error message when provided", () => {
    expect(getSkillStatusMessage("error", "file not found")).toBe(
      "Failed to load skill: file not found",
    );
  });

  test("shows unknown error when no error message provided", () => {
    expect(getSkillStatusMessage("error")).toBe(
      "Failed to load skill: unknown error",
    );
  });

  test("shows unknown error when error message is undefined", () => {
    expect(getSkillStatusMessage("error", undefined)).toBe(
      "Failed to load skill: unknown error",
    );
  });
});

// ============================================================================
// Deduplication and error bypass logic (shouldShowSkillLoad)
// ============================================================================

describe("shouldShowSkillLoad", () => {
  test("returns false when skillName is undefined", () => {
    expect(shouldShowSkillLoad(undefined, undefined, new Set())).toBe(false);
  });

  test("returns true for first invocation of a skill", () => {
    expect(shouldShowSkillLoad("gh-commit", undefined, new Set())).toBe(true);
  });

  test("returns false for repeat invocation of an already-loaded skill", () => {
    const loaded = new Set(["gh-commit"]);
    expect(shouldShowSkillLoad("gh-commit", undefined, loaded)).toBe(false);
  });

  test("returns true for error even when skill was already loaded", () => {
    const loaded = new Set(["gh-commit"]);
    expect(
      shouldShowSkillLoad("gh-commit", "permission denied", loaded),
    ).toBe(true);
  });

  test("returns true for error on a skill never loaded before", () => {
    expect(
      shouldShowSkillLoad("gh-commit", "file not found", new Set()),
    ).toBe(true);
  });

  test("allows different skill name when first skill already loaded", () => {
    const loaded = new Set(["gh-commit"]);
    expect(shouldShowSkillLoad("sl-commit", undefined, loaded)).toBe(true);
  });

  test("blocks only the specific skill that was already loaded", () => {
    const loaded = new Set(["gh-commit", "sl-commit"]);
    expect(shouldShowSkillLoad("gh-commit", undefined, loaded)).toBe(false);
    expect(shouldShowSkillLoad("sl-commit", undefined, loaded)).toBe(false);
    expect(shouldShowSkillLoad("gh-create-pr", undefined, loaded)).toBe(true);
  });

  test("returns false when skillName is empty string", () => {
    expect(shouldShowSkillLoad("", undefined, new Set())).toBe(false);
  });
});
