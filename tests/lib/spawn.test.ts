/**
 * Tests for pure utility functions in lib/spawn.ts
 */
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import {
  prependPath,
  getHomeDir,
  upgradeNpm,
  upgradePlaywrightCli,
  upgradeLiteparse,
} from "@/lib/spawn.ts";

// ---------------------------------------------------------------------------
// Environment save / restore
// ---------------------------------------------------------------------------
let savedPATH: string | undefined;
let savedHOME: string | undefined;
let savedUSERPROFILE: string | undefined;

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
// upgradePlaywrightCli — npm-only behaviour
// ---------------------------------------------------------------------------
describe("upgradePlaywrightCli", () => {
  test("succeeds via npm when npm install works", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/npm" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(0) as any,
    );

    await upgradePlaywrightCli();

    expect(spawnSpy).toHaveBeenCalled();
    const call = spawnSpy.mock.calls[0]![0] as any;
    expect(call.cmd).toEqual(["/usr/local/bin/npm", "install", "-g", "@playwright/cli@latest"]);
  });

  test("throws when npm is not available", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );

    await expect(upgradePlaywrightCli()).rejects.toThrow(
      "npm is not available to upgrade @playwright/cli.",
    );
  });

  test("throws when npm install fails", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/npm" as ReturnType<typeof Bun.which>,
    );
    using _spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(1, "", "install failed") as any,
    );

    await expect(upgradePlaywrightCli()).rejects.toThrow(
      "Failed to upgrade @playwright/cli: npm: install failed",
    );
  });
});

// ---------------------------------------------------------------------------
// upgradeLiteparse — npm-only behaviour
// ---------------------------------------------------------------------------
describe("upgradeLiteparse", () => {
  test("succeeds via npm when npm install works", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/npm" as ReturnType<typeof Bun.which>,
    );
    using spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(0) as any,
    );

    await upgradeLiteparse();

    expect(spawnSpy).toHaveBeenCalled();
    const call = spawnSpy.mock.calls[0]![0] as any;
    expect(call.cmd).toEqual(["/usr/local/bin/npm", "install", "-g", "@llamaindex/liteparse@latest"]);
  });

  test("throws when npm is not available", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );

    await expect(upgradeLiteparse()).rejects.toThrow(
      "npm is not available to upgrade @llamaindex/liteparse.",
    );
  });

  test("throws when npm install fails", async () => {
    using _whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/local/bin/npm" as ReturnType<typeof Bun.which>,
    );
    using _spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      createMockSubprocess(1, "", "install failed") as any,
    );

    await expect(upgradeLiteparse()).rejects.toThrow(
      "Failed to upgrade @llamaindex/liteparse: npm: install failed",
    );
  });
});
