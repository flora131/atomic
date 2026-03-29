/**
 * Tests for pure utility functions in lib/spawn.ts
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { prependPath, getHomeDir, getBunBinDir } from "@/lib/spawn.ts";

// ---------------------------------------------------------------------------
// Environment save / restore
// ---------------------------------------------------------------------------
let savedPATH: string | undefined;
let savedHOME: string | undefined;
let savedUSERPROFILE: string | undefined;

beforeEach(() => {
  savedPATH = process.env.PATH;
  savedHOME = process.env.HOME;
  savedUSERPROFILE = process.env.USERPROFILE;
});

afterEach(() => {
  // Restore originals (delete if they were undefined)
  if (savedPATH === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = savedPATH;
  }

  if (savedHOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = savedHOME;
  }

  if (savedUSERPROFILE === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = savedUSERPROFILE;
  }
});

// ---------------------------------------------------------------------------
// prependPath
// ---------------------------------------------------------------------------
describe("prependPath", () => {
  test("prepends directory to PATH", () => {
    process.env.PATH = "/usr/bin:/bin";
    prependPath("/my/dir");
    expect(process.env.PATH).toBe("/my/dir:/usr/bin:/bin");
  });

  test("does not duplicate if directory is already present", () => {
    process.env.PATH = "/my/dir:/usr/bin";
    prependPath("/my/dir");
    expect(process.env.PATH).toBe("/my/dir:/usr/bin");
  });

  test("handles empty PATH", () => {
    process.env.PATH = "";
    prependPath("/my/dir");
    expect(process.env.PATH).toBe("/my/dir:");
  });

  test("handles undefined PATH gracefully", () => {
    delete process.env.PATH;
    prependPath("/my/dir");
    expect(String(process.env["PATH"])).toBe("/my/dir:");
  });
});

// ---------------------------------------------------------------------------
// getHomeDir
// ---------------------------------------------------------------------------
describe("getHomeDir", () => {
  test("returns HOME env var when set", () => {
    process.env.HOME = "/home/testuser";
    process.env.USERPROFILE = "C:\\Users\\testuser";
    expect(getHomeDir()).toBe("/home/testuser");
  });

  test("falls back to USERPROFILE when HOME is not set", () => {
    delete process.env.HOME;
    process.env.USERPROFILE = "C:\\Users\\testuser";
    expect(getHomeDir()).toBe("C:\\Users\\testuser");
  });

  test("returns undefined if neither HOME nor USERPROFILE is set", () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(getHomeDir()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getBunBinDir
// ---------------------------------------------------------------------------
describe("getBunBinDir", () => {
  test("returns path with .bun/bin suffix when home is available", () => {
    process.env.HOME = "/home/testuser";
    const result = getBunBinDir();
    expect(result).toBe("/home/testuser/.bun/bin");
  });

  test("returns undefined when no home dir is available", () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(getBunBinDir()).toBeUndefined();
  });
});
