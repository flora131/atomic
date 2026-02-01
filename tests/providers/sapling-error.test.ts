import { describe, it, expect } from "bun:test";
import { SaplingProvider, createSaplingProvider } from "../../src/providers/sapling";

describe("SaplingProvider error handling", () => {
  it("should report missing sl CLI in prerequisites", async () => {
    const testProvider = createSaplingProvider({ prWorkflow: "stack" }, async (cmd) => cmd !== "sl");
    const result = await testProvider.checkPrerequisites();
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("sl");
  });

  it("should report missing gh CLI in prerequisites", async () => {
    const testProvider = createSaplingProvider({ prWorkflow: "stack" }, async (cmd) => cmd !== "gh");
    const result = await testProvider.checkPrerequisites();
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("gh");
  });
});
