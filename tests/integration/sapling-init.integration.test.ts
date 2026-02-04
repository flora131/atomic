import { describe, it, expect } from "bun:test";
import { runInitCommand, readConfigYaml } from "../test-helpers";
import { getProvider } from "../../src/providers";

describe("atomic init integration (Sapling)", () => {
  it("should write provider: sapling to config.yaml", async () => {
    await runInitCommand({ provider: "sapling", saplingPrWorkflow: "stack" });
    const config = await readConfigYaml();
    expect(config.sourceControl.provider).toBe("sapling");
    expect(config.sourceControl.sapling!.prWorkflow).toBe("stack");
  });

  it("should use SaplingProvider for commands after init", async () => {
    await runInitCommand({ provider: "sapling", saplingPrWorkflow: "branch" });
    const config = await readConfigYaml();
    const provider = getProvider(config.sourceControl.provider as "sapling");
    expect(provider.name).toBe("sapling");
    expect(provider.commands.status).toMatch(/^sl status/);
  });

  it("should error if Sapling CLI is missing", async () => {
    // Simulate missing sl
    const orig = (global as any).commandExists;
    (global as any).commandExists = async (cmd: string) => cmd !== "sl";
    await expect(runInitCommand({ provider: "sapling" })).rejects.toThrow(/Sapling CLI/);
    (global as any).commandExists = orig;
  });
});
