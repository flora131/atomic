import {
  test,
  expect,
  describe,
  afterEach,
  beforeEach,
} from "bun:test";
import {
  isCommandInstalled,
  getCommandPath,
  getCommandVersion,
  isWindows,
  isMacOS,
  isLinux,
  getScriptExtension,
  getOppositeScriptExtension,
  isWslInstalled,
  supportsColor,
  supportsTrueColor,
  supports256Color,
} from "@/services/system/detect.ts";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

describe("platform detection", () => {
  test("isLinux matches process.platform", () => {
    expect(isLinux()).toBe(process.platform === "linux");
  });

  test("isWindows matches process.platform", () => {
    expect(isWindows()).toBe(process.platform === "win32");
  });

  test("isMacOS matches process.platform", () => {
    expect(isMacOS()).toBe(process.platform === "darwin");
  });

  test("exactly one platform flag is true", () => {
    const flags = [isLinux(), isWindows(), isMacOS()];
    expect(flags.filter(Boolean).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Script extensions
// ---------------------------------------------------------------------------

describe("script extensions", () => {
  test("getScriptExtension returns .sh on non-Windows", () => {
    if (process.platform !== "win32") {
      expect(getScriptExtension()).toBe(".sh");
    }
  });

  test("getOppositeScriptExtension returns .ps1 on non-Windows", () => {
    if (process.platform !== "win32") {
      expect(getOppositeScriptExtension()).toBe(".ps1");
    }
  });

  test("extensions are complementary", () => {
    const ext = getScriptExtension();
    const opposite = getOppositeScriptExtension();
    expect(ext).not.toBe(opposite);
    expect([".sh", ".ps1"]).toContain(ext);
    expect([".sh", ".ps1"]).toContain(opposite);
  });
});

// ---------------------------------------------------------------------------
// Command detection
// ---------------------------------------------------------------------------

describe("isCommandInstalled", () => {
  test("returns true for a known command (ls)", () => {
    expect(isCommandInstalled("ls")).toBe(true);
  });

  test("returns false for a non-existent command", () => {
    expect(isCommandInstalled("__no_such_cmd_xyzzy__")).toBe(false);
  });
});

describe("getCommandPath", () => {
  test("returns an absolute path for a known command", () => {
    const p = getCommandPath("ls");
    expect(p).not.toBeNull();
    expect(p!.startsWith("/")).toBe(true);
  });

  test("returns null for a non-existent command", () => {
    expect(getCommandPath("__no_such_cmd_xyzzy__")).toBeNull();
  });
});

describe("getCommandVersion", () => {
  test("returns a version string for bun", () => {
    const version = getCommandVersion("bun");
    expect(version).not.toBeNull();
    expect(version!).toContain(".");
  });

  test("returns null for a non-existent command", () => {
    expect(getCommandVersion("__no_such_cmd_xyzzy__")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WSL detection
// ---------------------------------------------------------------------------

describe("isWslInstalled", () => {
  test("returns false on non-Windows", () => {
    if (process.platform !== "win32") {
      expect(isWslInstalled()).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Color support
// ---------------------------------------------------------------------------

describe("supportsColor", () => {
  const origNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  test("returns false when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    expect(supportsColor()).toBe(false);
  });

  test("returns true when NO_COLOR is unset", () => {
    delete process.env.NO_COLOR;
    expect(supportsColor()).toBe(true);
  });
});

describe("supportsTrueColor", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["NO_COLOR", "COLORTERM", "TERM_PROGRAM", "TERM"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("returns false when NO_COLOR is set", () => {
    process.env.NO_COLOR = "";
    expect(supportsTrueColor()).toBe(false);
  });

  test("returns true when COLORTERM is truecolor", () => {
    process.env.COLORTERM = "truecolor";
    expect(supportsTrueColor()).toBe(true);
  });

  test("returns true when COLORTERM is 24bit", () => {
    process.env.COLORTERM = "24bit";
    expect(supportsTrueColor()).toBe(true);
  });

  test("returns false for Apple_Terminal", () => {
    process.env.TERM_PROGRAM = "Apple_Terminal";
    expect(supportsTrueColor()).toBe(false);
  });

  test("returns true for known truecolor terminals", () => {
    for (const term of ["iTerm.app", "hyper", "WezTerm", "alacritty", "kitty", "ghostty"]) {
      process.env.TERM_PROGRAM = term;
      expect(supportsTrueColor()).toBe(true);
    }
  });

  test("returns true when TERM contains 24bit", () => {
    process.env.TERM = "xterm-24bit";
    expect(supportsTrueColor()).toBe(true);
  });

  test("returns true when TERM contains direct", () => {
    process.env.TERM = "xterm-direct";
    expect(supportsTrueColor()).toBe(true);
  });

  test("returns false when no truecolor indicators present", () => {
    expect(supportsTrueColor()).toBe(false);
  });
});

describe("supports256Color", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["TERM", "NO_COLOR", "COLORTERM", "TERM_PROGRAM"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("returns true when TERM includes 256color", () => {
    process.env.TERM = "xterm-256color";
    expect(supports256Color()).toBe(true);
  });

  test("returns true when supportsTrueColor is true", () => {
    process.env.COLORTERM = "truecolor";
    expect(supports256Color()).toBe(true);
  });

  test("returns false with basic TERM and no truecolor", () => {
    process.env.TERM = "xterm";
    expect(supports256Color()).toBe(false);
  });
});
