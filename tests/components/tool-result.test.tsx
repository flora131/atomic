import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { getToolStatusColorKey } from "@/components/tool-result.tsx";

const TOOL_RESULT_SRC = fs.readFileSync(
  path.resolve(import.meta.dir, "../../src/components/tool-result.tsx"),
  "utf-8",
);

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

// ============================================================================
// React.memo wrapping — structural tests
// ============================================================================

describe("tool-result.tsx React.memo wrapping", () => {
  test("imports memo from react", () => {
    expect(TOOL_RESULT_SRC).toContain(
      'import React, { memo, useMemo } from "react";',
    );
  });

  test("StatusIndicator is wrapped with React.memo", () => {
    expect(TOOL_RESULT_SRC).toContain(
      "const StatusIndicator = memo(function StatusIndicator(",
    );
  });

  test("StatusIndicator has an extracted StatusIndicatorProps interface", () => {
    expect(TOOL_RESULT_SRC).toContain("interface StatusIndicatorProps {");
    expect(TOOL_RESULT_SRC).toContain("}: StatusIndicatorProps)");
  });

  test("CollapsibleContent is wrapped with React.memo", () => {
    expect(TOOL_RESULT_SRC).toContain(
      "const CollapsibleContent = memo(function CollapsibleContent(",
    );
  });

  test("CollapsibleContent uses CollapsibleContentProps interface", () => {
    expect(TOOL_RESULT_SRC).toContain("interface CollapsibleContentProps {");
    expect(TOOL_RESULT_SRC).toContain("}: CollapsibleContentProps)");
  });
});
