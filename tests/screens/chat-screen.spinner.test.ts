import { describe, expect, test } from "bun:test";
import { getSpinnerVerbForCommand } from "@/state/chat/exports.ts";

describe("getSpinnerVerbForCommand", () => {
  test("returns Compacting for /compact", () => {
    expect(getSpinnerVerbForCommand("compact")).toBe("Compacting");
  });

  test("returns undefined for commands without overrides", () => {
    expect(getSpinnerVerbForCommand("help")).toBeUndefined();
    expect(getSpinnerVerbForCommand("clear")).toBeUndefined();
  });
});
