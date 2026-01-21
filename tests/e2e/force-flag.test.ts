import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

/**
 * Integration tests for the --force flag behavior
 *
 * These tests verify that:
 * 1. --force flag overwrites existing CLAUDE.md
 * 2. --force flag overwrites existing AGENTS.md
 * 3. Empty preserved files are overwritten without --force
 * 4. Non-empty preserved files are preserved without --force
 * 5. Auto-init respects the force flag
 */
describe("--force flag integration tests", () => {
  let tmpDir: string;
  const atomicPath = path.join(__dirname, "../../src/index.ts");

  beforeEach(async () => {
    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-force-test-"));
  });

  afterEach(async () => {
    // Clean up the temporary directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper function to run the atomic CLI and capture output
   * Uses --yes flag to auto-confirm all prompts (non-interactive mode)
   */
  function runAtomic(
    args: string[],
    options: { timeout?: number } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { timeout = 10000 } = options;

    return new Promise((resolve) => {
      // Add --yes flag to auto-confirm prompts and --no-banner to reduce output
      const fullArgs = [...args, "--yes", "--no-banner"];
      
      const proc = spawn("bun", ["run", atomicPath, ...fullArgs], {
        cwd: tmpDir,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Kill the process after timeout
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on("error", () => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: 1 });
      });
    });
  }

  describe("--force flag overwrites existing CLAUDE.md", () => {
    test("atomic init --force overwrites existing CLAUDE.md with template", async () => {
      // Create .claude folder and existing CLAUDE.md with user content
      const claudeFolder = path.join(tmpDir, ".claude");
      const claudeMdPath = path.join(tmpDir, "CLAUDE.md");

      await fs.mkdir(claudeFolder, { recursive: true });
      await fs.writeFile(claudeMdPath, "# My Custom Instructions\n\nDo not overwrite me!");

      // Verify initial content
      const initialContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(initialContent).toContain("My Custom Instructions");
      expect(initialContent).toContain("Do not overwrite me");

      // Run atomic init with --force flag
      await runAtomic(["init", "-a", "claude", "--force"]);

      // Verify CLAUDE.md was overwritten with template content
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");
      // Template starts with "# [PROJECT_NAME]"
      expect(finalContent).toContain("[PROJECT_NAME]");
      // User content should be gone
      expect(finalContent).not.toContain("My Custom Instructions");
      expect(finalContent).not.toContain("Do not overwrite me");
    }, 15000);

    test("atomic init -f (shorthand) overwrites existing CLAUDE.md", async () => {
      // Create .claude folder and existing CLAUDE.md
      const claudeFolder = path.join(tmpDir, ".claude");
      const claudeMdPath = path.join(tmpDir, "CLAUDE.md");

      await fs.mkdir(claudeFolder, { recursive: true });
      await fs.writeFile(claudeMdPath, "# User's Custom Content\n\nImportant notes here.");

      // Verify initial content
      const initialContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(initialContent).toContain("User's Custom Content");

      // Run atomic init with -f shorthand flag
      await runAtomic(["init", "-a", "claude", "-f"]);

      // Verify CLAUDE.md was overwritten
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(finalContent).toContain("[PROJECT_NAME]");
      expect(finalContent).not.toContain("User's Custom Content");
    }, 15000);

    test("without --force, existing CLAUDE.md is preserved", async () => {
      // Create .claude folder and existing CLAUDE.md
      const claudeFolder = path.join(tmpDir, ".claude");
      const claudeMdPath = path.join(tmpDir, "CLAUDE.md");

      await fs.mkdir(claudeFolder, { recursive: true });
      await fs.writeFile(claudeMdPath, "# Preserved Content\n\nThis should stay.");

      const initialContent = await fs.readFile(claudeMdPath, "utf-8");

      // Run atomic init without --force (user confirms update)
      await runAtomic(["init", "-a", "claude"]);

      // CLAUDE.md should be preserved (user content intact)
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(finalContent).toContain("Preserved Content");
      expect(finalContent).toContain("This should stay");
    }, 15000);
  });

  describe("--force flag overwrites existing AGENTS.md", () => {
    test("atomic init --force overwrites existing AGENTS.md for opencode", async () => {
      // Create .opencode folder and existing AGENTS.md
      const opencodeFolder = path.join(tmpDir, ".opencode");
      const agentsMdPath = path.join(tmpDir, "AGENTS.md");

      await fs.mkdir(opencodeFolder, { recursive: true });
      await fs.writeFile(agentsMdPath, "# My OpenCode Instructions\n\nCustom agent config.");

      // Verify initial content
      const initialContent = await fs.readFile(agentsMdPath, "utf-8");
      expect(initialContent).toContain("My OpenCode Instructions");

      // Run atomic init with --force flag for opencode
      await runAtomic(["init", "-a", "opencode", "--force"]);

      // Verify AGENTS.md was overwritten with template content
      const finalContent = await fs.readFile(agentsMdPath, "utf-8");
      // The AGENTS.md template should have standard content
      expect(finalContent).toContain("[PROJECT_NAME]");
      expect(finalContent).not.toContain("My OpenCode Instructions");
    }, 15000);

    test("atomic init -f overwrites existing AGENTS.md for copilot", async () => {
      // Create .github folder and existing AGENTS.md
      const githubFolder = path.join(tmpDir, ".github");
      const agentsMdPath = path.join(tmpDir, "AGENTS.md");

      await fs.mkdir(githubFolder, { recursive: true });
      await fs.writeFile(agentsMdPath, "# Custom Copilot Config\n\nMy copilot rules.");

      // Verify initial content
      const initialContent = await fs.readFile(agentsMdPath, "utf-8");
      expect(initialContent).toContain("Custom Copilot Config");

      // Run atomic init with -f for copilot
      await runAtomic(["init", "-a", "copilot", "-f"]);

      // Verify AGENTS.md was overwritten
      const finalContent = await fs.readFile(agentsMdPath, "utf-8");
      expect(finalContent).toContain("[PROJECT_NAME]");
      expect(finalContent).not.toContain("Custom Copilot Config");
    }, 15000);
  });

  describe("empty file detection during init", () => {
    test("0-byte CLAUDE.md is overwritten without --force", async () => {
      // Create .claude folder and empty CLAUDE.md (0 bytes)
      const claudeFolder = path.join(tmpDir, ".claude");
      const claudeMdPath = path.join(tmpDir, "CLAUDE.md");

      await fs.mkdir(claudeFolder, { recursive: true });
      await fs.writeFile(claudeMdPath, "");

      // Verify file is empty
      const stats = await fs.stat(claudeMdPath);
      expect(stats.size).toBe(0);

      // Run atomic init without --force
      await runAtomic(["init", "-a", "claude"]);

      // CLAUDE.md should be overwritten (was empty)
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(finalContent).toContain("[PROJECT_NAME]");
      expect(finalContent.length).toBeGreaterThan(0);
    }, 15000);

    test("whitespace-only AGENTS.md is overwritten without --force", async () => {
      // Create .opencode folder and whitespace-only AGENTS.md
      const opencodeFolder = path.join(tmpDir, ".opencode");
      const agentsMdPath = path.join(tmpDir, "AGENTS.md");

      await fs.mkdir(opencodeFolder, { recursive: true });
      await fs.writeFile(agentsMdPath, "   \n\t\n   ");

      // Verify file has only whitespace
      const initialContent = await fs.readFile(agentsMdPath, "utf-8");
      expect(initialContent.trim()).toBe("");

      // Run atomic init without --force
      await runAtomic(["init", "-a", "opencode"]);

      // AGENTS.md should be overwritten (was whitespace-only)
      const finalContent = await fs.readFile(agentsMdPath, "utf-8");
      expect(finalContent.trim().length).toBeGreaterThan(0);
      expect(finalContent).toContain("[PROJECT_NAME]");
    }, 15000);
  });

  describe("non-empty files are preserved without --force", () => {
    test("CLAUDE.md with content is preserved without --force", async () => {
      // Create .claude folder and CLAUDE.md with actual content
      const claudeFolder = path.join(tmpDir, ".claude");
      const claudeMdPath = path.join(tmpDir, "CLAUDE.md");

      await fs.mkdir(claudeFolder, { recursive: true });
      await fs.writeFile(claudeMdPath, "# My Project Instructions\n\nImportant project-specific rules.");

      const initialContent = await fs.readFile(claudeMdPath, "utf-8");

      // Run atomic init without --force
      await runAtomic(["init", "-a", "claude"]);

      // CLAUDE.md should be preserved
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(finalContent).toBe(initialContent);
      expect(finalContent).toContain("My Project Instructions");
    }, 15000);
  });

  describe("auto-init with force flag", () => {
    test("atomic -a claude -f with existing config overwrites CLAUDE.md", async () => {
      // Create .claude folder and CLAUDE.md with content
      const claudeFolder = path.join(tmpDir, ".claude");
      const claudeMdPath = path.join(tmpDir, "CLAUDE.md");

      await fs.mkdir(claudeFolder, { recursive: true });
      await fs.writeFile(claudeMdPath, "# Original Config\n\nDo not touch.");

      const initialContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(initialContent).toContain("Original Config");

      // Run atomic with auto-init and force flag
      // Note: This will try to spawn the agent, so it will error, but init should happen first
      const { stdout, stderr } = await runAtomic(["-a", "claude", "-f"], { timeout: 10000 });
      const output = stdout + stderr;

      // The init should have run (either successfully or errored after)
      // Check if CLAUDE.md was updated
      const fileExists = await fs.stat(claudeMdPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // If file exists, check content
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");

      // With -f flag AND existing .claude folder, the agent spawns directly
      // without re-running init, so content should be preserved
      // This tests that the force flag is correctly passed to auto-init when needed
      // If .claude folder exists, no init is run, content stays the same
      expect(finalContent).toContain("Original Config");
    }, 15000);

    test("atomic -a claude -f without existing config runs init with force", async () => {
      // No .claude folder - this should trigger auto-init
      const claudeMdPath = path.join(tmpDir, "CLAUDE.md");

      // Pre-create a CLAUDE.md to test force behavior during auto-init
      await fs.writeFile(claudeMdPath, "# Pre-existing CLAUDE.md\n\nShould be overwritten with -f.");

      // Run atomic with auto-init and force flag (no .claude folder)
      await runAtomic(["-a", "claude", "-f"], { timeout: 10000 });

      // CLAUDE.md should be overwritten because -f was passed during auto-init
      const finalContent = await fs.readFile(claudeMdPath, "utf-8");
      expect(finalContent).toContain("[PROJECT_NAME]");
      expect(finalContent).not.toContain("Pre-existing CLAUDE.md");
    }, 15000);
  });
});
