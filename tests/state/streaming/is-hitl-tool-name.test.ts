import { describe, expect, test } from "bun:test";
import { isHitlToolName } from "@/state/streaming/pipeline-tools/shared.ts";

describe("isHitlToolName", () => {
  test("recognizes exact HITL tool names", () => {
    expect(isHitlToolName("ask_question")).toBe(true);
    expect(isHitlToolName("ask_user")).toBe(true);
    expect(isHitlToolName("question")).toBe(true);
    expect(isHitlToolName("AskUserQuestion")).toBe(true);
  });

  test("recognizes HITL suffixes for non-MCP providers", () => {
    expect(isHitlToolName("copilot/ask_user")).toBe(true);
    expect(isHitlToolName("copilot__ask_user")).toBe(true);
    expect(isHitlToolName("copilot/ask_question")).toBe(true);
    expect(isHitlToolName("copilot__ask_question")).toBe(true);
  });

  test("does NOT treat MCP tools as HITL", () => {
    expect(isHitlToolName("mcp__deepwiki__ask_question")).toBe(false);
    expect(isHitlToolName("mcp__some_server__ask_user")).toBe(false);
    expect(isHitlToolName("mcp__myserver__ask_question")).toBe(false);
    expect(isHitlToolName("MCP__DeepWiki__ask_question")).toBe(false);
  });

  test("rejects unrelated tool names", () => {
    expect(isHitlToolName("bash")).toBe(false);
    expect(isHitlToolName("Read")).toBe(false);
    expect(isHitlToolName("edit")).toBe(false);
  });
});
