/**
 * Tests for JSON merge utilities in merge.ts
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { mergeJsonFile } from "./merge";

// Helper to read and parse JSON file
async function readJson<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

describe("mergeJsonFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-merge-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("should merge source into destination, preserving existing keys", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(srcPath, JSON.stringify({ key1: "src-value1" }));
    await writeFile(destPath, JSON.stringify({ key2: "dest-value2" }));

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<Record<string, string>>(destPath);
    expect(result.key1).toBe("src-value1");
    expect(result.key2).toBe("dest-value2");
  });

  test("should override destination values with source values for same keys", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(srcPath, JSON.stringify({ version: "2.0.0", newKey: "new" }));
    await writeFile(destPath, JSON.stringify({ version: "1.0.0", existingKey: "existing" }));

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<Record<string, string>>(destPath);
    expect(result.version).toBe("2.0.0"); // Source overrides
    expect(result.newKey).toBe("new");
    expect(result.existingKey).toBe("existing");
  });

  test("should deep merge mcpServers from both files", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: {
          "cli-server": { command: "cli-cmd", args: ["--cli"] },
        },
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: {
          "user-server": { command: "user-cmd", args: ["--user"] },
        },
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<{
      mcpServers: Record<string, { command: string; args: string[] }>;
    }>(destPath);
    expect(result.mcpServers["cli-server"]).toEqual({ command: "cli-cmd", args: ["--cli"] });
    expect(result.mcpServers["user-server"]).toEqual({ command: "user-cmd", args: ["--user"] });
  });

  test("should override destination mcpServers with source for same server names", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: {
          "shared-server": { command: "new-cmd", version: "2.0" },
        },
      })
    );
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: {
          "shared-server": { command: "old-cmd", version: "1.0" },
          "user-server": { command: "user-cmd" },
        },
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<{
      mcpServers: Record<string, { command: string; version?: string }>;
    }>(destPath);
    expect(result.mcpServers["shared-server"]).toEqual({ command: "new-cmd", version: "2.0" });
    expect(result.mcpServers["user-server"]).toEqual({ command: "user-cmd" });
  });

  test("should handle destination without mcpServers", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(
      srcPath,
      JSON.stringify({
        mcpServers: {
          "new-server": { command: "cmd" },
        },
      })
    );
    await writeFile(destPath, JSON.stringify({ otherKey: "value" }));

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<{
      mcpServers?: Record<string, unknown>;
      otherKey: string;
    }>(destPath);
    expect(result.mcpServers).toEqual({ "new-server": { command: "cmd" } });
    expect(result.otherKey).toBe("value");
  });

  test("should handle source without mcpServers", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(srcPath, JSON.stringify({ newKey: "newValue" }));
    await writeFile(
      destPath,
      JSON.stringify({
        mcpServers: { "existing-server": { command: "cmd" } },
        otherKey: "value",
      })
    );

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<{
      mcpServers: Record<string, unknown>;
      newKey: string;
      otherKey: string;
    }>(destPath);
    expect(result.mcpServers).toEqual({ "existing-server": { command: "cmd" } });
    expect(result.newKey).toBe("newValue");
    expect(result.otherKey).toBe("value");
  });

  test("should write formatted JSON with 2-space indentation and trailing newline", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(srcPath, JSON.stringify({ key: "value" }));
    await writeFile(destPath, JSON.stringify({ existing: "data" }));

    await mergeJsonFile(srcPath, destPath);

    const rawContent = await readFile(destPath, "utf-8");
    // Verify trailing newline and proper indentation
    expect(rawContent.endsWith("\n")).toBe(true);
    expect(rawContent).toContain("  \"key\": \"value\"");
    expect(rawContent).toContain("  \"existing\": \"data\"");
  });

  test("should throw error when source file does not exist", async () => {
    const srcPath = join(tempDir, "nonexistent.json");
    const destPath = join(tempDir, "dest.json");
    await writeFile(destPath, JSON.stringify({}));

    await expect(mergeJsonFile(srcPath, destPath)).rejects.toThrow();
  });

  test("should throw error when destination file does not exist", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "nonexistent.json");
    await writeFile(srcPath, JSON.stringify({}));

    await expect(mergeJsonFile(srcPath, destPath)).rejects.toThrow();
  });

  test("should throw error for invalid JSON in source file", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");
    await writeFile(srcPath, "not valid json");
    await writeFile(destPath, JSON.stringify({}));

    await expect(mergeJsonFile(srcPath, destPath)).rejects.toThrow();
  });

  test("should throw error for invalid JSON in destination file", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");
    await writeFile(srcPath, JSON.stringify({}));
    await writeFile(destPath, "not valid json");

    await expect(mergeJsonFile(srcPath, destPath)).rejects.toThrow();
  });

  test("should replace top-level arrays with source values rather than concatenating", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(srcPath, JSON.stringify({ plugins: ["plugin-c"] }));
    await writeFile(destPath, JSON.stringify({ plugins: ["plugin-a", "plugin-b"] }));

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<{ plugins: string[] }>(destPath);
    expect(result.plugins).toEqual(["plugin-c"]);
  });

  test("should handle merging two empty objects", async () => {
    const srcPath = join(tempDir, "source.json");
    const destPath = join(tempDir, "dest.json");

    await writeFile(srcPath, JSON.stringify({}));
    await writeFile(destPath, JSON.stringify({}));

    await mergeJsonFile(srcPath, destPath);

    const result = await readJson<{ mcpServers?: Record<string, unknown> }>(destPath);
    expect(result.mcpServers).toEqual({});
  });
});
