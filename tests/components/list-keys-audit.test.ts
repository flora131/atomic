import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(import.meta.dir, "../../src");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(SRC, relativePath), "utf-8");
}

describe("List key audit — documentation comments", () => {
  describe("Low-risk sites have inline documentation comments", () => {
    it("tool-result.tsx displayLines.map has safety comment", () => {
      const content = readFile("components/tool-result.tsx");
      const displayLinesIdx = content.indexOf("displayLines.map(");
      expect(displayLinesIdx).toBeGreaterThan(-1);
      // Check that the comment appears before the .map call
      const before = content.slice(Math.max(0, displayLinesIdx - 200), displayLinesIdx);
      expect(before).toContain("Index keys are safe here");
    });

    it("tool-result.tsx truncatedErrorLines.map has safety comment", () => {
      const content = readFile("components/tool-result.tsx");
      const errorLinesIdx = content.indexOf("truncatedErrorLines.map(");
      expect(errorLinesIdx).toBeGreaterThan(-1);
      const before = content.slice(Math.max(0, errorLinesIdx - 200), errorLinesIdx);
      expect(before).toContain("Index keys are safe here");
    });

    it("error-exit-screen.tsx stackLines.map has safety comment", () => {
      const content = readFile("components/error-exit-screen.tsx");
      const stackIdx = content.indexOf("stackLines.slice(1).map(");
      expect(stackIdx).toBeGreaterThan(-1);
      const before = content.slice(Math.max(0, stackIdx - 200), stackIdx);
      expect(before).toContain("index keys are safe here");
    });

    it("chat-header.tsx chars.map (GradientText) has safety comment", () => {
      const content = readFile("components/chat-header.tsx");
      const charsIdx = content.indexOf("chars.map(");
      expect(charsIdx).toBeGreaterThan(-1);
      const before = content.slice(Math.max(0, charsIdx - 200), charsIdx);
      expect(before).toContain("Index keys are safe here");
    });

    it("chat-header.tsx ATOMIC_BLOCK_LOGO.map has safety comment", () => {
      const content = readFile("components/chat-header.tsx");
      const logoIdx = content.indexOf("ATOMIC_BLOCK_LOGO.map(");
      expect(logoIdx).toBeGreaterThan(-1);
      const before = content.slice(Math.max(0, logoIdx - 200), logoIdx);
      expect(before).toContain("Index keys are safe here");
    });

    it("transcript-view.tsx transcriptLines.map has safety comment", () => {
      const content = readFile("components/transcript-view.tsx");
      const transcriptIdx = content.indexOf("transcriptLines.map(");
      expect(transcriptIdx).toBeGreaterThan(-1);
      const before = content.slice(Math.max(0, transcriptIdx - 200), transcriptIdx);
      expect(before).toContain("Index keys are safe here");
    });
  });

  describe("Medium-risk sites use stable identity keys", () => {
    it("parallel-agents-tree.tsx uses part.id for tool parts", () => {
      const content = readFile("components/parallel-agents-tree.tsx");
      // Find the visibleTools.map and verify key={part.id} is used
      const toolsMapIdx = content.indexOf("visibleTools.map(");
      expect(toolsMapIdx).toBeGreaterThan(-1);
      const afterToolsMap = content.slice(toolsMapIdx, toolsMapIdx + 300);
      expect(afterToolsMap).toContain("key={part.id}");
      // Ensure no index-based key within that .map
      expect(afterToolsMap).not.toMatch(/key=\{index\}/);
    });

    it("parallel-agents-tree.tsx uses agent.id for agents", () => {
      const content = readFile("components/parallel-agents-tree.tsx");
      const agentsMapIdx = content.indexOf("visibleAgents.map(");
      expect(agentsMapIdx).toBeGreaterThan(-1);
      const afterAgentsMap = content.slice(agentsMapIdx, agentsMapIdx + 200);
      expect(afterAgentsMap).toContain("key={agent.id}");
    });
  });

  describe("Already-stable sites remain unchanged", () => {
    it("autocomplete.tsx uses command.name as key", () => {
      const content = readFile("components/autocomplete.tsx");
      expect(content).toContain("key={command.name}");
    });

    it("user-question-dialog.tsx uses option.value as key", () => {
      const content = readFile("components/user-question-dialog.tsx");
      expect(content).toContain("key={option.value}");
    });
  });
});
