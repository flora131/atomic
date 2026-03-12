import { describe, expect, test } from "bun:test";
import {
  createMockContext,
  formatGroupedModels,
  groupByProvider,
  mcpCommand,
} from "./builtin-commands.test-support.ts";

describe("Built-in Commands MCP and formatting helpers", () => {
  describe("mcpCommand", () => {
    test("lists MCP servers when no args provided", async () => {
      const result = await mcpCommand.execute(
        "",
        createMockContext({ getMcpServerToggles: () => ({}) }),
      );

      expect(result.success).toBe(true);
      expect(result.mcpSnapshot).toBeDefined();
    });

    test("returns error for enable without server name", async () => {
      const result = await mcpCommand.execute(
        "enable",
        createMockContext({ getMcpServerToggles: () => ({}) }),
      );

      expect(result.success).toBe(false);
      expect(result.mcpSnapshot).toBeUndefined();
      expect(result.message).toContain("Usage");
    });

    test("returns error for unknown server", async () => {
      const result = await mcpCommand.execute(
        "enable unknown-server",
        createMockContext({ getMcpServerToggles: () => ({}) }),
      );

      expect(result.success).toBe(false);
      expect(result.mcpSnapshot).toBeUndefined();
      expect(result.message).toContain("not found");
    });
  });

  describe("groupByProvider", () => {
    test("groups models by provider ID", () => {
      const models = [
        { providerID: "anthropic", modelID: "model1", name: "Model 1" },
        { providerID: "anthropic", modelID: "model2", name: "Model 2" },
        { providerID: "openai", modelID: "model3", name: "Model 3" },
      ];

      const grouped = groupByProvider(models);

      expect(grouped.size).toBe(2);
      expect(grouped.get("anthropic")?.length).toBe(2);
      expect(grouped.get("openai")?.length).toBe(1);
    });

    test("handles empty model list", () => {
      expect(groupByProvider([]).size).toBe(0);
    });
  });

  describe("formatGroupedModels", () => {
    test("formats models with provider headers", () => {
      const grouped = new Map([
        [
          "anthropic",
          [{ providerID: "anthropic", modelID: "model1", name: "Model 1" }],
        ],
        [
          "openai",
          [{ providerID: "openai", modelID: "model2", name: "Model 2" }],
        ],
      ]);

      const lines = formatGroupedModels(grouped);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines).toContainEqual("**anthropic**");
      expect(lines).toContainEqual("**openai**");
      expect(lines).toContainEqual("  - model1");
      expect(lines).toContainEqual("  - model2");
    });

    test("includes status annotations for non-active models", () => {
      const grouped = new Map([
        [
          "anthropic",
          [
            {
              providerID: "anthropic",
              modelID: "model1",
              name: "Model 1",
              status: "beta",
            },
          ],
        ],
      ]);

      expect(formatGroupedModels(grouped)).toContainEqual("  - model1 (beta)");
    });

    test("includes context limit annotations", () => {
      const grouped = new Map([
        [
          "anthropic",
          [
            {
              providerID: "anthropic",
              modelID: "model1",
              name: "Model 1",
              limits: { context: 200000 },
            },
          ],
        ],
      ]);

      expect(formatGroupedModels(grouped)).toContainEqual("  - model1 (200k ctx)");
    });

    test("handles empty grouped models", () => {
      expect(formatGroupedModels(new Map())).toHaveLength(0);
    });
  });
});
