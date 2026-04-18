import { test, expect, describe } from "bun:test";
import {
  isUrl,
  isFilePath,
  classifyReference,
  getViewportSizes,
  type ReferenceType,
} from "./web-capture";

describe("isUrl", () => {
  test("returns true for http URL", () => {
    expect(isUrl("http://example.com")).toBe(true);
  });

  test("returns true for https URL", () => {
    expect(isUrl("https://example.com/path")).toBe(true);
  });

  test("returns true for HTTP (uppercase) URL", () => {
    expect(isUrl("HTTP://example.com")).toBe(true);
  });

  test("returns true for HTTPS (uppercase) URL", () => {
    expect(isUrl("HTTPS://example.com")).toBe(true);
  });

  test("returns true for www. prefix", () => {
    expect(isUrl("www.example.com")).toBe(true);
  });

  test("returns false for file path", () => {
    expect(isUrl("/usr/local/file.html")).toBe(false);
  });

  test("returns false for relative path", () => {
    expect(isUrl("./src/components/Button.tsx")).toBe(false);
  });

  test("returns false for plain string", () => {
    expect(isUrl("src/components")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isUrl("")).toBe(false);
  });
});

describe("isFilePath", () => {
  test("returns true for absolute path with file extension", () => {
    expect(isFilePath("/usr/local/file.html")).toBe(true);
  });

  test("returns true for relative ./ path with file extension", () => {
    expect(isFilePath("./src/mockup.png")).toBe(true);
  });

  test("returns true for relative ../ path with file extension", () => {
    expect(isFilePath("../parent/file.css")).toBe(true);
  });

  test("returns true for home directory path with file extension", () => {
    expect(isFilePath("~/Documents/design.pdf")).toBe(true);
  });

  test("returns true for path with .html extension", () => {
    expect(isFilePath("design/mockup.html")).toBe(true);
  });

  test("returns true for path with .css extension", () => {
    expect(isFilePath("styles/main.css")).toBe(true);
  });

  test("returns true for path with .png extension", () => {
    expect(isFilePath("assets/logo.png")).toBe(true);
  });

  test("returns true for path with .jpg extension", () => {
    expect(isFilePath("assets/photo.jpg")).toBe(true);
  });

  test("returns true for path with .pdf extension", () => {
    expect(isFilePath("docs/spec.pdf")).toBe(true);
  });

  test("returns true for path with .docx extension", () => {
    expect(isFilePath("docs/brief.docx")).toBe(true);
  });

  test("returns false for URL", () => {
    expect(isFilePath("https://example.com/file.html")).toBe(false);
  });

  test("returns false for codebase path without extension", () => {
    expect(isFilePath("src/components")).toBe(false);
  });

  test("returns false for absolute directory path without extension", () => {
    expect(isFilePath("/src/components")).toBe(false);
  });

  test("returns false for relative directory path without extension", () => {
    expect(isFilePath("./src/components")).toBe(false);
  });

  test("returns false for home directory path without extension", () => {
    expect(isFilePath("~/projects/my-app/src")).toBe(false);
  });

  test("returns false for absolute path that looks like a project root", () => {
    expect(isFilePath("/Users/me/project/src/components")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isFilePath("")).toBe(false);
  });
});

describe("classifyReference", () => {
  test("returns 'none' for empty string", () => {
    expect(classifyReference("")).toBe("none" satisfies ReferenceType);
  });

  test("returns 'none' for whitespace-only string", () => {
    expect(classifyReference("   ")).toBe("none" satisfies ReferenceType);
  });

  test("returns 'url' for https URL", () => {
    expect(classifyReference("https://example.com")).toBe("url" satisfies ReferenceType);
  });

  test("returns 'url' for http URL", () => {
    expect(classifyReference("http://example.com/page")).toBe("url" satisfies ReferenceType);
  });

  test("returns 'url' for www URL", () => {
    expect(classifyReference("www.example.com")).toBe("url" satisfies ReferenceType);
  });

  test("returns 'file' for absolute path", () => {
    expect(classifyReference("/home/user/design.png")).toBe("file" satisfies ReferenceType);
  });

  test("returns 'file' for relative path", () => {
    expect(classifyReference("./mockup.pdf")).toBe("file" satisfies ReferenceType);
  });

  test("returns 'file' for home path", () => {
    expect(classifyReference("~/Downloads/spec.docx")).toBe("file" satisfies ReferenceType);
  });

  test("returns 'codebase' for codebase path", () => {
    expect(classifyReference("src/components")).toBe("codebase" satisfies ReferenceType);
  });

  test("returns 'codebase' for bare component name", () => {
    expect(classifyReference("Button")).toBe("codebase" satisfies ReferenceType);
  });

  test("returns 'codebase' for absolute directory path without extension", () => {
    expect(classifyReference("/src/components")).toBe("codebase" satisfies ReferenceType);
  });

  test("returns 'codebase' for relative directory path without extension", () => {
    expect(classifyReference("./src/components")).toBe("codebase" satisfies ReferenceType);
  });

  test("returns 'file' for absolute path with recognized extension", () => {
    expect(classifyReference("/home/user/design.png")).toBe("file" satisfies ReferenceType);
  });
});

describe("getViewportSizes", () => {
  test("returns an array of three viewport sizes", () => {
    const sizes = getViewportSizes();
    expect(sizes).toHaveLength(3);
  });

  test("includes mobile viewport", () => {
    const sizes = getViewportSizes();
    const mobile = sizes.find((s) => s.name === "mobile");
    expect(mobile).toBeDefined();
    expect(mobile?.width).toBe(375);
    expect(mobile?.height).toBe(812);
  });

  test("includes tablet viewport", () => {
    const sizes = getViewportSizes();
    const tablet = sizes.find((s) => s.name === "tablet");
    expect(tablet).toBeDefined();
    expect(tablet?.width).toBe(768);
    expect(tablet?.height).toBe(1024);
  });

  test("includes desktop viewport", () => {
    const sizes = getViewportSizes();
    const desktop = sizes.find((s) => s.name === "desktop");
    expect(desktop).toBeDefined();
    expect(desktop?.width).toBe(1440);
    expect(desktop?.height).toBe(900);
  });

  test("each entry has name, width, and height properties", () => {
    const sizes = getViewportSizes();
    for (const size of sizes) {
      expect(typeof size.name).toBe("string");
      expect(typeof size.width).toBe("number");
      expect(typeof size.height).toBe("number");
    }
  });

  test("returns a new array on each call (no shared reference)", () => {
    const a = getViewportSizes();
    const b = getViewportSizes();
    expect(a).not.toBe(b);
  });
});
