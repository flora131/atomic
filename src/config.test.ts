import { describe, expect, test } from "bun:test";
import { isValidScm, getScmConfig } from "./config";

describe("azure-devops SCM config", () => {
  test("isValidScm('azure-devops') returns true", () => {
    expect(isValidScm("azure-devops")).toBe(true);
  });

  test("isValidScm('github') still returns true", () => {
    expect(isValidScm("github")).toBe(true);
  });

  test("isValidScm('sapling') still returns true", () => {
    expect(isValidScm("sapling")).toBe(true);
  });

  test("isValidScm('unknown') returns false", () => {
    expect(isValidScm("unknown")).toBe(false);
  });

  test("getScmConfig('azure-devops') returns expected ScmConfig shape", () => {
    const config = getScmConfig("azure-devops");
    expect(config.name).toBe("azure-devops");
    expect(config.displayName).toBe("Azure DevOps / Git");
    expect(config.cliTool).toBe("git");
    expect(config.reviewTool).toBe("az repos");
    expect(config.reviewSystem).toBe("azure-devops");
    expect(config.detectDir).toBe(".git");
    expect(config.reviewCommandFile).toBe("create-az-pr.md");
    expect(config.requiredConfigFiles).toContain("~/.azure/azureProfile.json");
  });
});
