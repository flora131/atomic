import { test, expect, describe } from "bun:test";
import { isCompiledBinaryRuntime, isInstalledPackage } from "./runtime-env.ts";

describe("isCompiledBinaryRuntime", () => {
  test("true for POSIX bunfs prefix", () => {
    expect(isCompiledBinaryRuntime("/$bunfs/root/src/lib")).toBe(true);
  });

  test("true for Windows bunfs prefix", () => {
    expect(isCompiledBinaryRuntime("\\$bunfs\\root\\src\\lib")).toBe(true);
  });

  test("true for Windows ~BUN compiled-binary prefix (backslash, upper-case drive)", () => {
    // Bun's actual Windows shape per oven-sh/bun#25500. `B:\~BUN\root\...`
    // is what `import.meta.dir` resolves to inside a `bun build --compile`d exe.
    expect(isCompiledBinaryRuntime("B:\\~BUN\\root\\packages\\atomic\\src\\lib")).toBe(true);
  });

  test("true for Windows ~BUN compiled-binary prefix (forward-slash, lower-case)", () => {
    expect(isCompiledBinaryRuntime("c:/~bun/root/x")).toBe(true);
  });

  test("true for Windows ~BUN path without drive letter prefix", () => {
    // Some runner images surface the path with normalization that drops or
    // rewrites the drive letter. As long as `~BUN` appears as a path segment,
    // it's a compiled binary.
    expect(isCompiledBinaryRuntime("\\~BUN\\root\\x")).toBe(true);
  });

  test("false for node_modules path", () => {
    expect(isCompiledBinaryRuntime("/home/user/node_modules/@bastani/atomic-sdk/src/lib")).toBe(false);
  });

  test("false for dev checkout path", () => {
    expect(isCompiledBinaryRuntime("/home/user/projects/atomic/packages/atomic-sdk/src/lib")).toBe(false);
  });

  test("false for empty string", () => {
    expect(isCompiledBinaryRuntime("")).toBe(false);
  });
});

describe("isInstalledPackage", () => {
  test("true for node_modules path", () => {
    expect(isInstalledPackage("/home/user/node_modules/@bastani/atomic-sdk/src/lib")).toBe(true);
  });

  test("true for POSIX bunfs path", () => {
    expect(isInstalledPackage("/$bunfs/root/src/lib")).toBe(true);
  });

  test("true for Windows bunfs path", () => {
    expect(isInstalledPackage("\\$bunfs\\root\\src\\lib")).toBe(true);
  });

  test("false for dev checkout path", () => {
    expect(isInstalledPackage("/home/user/projects/atomic/packages/atomic-sdk/src/lib")).toBe(false);
  });

  test("false for empty string", () => {
    expect(isInstalledPackage("")).toBe(false);
  });
});
