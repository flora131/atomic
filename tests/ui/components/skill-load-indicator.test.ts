/**
 * Tests for SkillLoadIndicator Component
 *
 * Tests cover:
 * - Component exports and types
 * - Status type values
 */

import { describe, test, expect } from "bun:test";
import {
  SkillLoadIndicator,
  type SkillLoadIndicatorProps,
  type SkillLoadStatus,
} from "../../../src/ui/components/skill-load-indicator.tsx";

// ============================================================================
// EXPORTS TESTS
// ============================================================================

describe("SkillLoadIndicator", () => {
  test("component is exported as a function", () => {
    expect(typeof SkillLoadIndicator).toBe("function");
  });

  test("SkillLoadStatus type accepts valid values", () => {
    const loading: SkillLoadStatus = "loading";
    const loaded: SkillLoadStatus = "loaded";
    const error: SkillLoadStatus = "error";
    expect(loading).toBe("loading");
    expect(loaded).toBe("loaded");
    expect(error).toBe("error");
  });

  test("SkillLoadIndicatorProps accepts required props", () => {
    const props: SkillLoadIndicatorProps = {
      skillName: "commit",
      status: "loaded",
    };
    expect(props.skillName).toBe("commit");
    expect(props.status).toBe("loaded");
  });

  test("SkillLoadIndicatorProps accepts optional errorMessage", () => {
    const props: SkillLoadIndicatorProps = {
      skillName: "commit",
      status: "error",
      errorMessage: "File not found",
    };
    expect(props.errorMessage).toBe("File not found");
  });
});
