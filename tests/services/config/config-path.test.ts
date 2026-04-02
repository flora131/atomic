import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getBinaryDataDir,
  getConfigRoot,
  getBinaryInstallDir,
  getBinaryPath,
  configDataDirExists,
  detectInstallationType,
  ensureConfigDataDir,
} from "@/services/config/config-path.ts";

async function createBinaryConfigData(dataDir: string): Promise<void> {
  await mkdir(join(dataDir, ".claude"), { recursive: true });
  await mkdir(join(dataDir, ".opencode"), { recursive: true });
  await mkdir(join(dataDir, ".github", "skills"), { recursive: true });
  await mkdir(join(dataDir, ".github", "agents"), { recursive: true });
  await mkdir(join(dataDir, ".vscode"), { recursive: true });
  await writeFile(join(dataDir, ".github", "lsp.json"), "{}");
  await writeFile(join(dataDir, ".vscode", "mcp.json"), "{}");
}

/**
 * Tests for config-path.ts pure/deterministic functions.
 *
 * Note: detectInstallationType() depends on import.meta.dir, which in
 * dev/test mode returns "source". We test behaviors observable under
 * that installation type (non-binary), since mocking import.meta.dir
 * is not practical.
 */

describe("detectInstallationType", () => {
  test("returns 'source' when running from source/dev mode", () => {
    // In the test environment, import.meta.dir won't contain '$bunfs' or 'node_modules'
    expect(detectInstallationType()).toBe("source");
  });
});

describe("getBinaryDataDir", () => {
  let savedXdgDataHome: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedXdgDataHome = process.env.XDG_DATA_HOME;
    savedHome = process.env.HOME;
  });

  afterEach(() => {
    if (savedXdgDataHome !== undefined) {
      process.env.XDG_DATA_HOME = savedXdgDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }

    if (savedHome !== undefined) {
      process.env.HOME = savedHome;
    } else {
      delete process.env.HOME;
    }
  });

  test("uses XDG_DATA_HOME when set", () => {
    process.env.XDG_DATA_HOME = "/custom/data";
    const result = getBinaryDataDir();
    expect(result).toBe(join("/custom/data", "atomic"));
  });

  test("falls back to HOME/.local/share when XDG_DATA_HOME is not set", () => {
    delete process.env.XDG_DATA_HOME;
    process.env.HOME = "/home/testuser";
    const result = getBinaryDataDir();
    expect(result).toBe(join("/home/testuser", ".local", "share", "atomic"));
  });

  test("handles empty HOME when XDG_DATA_HOME is not set", () => {
    delete process.env.XDG_DATA_HOME;
    process.env.HOME = "";
    const result = getBinaryDataDir();
    expect(result).toBe(join("", ".local", "share", "atomic"));
  });

  test("prefers XDG_DATA_HOME over HOME", () => {
    process.env.XDG_DATA_HOME = "/xdg/data";
    process.env.HOME = "/home/testuser";
    const result = getBinaryDataDir();
    expect(result).toBe(join("/xdg/data", "atomic"));
  });

  test("result always ends with 'atomic' directory", () => {
    process.env.XDG_DATA_HOME = "/some/path";
    const result = getBinaryDataDir();
    expect(result.endsWith("atomic")).toBe(true);
  });
});

describe("getConfigRoot", () => {
  test("returns a path that is a parent directory (for source installs)", () => {
    // In source mode, getConfigRoot() resolves to the repo root
    // by navigating up 3 levels from src/services/config/
    const result = getConfigRoot();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns a path that does not contain 'src/services/config'", () => {
    // The config root should be the repo root, not the source file's directory
    const result = getConfigRoot();
    expect(result).not.toContain(join("src", "services", "config"));
  });

  test("returns a consistent path on repeated calls", () => {
    const result1 = getConfigRoot();
    const result2 = getConfigRoot();
    expect(result1).toBe(result2);
  });
});

describe("getBinaryInstallDir", () => {
  let savedAtomicInstallDir: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedAtomicInstallDir = process.env.ATOMIC_INSTALL_DIR;
    savedHome = process.env.HOME;
  });

  afterEach(() => {
    if (savedAtomicInstallDir !== undefined) {
      process.env.ATOMIC_INSTALL_DIR = savedAtomicInstallDir;
    } else {
      delete process.env.ATOMIC_INSTALL_DIR;
    }

    if (savedHome !== undefined) {
      process.env.HOME = savedHome;
    } else {
      delete process.env.HOME;
    }
  });

  test("respects ATOMIC_INSTALL_DIR when set (non-binary install)", () => {
    process.env.ATOMIC_INSTALL_DIR = "/custom/install/dir";
    const result = getBinaryInstallDir();
    expect(result).toBe("/custom/install/dir");
  });

  test("falls back to HOME/.local/bin when ATOMIC_INSTALL_DIR is not set", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    process.env.HOME = "/home/testuser";
    const result = getBinaryInstallDir();
    expect(result).toBe(join("/home/testuser", ".local", "bin"));
  });

  test("handles empty HOME when ATOMIC_INSTALL_DIR is not set", () => {
    delete process.env.ATOMIC_INSTALL_DIR;
    process.env.HOME = "";
    const result = getBinaryInstallDir();
    expect(result).toBe(join("", ".local", "bin"));
  });
});

describe("getBinaryPath", () => {
  let savedAtomicInstallDir: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedAtomicInstallDir = process.env.ATOMIC_INSTALL_DIR;
    savedHome = process.env.HOME;
  });

  afterEach(() => {
    if (savedAtomicInstallDir !== undefined) {
      process.env.ATOMIC_INSTALL_DIR = savedAtomicInstallDir;
    } else {
      delete process.env.ATOMIC_INSTALL_DIR;
    }

    if (savedHome !== undefined) {
      process.env.HOME = savedHome;
    } else {
      delete process.env.HOME;
    }
  });

  test("returns path ending with 'atomic' on unix (non-binary install)", () => {
    // On Linux (non-Windows), the binary name is 'atomic'
    delete process.env.ATOMIC_INSTALL_DIR;
    process.env.HOME = "/home/testuser";
    const result = getBinaryPath();
    expect(result).toBe(join("/home/testuser", ".local", "bin", "atomic"));
  });

  test("uses ATOMIC_INSTALL_DIR for the directory portion", () => {
    process.env.ATOMIC_INSTALL_DIR = "/opt/bin";
    const result = getBinaryPath();
    expect(result).toBe(join("/opt/bin", "atomic"));
  });

  test("binary path is inside the install dir", () => {
    process.env.ATOMIC_INSTALL_DIR = "/custom/path";
    const result = getBinaryPath();
    expect(result.startsWith("/custom/path")).toBe(true);
  });
});

describe("configDataDirExists", () => {
  test("returns true for non-binary installs (source/dev mode)", () => {
    // In source/dev mode, detectInstallationType() returns "source",
    // so configDataDirExists() always returns true without checking the filesystem
    expect(configDataDirExists()).toBe(true);
  });

  test("return value is a boolean", () => {
    const result = configDataDirExists();
    expect(typeof result).toBe("boolean");
  });

  describe("binary installs", () => {
    let savedXdgDataHome: string | undefined;
    let savedHome: string | undefined;
    let tempRoot: string;

    beforeEach(async () => {
      savedXdgDataHome = process.env.XDG_DATA_HOME;
      savedHome = process.env.HOME;
      tempRoot = await mkdtemp(join(tmpdir(), "atomic-config-data-"));
      process.env.XDG_DATA_HOME = tempRoot;
      process.env.HOME = tempRoot;
    });

    afterEach(async () => {
      if (savedXdgDataHome !== undefined) {
        process.env.XDG_DATA_HOME = savedXdgDataHome;
      } else {
        delete process.env.XDG_DATA_HOME;
      }

      if (savedHome !== undefined) {
        process.env.HOME = savedHome;
      } else {
        delete process.env.HOME;
      }

      await rm(tempRoot, { recursive: true, force: true });
    });

    test("returns false when the binary data dir does not exist", () => {
      expect(configDataDirExists("binary")).toBe(false);
    });

    test("does not treat an empty binary data dir as installed config", async () => {
      await mkdir(getBinaryDataDir(), { recursive: true });
      expect(configDataDirExists("binary")).toBe(false);
    });

    test("returns false when required binary config assets are missing", async () => {
      await mkdir(join(getBinaryDataDir(), ".github", "skills"), { recursive: true });
      expect(configDataDirExists("binary")).toBe(false);
    });

    test("returns true when all required binary config assets are present", async () => {
      await createBinaryConfigData(getBinaryDataDir());
      expect(configDataDirExists("binary")).toBe(true);
    });
  });
});

describe("ensureConfigDataDir", () => {
  test("returns immediately (no-op) when configDataDirExists() is true", async () => {
    // In source/dev mode, configDataDirExists() returns true,
    // so ensureConfigDataDir should short-circuit and return void
    const result = await ensureConfigDataDir("1.0.0");
    expect(result).toBeUndefined();
  });

  test("does not throw for any version string format", async () => {
    // Since it short-circuits, it should never throw regardless of version format
    await expect(ensureConfigDataDir("1.0.0")).resolves.toBeUndefined();
    await expect(ensureConfigDataDir("v1.0.0")).resolves.toBeUndefined();
    await expect(ensureConfigDataDir("")).resolves.toBeUndefined();
  });

  test("returns a Promise", () => {
    const result = ensureConfigDataDir("1.0.0");
    expect(result).toBeInstanceOf(Promise);
  });

  test("returns immediately for binary installs when required config data already exists", async () => {
    const savedXdgDataHome = process.env.XDG_DATA_HOME;
    const savedHome = process.env.HOME;
    const tempRoot = await mkdtemp(join(tmpdir(), "atomic-config-ensure-"));

    try {
      process.env.XDG_DATA_HOME = tempRoot;
      process.env.HOME = tempRoot;
      await createBinaryConfigData(getBinaryDataDir());

      await expect(ensureConfigDataDir("1.0.0", "binary")).resolves.toBeUndefined();
    } finally {
      if (savedXdgDataHome !== undefined) {
        process.env.XDG_DATA_HOME = savedXdgDataHome;
      } else {
        delete process.env.XDG_DATA_HOME;
      }

      if (savedHome !== undefined) {
        process.env.HOME = savedHome;
      } else {
        delete process.env.HOME;
      }

      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
