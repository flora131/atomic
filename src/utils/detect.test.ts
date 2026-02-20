/**
 * Tests for platform detection utilities in detect.ts
 */
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  mock,
  type Mock,
} from "bun:test";
import {
  isWindows,
  isMacOS,
  isLinux,
  getScriptExtension,
  getOppositeScriptExtension,
  supportsColor,
  supportsTrueColor,
  supports256Color,
  isCommandInstalled,
  getCommandPath,
  getCommandVersion,
  isWslInstalled,
  WSL_INSTALL_URL,
} from "./detect.ts";

// Store original env values for cleanup
let originalNoColor: string | undefined;
let originalColorTerm: string | undefined;
let originalTerm: string | undefined;

describe("Platform Detection", () => {
  test("should detect exactly one platform as true", () => {
    // Ensure mutual exclusivity - exactly one platform should be detected
    const platforms = [isWindows(), isMacOS(), isLinux()];
    const trueCount = platforms.filter((p) => p === true).length;

    expect(trueCount).toBe(1);
  });

  test("should detect current platform correctly", () => {
    const platform = process.platform;
    expect(isLinux()).toBe(platform === "linux");
    expect(isWindows()).toBe(platform === "win32");
    expect(isMacOS()).toBe(platform === "darwin");
  });

  test("should detect correct platform based on process.platform", () => {
    // Test that detection functions return correct values based on actual platform
    const platform = process.platform;

    if (platform === "linux") {
      expect(isLinux()).toBe(true);
      expect(isWindows()).toBe(false);
      expect(isMacOS()).toBe(false);
    } else if (platform === "win32") {
      expect(isWindows()).toBe(true);
      expect(isLinux()).toBe(false);
      expect(isMacOS()).toBe(false);
    } else if (platform === "darwin") {
      expect(isMacOS()).toBe(true);
      expect(isWindows()).toBe(false);
      expect(isLinux()).toBe(false);
    }
  });

  test("should return correct script extension for current platform", () => {
    expect(getScriptExtension()).toBe(isWindows() ? ".ps1" : ".sh");
  });

  test("should return correct script extension for current platform", () => {
    const extension = getScriptExtension();

    if (isWindows()) {
      expect(extension).toBe(".ps1");
    } else {
      // Unix-like systems (Linux, macOS)
      expect(extension).toBe(".sh");
    }
  });

  test("should return opposite script extension", () => {
    const extension = getScriptExtension();
    const opposite = getOppositeScriptExtension();

    // Opposite should be different from the current
    expect(extension).not.toBe(opposite);

    // If current is .sh, opposite should be .ps1 and vice versa
    if (extension === ".sh") {
      expect(opposite).toBe(".ps1");
    } else {
      expect(opposite).toBe(".sh");
    }
  });
});

describe("Color Detection", () => {
  beforeEach(() => {
    // Save original env values
    originalNoColor = process.env.NO_COLOR;
    originalColorTerm = process.env.COLORTERM;
    originalTerm = process.env.TERM;
  });

  afterEach(() => {
    // Restore original env values
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    if (originalColorTerm === undefined) {
      delete process.env.COLORTERM;
    } else {
      process.env.COLORTERM = originalColorTerm;
    }
    if (originalTerm === undefined) {
      delete process.env.TERM;
    } else {
      process.env.TERM = originalTerm;
    }
  });

  describe("supportsColor", () => {
    test("should return true when NO_COLOR is not set", () => {
      delete process.env.NO_COLOR;
      expect(supportsColor()).toBe(true);
    });

    test("should return false when NO_COLOR is set to empty string", () => {
      process.env.NO_COLOR = "";
      expect(supportsColor()).toBe(false);
    });

    test("should return false when NO_COLOR is set to any value", () => {
      process.env.NO_COLOR = "1";
      expect(supportsColor()).toBe(false);
    });
  });

  describe("supportsTrueColor", () => {
    test("should return true by default (modern terminals)", () => {
      delete process.env.NO_COLOR;
      expect(supportsTrueColor()).toBe(true);
    });

    test("should return false when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      expect(supportsTrueColor()).toBe(false);
    });
  });

  describe("supports256Color", () => {
    test("should return true when TERM includes 256color", () => {
      delete process.env.NO_COLOR;
      process.env.TERM = "xterm-256color";
      expect(supports256Color()).toBe(true);
    });

    test("should return true when supportsTrueColor returns true", () => {
      delete process.env.NO_COLOR;
      process.env.TERM = "xterm";
      // Since supportsTrueColor returns true by default, this should be true
      expect(supports256Color()).toBe(true);
    });

    test("should return true when TERM includes 256color even if NO_COLOR is set", () => {
      // Note: supports256Color checks TERM first, then falls back to supportsTrueColor
      // If TERM explicitly includes 256color, it returns true regardless of NO_COLOR
      process.env.NO_COLOR = "1";
      process.env.TERM = "xterm-256color";
      expect(supports256Color()).toBe(true);
    });

    test("should return false when NO_COLOR is set and TERM does not include 256color", () => {
      // When TERM doesn't have 256color, it falls back to supportsTrueColor
      // which respects NO_COLOR
      process.env.NO_COLOR = "1";
      process.env.TERM = "xterm";
      expect(supports256Color()).toBe(false);
    });
  });
});

describe("Command Detection", () => {
  describe("isCommandInstalled", () => {
    test("should return true for 'bun' command (known to be installed)", () => {
      // Bun is definitely installed since we're running tests with it
      expect(isCommandInstalled("bun")).toBe(true);
    });

    test("should return false for non-existent command", () => {
      expect(isCommandInstalled("this-command-definitely-does-not-exist-xyz")).toBe(false);
    });

    test("should return true for a common command", () => {
      const cmd = process.platform === "win32" ? "cmd" : "sh";
      expect(isCommandInstalled(cmd)).toBe(true);
    });
  });

  describe("getCommandPath", () => {
    test("should return a path for 'bun' command", () => {
      const path = getCommandPath("bun");
      expect(path).not.toBeNull();
      expect(path).toContain("bun");
    });

    test("should return null for non-existent command", () => {
      expect(getCommandPath("this-command-definitely-does-not-exist-xyz")).toBeNull();
    });

    test("should return a path for a common command", () => {
      const cmd = process.platform === "win32" ? "cmd" : "sh";
      const path = getCommandPath(cmd);
      expect(path).not.toBeNull();
    });
  });

  describe("getCommandVersion", () => {
    test("should return version string for 'bun' command", () => {
      const version = getCommandVersion("bun");
      expect(version).not.toBeNull();
      expect(typeof version).toBe("string");
      // Bun version format is typically X.Y.Z
      expect(version!.length).toBeGreaterThan(0);
    });

    test("should return null for non-existent command", () => {
      expect(getCommandVersion("this-command-definitely-does-not-exist-xyz")).toBeNull();
    });
  });
});

describe("WSL Detection", () => {
  test("should return false on non-Windows platforms", () => {
    // On Linux, isWslInstalled should return false
    if (isLinux()) {
      expect(isWslInstalled()).toBe(false);
    }
  });

  test("should return false on macOS", () => {
    if (isMacOS()) {
      expect(isWslInstalled()).toBe(false);
    }
  });
});

describe("WSL_INSTALL_URL constant", () => {
  test("should be a valid Microsoft URL", () => {
    expect(WSL_INSTALL_URL).toBe(
      "https://learn.microsoft.com/en-us/windows/wsl/install",
    );
  });
});

describe("supportsColor — additional edge cases", () => {
  let originalNoColor: string | undefined;

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR;
  });

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  test("should return false when NO_COLOR is set to 'false' (any value disables color)", () => {
    process.env.NO_COLOR = "false";
    expect(supportsColor()).toBe(false);
  });

  test("should return false when NO_COLOR is set to '0'", () => {
    process.env.NO_COLOR = "0";
    expect(supportsColor()).toBe(false);
  });

  test("should return false when NO_COLOR is set to 'true'", () => {
    process.env.NO_COLOR = "true";
    expect(supportsColor()).toBe(false);
  });
});

describe("supportsTrueColor — additional edge cases", () => {
  let originalNoColor: string | undefined;
  let originalColorTerm: string | undefined;

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR;
    originalColorTerm = process.env.COLORTERM;
  });

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    if (originalColorTerm === undefined) {
      delete process.env.COLORTERM;
    } else {
      process.env.COLORTERM = originalColorTerm;
    }
  });

  test("should return true when COLORTERM is set to 'truecolor'", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    expect(supportsTrueColor()).toBe(true);
  });

  test("should return true when COLORTERM is set to '24bit'", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "24bit";
    expect(supportsTrueColor()).toBe(true);
  });

  test("should return false when NO_COLOR is set even if COLORTERM indicates truecolor", () => {
    process.env.NO_COLOR = "1";
    process.env.COLORTERM = "truecolor";
    expect(supportsTrueColor()).toBe(false);
  });

  test("should return true when COLORTERM is unset and NO_COLOR is unset", () => {
    delete process.env.NO_COLOR;
    delete process.env.COLORTERM;
    expect(supportsTrueColor()).toBe(true);
  });
});

describe("supports256Color — additional edge cases", () => {
  let originalNoColor: string | undefined;
  let originalTerm: string | undefined;

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR;
    originalTerm = process.env.TERM;
  });

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    if (originalTerm === undefined) {
      delete process.env.TERM;
    } else {
      process.env.TERM = originalTerm;
    }
  });

  test("should return true when TERM is empty but truecolor is supported", () => {
    delete process.env.NO_COLOR;
    process.env.TERM = "";
    // With NO_COLOR unset, supportsTrueColor returns true, so supports256Color returns true
    expect(supports256Color()).toBe(true);
  });

  test("should return true when TERM is unset but truecolor is supported", () => {
    delete process.env.NO_COLOR;
    delete process.env.TERM;
    expect(supports256Color()).toBe(true);
  });

  test("should return false when TERM is 'dumb' and NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    process.env.TERM = "dumb";
    expect(supports256Color()).toBe(false);
  });
});

describe("isCommandInstalled — with spyOn", () => {
  test("should delegate to Bun.which and return true when path is found", () => {
    const whichSpy = spyOn(Bun, "which").mockReturnValue(
      "/usr/bin/fake-command" as ReturnType<typeof Bun.which>,
    );
    expect(isCommandInstalled("fake-command")).toBe(true);
    expect(whichSpy).toHaveBeenCalledWith("fake-command");
    whichSpy.mockRestore();
  });

  test("should delegate to Bun.which and return false when path is null", () => {
    const whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    expect(isCommandInstalled("missing-command")).toBe(false);
    expect(whichSpy).toHaveBeenCalledWith("missing-command");
    whichSpy.mockRestore();
  });
});

describe("getCommandPath — additional tests", () => {
  test("should return an absolute path for known commands", () => {
    const path = getCommandPath("bun");
    expect(path).not.toBeNull();
    // Absolute paths start with / on Unix or drive letter on Windows
    const isAbsolute = path!.startsWith("/") || /^[A-Za-z]:/.test(path!);
    expect(isAbsolute).toBe(true);
  });

  test("should delegate to Bun.which and return the resolved path", () => {
    const expectedPath = "/usr/local/bin/my-tool";
    const whichSpy = spyOn(Bun, "which").mockReturnValue(
      expectedPath as ReturnType<typeof Bun.which>,
    );
    const result = getCommandPath("my-tool");
    expect(result).toBe(expectedPath);
    expect(whichSpy).toHaveBeenCalledWith("my-tool");
    whichSpy.mockRestore();
  });

  test("should return null via Bun.which when command does not exist", () => {
    const whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    const result = getCommandPath("nonexistent-tool");
    expect(result).toBeNull();
    whichSpy.mockRestore();
  });
});

describe("getCommandVersion — additional tests", () => {
  test("should return a version string matching semver-like pattern for bun", () => {
    const version = getCommandVersion("bun");
    expect(version).not.toBeNull();
    // Bun version output contains a semver-like version number
    expect(/\d+\.\d+\.\d+/.test(version!)).toBe(true);
  });

  test("should return null when Bun.which returns null", () => {
    const whichSpy = spyOn(Bun, "which").mockReturnValue(
      null as ReturnType<typeof Bun.which>,
    );
    const result = getCommandVersion("nonexistent");
    expect(result).toBeNull();
    expect(whichSpy).toHaveBeenCalledWith("nonexistent");
    whichSpy.mockRestore();
  });
});
