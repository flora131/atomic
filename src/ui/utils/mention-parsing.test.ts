import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globalRegistry } from "../commands/index.ts";
import {
  hasAnyAtReferenceToken,
  parseAtMentions,
  processFileMentions,
} from "./mention-parsing.ts";

describe("mention parsing", () => {
  let originalCwd = "";
  let testDir = "";
  let agentName = "";

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `atomic-mention-parsing-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(join(testDir, "src", "app.ts"), "export const app = true;\n");
    writeFileSync(join(testDir, "foo"), "foo\n");
    writeFileSync(join(testDir, "bar"), "bar\n");
    process.chdir(testDir);

    agentName = `mention-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    globalRegistry.register({
      name: agentName,
      description: "test agent",
      category: "agent",
      execute: () => ({ success: true }),
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    globalRegistry.unregister(agentName);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("detects @references when adjacent to bracket punctuation", () => {
    expect(hasAnyAtReferenceToken("(@src/app.ts)")).toBe(true);
    expect(hasAnyAtReferenceToken("[@foo]")).toBe(true);
    expect(hasAnyAtReferenceToken("{@bar}")).toBe(true);
  });

  test("resolves bracket-adjacent file references", () => {
    const result = processFileMentions("Inspect (@src/app.ts), [@foo], and {@bar}.");

    expect(result.message).toBe("Inspect (src/app.ts), [foo], and {bar}.");
    expect(result.filesRead.map(file => file.path)).toEqual(["src/app.ts", "foo", "bar"]);
  });

  test("resolves punctuation-adjacent references without swallowing punctuation", () => {
    const result = processFileMentions("Inspect @src/app.ts,@foo; then (@bar). ");

    expect(result.message).toBe("Inspect src/app.ts,foo; then (bar). ");
    expect(result.filesRead.map(file => file.path)).toEqual(["src/app.ts", "foo", "bar"]);
  });

  test("preserves agent mentions while resolving file references", () => {
    const result = processFileMentions(`Use (@${agentName}) with [@foo].`);

    expect(result.message).toBe(`Use (@${agentName}) with [foo].`);
    expect(result.filesRead.map(file => file.path)).toEqual(["foo"]);
  });

  test("keeps existing agent mention parsing behavior", () => {
    const mentions = parseAtMentions(`@${agentName} summarize src/app.ts quickly`);

    expect(mentions).toEqual([
      {
        agentName,
        args: "summarize src/app.ts quickly",
      },
    ]);
  });

  test("tokenizes agent mentions before trailing bracket punctuation", () => {
    const mentions = parseAtMentions(`@${agentName})`);

    expect(mentions).toEqual([
      {
        agentName,
        args: ")",
      },
    ]);
  });
});
