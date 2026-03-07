import { describe, expect, test } from "bun:test";
import {
  createLoadedSkillTrackingSet,
  normalizeSkillTrackingKey,
  normalizeSessionTrackingKey,
  shouldResetLoadedSkillsForSessionChange,
  tryTrackLoadedSkill,
} from "@/lib/ui/skill-load-tracking.ts";

describe("skill-load-tracking", () => {
  test("normalizes skill names for case-insensitive tracking", () => {
    expect(normalizeSkillTrackingKey(" Prompt-Engineer ")).toBe("prompt-engineer");
  });

  test("seeds loaded skill set from existing messages", () => {
    const loaded = createLoadedSkillTrackingSet([
      {
        skillLoads: [
          { skillName: "prompt-engineer" },
          { skillName: "  Explain-Code  " },
        ],
      },
      {
        skillLoads: [{ skillName: "prompt-engineer" }],
      },
    ]);

    expect(loaded.has("prompt-engineer")).toBe(true);
    expect(loaded.has("explain-code")).toBe(true);
    expect(loaded.size).toBe(2);
  });

  test("seeds loaded skill set from reconstructed skill-load parts", () => {
    const loaded = createLoadedSkillTrackingSet([
      {
        parts: [
          {
            type: "skill-load",
            skills: [{ skillName: "Prompt-Engineer" }],
          },
        ],
      },
    ]);

    expect(loaded.has("prompt-engineer")).toBe(true);
    expect(loaded.size).toBe(1);
  });

  test("tracks each skill only once", () => {
    const loaded = new Set<string>();

    expect(tryTrackLoadedSkill(loaded, "prompt-engineer")).toBe(true);
    expect(tryTrackLoadedSkill(loaded, " Prompt-Engineer ")).toBe(false);
    expect(tryTrackLoadedSkill(loaded, "")).toBe(false);
    expect(loaded.size).toBe(1);
  });

  test("normalizes session tracking keys", () => {
    expect(normalizeSessionTrackingKey(" session-1 ")).toBe("session-1");
    expect(normalizeSessionTrackingKey(" ")).toBeNull();
    expect(normalizeSessionTrackingKey(undefined)).toBeNull();
  });

  test("resets skill tracking only when session actually changes", () => {
    expect(shouldResetLoadedSkillsForSessionChange(null, "session-1")).toBe(false);
    expect(shouldResetLoadedSkillsForSessionChange("session-1", " session-1 ")).toBe(false);
    expect(shouldResetLoadedSkillsForSessionChange("session-1", "session-2")).toBe(true);
    expect(shouldResetLoadedSkillsForSessionChange("session-1", null)).toBe(false);
  });
});
