import { expect, test, describe, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("listAgentsCommand", () => {
  let tmpDir: string;
  let originalCwd: () => string;
  let logs: string[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "atomic-list-agents-"));
    logs = [];
    originalCwd = process.cwd;
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("listAgentsCommand is exported as a function", async () => {
    const { listAgentsCommand } = await import("@/commands/cli/list.ts");
    expect(typeof listAgentsCommand).toBe("function");
  });
});
