import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runInitCommand, readConfigYaml, cleanupLastInitTestDir } from "../test-helpers";
import { getProvider } from "../../src/providers";

describe("atomic init integration (Sapling)", () => {
  let origCommandExists: unknown;

  beforeEach(() => {
    origCommandExists = (global as any).commandExists;
    // Mock commandExists to return true for sl and gh
    (global as any).commandExists = async (cmd: string) =>
      cmd === "sl" || cmd === "gh";
  });

  afterEach(async () => {
    (global as any).commandExists = origCommandExists;
    await cleanupLastInitTestDir();
  });

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
    // Override mock to simulate missing sl
    (global as any).commandExists = async (cmd: string) => cmd !== "sl";
    await expect(runInitCommand({ provider: "sapling" })).rejects.toThrow(/Sapling CLI/);
  });
});
