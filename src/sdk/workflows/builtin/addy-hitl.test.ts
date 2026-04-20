/**
 * Ensures every HITL gate in the addy-* workflows forces the agent to invoke
 * the `AskUserQuestion` tool instead of emitting prose like
 * "reply 'confirm'". The TUI only surfaces the blocking prompt when the tool
 * is actually called (via the PreToolUse hook on AskUserQuestion); prose
 * gates slip past the user and the workflow proceeds unilaterally.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = [
  "addy-define-to-ship-prep",
  "addy-ship-canary",
  "addy-ship-cleanup",
];

function workflowSource(name: string): string {
  const path = join(import.meta.dir, name, "claude/index.ts");
  return readFileSync(path, "utf-8");
}

describe("addy workflows — HITL gates must force AskUserQuestion tool calls", () => {
  for (const workflow of WORKFLOWS) {
    test(`${workflow}: includes the HITL tool-call rule preamble`, () => {
      const src = workflowSource(workflow);
      expect(src).toContain("HITL_TOOL_RULE");
    });

    test(`${workflow}: every stage prompt references HITL_TOOL_RULE`, () => {
      const src = workflowSource(workflow);
      // Each stage passes an array to `.join("\n")` that then feeds
      // `s.session.query(...)`. Make sure every such array body mentions
      // the preamble token.
      const queryArrays = src.match(
        /s\.session\.query\(\s*\[[\s\S]*?\]\.join\("\\n"\)/g,
      ) ?? [];
      expect(queryArrays.length).toBeGreaterThan(0);
      for (const call of queryArrays) {
        expect(call).toContain("HITL_TOOL_RULE");
      }
    });

    test(`${workflow}: the original bug's prose gate no longer appears as an instruction`, () => {
      // The reported bug: the idea-refine prompt asked the agent to literally
      // *say* "Correct me now or I'll proceed with these". That sentence is
      // not a gate — the TUI can't see it. Lock it out of the source entirely
      // so the regression can't reappear.
      const src = workflowSource(workflow);
      expect(src).not.toMatch(/Correct me now or I'?ll proceed with these/i);
    });
  }
});
