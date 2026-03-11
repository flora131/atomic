import { describe, expect, test } from "bun:test";
import {
  isToolDisabledBySubagentPolicy,
  resolveSubagentToolPolicy,
  type SubagentToolPolicy,
} from "@/services/agents/subagent-tool-policy.ts";

/**
 * Mirrors the conversion the OpenCode client performs in `onSessionCreated`:
 *   disallowedTools = entries where enabled === false
 *
 * Source: src/services/agents/clients/opencode.ts (onSessionCreated callback)
 */
function convertOpenCodeToolToggles(
  tools: Record<string, boolean>,
): SubagentToolPolicy {
  return {
    disallowedTools: Object.entries(tools)
      .filter(([, enabled]) => enabled === false)
      .map(([toolName]) => toolName),
  };
}

describe("OpenCode worker tool permissions", () => {
  const workerToolToggles: Record<string, boolean> = {
    write: true,
    edit: true,
    bash: true,
    todowrite: true,
    question: false,
    lsp: true,
    skill: true,
  };

  const policies: Record<string, SubagentToolPolicy> = {
    worker: convertOpenCodeToolToggles(workerToolToggles),
  };

  test("denies question tool for the worker sub-agent", () => {
    const policy = resolveSubagentToolPolicy(policies, "worker");
    expect(isToolDisabledBySubagentPolicy(policy, "question")).toBe(true);
  });

  test("allows tools enabled in the worker frontmatter", () => {
    const policy = resolveSubagentToolPolicy(policies, "worker");
    expect(isToolDisabledBySubagentPolicy(policy, "bash")).toBe(false);
    expect(isToolDisabledBySubagentPolicy(policy, "edit")).toBe(false);
    expect(isToolDisabledBySubagentPolicy(policy, "write")).toBe(false);
  });
});
