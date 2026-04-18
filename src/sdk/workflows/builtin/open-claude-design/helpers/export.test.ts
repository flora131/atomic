import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import {
  DESIGN_OUTPUT_BASE,
  OUTPUT_PREFIX,
  EXPORT_PREFIX,
  getTimestamp,
  getTimestampedOutputDir,
  getTimestampedExportDir,
  ensureDir,
  isSensitiveFile,
  filterSensitiveFiles,
  copyDesignFiles,
  ensureOutputDirs,
} from "./export";

const TMP_DIR = path.join(
  import.meta.dir,
  "__test_tmp__",
);

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("Constants", () => {
  test("DESIGN_OUTPUT_BASE is .open-claude-design", () => {
    expect(DESIGN_OUTPUT_BASE).toBe(".open-claude-design");
  });

  test("OUTPUT_PREFIX is output", () => {
    expect(OUTPUT_PREFIX).toBe("output");
  });

  test("EXPORT_PREFIX is export", () => {
    expect(EXPORT_PREFIX).toBe("export");
  });
});

describe("getTimestamp", () => {
  test("returns a string", () => {
    expect(typeof getTimestamp()).toBe("string");
  });

  test("matches YYYY-MM-DDTHH-mm-ss format", () => {
    const ts = getTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  test("contains no colons", () => {
    const ts = getTimestamp();
    expect(ts).not.toContain(":");
  });

  test("contains no periods", () => {
    const ts = getTimestamp();
    expect(ts).not.toContain(".");
  });

  test("is filesystem-safe (no special chars besides - and T)", () => {
    const ts = getTimestamp();
    expect(ts).toMatch(/^[0-9T\-]+$/);
  });

  test("two calls close in time have the same date prefix", () => {
    const ts1 = getTimestamp();
    const ts2 = getTimestamp();
    // They should both start with the same date (YYYY-MM-DD)
    expect(ts1.slice(0, 10)).toBe(ts2.slice(0, 10));
  });
});

describe("getTimestampedOutputDir", () => {
  test("returns path under root/.open-claude-design", () => {
    const dir = getTimestampedOutputDir("/tmp/myproject");
    expect(dir.startsWith("/tmp/myproject/.open-claude-design/output-")).toBe(true);
  });

  test("uses OUTPUT_PREFIX", () => {
    const dir = getTimestampedOutputDir("/tmp/myproject");
    const base = path.basename(dir);
    expect(base.startsWith(OUTPUT_PREFIX + "-")).toBe(true);
  });

  test("appends timestamp after prefix", () => {
    const dir = getTimestampedOutputDir("/tmp/myproject");
    const base = path.basename(dir);
    const ts = base.slice(OUTPUT_PREFIX.length + 1);
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe("getTimestampedExportDir", () => {
  test("returns path under root/.open-claude-design", () => {
    const dir = getTimestampedExportDir("/tmp/myproject");
    expect(dir.startsWith("/tmp/myproject/.open-claude-design/export-")).toBe(true);
  });

  test("uses EXPORT_PREFIX", () => {
    const dir = getTimestampedExportDir("/tmp/myproject");
    const base = path.basename(dir);
    expect(base.startsWith(EXPORT_PREFIX + "-")).toBe(true);
  });

  test("appends timestamp after prefix", () => {
    const dir = getTimestampedExportDir("/tmp/myproject");
    const base = path.basename(dir);
    const ts = base.slice(EXPORT_PREFIX.length + 1);
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe("ensureDir", () => {
  test("creates a new directory", async () => {
    const newDir = path.join(TMP_DIR, "new-dir");
    await ensureDir(newDir);
    const stat = await Bun.file(newDir).exists();
    // Use readdir to confirm directory exists
    const contents = await readdir(newDir);
    expect(Array.isArray(contents)).toBe(true);
  });

  test("creates nested directories recursively", async () => {
    const nestedDir = path.join(TMP_DIR, "a", "b", "c");
    await ensureDir(nestedDir);
    const contents = await readdir(nestedDir);
    expect(Array.isArray(contents)).toBe(true);
  });

  test("does not throw if directory already exists", async () => {
    const existingDir = path.join(TMP_DIR, "existing");
    await mkdir(existingDir);
    // Should not throw
    await expect(ensureDir(existingDir)).resolves.toBeUndefined();
  });
});

describe("isSensitiveFile", () => {
  test("returns true for .env file", () => {
    expect(isSensitiveFile(".env")).toBe(true);
  });

  test("returns true for .env.local file", () => {
    expect(isSensitiveFile(".env.local")).toBe(true);
  });

  test("returns true for .env.production file", () => {
    expect(isSensitiveFile(".env.production")).toBe(true);
  });

  test("returns true for credentials file", () => {
    expect(isSensitiveFile("credentials")).toBe(true);
  });

  test("returns true for file with 'secret' in the name", () => {
    expect(isSensitiveFile("my-secret-key.txt")).toBe(true);
  });

  test("returns true for .key file", () => {
    expect(isSensitiveFile("server.key")).toBe(true);
  });

  test("returns true for .pem file", () => {
    expect(isSensitiveFile("cert.pem")).toBe(true);
  });

  test("returns true for .p12 file", () => {
    expect(isSensitiveFile("keystore.p12")).toBe(true);
  });

  test("returns true for id_rsa file", () => {
    expect(isSensitiveFile("id_rsa")).toBe(true);
  });

  test("returns true for id_ed25519 file", () => {
    expect(isSensitiveFile("id_ed25519")).toBe(true);
  });

  test("returns false for regular HTML file", () => {
    expect(isSensitiveFile("index.html")).toBe(false);
  });

  test("returns false for regular CSS file", () => {
    expect(isSensitiveFile("styles.css")).toBe(false);
  });

  test("returns false for regular JS file", () => {
    expect(isSensitiveFile("app.js")).toBe(false);
  });

  test("returns true for path with sensitive basename (case-insensitive)", () => {
    expect(isSensitiveFile("/some/path/.ENV")).toBe(true);
  });

  test("returns true for full path with sensitive file", () => {
    expect(isSensitiveFile("/home/user/.env.local")).toBe(true);
  });

  test("returns false for path with non-sensitive file", () => {
    expect(isSensitiveFile("/home/user/design.html")).toBe(false);
  });
});

describe("filterSensitiveFiles", () => {
  test("returns empty array for empty input", () => {
    expect(filterSensitiveFiles([])).toEqual([]);
  });

  test("keeps non-sensitive files", () => {
    const files = ["index.html", "styles.css", "app.js"];
    expect(filterSensitiveFiles(files)).toEqual(files);
  });

  test("removes .env files", () => {
    const files = ["index.html", ".env", "styles.css"];
    expect(filterSensitiveFiles(files)).toEqual(["index.html", "styles.css"]);
  });

  test("removes multiple sensitive files", () => {
    const files = [".env", "id_rsa", "index.html", "cert.pem"];
    expect(filterSensitiveFiles(files)).toEqual(["index.html"]);
  });

  test("returns all files when none are sensitive", () => {
    const files = ["design.html", "theme.css", "interactions.js", "assets/logo.png"];
    expect(filterSensitiveFiles(files)).toEqual(files);
  });
});

describe("copyDesignFiles", () => {
  test("copies non-sensitive files from source to target", async () => {
    const sourceDir = path.join(TMP_DIR, "source");
    const targetDir = path.join(TMP_DIR, "target");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });

    await writeFile(path.join(sourceDir, "index.html"), "<html></html>");
    await writeFile(path.join(sourceDir, "styles.css"), "body { margin: 0; }");

    const copied = await copyDesignFiles(sourceDir, targetDir);

    expect(copied).toHaveLength(2);
    const targetContents = await readdir(targetDir);
    expect(targetContents).toContain("index.html");
    expect(targetContents).toContain("styles.css");
  });

  test("does not copy sensitive files", async () => {
    const sourceDir = path.join(TMP_DIR, "source-sensitive");
    const targetDir = path.join(TMP_DIR, "target-sensitive");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });

    await writeFile(path.join(sourceDir, "index.html"), "<html></html>");
    await writeFile(path.join(sourceDir, ".env"), "SECRET=abc");

    const copied = await copyDesignFiles(sourceDir, targetDir);

    expect(copied).toHaveLength(1);
    const targetContents = await readdir(targetDir);
    expect(targetContents).toContain("index.html");
    expect(targetContents).not.toContain(".env");
  });

  test("returns empty array for empty source directory", async () => {
    const sourceDir = path.join(TMP_DIR, "empty-source");
    const targetDir = path.join(TMP_DIR, "empty-target");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });

    const copied = await copyDesignFiles(sourceDir, targetDir);

    expect(copied).toEqual([]);
  });

  test("returns empty array for non-existent source directory", async () => {
    const sourceDir = path.join(TMP_DIR, "nonexistent-source");
    const targetDir = path.join(TMP_DIR, "target-nonexistent");
    await mkdir(targetDir, { recursive: true });

    const copied = await copyDesignFiles(sourceDir, targetDir);

    expect(copied).toEqual([]);
  });

  test("preserves file contents when copying", async () => {
    const sourceDir = path.join(TMP_DIR, "source-content");
    const targetDir = path.join(TMP_DIR, "target-content");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });

    const htmlContent = "<!DOCTYPE html><html><body>Hello World</body></html>";
    await writeFile(path.join(sourceDir, "index.html"), htmlContent);

    await copyDesignFiles(sourceDir, targetDir);

    const copiedContent = await Bun.file(path.join(targetDir, "index.html")).text();
    expect(copiedContent).toBe(htmlContent);
  });

  test("handles nested directories recursively", async () => {
    const sourceDir = path.join(TMP_DIR, "source-nested");
    const targetDir = path.join(TMP_DIR, "target-nested");
    await mkdir(path.join(sourceDir, "assets"), { recursive: true });
    await mkdir(targetDir, { recursive: true });

    await writeFile(path.join(sourceDir, "index.html"), "<html></html>");
    await writeFile(path.join(sourceDir, "assets", "logo.png"), "PNG_DATA");

    const copied = await copyDesignFiles(sourceDir, targetDir);

    expect(copied.length).toBeGreaterThanOrEqual(2);
    const targetAssets = await readdir(path.join(targetDir, "assets"));
    expect(targetAssets).toContain("logo.png");
  });
});

describe("ensureOutputDirs", () => {
  test("returns outputDir and exportDir", async () => {
    const result = await ensureOutputDirs(TMP_DIR);
    expect(result).toHaveProperty("outputDir");
    expect(result).toHaveProperty("exportDir");
  });

  test("outputDir is under DESIGN_OUTPUT_BASE", async () => {
    const result = await ensureOutputDirs(TMP_DIR);
    expect(result.outputDir).toContain(DESIGN_OUTPUT_BASE);
    expect(path.basename(result.outputDir)).toMatch(new RegExp(`^${OUTPUT_PREFIX}-`));
  });

  test("exportDir is under DESIGN_OUTPUT_BASE", async () => {
    const result = await ensureOutputDirs(TMP_DIR);
    expect(result.exportDir).toContain(DESIGN_OUTPUT_BASE);
    expect(path.basename(result.exportDir)).toMatch(new RegExp(`^${EXPORT_PREFIX}-`));
  });

  test("both directories are actually created on disk", async () => {
    const result = await ensureOutputDirs(TMP_DIR);
    const outputContents = await readdir(result.outputDir);
    const exportContents = await readdir(result.exportDir);
    expect(Array.isArray(outputContents)).toBe(true);
    expect(Array.isArray(exportContents)).toBe(true);
  });

  test("both dirs use the same timestamp", async () => {
    const result = await ensureOutputDirs(TMP_DIR);
    const outputTs = path.basename(result.outputDir).slice(OUTPUT_PREFIX.length + 1);
    const exportTs = path.basename(result.exportDir).slice(EXPORT_PREFIX.length + 1);
    expect(outputTs).toBe(exportTs);
  });
});
