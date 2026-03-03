import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "./opencode.ts";

describe("OpenCodeClient.getModelDisplayInfo", () => {
  test("uses default model label when no model is configured", async () => {
    const client = new OpenCodeClient();

    const info = await client.getModelDisplayInfo();

    expect(info.model).toBe("big-pickle");
    expect(info.tier).toBe("OpenCode");
  });

  test("strips provider prefix from explicit model hint", async () => {
    const client = new OpenCodeClient();

    const info = await client.getModelDisplayInfo("anthropic/claude-sonnet-4");

    expect(info.model).toBe("claude-sonnet-4");
    expect(info.tier).toBe("OpenCode");
  });
});
