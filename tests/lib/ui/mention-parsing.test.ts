import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasAnyAtReferenceToken,
  processFileMentions,
} from "@/lib/ui/mention-parsing.ts";

describe("mention parsing", () => {
  let originalCwd = "";
  let testDir = "";

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `atomic-mention-parsing-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(join(testDir, "src", "app.ts"), "export const app = true;\n");
    writeFileSync(join(testDir, "foo"), "foo\n");
    writeFileSync(join(testDir, "bar"), "bar\n");
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
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
});
