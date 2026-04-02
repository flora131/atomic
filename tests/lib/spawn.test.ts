/**
 * Tests for pure utility functions in lib/spawn.ts
 */
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prependPath, getHomeDir, getBunBinDir, resolveBunExecutable } from "@/lib/spawn.ts";

// ---------------------------------------------------------------------------
// Environment save / restore
// ---------------------------------------------------------------------------
let savedPATH: string | undefined;
let savedHOME: string | undefined;
let savedUSERPROFILE: string | undefined;
let savedBunInstall: string | undefined;
let tempDirs: string[] = [];

beforeEach(() => {
  savedPATH = process.env.PATH;
  savedHOME = process.env.HOME;
  savedUSERPROFILE = process.env.USERPROFILE;
  savedBunInstall = process.env.BUN_INSTALL;
  tempDirs = [];
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

  if (savedBunInstall === undefined) {
    delete process.env.BUN_INSTALL;
  } else {
    process.env.BUN_INSTALL = savedBunInstall;
  }

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
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
  test("prefers BUN_INSTALL when set", () => {
    process.env.BUN_INSTALL = "/custom/bun";
    process.env.HOME = "/home/testuser";
    expect(getBunBinDir()).toBe("/custom/bun/bin");
  });

  test("returns path with .bun/bin suffix when home is available", () => {
    delete process.env.BUN_INSTALL;
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

// ---------------------------------------------------------------------------
// resolveBunExecutable
// ---------------------------------------------------------------------------
describe("resolveBunExecutable", () => {
  test("returns Bun.which result when bun is already on PATH", () => {
    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/bun" as ReturnType<typeof Bun.which>,
    );

    expect(resolveBunExecutable()).toBe("/usr/local/bin/bun");
    expect(whichSpy).toHaveBeenCalledWith("bun");
  });

  test("falls back to the default bun install location and prepends PATH", () => {
    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    const bunInstallDir = mkdtempSync(join(tmpdir(), "bun-install-"));
    tempDirs.push(bunInstallDir);
    const bunBinDir = join(bunInstallDir, "bin");
    mkdirSync(bunBinDir, { recursive: true });

    const bunExecutable = join(
      bunBinDir,
      process.platform === "win32" ? "bun.exe" : "bun",
    );
    writeFileSync(bunExecutable, "");
    process.env.BUN_INSTALL = bunInstallDir;
    process.env.PATH = "/usr/bin";

    expect(resolveBunExecutable()).toBe(bunExecutable);
    const pathDelimiter = process.platform === "win32" ? ";" : ":";
    expect(process.env.PATH).toBe(`${bunBinDir}${pathDelimiter}/usr/bin`);
    expect(whichSpy).toHaveBeenCalledWith("bun");
  });

  test("returns undefined when bun is not installed", () => {
    using whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    expect(resolveBunExecutable()).toBeUndefined();
    expect(whichSpy).toHaveBeenCalledWith("bun");
  });
});
