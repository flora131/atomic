import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasRequiredMuxBinary,
  isMuxBinaryRequiredForPlatform,
  prependPath,
  resolveCommandFromCurrentPath,
} from "./spawn.ts";

describe("spawn PATH helpers", () => {
  let originalPath: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalPath = process.env.PATH;
    tempDir = mkdtempSync(join(tmpdir(), "atomic-spawn-"));
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(tempDir, { force: true, recursive: true });
  });

  test("resolves commands added to PATH during the current process", () => {
    const commandName = process.platform === "win32"
      ? "atomic-spawn-test.cmd"
      : "atomic-spawn-test";
    const commandPath = join(tempDir, commandName);
    const body = process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n";

    writeFileSync(commandPath, body);
    chmodSync(commandPath, 0o755);

    process.env.PATH = originalPath ?? "";
    prependPath(tempDir);

    expect(resolveCommandFromCurrentPath("atomic-spawn-test")).toBe(commandPath);
  });

  test("requires native psmux binaries on Windows", () => {
    expect(isMuxBinaryRequiredForPlatform("psmux", "win32")).toBe(true);
    expect(isMuxBinaryRequiredForPlatform("pmux", "win32")).toBe(true);
    expect(isMuxBinaryRequiredForPlatform("tmux", "win32")).toBe(false);
  });

  test("requires tmux on Unix-like platforms", () => {
    expect(isMuxBinaryRequiredForPlatform("tmux", "linux")).toBe(true);
    expect(isMuxBinaryRequiredForPlatform("psmux", "linux")).toBe(false);
    expect(isMuxBinaryRequiredForPlatform("pmux", "darwin")).toBe(false);
  });

  test("uses platform requirement when checking PATH", () => {
    const commandPath = join(tempDir, "tmux");

    writeFileSync(commandPath, "#!/bin/sh\n");
    chmodSync(commandPath, 0o755);

    process.env.PATH = tempDir;

    expect(hasRequiredMuxBinary()).toBe(process.platform !== "win32");
  });

  test("does not add duplicate PATH entries", () => {
    process.env.PATH = originalPath ?? "";

    prependPath(tempDir);
    prependPath(tempDir);

    const delimiter = process.platform === "win32" ? ";" : ":";
    const entries = (process.env.PATH ?? "").split(delimiter);
    expect(entries.filter((entry) => entry === tempDir)).toHaveLength(1);
  });
});
