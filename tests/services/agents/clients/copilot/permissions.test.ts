import { describe, expect, test } from "bun:test";
import type { CopilotAgentToolPolicy, CopilotSessionState } from "@/services/agents/clients/copilot/types.ts";
import { createAutoApprovePermissionHandler } from "@/services/agents/clients/copilot/permissions.ts";

describe("createAutoApprovePermissionHandler — worker agent", () => {
  const workerToolCallId = "tool-call-1";
  const sessionId = "session-1";

  const sessions = new Map([
    [sessionId, {
      toolCallIdToSubagentName: new Map([[workerToolCallId, "worker"]]),
    } as unknown as CopilotSessionState],
  ]);

  const agentToolPolicies: Record<string, CopilotAgentToolPolicy> = {
    worker: {
      tools: ["execute", "agent", "edit", "search", "read", "lsp"],
    },
  };

  test("denies AskUserQuestion for the worker sub-agent", async () => {
    const handler = createAutoApprovePermissionHandler({
      sessions,
      agentToolPolicies,
    });

    const result = await handler(
      { kind: "custom-tool", toolName: "AskUserQuestion", toolCallId: workerToolCallId },
      { sessionId },
    );

    expect(result).toEqual({ kind: "denied-interactively-by-user" });
  });

  test("approves tools listed in the worker frontmatter", async () => {
    const handler = createAutoApprovePermissionHandler({
      sessions,
      agentToolPolicies,
    });

    const result = await handler(
      { kind: "custom-tool", toolName: "edit", toolCallId: workerToolCallId },
      { sessionId },
    );

    expect(result).toEqual({ kind: "approved" });
  });
});
