import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  copilotSubprocessEnv,
  copilotSdkLaunchOptions,
  enumeratePathCandidates,
  isCopilotShim,
  resolveCopilotCliPath,
} from "./copilot.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTempCopilotBin(): { dir: string; bin: string } {
  const dir = mkdtempSync(join(tmpdir(), "atomic-copilot-test-"));
  const bin = join(dir, "copilot");
  writeFileSync(bin, "#!/bin/sh\necho copilot\n", { encoding: "utf-8" });
  chmodSync(bin, 0o755);
  return { dir, bin };
}

function makeEmptyTempDir(): string {
  return mkdtempSync(join(tmpdir(), "atomic-copilot-empty-"));
}

/** Creates a dir with a `copilot` file that has a node shebang (shim). */
function makeNodeShimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atomic-copilot-shim-"));
  const bin = join(dir, "copilot");
  writeFileSync(bin, "#!/usr/bin/env node\nconsole.log('shim');\n", { encoding: "utf-8" });
  chmodSync(bin, 0o755);
  return dir;
}

/** Creates a dir with a `copilot` file that has a .js extension. */
function makeJsExtensionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atomic-copilot-jsext-"));
  const bin = join(dir, "copilot.js");
  writeFileSync(bin, "#!/usr/bin/env node\n", { encoding: "utf-8" });
  chmodSync(bin, 0o755);
  return dir;
}

/** Creates a node_modules/.bin/copilot symlink pointing to a .js loader file. */
function makeNpmLoaderShimDir(): { dir: string; bin: string; target: string } {
  const dir = mkdtempSync(join(tmpdir(), "atomic-copilot-npmloader-"));
  const binDir = join(dir, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const target = join(dir, "npm-loader.js");
  writeFileSync(target, "// npm-loader.js shim\n", { encoding: "utf-8" });
  const bin = join(binDir, "copilot");
  symlinkSync(target, bin);
  return { dir, bin, target };
}

/** Creates a dir with a `copilot` file containing npm-loader.js marker in header. */
function makeNpmLoaderMarkerDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atomic-copilot-npmmarker-"));
  const bin = join(dir, "copilot");
  writeFileSync(bin, "#!/bin/sh\n# loads npm-loader.js\n", { encoding: "utf-8" });
  chmodSync(bin, 0o755);
  return dir;
}

// ── resolveCopilotCliPath ─────────────────────────────────────────────────

describe("resolveCopilotCliPath", () => {
  let origCliPath: string | undefined;
  let origPath: string | undefined;

  beforeEach(() => {
    origCliPath = process.env["COPILOT_CLI_PATH"];
    origPath = process.env["PATH"];
  });

  afterEach(() => {
    if (origCliPath === undefined) {
      delete process.env["COPILOT_CLI_PATH"];
    } else {
      process.env["COPILOT_CLI_PATH"] = origCliPath;
    }
    if (origPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = origPath;
    }
  });

  test("COPILOT_CLI_PATH env var takes precedence over PATH", () => {
    const explicit = "/custom/bin/copilot";
    process.env["COPILOT_CLI_PATH"] = explicit;
    // even if PATH has a copilot binary, the env var wins
    expect(resolveCopilotCliPath()).toBe(explicit);
  });

  test("PATH-resolved copilot binary populates cliPath when env var unset", () => {
    delete process.env["COPILOT_CLI_PATH"];
    const { dir, bin } = makeTempCopilotBin();
    process.env["PATH"] = `${dir}:${origPath ?? ""}`;
    const result = resolveCopilotCliPath();
    expect(result).toBe(bin);
  });

  test("returns undefined when copilot not on PATH and env var unset", () => {
    delete process.env["COPILOT_CLI_PATH"];
    const emptyDir = makeEmptyTempDir();
    process.env["PATH"] = emptyDir;
    const result = resolveCopilotCliPath();
    expect(result).toBeUndefined();
  });
});

// ── copilotSubprocessEnv ──────────────────────────────────────────────────

describe("copilotSubprocessEnv", () => {
  test("NODE_NO_WARNINGS is set to '1'", () => {
    const env = copilotSubprocessEnv({});
    expect(env["NODE_NO_WARNINGS"]).toBe("1");
  });

  test("UTF-8 locale defaults applied when base env empty", () => {
    const env = copilotSubprocessEnv({});
    expect(env["LANG"]).toBe("en_US.UTF-8");
    expect(env["LC_ALL"]).toBe("en_US.UTF-8");
    expect(env["LC_CTYPE"]).toBe("en_US.UTF-8");
  });

  test("UTF-8 env vars from base merged into result", () => {
    const base = {
      LANG: "fr_FR.UTF-8",
      LC_ALL: "fr_FR.UTF-8",
      LC_CTYPE: "fr_FR.UTF-8",
      MY_CUSTOM: "hello",
    };
    const env = copilotSubprocessEnv(base);
    expect(env["LANG"]).toBe("fr_FR.UTF-8");
    expect(env["LC_ALL"]).toBe("fr_FR.UTF-8");
    expect(env["MY_CUSTOM"]).toBe("hello");
    expect(env["NODE_NO_WARNINGS"]).toBe("1");
  });

  test("NODE_NO_WARNINGS=1 overrides any base value", () => {
    const env = copilotSubprocessEnv({ NODE_NO_WARNINGS: "0" });
    expect(env["NODE_NO_WARNINGS"]).toBe("1");
  });

  test("returns fresh object per call (no shared state)", () => {
    const a = copilotSubprocessEnv({});
    const b = copilotSubprocessEnv({});
    expect(a).not.toBe(b);
  });
});

// ── copilotSdkLaunchOptions ───────────────────────────────────────────────

describe("copilotSdkLaunchOptions", () => {
  let origCliPath: string | undefined;
  let origPath: string | undefined;

  beforeEach(() => {
    origCliPath = process.env["COPILOT_CLI_PATH"];
    origPath = process.env["PATH"];
  });

  afterEach(() => {
    if (origCliPath === undefined) {
      delete process.env["COPILOT_CLI_PATH"];
    } else {
      process.env["COPILOT_CLI_PATH"] = origCliPath;
    }
    if (origPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = origPath;
    }
  });

  test("env contains NODE_NO_WARNINGS=1", () => {
    const opts = copilotSdkLaunchOptions();
    expect(opts.env?.["NODE_NO_WARNINGS"]).toBe("1");
  });

  test("cliPath populated from COPILOT_CLI_PATH", () => {
    process.env["COPILOT_CLI_PATH"] = "/my/copilot";
    const opts = copilotSdkLaunchOptions();
    expect(opts.cliPath).toBe("/my/copilot");
  });

  test("cliPath omitted when copilot not resolvable", () => {
    delete process.env["COPILOT_CLI_PATH"];
    const emptyDir = makeEmptyTempDir();
    process.env["PATH"] = emptyDir;
    const opts = copilotSdkLaunchOptions();
    expect("cliPath" in opts).toBe(false);
  });

  test("cliPath populated from PATH-resolved binary", () => {
    delete process.env["COPILOT_CLI_PATH"];
    const { dir, bin } = makeTempCopilotBin();
    process.env["PATH"] = `${dir}:${origPath ?? ""}`;
    const opts = copilotSdkLaunchOptions();
    expect(opts.cliPath).toBe(bin);
  });

  test("cliPath omitted when only shim on PATH", () => {
    delete process.env["COPILOT_CLI_PATH"];
    const shimDir = makeNodeShimDir();
    process.env["PATH"] = shimDir;
    const opts = copilotSdkLaunchOptions();
    expect("cliPath" in opts).toBe(false);
  });
});

// ── isCopilotShim ─────────────────────────────────────────────────────────

describe("isCopilotShim", () => {
  test("returns true for .js extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-shim-jsext-"));
    const p = join(dir, "copilot.js");
    writeFileSync(p, "#!/usr/bin/env node\n", { encoding: "utf-8" });
    expect(isCopilotShim(p)).toBe(true);
  });

  test("returns true for .mjs extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-shim-mjs-"));
    const p = join(dir, "copilot.mjs");
    writeFileSync(p, "export default {}\n", { encoding: "utf-8" });
    expect(isCopilotShim(p)).toBe(true);
  });

  test("returns true for .cjs extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-shim-cjs-"));
    const p = join(dir, "copilot.cjs");
    writeFileSync(p, "module.exports = {}\n", { encoding: "utf-8" });
    expect(isCopilotShim(p)).toBe(true);
  });

  test("returns true for #!/usr/bin/env node shebang", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-shim-shebang-"));
    const p = join(dir, "copilot");
    writeFileSync(p, "#!/usr/bin/env node\nconsole.log('hi');\n", { encoding: "utf-8" });
    chmodSync(p, 0o755);
    expect(isCopilotShim(p)).toBe(true);
  });

  test("returns true for #!/usr/bin/node shebang", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-shim-shebang2-"));
    const p = join(dir, "copilot");
    writeFileSync(p, "#!/usr/bin/node\nconsole.log('hi');\n", { encoding: "utf-8" });
    chmodSync(p, 0o755);
    expect(isCopilotShim(p)).toBe(true);
  });

  test("returns true when header contains npm-loader.js marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-shim-marker-"));
    const p = join(dir, "copilot");
    writeFileSync(p, "#!/bin/sh\n# loads npm-loader.js internally\n", { encoding: "utf-8" });
    chmodSync(p, 0o755);
    expect(isCopilotShim(p)).toBe(true);
  });

  test("returns true for node_modules/.bin/copilot symlink pointing to .js file", () => {
    const { bin } = makeNpmLoaderShimDir();
    expect(isCopilotShim(bin)).toBe(true);
  });

  test("returns false for plain shell script binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-shim-shell-"));
    const p = join(dir, "copilot");
    writeFileSync(p, "#!/bin/sh\necho copilot\n", { encoding: "utf-8" });
    chmodSync(p, 0o755);
    expect(isCopilotShim(p)).toBe(false);
  });

  test("returns false for missing file (let SDK surface the error)", () => {
    expect(isCopilotShim("/nonexistent/path/copilot")).toBe(false);
  });
});

// ── enumeratePathCandidates ───────────────────────────────────────────────

describe("enumeratePathCandidates", () => {
  test("returns empty array when PATH has no matching binary", () => {
    const empty = makeEmptyTempDir();
    expect(enumeratePathCandidates("copilot", empty)).toEqual([]);
  });

  test("returns single match when one dir has binary", () => {
    const { dir, bin } = makeTempCopilotBin();
    const result = enumeratePathCandidates("copilot", dir);
    expect(result).toEqual([bin]);
  });

  test("returns ordered matches from multiple PATH dirs", () => {
    const { dir: dir1, bin: bin1 } = makeTempCopilotBin();
    const { dir: dir2, bin: bin2 } = makeTempCopilotBin();
    const result = enumeratePathCandidates("copilot", `${dir1}:${dir2}`);
    expect(result).toEqual([bin1, bin2]);
  });

  test("skips dirs that do not contain the binary", () => {
    const empty = makeEmptyTempDir();
    const { dir, bin } = makeTempCopilotBin();
    const result = enumeratePathCandidates("copilot", `${empty}:${dir}`);
    expect(result).toEqual([bin]);
  });
});

// ── resolveCopilotCliPath shim rejection ──────────────────────────────────

describe("resolveCopilotCliPath shim rejection", () => {
  let origCliPath: string | undefined;
  let origPath: string | undefined;

  beforeEach(() => {
    origCliPath = process.env["COPILOT_CLI_PATH"];
    origPath = process.env["PATH"];
    delete process.env["COPILOT_CLI_PATH"];
  });

  afterEach(() => {
    if (origCliPath === undefined) {
      delete process.env["COPILOT_CLI_PATH"];
    } else {
      process.env["COPILOT_CLI_PATH"] = origCliPath;
    }
    if (origPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = origPath;
    }
  });

  test("returns undefined when only node-shebang shim exists on PATH", () => {
    process.env["PATH"] = makeNodeShimDir();
    expect(resolveCopilotCliPath()).toBeUndefined();
  });

  test("returns undefined when only npm-loader.js symlink shim on PATH", () => {
    const { dir } = makeNpmLoaderShimDir();
    const binDir = join(dir, "node_modules", ".bin");
    process.env["PATH"] = binDir;
    expect(resolveCopilotCliPath()).toBeUndefined();
  });

  test("returns undefined when only npm-loader.js marker shim on PATH", () => {
    process.env["PATH"] = makeNpmLoaderMarkerDir();
    expect(resolveCopilotCliPath()).toBeUndefined();
  });

  test("skips shim and returns second PATH candidate (real binary)", () => {
    const shimDir = makeNodeShimDir();
    const { dir: realDir, bin: realBin } = makeTempCopilotBin();
    process.env["PATH"] = `${shimDir}:${realDir}`;
    expect(resolveCopilotCliPath()).toBe(realBin);
  });

  test("returns first non-shim when multiple real binaries on PATH", () => {
    const { dir: dir1, bin: bin1 } = makeTempCopilotBin();
    const { dir: dir2 } = makeTempCopilotBin();
    process.env["PATH"] = `${dir1}:${dir2}`;
    expect(resolveCopilotCliPath()).toBe(bin1);
  });
});
