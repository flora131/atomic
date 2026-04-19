import { test, expect, describe } from "bun:test";
import { createCommonIgnoreFilter } from "../../src/lib/common-ignore.ts";

describe("createCommonIgnoreFilter", () => {
  test("ignores common OS, dependency, and lockfile patterns", () => {
    const filter = createCommonIgnoreFilter();
    expect(filter.ignores(".DS_Store")).toBe(true);
    expect(filter.ignores("Thumbs.db")).toBe(true);
    expect(filter.ignores("node_modules/foo")).toBe(true);
    expect(filter.ignores("bun.lock")).toBe(true);
    expect(filter.ignores("build.log")).toBe(true);
  });

  test("does not match unrelated agent config files", () => {
    const filter = createCommonIgnoreFilter();
    expect(filter.ignores("CLAUDE.md")).toBe(false);
    expect(filter.ignores("skills/my-skill/SKILL.md")).toBe(false);
    expect(filter.ignores("settings.json")).toBe(false);
  });
});
