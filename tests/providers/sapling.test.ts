import { describe, it, expect } from "bun:test";
import { SaplingProvider, createSaplingProvider } from "../../src/providers/sapling";
import type { SourceControlProvider } from "../../src/providers/provider";

describe("SaplingProvider", () => {
  it("should have correct name and CLI", () => {
    expect(SaplingProvider.name).toBe("sapling");
    expect(SaplingProvider.cli).toBe("sl");
    expect(SaplingProvider.displayName).toMatch(/Sapling/i);
  });

  it("should have all required command mappings", () => {
    const cmds = SaplingProvider.commands;
    expect(cmds.status).toMatch(/^sl status/);
    expect(cmds.log).toMatch(/^sl log/);
    expect(cmds.diff).toBe("sl diff");
    expect(cmds.branch).toMatch(/^sl log/);
    expect(cmds.add).toBe("sl add");
    expect(cmds.commit).toBe("sl commit");
    expect(cmds.amend).toBe("sl amend");
    expect(cmds.push).toMatch(/^sl push|sl pr submit/);
    expect(cmds.pull).toBe("sl pull");
    expect(cmds.createPR).toMatch(/^sl pr submit/);
    expect(cmds.listPRs).toMatch(/^sl ssl/);
    expect(cmds.viewPR).toMatch(/^sl pr/);
  });

  it("should allow stack and branch workflows", () => {
    const stack = createSaplingProvider({ prWorkflow: "stack" });
    const branch = createSaplingProvider({ prWorkflow: "branch" });
    expect(stack.commands.createPR).toBe("sl pr submit --stack");
    expect(branch.commands.push).toBe("sl push --to");
    expect(branch.commands.createPR).toBe("sl pr submit");
  });

  it("should list all allowed tools", () => {
    expect(Array.isArray(SaplingProvider.allowedTools)).toBe(true);
    expect(SaplingProvider.allowedTools).toContain("Bash(sl add:*)");
    expect(SaplingProvider.allowedTools).toContain("Bash(sl pr:*)");
  });

  it("should check prerequisites and report missing CLIs", async () => {
    // Use customCommandExists to simulate missing sl and gh
    const testProvider = createSaplingProvider({ prWorkflow: "stack" }, async () => false);
    const result = await testProvider.checkPrerequisites();
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("sl");
    expect(result.missing).toContain("gh");
  });
});
