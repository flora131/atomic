/**
 * Tests for migration notes documentation
 *
 * Validates that the migration notes document exists and covers
 * all required migration topics for removed commands.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const DOCS_DIR = join(process.cwd(), "research", "docs");
const MIGRATION_DOC = join(DOCS_DIR, "2026-02-03-command-migration-notes.md");

describe("Migration Notes Documentation", () => {
  let content: string;

  beforeAll(() => {
    content = existsSync(MIGRATION_DOC)
      ? readFileSync(MIGRATION_DOC, "utf-8")
      : "";
  });

  describe("Document exists and has basic structure", () => {
    test("migration notes document exists", () => {
      expect(existsSync(MIGRATION_DOC)).toBe(true);
    });

    test("document has a title", () => {
      expect(content).toContain("# Migration Notes");
    });

    test("document has metadata header", () => {
      expect(content).toContain("**Date:**");
      expect(content).toContain("**Status:**");
      expect(content).toContain("**Author:**");
    });

    test("document has table of contents", () => {
      expect(content).toContain("## Table of Contents");
    });
  });

  describe("/atomic replaced by /ralph", () => {
    test("document section exists", () => {
      expect(content).toContain("/atomic replaced by /ralph");
    });

    test("explains the change", () => {
      expect(content).toContain("/atomic");
      expect(content).toContain("/ralph");
    });

    test("shows before/after migration table", () => {
      expect(content).toContain("| Before | After |");
    });

    test("documents /ralph flags", () => {
      expect(content).toContain("--yolo");
      expect(content).toContain("--resume");
      expect(content).toContain("--feature-list");
      expect(content).toContain("--max-iterations");
    });
  });

  describe("/ralph:* hook-based commands removed", () => {
    test("document section exists", () => {
      expect(content).toContain("/ralph:* hook-based commands removed");
    });

    test("documents /ralph:ralph-loop removal", () => {
      expect(content).toContain("/ralph:ralph-loop");
    });

    test("documents /ralph:cancel-ralph removal", () => {
      expect(content).toContain("/ralph:cancel-ralph");
    });

    test("documents /ralph:ralph-help removal", () => {
      expect(content).toContain("/ralph:ralph-help");
    });

    test("explains keyboard interrupts replace cancel command", () => {
      expect(content).toContain("Ctrl+C");
      expect(content).toContain("Esc");
    });

    test("explains /help includes Ralph documentation now", () => {
      expect(content).toContain("/help");
    });
  });

  describe("/approve, /reject, /status removed", () => {
    test("document section exists", () => {
      expect(content).toContain("/approve, /reject, /status removed");
    });

    test("documents /approve removal", () => {
      expect(content).toContain("/approve");
    });

    test("documents /reject removal", () => {
      expect(content).toContain("/reject");
    });

    test("documents /status removal", () => {
      expect(content).toContain("/status");
    });
  });

  describe("Spec approval is now manual", () => {
    test("document section exists", () => {
      expect(content).toContain("Spec Approval is Now Manual");
    });

    test("explains manual review process", () => {
      expect(content).toContain("manual");
      expect(content).toContain("before");
    });

    test("lists recommended process steps", () => {
      expect(content).toContain("/research-codebase");
      expect(content).toContain("/create-spec");
      expect(content).toContain("/create-feature-list");
    });

    test("mentions spec file locations", () => {
      expect(content).toContain("research/spec.md");
      expect(content).toContain("research/feature-list.json");
    });
  });

  describe("Progress tracking via progress.txt", () => {
    test("document section exists", () => {
      expect(content).toContain("Progress Tracking via progress.txt");
    });

    test("explains progress.txt usage", () => {
      expect(content).toContain("progress.txt");
    });

    test("shows example progress file format", () => {
      expect(content).toContain("research/progress.txt");
    });

    test("mentions session-specific progress", () => {
      expect(content).toContain(".ralph/sessions");
    });

    test("explains benefits of file-based progress", () => {
      expect(content).toContain("Persistent");
    });
  });

  describe("Migration checklist", () => {
    test("document has migration checklist section", () => {
      expect(content).toContain("## Migration Checklist");
    });

    test("includes before upgrading steps", () => {
      expect(content).toContain("Before Upgrading");
    });

    test("includes after upgrading steps", () => {
      expect(content).toContain("After Upgrading");
    });

    test("includes script update examples", () => {
      expect(content).toContain("Scripts to Update");
    });
  });

  describe("Related documentation", () => {
    test("references related files", () => {
      expect(content).toContain("## Related Documentation");
    });

    test("mentions workflow-commands.ts", () => {
      expect(content).toContain("workflow-commands.ts");
    });

    test("mentions ralph.ts workflow", () => {
      expect(content).toContain("ralph.ts");
    });

    test("mentions other documentation files", () => {
      expect(content).toContain("workflow-composition-patterns.md");
      expect(content).toContain("custom-workflow-file-format.md");
    });
  });
});
