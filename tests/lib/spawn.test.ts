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
  upgradeBun,
  upgradeNpm,
  upgradeUv,
  upgradePlaywrightCli,
  upgradeLiteparse,
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
    delete process.env.BUN_INSTALL;
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

// ---------------------------------------------------------------------------
// Helpers for upgrade function tests
// ---------------------------------------------------------------------------

/**
 * Create a mock Bun.Subprocess-like object that runCommand can consume.
 * runCommand reads proc.stdout, proc.stderr (via new Response().text()),
 * and proc.exited.
 */
function createMockSubprocess(exitCode: number, stdout = "", stderr = "") {
  return {
    pid: 1,
    stdin: undefined,
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        if (stdout) controller.enqueue(new TextEncoder().encode(stdout));
        controller.close();
      },
    }),
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        if (stderr) controller.enqueue(new TextEncoder().encode(stderr));
        controller.close();
      },
    }),
    exited: Promise.resolve(exitCode),
    kill() {},
    ref() {},
    unref() {},
    killed: false,
    exitCode: null,
    signalCode: null,
    resourceUsage: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// upgradeBun
// ---------------------------------------------------------------------------
describe("upgradeBun", () => {
  test("runs 'bun upgrade' when bun is on PATH", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/bun" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(0, "Bun upgraded") as any,
    );

    await upgradeBun();

    expect(spawnSpy).toHaveBeenCalled();
    const call = spawnSpy.mock.calls[0]![0] as any;
    expect(call.cmd).toEqual(["/usr/local/bin/bun", "upgrade"]);
  });

  test("throws when bun upgrade fails", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/bun" as ReturnType<typeof Bun.which>,
    );
    using _spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(1, "", "upgrade error") as any,
    );

    await expect(upgradeBun()).rejects.toThrow("bun upgrade failed: upgrade error");
  });
});

// ---------------------------------------------------------------------------
// upgradeNpm
// ---------------------------------------------------------------------------
describe("upgradeNpm", () => {
  test("runs 'npm install -g npm@latest' when npm is on PATH", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/npm" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(0) as any,
    );

    await upgradeNpm();

    expect(spawnSpy).toHaveBeenCalled();
    const call = spawnSpy.mock.calls[0]![0] as any;
    expect(call.cmd).toEqual(["/usr/local/bin/npm", "install", "-g", "npm@latest"]);
  });

  test("throws with sudo hint when npm self-upgrade fails with permission error", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/npm" as ReturnType<typeof Bun.which>,
    );
    using _spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(1, "", "permission denied") as any,
    );

    await expect(upgradeNpm()).rejects.toThrow(
      "npm self-upgrade failed: permission denied\n" +
      "If this is a permissions issue, try: sudo npm install -g npm@latest",
    );
  });

  test("throws without sudo hint when npm self-upgrade fails for non-permission reasons", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/npm" as ReturnType<typeof Bun.which>,
    );
    using _spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(1, "", "network timeout") as any,
    );

    await expect(upgradeNpm()).rejects.toEqual(
      new Error("npm self-upgrade failed: network timeout"),
    );
  });
});

// ---------------------------------------------------------------------------
// upgradeUv
// ---------------------------------------------------------------------------
describe("upgradeUv", () => {
  test("runs 'uv self update' when uv is on PATH", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/uv" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(0) as any,
    );

    await upgradeUv();

    expect(spawnSpy).toHaveBeenCalled();
    const call = spawnSpy.mock.calls[0]![0] as any;
    expect(call.cmd).toEqual(["/usr/local/bin/uv", "self", "update"]);
  });

  test("throws when uv self update fails", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/uv" as ReturnType<typeof Bun.which>,
    );
    using _spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(1, "", "update error") as any,
    );

    await expect(upgradeUv()).rejects.toThrow("uv self update failed: update error");
  });
});

// ---------------------------------------------------------------------------
// upgradePlaywrightCli — fallback behaviour
// ---------------------------------------------------------------------------
describe("upgradePlaywrightCli", () => {
  test("succeeds via bun when bun install works", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/bun" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(0) as any,
    );

    await upgradePlaywrightCli();

    expect(spawnSpy).toHaveBeenCalled();
    const call = spawnSpy.mock.calls[0]![0] as any;
    expect(call.cmd).toEqual(["/usr/local/bin/bun", "install", "-g", "@playwright/cli@latest"]);
  });

  test("falls back to npm when bun install fails", async () => {
    let callCount = 0;
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/mock" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockImplementation((() => {
      callCount++;
      // First call (bun install -g) fails, second call (npm install -g) succeeds
      if (callCount === 1) return createMockSubprocess(1, "", "bun install failed");
      return createMockSubprocess(0);
    }) as any);

    await upgradePlaywrightCli();

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    const npmCall = spawnSpy.mock.calls[1]![0] as any;
    expect(npmCall.cmd).toEqual(["/usr/local/bin/mock", "install", "-g", "@playwright/cli@latest"]);
  });

  test("throws when neither bun nor npm can install", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    await expect(upgradePlaywrightCli()).rejects.toThrow(
      "Neither bun nor npm is available to upgrade @playwright/cli.",
    );
  });
});

// ---------------------------------------------------------------------------
// upgradeLiteparse — fallback behaviour
// ---------------------------------------------------------------------------
describe("upgradeLiteparse", () => {
  test("succeeds via bun when bun install works", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/bun" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(0) as any,
    );

    await upgradeLiteparse();

    expect(spawnSpy).toHaveBeenCalled();
    const call = spawnSpy.mock.calls[0]![0] as any;
    expect(call.cmd).toEqual(["/usr/local/bin/bun", "install", "-g", "@llamaindex/liteparse@latest"]);
  });

  test("falls back to npm when bun install fails", async () => {
    let callCount = 0;
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/mock" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockImplementation((() => {
      callCount++;
      if (callCount === 1) return createMockSubprocess(1, "", "bun install failed");
      return createMockSubprocess(0);
    }) as any);

    await upgradeLiteparse();

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    const npmCall = spawnSpy.mock.calls[1]![0] as any;
    expect(npmCall.cmd).toEqual(["/usr/local/bin/mock", "install", "-g", "@llamaindex/liteparse@latest"]);
  });

  test("throws when neither bun nor npm can install", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    delete process.env.BUN_INSTALL;
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    await expect(upgradeLiteparse()).rejects.toThrow(
      "Neither bun nor npm is available to upgrade @llamaindex/liteparse.",
    );
  });
});
