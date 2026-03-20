import { beforeEach, describe, expect, test } from "bun:test";
import {
  appendSkillLoadToLatestAssistantMessage,
  createMessage,
} from "@/state/chat/shared/helpers/messages.ts";
import type { ChatMessage, MessageSkillLoad } from "@/state/chat/shared/types/index.ts";
import type { ToolPart } from "@/state/parts/index.ts";
import { createPartId, _resetPartCounter } from "@/state/parts/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMsg(id: string, role: "user" | "assistant" | "system", opts?: {
  parts?: ChatMessage["parts"];
  skillLoads?: MessageSkillLoad[];
  streaming?: boolean;
}): ChatMessage {
  return {
    id,
    role,
    content: `content-${id}`,
    timestamp: new Date().toISOString(),
    parts: opts?.parts ?? [],
    skillLoads: opts?.skillLoads,
    streaming: opts?.streaming,
  };
}

function createToolPart(toolName: string, input: Record<string, unknown> = {}): ToolPart {
  return {
    id: createPartId(),
    type: "tool",
    toolCallId: `call_${Math.random().toString(36).slice(2, 6)}`,
    toolName,
    input,
    state: { status: "running", startedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };
}

function makeSkillLoad(name: string): MessageSkillLoad {
  return { skillName: name, status: "loaded" };
}

// ---------------------------------------------------------------------------
// appendSkillLoadToLatestAssistantMessage
// ---------------------------------------------------------------------------

describe("appendSkillLoadToLatestAssistantMessage", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  test("attaches skill load to the last assistant message when it is at the end", () => {
    const messages = [
      createMsg("u1", "user"),
      createMsg("a1", "assistant"),
    ];
    const result = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("gh-commit"));

    expect(result).toHaveLength(2);
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.skillLoads).toHaveLength(1);
    expect(result[1]!.skillLoads![0]!.skillName).toBe("gh-commit");
  });

  test("finds assistant message past trailing system messages", () => {
    const messages = [
      createMsg("u1", "user"),
      createMsg("a1", "assistant", { streaming: true }),
      createMsg("s1", "system"),
      createMsg("s2", "system"),
    ];
    const result = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("gh-commit"));

    // Should attach to the assistant, not create a new one
    expect(result).toHaveLength(4);
    expect(result[1]!.id).toBe("a1");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.skillLoads).toHaveLength(1);
    expect(result[1]!.skillLoads![0]!.skillName).toBe("gh-commit");
    // System messages unchanged
    expect(result[2]!.role).toBe("system");
    expect(result[3]!.role).toBe("system");
  });

  test("does not duplicate an already-tracked skill", () => {
    const messages = [
      createMsg("a1", "assistant", { skillLoads: [makeSkillLoad("gh-commit")] }),
    ];
    const result = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("  GH-Commit  "));

    expect(result).toHaveLength(1);
    expect(result[0]!.skillLoads).toHaveLength(1);
  });

  test("creates a new assistant message when none exists", () => {
    const messages = [createMsg("u1", "user")];
    const result = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("gh-commit"));

    expect(result).toHaveLength(2);
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.skillLoads).toHaveLength(1);
  });

  test("rejects empty skill names", () => {
    const messages = [createMsg("a1", "assistant")];
    const result = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("  "));

    expect(result).toBe(messages);
  });

  // ---------------------------------------------------------------------------
  // upsertSkillLoadPart — tested via appendSkillLoadToLatestAssistantMessage
  // since upsertSkillLoadPart is private, we verify its behavior through
  // the public function and part ordering assertions.
  // ---------------------------------------------------------------------------

  test("inserts skill-load part at the position of the skill tool call", () => {
    const textPart = { id: createPartId(), type: "text" as const, content: "hello", isStreaming: false, createdAt: new Date().toISOString() };
    const bashTool = createToolPart("bash", { command: "ls" });
    const skillTool = createToolPart("skill", { skill: "gh-commit" });
    const anotherTool = createToolPart("bash", { command: "pwd" });

    const messages = [
      createMsg("a1", "assistant", {
        parts: [textPart, bashTool, skillTool, anotherTool],
      }),
    ];

    const result = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("gh-commit"));
    const parts = result[0]!.parts!;

    // skill-load part should be inserted BEFORE the skill tool call
    const skillLoadIdx = parts.findIndex((p) => p.type === "skill-load");
    const skillToolIdx = parts.findIndex((p) => p.type === "tool" && (p as ToolPart).toolName === "skill");

    expect(skillLoadIdx).toBeGreaterThanOrEqual(0);
    expect(skillToolIdx).toBeGreaterThan(skillLoadIdx);
    // text and bash tool should remain before the skill-load
    expect(parts[0]!.type).toBe("text");
    expect(parts[1]!.type).toBe("tool");
    expect((parts[1] as ToolPart).toolName).toBe("bash");
  });

  test("appends skill-load part at the end when no skill tool call exists", () => {
    const textPart = { id: createPartId(), type: "text" as const, content: "hello", isStreaming: false, createdAt: new Date().toISOString() };
    const bashTool = createToolPart("bash", { command: "ls" });

    const messages = [
      createMsg("a1", "assistant", { parts: [textPart, bashTool] }),
    ];

    const result = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("gh-commit"));
    const parts = result[0]!.parts!;

    const skillLoadIdx = parts.findIndex((p) => p.type === "skill-load");
    expect(skillLoadIdx).toBe(parts.length - 1);
  });

  test("creates separate skill-load parts for each skill instead of merging", () => {
    const skillTool1 = createToolPart("skill", { skill: "gh-commit" });
    const textPart = { id: createPartId(), type: "text" as const, content: "text", isStreaming: false, createdAt: new Date().toISOString() };
    const skillTool2 = createToolPart("skill", { skill: "testing-anti-patterns" });

    const messages = [
      createMsg("a1", "assistant", {
        parts: [skillTool1, textPart, skillTool2],
      }),
    ];

    // First skill creates a skill-load part before its tool call
    const step1 = appendSkillLoadToLatestAssistantMessage(messages, makeSkillLoad("gh-commit"));
    // Second skill should create a SEPARATE skill-load part at its own tool call position
    const step2 = appendSkillLoadToLatestAssistantMessage(step1, makeSkillLoad("testing-anti-patterns"));
    const parts = step2[0]!.parts!;

    const skillLoadParts = parts.filter((p) => p.type === "skill-load");
    expect(skillLoadParts).toHaveLength(2);
    expect(step2[0]!.skillLoads).toHaveLength(2);
  });
});
