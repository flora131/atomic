import { describe, expect, test } from "bun:test";
import { getToolStatusColorKey } from "@/components/tool-result.tsx";

describe("getToolStatusColorKey", () => {
  test("maps completed tool executions to success", () => {
    expect(getToolStatusColorKey("completed")).toBe("success");
  });

  test("maps the remaining tool execution states to their expected color keys", () => {
    expect(getToolStatusColorKey("pending")).toBe("muted");
    expect(getToolStatusColorKey("running")).toBe("accent");
    expect(getToolStatusColorKey("error")).toBe("error");
    expect(getToolStatusColorKey("interrupted")).toBe("warning");
  });
});
