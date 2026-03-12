/**
 * Tests for @ mention file suggestions in nested directories
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getMentionSuggestions } from "@/state/chat/exports.ts";

// Create a test directory structure to verify nested file detection
const testDir = join(tmpdir(), `atomic-test-${Date.now()}`);
let originalCwd: string;

beforeEach(() => {
  // Save original directory
  originalCwd = process.cwd();

  // Create test directory structure
  mkdirSync(testDir, { recursive: true });
  process.chdir(testDir);

  // Create nested directory structure
  mkdirSync(join(testDir, "src", "components", "ui"), { recursive: true });
  mkdirSync(join(testDir, "src", "lib"), { recursive: true });
  mkdirSync(join(testDir, "docs"), { recursive: true });

  // Create files at various depths
  writeFileSync(join(testDir, "README.md"), "# Test");
  writeFileSync(join(testDir, "src", "app.tsx"), "// app");
  writeFileSync(join(testDir, "src", "components", "ui", "button.tsx"), "// nested");
  writeFileSync(join(testDir, "src", "lib", "helper.ts"), "// lib");
  writeFileSync(join(testDir, "docs", "guide.md"), "// docs");
});

afterEach(() => {
  // Restore original directory
  process.chdir(originalCwd);

  // Clean up test directory
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test("getMentionSuggestions finds files in nested directories (depth > 2)", () => {
  const suggestions = getMentionSuggestions("");

  // Convert to file names for easier assertion
  const fileNames = suggestions
    .filter((s) => s.category === "file")
    .map((s) => s.name);

  // Should find files at all depths
  expect(fileNames).toContain("README.md");
  expect(fileNames).toContain("src/app.tsx");
  expect(fileNames).toContain("src/components/ui/button.tsx"); // Depth 3 - the bug!
  expect(fileNames).toContain("src/lib/helper.ts");
  expect(fileNames).toContain("docs/guide.md");
});

test("getMentionSuggestions finds newly created files in nested directories", () => {
  // Get initial suggestions
  const beforeSuggestions = getMentionSuggestions("");
  const beforeFiles = beforeSuggestions
    .filter((s) => s.category === "file")
    .map((s) => s.name);

  expect(beforeFiles).not.toContain("src/components/ui/modal.tsx");

  // Create a new file in a nested directory
  writeFileSync(join(testDir, "src", "components", "ui", "modal.tsx"), "// modal");

  // Get updated suggestions (simulates watcher update)
  const afterSuggestions = getMentionSuggestions("");
  const afterFiles = afterSuggestions
    .filter((s) => s.category === "file")
    .map((s) => s.name);

  // Should now include the newly created file
  expect(afterFiles).toContain("src/components/ui/modal.tsx");
});

test("getMentionSuggestions filters files by search term", () => {
  const suggestions = getMentionSuggestions("button");
  const fileNames = suggestions
    .filter((s) => s.category === "file")
    .map((s) => s.name);

  // Should only find files matching "button"
  expect(fileNames).toContain("src/components/ui/button.tsx");
  expect(fileNames).not.toContain("README.md");
  expect(fileNames).not.toContain("src/app.tsx");
});

test("getMentionSuggestions includes directories", () => {
  const suggestions = getMentionSuggestions("");
  const dirNames = suggestions
    .filter((s) => s.category === "folder")
    .map((s) => s.name);

  // Should find directories at various depths
  expect(dirNames).toContain("src/");
  expect(dirNames).toContain("docs/");
  expect(dirNames).toContain("src/components/");
  expect(dirNames).toContain("src/lib/");
  expect(dirNames).toContain("src/components/ui/");
});
