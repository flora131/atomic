import { describe, expect, test } from "bun:test";
import { formatSubagentToolSummary } from "@/lib/ui/subagent-tool-summary.ts";

describe("formatSubagentToolSummary", () => {
  test("formats read tools with compact basename lists", () => {
    expect(formatSubagentToolSummary("Read", {
      paths: [
        "/tmp/copilot.ts",
        "/tmp/claude-agent-sdk.md",
      ],
    })).toBe("Read copilot.ts, claude-agent-sdk.md");
  });

  test("formats grep/search tools with scope when available", () => {
    expect(formatSubagentToolSummary("Search", {
      pattern: "type: \"subagent|tool.execution\"",
      path: "/tmp/claude-agent-sdk.md",
    })).toBe("Search type: \"subagent|tool.execution\" in claude-agent-sdk.md");
  });

  test("formats bash tools using the command text", () => {
    expect(formatSubagentToolSummary("Bash", {
      command: "rg -n \"subagent\" src/ui",
    })).toBe("Bash rg -n \"subagent\" src/ui");
  });
});
