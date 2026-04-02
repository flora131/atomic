/**
 * E2E tests for SkillLoadIndicator component.
 *
 * Validates all visual states (loading, loaded, error) by rendering the
 * component inside a ThemeProvider and asserting on the captured character
 * frame output.
 */

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import {
  SkillLoadIndicator,
  getSkillStatusColorKey,
  getSkillStatusIcon,
  getSkillStatusMessage,
  shouldShowSkillLoad,
  type SkillLoadStatus,
} from "@/components/skill-load-indicator.tsx";

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

const TEST_WIDTH = 60;
const TEST_HEIGHT = 10;

let destroyRenderer: (() => void) | undefined;

async function renderIndicator(props: {
  skillName: string;
  status: SkillLoadStatus;
  errorMessage?: string;
}) {
  const { renderer, renderOnce, captureCharFrame } = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <SkillLoadIndicator {...props} />
    </ThemeProvider>,
    { width: TEST_WIDTH, height: TEST_HEIGHT },
  );

  destroyRenderer = () => renderer.destroy();

  await renderOnce();
  return captureCharFrame();
}

afterEach(() => {
  destroyRenderer?.();
  destroyRenderer = undefined;
});

// ---------------------------------------------------------------------------
// Component rendering tests
// ---------------------------------------------------------------------------

describe("SkillLoadIndicator E2E", () => {
  test("renders loading state with skill name and loading message", async () => {
    const frame = await renderIndicator({
      skillName: "my-skill",
      status: "loading",
    });

    expect(frame).toContain("Skill(my-skill)");
    expect(frame).toContain("Loading skill...");
  });

  test("renders loaded state with success message", async () => {
    const frame = await renderIndicator({
      skillName: "my-skill",
      status: "loaded",
    });

    expect(frame).toContain("Skill(my-skill)");
    expect(frame).toContain("Successfully loaded skill");
  });

  test("renders error state with provided error message", async () => {
    const frame = await renderIndicator({
      skillName: "my-skill",
      status: "error",
      errorMessage: "not found",
    });

    expect(frame).toContain("Skill(my-skill)");
    expect(frame).toContain("Failed to load skill: not found");
  });

  test("displays skill name in Skill(name) header format", async () => {
    const frame = await renderIndicator({
      skillName: "custom-lint-rule",
      status: "loaded",
    });

    expect(frame).toContain("Skill(custom-lint-rule)");
  });

  test("renders error state with 'unknown error' when no errorMessage provided", async () => {
    const frame = await renderIndicator({
      skillName: "my-skill",
      status: "error",
    });

    expect(frame).toContain("Failed to load skill: unknown error");
  });

  test("renders the tree connector symbol in the status line", async () => {
    const frame = await renderIndicator({
      skillName: "my-skill",
      status: "loaded",
    });

    expect(frame).toContain("└");
  });
});

// ---------------------------------------------------------------------------
// Helper function unit tests
// ---------------------------------------------------------------------------

describe("getSkillStatusColorKey", () => {
  test("returns 'accent' for loading status", () => {
    expect(getSkillStatusColorKey("loading")).toBe("accent");
  });

  test("returns 'success' for loaded status", () => {
    expect(getSkillStatusColorKey("loaded")).toBe("success");
  });

  test("returns 'error' for error status", () => {
    expect(getSkillStatusColorKey("error")).toBe("error");
  });
});

describe("getSkillStatusIcon", () => {
  test("returns active icon for loading status", () => {
    const icon = getSkillStatusIcon("loading");
    expect(icon).toBe("●");
  });

  test("returns active icon for loaded status", () => {
    const icon = getSkillStatusIcon("loaded");
    expect(icon).toBe("●");
  });

  test("returns error icon for error status", () => {
    const icon = getSkillStatusIcon("error");
    expect(icon).toBe("✗");
  });
});

describe("getSkillStatusMessage", () => {
  test("returns loading message", () => {
    expect(getSkillStatusMessage("loading")).toBe("Loading skill...");
  });

  test("returns success message for loaded status", () => {
    expect(getSkillStatusMessage("loaded")).toBe("Successfully loaded skill");
  });

  test("returns error message with provided detail", () => {
    expect(getSkillStatusMessage("error", "timeout")).toBe(
      "Failed to load skill: timeout",
    );
  });

  test("returns error message with 'unknown error' when no detail", () => {
    expect(getSkillStatusMessage("error")).toBe(
      "Failed to load skill: unknown error",
    );
  });
});

describe("shouldShowSkillLoad", () => {
  test("returns false when skillName is undefined", () => {
    expect(shouldShowSkillLoad(undefined, undefined, new Set())).toBe(false);
  });

  test("returns false when skillName is empty string", () => {
    expect(shouldShowSkillLoad("", undefined, new Set())).toBe(false);
  });

  test("returns true when there is an error message", () => {
    expect(
      shouldShowSkillLoad("my-skill", "failed", new Set(["my-skill"])),
    ).toBe(true);
  });

  test("returns true when skill is not in loadedSkills set", () => {
    expect(shouldShowSkillLoad("my-skill", undefined, new Set())).toBe(true);
  });

  test("returns false when skill is already in loadedSkills set", () => {
    expect(
      shouldShowSkillLoad("my-skill", undefined, new Set(["my-skill"])),
    ).toBe(false);
  });
});
