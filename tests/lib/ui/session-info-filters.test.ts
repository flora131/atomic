import { describe, expect, test } from "bun:test";
import { isLikelyFilePath } from "@/services/events/session-info-filters.ts";

describe("isLikelyFilePath", () => {
  describe("Windows absolute paths", () => {
    test("detects drive letter with backslash", () => {
      expect(isLikelyFilePath("C:\\dev\\file.ts")).toBe(true);
    });

    test("detects lowercase drive letter", () => {
      expect(isLikelyFilePath("c:\\Users\\project")).toBe(true);
    });

    test("detects deep nested Windows path", () => {
      expect(isLikelyFilePath("D:\\projects\\app\\src\\index.ts")).toBe(true);
    });

    test("detects drive root with trailing backslash", () => {
      expect(isLikelyFilePath("C:\\")).toBe(true);
    });

    test("rejects Windows path embedded in sentence", () => {
      expect(isLikelyFilePath("C:\\dev\\file.ts is a file")).toBe(false);
    });
  });

  describe("POSIX absolute paths", () => {
    test("detects standard POSIX path", () => {
      expect(isLikelyFilePath("/home/user/file.ts")).toBe(true);
    });

    test("detects /usr path", () => {
      expect(isLikelyFilePath("/usr/local/bin/node")).toBe(true);
    });

    test("detects /tmp path", () => {
      expect(isLikelyFilePath("/tmp/output.log")).toBe(true);
    });

    test("rejects bare root slash", () => {
      expect(isLikelyFilePath("/")).toBe(false);
    });

    test("accepts single-segment absolute path", () => {
      expect(isLikelyFilePath("/file")).toBe(true);
    });

    test("accepts single-segment POSIX path like /help", () => {
      expect(isLikelyFilePath("/help")).toBe(true);
    });
  });

  describe("home-relative paths", () => {
    test("detects ~/path", () => {
      expect(isLikelyFilePath("~/project/file.ts")).toBe(true);
    });

    test("detects ~/ with dotfile", () => {
      expect(isLikelyFilePath("~/.config")).toBe(true);
    });

    test("detects deep home-relative path", () => {
      expect(isLikelyFilePath("~/.local/share/app/data.json")).toBe(true);
    });

    test("rejects tilde without slash", () => {
      expect(isLikelyFilePath("~file")).toBe(false);
    });
  });

  describe("dot-relative paths", () => {
    test("detects ./path with forward slash", () => {
      expect(isLikelyFilePath("./src/index.ts")).toBe(true);
    });

    test("detects ../path with forward slash", () => {
      expect(isLikelyFilePath("../lib/utils.ts")).toBe(true);
    });

    test("detects .\\path with backslash", () => {
      expect(isLikelyFilePath(".\\src\\main.ts")).toBe(true);
    });

    test("detects ..\\path with backslash", () => {
      expect(isLikelyFilePath("..\\config\\app.json")).toBe(true);
    });

    test("detects minimal dot-relative path", () => {
      expect(isLikelyFilePath("./a")).toBe(true);
    });
  });

  describe("edge cases — rejection", () => {
    test("rejects empty string", () => {
      expect(isLikelyFilePath("")).toBe(false);
    });

    test("rejects plain word", () => {
      expect(isLikelyFilePath("hello")).toBe(false);
    });

    test("rejects sentence with spaces", () => {
      expect(isLikelyFilePath("Created 2 files")).toBe(false);
    });

    test("rejects sentence containing a path", () => {
      expect(isLikelyFilePath("see /home/user/file.ts for details")).toBe(
        false,
      );
    });

    test("rejects URL-like string (no spaces but has colon-slash-slash)", () => {
      expect(isLikelyFilePath("https://example.com")).toBe(false);
    });

    test("rejects bare filename without directory separator", () => {
      expect(isLikelyFilePath("file.ts")).toBe(false);
    });

    test("rejects single dot", () => {
      expect(isLikelyFilePath(".")).toBe(false);
    });

    test("rejects double dot", () => {
      expect(isLikelyFilePath("..")).toBe(false);
    });

    test("rejects string of only spaces", () => {
      expect(isLikelyFilePath("   ")).toBe(false);
    });

    test("rejects colon-only prefix that looks like drive letter", () => {
      expect(isLikelyFilePath("C:file")).toBe(false);
    });

    test("rejects numeric string", () => {
      expect(isLikelyFilePath("12345")).toBe(false);
    });
  });
});
