/**
 * Tests for pure utility functions in lib/spawn.ts
 */
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  prependPath,
  getHomeDir,
  getBunBinDir,
  getBunGlobalInstallDir,
  resolveBunExecutable,
} from "@/lib/spawn.ts";

// ---------------------------------------------------------------------------
// Environment save / restore
// ---------------------------------------------------------------------------
let savedPATH: string | undefined;
let savedHOME: string | undefined;
let savedUSERPROFILE: string | undefined;
let savedBunInstall: string | undefined;
let tempDirs: string[] = [];

const pathDelimiter = process.platform === "win32" ? ";" : ":";
const samplePathEntries =
  process.platform === "win32"
    ? ["C:\\Windows\\System32", "C:\\Windows"]
    : ["/usr/bin", "/bin"];
const prependedDir = process.platform === "win32" ? "C:\\my\\dir" : "/my/dir";

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
    process.env.PATH = samplePathEntries.join(pathDelimiter);
    prependPath(prependedDir);
    expect(process.env.PATH).toBe(
      `${prependedDir}${pathDelimiter}${samplePathEntries.join(pathDelimiter)}`,
    );
  });

  test("does not duplicate if directory is already present", () => {
    process.env.PATH = [prependedDir, samplePathEntries[0]].join(pathDelimiter);
    prependPath(prependedDir);
    expect(process.env.PATH).toBe([prependedDir, samplePathEntries[0]].join(pathDelimiter));
  });

  test("handles empty PATH", () => {
    process.env.PATH = "";
    prependPath(prependedDir);
    expect(process.env.PATH).toBe(`${prependedDir}${pathDelimiter}`);
  });

  test("handles undefined PATH gracefully", () => {
    delete process.env.PATH;
    prependPath(prependedDir);
    expect(String(process.env["PATH"])).toBe(`${prependedDir}${pathDelimiter}`);
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
  test("prefers BUN_INSTALL over HOME/.bun when both are set", () => {
    const bunInstallDir = join(tmpdir(), "custom-bun");
    const homeDir = join(tmpdir(), "home-testuser");
    process.env.BUN_INSTALL = bunInstallDir;
    process.env.HOME = homeDir;
    expect(getBunBinDir()).toBe(join(bunInstallDir, "bin"));
  });

  test("returns path with .bun/bin suffix when home is available", () => {
    delete process.env.BUN_INSTALL;
    process.env.HOME = join(tmpdir(), "home-testuser");
    const result = getBunBinDir();
    expect(result).toBe(join(process.env.HOME, ".bun", "bin"));
  });

  test("falls back to USERPROFILE when HOME is not set", () => {
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    process.env.USERPROFILE = join(tmpdir(), "userprofile-testuser");
    expect(getBunBinDir()).toBe(join(process.env.USERPROFILE, ".bun", "bin"));
  });

  test("returns undefined when no home dir is available", () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(getBunBinDir()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getBunGlobalInstallDir
// ---------------------------------------------------------------------------
describe("getBunGlobalInstallDir", () => {
  test("prefers BUN_INSTALL over HOME/.bun when both are set", () => {
    const bunInstallDir = join(tmpdir(), "custom-bun");
    const homeDir = join(tmpdir(), "home-testuser");
    process.env.BUN_INSTALL = bunInstallDir;
    process.env.HOME = homeDir;
    expect(getBunGlobalInstallDir()).toBe(join(bunInstallDir, "install", "global"));
  });

  test("returns path with .bun/install/global suffix when home is available", () => {
    delete process.env.BUN_INSTALL;
    process.env.HOME = join(tmpdir(), "home-testuser");
    expect(getBunGlobalInstallDir()).toBe(join(process.env.HOME, ".bun", "install", "global"));
  });

  test("falls back to USERPROFILE when HOME is not set", () => {
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    process.env.USERPROFILE = join(tmpdir(), "userprofile-testuser");
    expect(getBunGlobalInstallDir()).toBe(
      join(process.env.USERPROFILE, ".bun", "install", "global"),
    );
  });

  test("returns undefined when no home dir is available", () => {
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(getBunGlobalInstallDir()).toBeUndefined();
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
    process.env.PATH = samplePathEntries[0];

    expect(resolveBunExecutable()).toBe(bunExecutable);
    expect(process.env.PATH).toBe(`${bunBinDir}${pathDelimiter}${samplePathEntries[0]}`);
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
