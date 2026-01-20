import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { mergeJsonFile } from "../src/utils/merge";

describe("mergeJsonFile", () => {
  const testDir = join(import.meta.dir, ".test-merge-temp");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("preserves destination MCP servers", async () => {
    const srcPath = join(testDir, "src.json");
    const destPath = join(testDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: { "cli-server": { command: "cli-cmd" } },
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: { "user-server": { command: "user-cmd" } },
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = JSON.parse(await readFile(destPath, "utf-8"));
    expect(result.mcpServers["user-server"]).toBeDefined();
    expect(result.mcpServers["user-server"].command).toBe("user-cmd");
    expect(result.mcpServers["cli-server"]).toBeDefined();
    expect(result.mcpServers["cli-server"].command).toBe("cli-cmd");
  });

  test("source overrides destination for same keys", async () => {
    const srcPath = join(testDir, "src.json");
    const destPath = join(testDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: { "shared-server": { command: "new-cmd" } },
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: { "shared-server": { command: "old-cmd" } },
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = JSON.parse(await readFile(destPath, "utf-8"));
    expect(result.mcpServers["shared-server"].command).toBe("new-cmd");
  });

  test("preserves destination top-level keys", async () => {
    const srcPath = join(testDir, "src.json");
    const destPath = join(testDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: {},
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: {},
        customKey: "user-value",
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = JSON.parse(await readFile(destPath, "utf-8"));
    expect(result.customKey).toBe("user-value");
  });

  test("handles empty mcpServers in destination", async () => {
    const srcPath = join(testDir, "src.json");
    const destPath = join(testDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: { "cli-server": { command: "cli-cmd" } },
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: {},
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = JSON.parse(await readFile(destPath, "utf-8"));
    expect(result.mcpServers["cli-server"]).toBeDefined();
    expect(result.mcpServers["cli-server"].command).toBe("cli-cmd");
  });

  test("handles undefined mcpServers in destination", async () => {
    const srcPath = join(testDir, "src.json");
    const destPath = join(testDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: { "cli-server": { command: "cli-cmd" } },
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        otherField: "value",
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = JSON.parse(await readFile(destPath, "utf-8"));
    expect(result.mcpServers["cli-server"]).toBeDefined();
    expect(result.otherField).toBe("value");
  });

  test("output is properly formatted JSON", async () => {
    const srcPath = join(testDir, "src.json");
    const destPath = join(testDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: { "cli-server": { command: "cli-cmd" } },
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: {},
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const content = await readFile(destPath, "utf-8");
    // Should be formatted with 2-space indentation and trailing newline
    expect(content).toContain("  ");
    expect(content.endsWith("\n")).toBe(true);
  });
});
