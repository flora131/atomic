import { describe, expect, test } from "bun:test";
import { getSpinnerVerbForCommand } from "./chat.tsx";

describe("getSpinnerVerbForCommand", () => {
  test("returns Compacting for /compact", () => {
    expect(getSpinnerVerbForCommand("compact")).toBe("Compacting");
  });

  test("returns undefined for commands without overrides", () => {
    expect(getSpinnerVerbForCommand("help")).toBeUndefined();
    expect(getSpinnerVerbForCommand("clear")).toBeUndefined();
  });
});
