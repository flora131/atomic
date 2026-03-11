import { describe, expect, test } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig } from "@/services/agents/types.ts";
import {
  createClaudeSubagentToolPermissionHook,
  isToolDisabledForAgent,
} from "@/services/agents/clients/claude/tool-permissions.ts";

describe("isToolDisabledForAgent", () => {
  const config: SessionConfig = {
    agents: {
      reviewer: {
        description: "Review code",
        prompt: "Review the code",
        tools: ["Read", "Grep"],
        disallowedTools: ["Task"],
      },
    },
  };

  test("denies tools explicitly disabled in frontmatter", () => {
    expect(isToolDisabledForAgent(config, "reviewer", "Task")).toBe(true);
  });

  test("denies tools outside the explicit allowlist", () => {
    expect(isToolDisabledForAgent(config, "reviewer", "Edit")).toBe(true);
  });

  test("allows tools inside the explicit allowlist", () => {
    expect(isToolDisabledForAgent(config, "reviewer", "Read")).toBe(false);
  });
});

describe("isToolDisabledForAgent — worker agent", () => {
  const config: SessionConfig = {
    agents: {
      worker: {
        description: "Implement a SINGLE task from a task list.",
        prompt: "You are tasked with implementing a SINGLE task.",
        tools: ["Bash", "Task", "Edit", "Glob", "Grep", "NotebookEdit", "NotebookRead", "Read", "Write", "Skill", "LSP"],
      },
    },
  };

  test("denies AskUserQuestion for the worker sub-agent", () => {
    expect(isToolDisabledForAgent(config, "worker", "AskUserQuestion")).toBe(true);
  });

  test("allows tools listed in the worker frontmatter", () => {
    expect(isToolDisabledForAgent(config, "worker", "Bash")).toBe(false);
    expect(isToolDisabledForAgent(config, "worker", "Edit")).toBe(false);
    expect(isToolDisabledForAgent(config, "worker", "Read")).toBe(false);
  });
});

describe("createClaudeSubagentToolPermissionHook", () => {
  const config: SessionConfig = {
    agents: {
      reviewer: {
        description: "Review code",
        prompt: "Review the code",
        tools: ["Read"],
        disallowedTools: ["Task"],
      },
    },
  };

  test("returns a deny decision for disabled sub-agent tools", async () => {
    const hook = createClaudeSubagentToolPermissionHook(config);
    const result = await hook({
      hook_event_name: "PreToolUse",
      session_id: "sdk-session",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/tmp",
      tool_name: "Task",
      tool_input: {},
      tool_use_id: "tool-1",
      agent_id: "agent-1",
      agent_type: "reviewer",
    }, undefined, { signal: AbortSignal.timeout(1000) });
    const syncResult = result as SyncHookJSONOutput;
    const hookOutput = syncResult.hookSpecificOutput as {
      hookEventName?: string;
      permissionDecision?: string;
    } | undefined;

    expect(hookOutput?.hookEventName).toBe("PreToolUse");
    expect(hookOutput?.permissionDecision).toBe("deny");
  });

  test("does not deny tools for the main thread", async () => {
    const hook = createClaudeSubagentToolPermissionHook(config);
    const result = await hook({
      hook_event_name: "PreToolUse",
      session_id: "sdk-session",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/tmp",
      tool_name: "Task",
      tool_input: {},
      tool_use_id: "tool-1",
      agent_type: "reviewer",
    }, undefined, { signal: AbortSignal.timeout(1000) });
    const syncResult = result as SyncHookJSONOutput;

    expect(syncResult.hookSpecificOutput).toBeUndefined();
  });
});
