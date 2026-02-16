import { describe, expect, test } from "bun:test";
import { getStatusIndicatorColor } from "./parallel-agents-tree.tsx";

describe("ParallelAgentsTree status indicator colors", () => {
  const colors = {
    muted: "#888888",
    success: "#00ff00",
    warning: "#ffff00",
    error: "#ff0000",
  };

  test("renders running and pending as muted static indicators", () => {
    expect(getStatusIndicatorColor("running", colors)).toBe(colors.muted);
    expect(getStatusIndicatorColor("pending", colors)).toBe(colors.muted);
    expect(getStatusIndicatorColor("background", colors)).toBe(colors.muted);
  });

  test("renders completed as success and interrupted as warning", () => {
    expect(getStatusIndicatorColor("completed", colors)).toBe(colors.success);
    expect(getStatusIndicatorColor("interrupted", colors)).toBe(colors.warning);
  });

  test("renders error as error color", () => {
    expect(getStatusIndicatorColor("error", colors)).toBe(colors.error);
  });
});
