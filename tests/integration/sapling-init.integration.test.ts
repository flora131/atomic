import { describe, it, expect, afterEach } from "bun:test";
import { runInitCommand, readConfigYaml, cleanupLastInitTestDir } from "../test-helpers";
import { getProvider } from "../../src/providers";

const mockCommandExists = async (cmd: string) => cmd === "sl" || cmd === "gh";

describe("atomic init integration (Sapling)", () => {
  afterEach(async () => {
    await cleanupLastInitTestDir();
  });

  it("should write provider: sapling to config.yaml", async () => {
    await runInitCommand({ provider: "sapling", saplingPrWorkflow: "stack", commandExists: mockCommandExists });
    const config = await readConfigYaml();
    expect(config.sourceControl.provider).toBe("sapling");
    expect(config.sourceControl.sapling!.prWorkflow).toBe("stack");
  });

  it("should use SaplingProvider for commands after init", async () => {
    await runInitCommand({ provider: "sapling", saplingPrWorkflow: "branch", commandExists: mockCommandExists });
    const config = await readConfigYaml();
    const provider = getProvider(config.sourceControl.provider as "sapling");
    expect(provider.name).toBe("sapling");
    expect(provider.commands.status).toMatch(/^sl status/);
  });

  it("should error if Sapling CLI is missing", async () => {
    const missingSlMock = async (cmd: string) => cmd !== "sl";
    await expect(runInitCommand({ provider: "sapling", commandExists: missingSlMock })).rejects.toThrow(/Sapling CLI/);
  });
});
