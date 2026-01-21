import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import {
  ChecksumMismatchError,
  GITHUB_REPO,
  getBinaryFilename,
  getConfigArchiveFilename,
  getDownloadUrl,
  getChecksumsUrl,
  parseChecksums,
  verifyChecksum,
} from "../src/utils/download";
import { isWindows } from "../src/utils/detect";

describe("ChecksumMismatchError", () => {
  test("is an instance of Error", () => {
    const error = new ChecksumMismatchError("test-file.txt");
    expect(error).toBeInstanceOf(Error);
  });

  test("has correct name property", () => {
    const error = new ChecksumMismatchError("test-file.txt");
    expect(error.name).toBe("ChecksumMismatchError");
  });

  test("includes filename in message", () => {
    const error = new ChecksumMismatchError("atomic-linux-x64");
    expect(error.message).toContain("atomic-linux-x64");
  });

  test("has expected message format", () => {
    const error = new ChecksumMismatchError("test-file");
    expect(error.message).toBe("Checksum verification failed for test-file");
  });
});

describe("GITHUB_REPO constant", () => {
  test("is set to flora131/atomic", () => {
    expect(GITHUB_REPO).toBe("flora131/atomic");
  });
});

describe("getBinaryFilename", () => {
  test("returns a string", () => {
    const filename = getBinaryFilename();
    expect(typeof filename).toBe("string");
    expect(filename.length).toBeGreaterThan(0);
  });

  test("starts with 'atomic-'", () => {
    const filename = getBinaryFilename();
    expect(filename.startsWith("atomic-")).toBe(true);
  });

  test("contains platform identifier", () => {
    const filename = getBinaryFilename();
    const platform = process.platform;

    if (platform === "linux") {
      expect(filename).toContain("linux");
    } else if (platform === "darwin") {
      expect(filename).toContain("darwin");
    } else if (platform === "win32") {
      expect(filename).toContain("windows");
    }
  });

  test("contains architecture identifier", () => {
    const filename = getBinaryFilename();
    const arch = process.arch;

    if (arch === "x64") {
      expect(filename).toContain("x64");
    } else if (arch === "arm64") {
      expect(filename).toContain("arm64");
    }
  });

  test("has .exe extension only on Windows", () => {
    const filename = getBinaryFilename();

    if (isWindows()) {
      expect(filename.endsWith(".exe")).toBe(true);
    } else {
      expect(filename.endsWith(".exe")).toBe(false);
    }
  });

  test("follows expected format pattern", () => {
    const filename = getBinaryFilename();
    // Should match: atomic-{os}-{arch} or atomic-{os}-{arch}.exe
    const pattern = /^atomic-(linux|darwin|windows)-(x64|arm64)(\.exe)?$/;
    expect(pattern.test(filename)).toBe(true);
  });
});

describe("getConfigArchiveFilename", () => {
  test("returns a string", () => {
    const filename = getConfigArchiveFilename();
    expect(typeof filename).toBe("string");
    expect(filename.length).toBeGreaterThan(0);
  });

  test("starts with 'atomic-config'", () => {
    const filename = getConfigArchiveFilename();
    expect(filename.startsWith("atomic-config")).toBe(true);
  });

  test("returns .zip on Windows, .tar.gz on Unix", () => {
    const filename = getConfigArchiveFilename();

    if (isWindows()) {
      expect(filename).toBe("atomic-config.zip");
    } else {
      expect(filename).toBe("atomic-config.tar.gz");
    }
  });
});

describe("getDownloadUrl", () => {
  test("returns a valid GitHub releases URL", () => {
    const url = getDownloadUrl("v0.1.0", "atomic-linux-x64");
    expect(url).toBe("https://github.com/flora131/atomic/releases/download/v0.1.0/atomic-linux-x64");
  });

  test("handles version with v prefix", () => {
    const url = getDownloadUrl("v1.2.3", "test-file");
    expect(url).toContain("/v1.2.3/");
  });

  test("adds v prefix if missing", () => {
    const url = getDownloadUrl("1.2.3", "test-file");
    expect(url).toContain("/v1.2.3/");
  });

  test("includes the filename", () => {
    const filename = "atomic-darwin-arm64";
    const url = getDownloadUrl("v0.1.0", filename);
    expect(url.endsWith(filename)).toBe(true);
  });
});

describe("getChecksumsUrl", () => {
  test("returns URL for checksums.txt", () => {
    const url = getChecksumsUrl("v0.1.0");
    expect(url).toBe("https://github.com/flora131/atomic/releases/download/v0.1.0/checksums.txt");
  });

  test("handles version without v prefix", () => {
    const url = getChecksumsUrl("0.1.0");
    expect(url).toContain("/v0.1.0/checksums.txt");
  });
});

describe("parseChecksums", () => {
  // SHA256 hashes are exactly 64 hex characters
  const hash1 = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
  const hash2 = "def456abc123def456abc123def456abc123def456abc123def456abc123def4";

  test("parses standard checksums.txt format", () => {
    const content = `${hash1}  atomic-linux-x64
${hash2}  atomic-darwin-arm64`;

    const checksums = parseChecksums(content);

    expect(checksums.size).toBe(2);
    expect(checksums.get("atomic-linux-x64")).toBe(hash1);
    expect(checksums.get("atomic-darwin-arm64")).toBe(hash2);
  });

  test("converts hash to lowercase", () => {
    const upperHash = "ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC1";
    const content = `${upperHash}  test-file`;
    const checksums = parseChecksums(content);

    expect(checksums.get("test-file")).toBe(upperHash.toLowerCase());
  });

  test("handles empty content", () => {
    const checksums = parseChecksums("");
    expect(checksums.size).toBe(0);
  });

  test("handles content with only whitespace", () => {
    const checksums = parseChecksums("   \n  \n   ");
    expect(checksums.size).toBe(0);
  });

  test("ignores malformed lines", () => {
    const content = `${hash1}  valid-file
not-a-valid-line
abc123  too-short-hash`;

    const checksums = parseChecksums(content);

    expect(checksums.size).toBe(1);
    expect(checksums.has("valid-file")).toBe(true);
  });

  test("handles filenames with spaces (two-space separator)", () => {
    // The format requires exactly two spaces between hash and filename
    const content = `${hash1}  file with spaces.txt`;
    const checksums = parseChecksums(content);

    expect(checksums.get("file with spaces.txt")).toBe(hash1);
  });
});

describe("verifyChecksum", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeAll(async () => {
    // Create a temp directory for test files
    tempDir = join(tmpdir(), `atomic-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    // Create a test file with known content
    testFilePath = join(tempDir, "test-file.txt");
    await writeFile(testFilePath, "Hello, World!");
  });

  afterAll(async () => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns true for valid checksum", async () => {
    // SHA256 of "Hello, World!" is known
    const knownHash = "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f";
    const checksumsTxt = `${knownHash}  test-file.txt`;

    const result = await verifyChecksum(testFilePath, checksumsTxt, "test-file.txt");
    expect(result).toBe(true);
  });

  test("returns false for invalid checksum", async () => {
    const wrongHash = "0000000000000000000000000000000000000000000000000000000000000000";
    const checksumsTxt = `${wrongHash}  test-file.txt`;

    const result = await verifyChecksum(testFilePath, checksumsTxt, "test-file.txt");
    expect(result).toBe(false);
  });

  test("throws error when filename not found in checksums", async () => {
    const checksumsTxt = `dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f  other-file.txt`;

    await expect(verifyChecksum(testFilePath, checksumsTxt, "test-file.txt")).rejects.toThrow(
      "No checksum found for test-file.txt"
    );
  });

  test("is case-insensitive for hash comparison", async () => {
    // Use uppercase hash - should still match
    const knownHash = "DFFD6021BB2BD5B0AF676290809EC3A53191DD81C7F70A4B28688A362182986F";
    const checksumsTxt = `${knownHash}  test-file.txt`;

    const result = await verifyChecksum(testFilePath, checksumsTxt, "test-file.txt");
    expect(result).toBe(true);
  });
});

// Note: We don't test getLatestRelease(), getReleaseByVersion(), or downloadFile()
// with actual network calls in unit tests. Those would be integration tests.
// These functions are tested via mocking or in integration test suites.
describe("network-dependent functions", () => {
  test("getLatestRelease and downloadFile are exported", async () => {
    const { getLatestRelease, downloadFile, getReleaseByVersion } = await import(
      "../src/utils/download"
    );
    expect(typeof getLatestRelease).toBe("function");
    expect(typeof downloadFile).toBe("function");
    expect(typeof getReleaseByVersion).toBe("function");
  });
});
