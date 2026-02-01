import { describe, it, expect } from "bun:test";
import { resolveTemplate } from "../../src/template/resolver";
import type { AtomicConfig } from "../../src/providers";

describe("Template variable system (Sapling)", () => {
  const saplingConfig: AtomicConfig = {
    version: 1,
    sourceControl: {
      provider: "sapling",
      sapling: { prWorkflow: "stack" },
    },
  };

  it("should resolve ${{ provider.commands.status }} to sl status", async () => {
    const template = "${{ provider.commands.status }}";
    const result = await resolveTemplate(template, saplingConfig);
    expect(result).toBe("sl status");
  });

  it("should resolve allowedTools as YAML list", async () => {
    const template = "allowed-tools:\n  ${{ provider.allowedTools }}";
    const result = await resolveTemplate(template, saplingConfig);
    expect(result).toMatch(/- Bash\(sl add:\*\)/);
    expect(result).toMatch(/- Bash\(sl pr:\*\)/);
  });
});
