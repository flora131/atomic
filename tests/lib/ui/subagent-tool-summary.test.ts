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

  test("collapses single newlines in bash commands to spaces", () => {
    expect(formatSubagentToolSummary("Bash", {
      command: "echo hello\necho world",
    })).toBe("Bash echo hello echo world");
  });

  test("truncates at double newlines in bash commands", () => {
    expect(formatSubagentToolSummary("Bash", {
      command: "echo hello\n\necho world",
    })).toBe("Bash echo hello…");
  });

  test("collapses newlines in task descriptions", () => {
    expect(formatSubagentToolSummary("task", {
      description: "Find files\nand analyze them",
    })).toBe("Task Find files and analyze them");
  });

  test("truncates at double newlines in task descriptions", () => {
    expect(formatSubagentToolSummary("task", {
      description: "Find files\n\nMore details here",
    })).toBe("Task Find files…");
  });
});
