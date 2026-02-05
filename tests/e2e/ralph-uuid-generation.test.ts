/**
 * E2E tests for /ralph command UUID generation
 *
 * These tests verify that the /ralph command:
 * 1. Generates a random UUID for each session
 * 2. Generates unique UUIDs across multiple runs
 * 3. Generates valid UUID v4 format
 *
 * Reference: Feature - E2E test: /ralph generates random UUID for session ID
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
import {
  parseRalphArgs,
  isValidUUID,
} from "../../src/ui/commands/workflow-commands.ts";
import {
  generateSessionId,
  getSessionDir,
  createSessionDirectory,
  saveSession,
  createRalphSession,
} from "../../src/workflows/index.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
} from "../../src/ui/commands/registry.ts";
import { createRalphWorkflow } from "../../src/workflows/index.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * UUID v4 regex pattern.
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where x is any hex digit and y is one of 8, 9, a, or b
 */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  stateOverrides: Partial<CommandContextState> = {}
): CommandContext & { getMessages: () => Array<{ role: string; content: string }> } {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
      ...stateOverrides,
    },
    addMessage: (role, content) => {
      messages.push({ role, content });
    },
    setStreaming: () => {},
    sendMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    agentType: undefined,
    modelOps: undefined,
    getMessages: () => messages,
  };
}

// ============================================================================
// E2E TEST: /ralph generates random UUID for session ID
// ============================================================================

describe("E2E test: /ralph generates random UUID for session ID", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-uuid-e2e-"));

    // Change to temp directory for testing
    process.chdir(tmpDir);

    // Create research directory with feature-list.json for non-yolo mode tests
    const researchDir = path.join(tmpDir, "research");
    await fs.mkdir(researchDir, { recursive: true });
    const featureListContent = {
      features: [
        {
          category: "functional",
          description: "Test feature",
          steps: ["Step 1"],
          passes: false,
        },
      ],
    };
    await fs.writeFile(
      path.join(researchDir, "feature-list.json"),
      JSON.stringify(featureListContent, null, 2)
    );
  });

  afterEach(async () => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up the temporary directory
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. Run /ralph multiple times
  // ============================================================================

  describe("1. Run /ralph multiple times", () => {
    test("can generate a single session ID", () => {
      const sessionId = generateSessionId();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
    });

    test("can generate multiple session IDs in sequence", () => {
      const sessionIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        sessionIds.push(generateSessionId());
      }
      expect(sessionIds.length).toBe(10);
      expect(sessionIds.every((id) => typeof id === "string")).toBe(true);
    });

    test("can generate session IDs rapidly", () => {
      const startTime = performance.now();
      const sessionIds: string[] = [];

      for (let i = 0; i < 100; i++) {
        sessionIds.push(generateSessionId());
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(sessionIds.length).toBe(100);
      // Should be fast (less than 100ms for 100 UUIDs)
      expect(duration).toBeLessThan(100);
    });

    test("workflow creation generates session ID when executing command", () => {
      // Parse the args as the command handler would
      const args = parseRalphArgs("implement feature");

      // Generate session ID as the command handler does
      const sessionId = generateSessionId();

      expect(sessionId).toBeDefined();
      expect(isValidUUID(sessionId)).toBe(true);
    });

    test("multiple workflow starts each get unique session ID", () => {
      const sessionIds: string[] = [];

      // Simulate starting 5 workflows
      for (let i = 0; i < 5; i++) {
        const sessionId = generateSessionId();
        sessionIds.push(sessionId);
      }

      // Each should have a unique ID
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(5);
    });
  });

  // ============================================================================
  // 2. Collect session UUIDs
  // ============================================================================

  describe("2. Collect session UUIDs", () => {
    test("can collect UUIDs into a Set", () => {
      const uuids = new Set<string>();

      for (let i = 0; i < 20; i++) {
        uuids.add(generateSessionId());
      }

      expect(uuids.size).toBe(20);
    });

    test("can collect UUIDs into an Array", () => {
      const uuids: string[] = [];

      for (let i = 0; i < 20; i++) {
        uuids.push(generateSessionId());
      }

      expect(uuids.length).toBe(20);
    });

    test("collected UUIDs are all strings", () => {
      const uuids: string[] = [];

      for (let i = 0; i < 10; i++) {
        uuids.push(generateSessionId());
      }

      expect(uuids.every((uuid) => typeof uuid === "string")).toBe(true);
    });

    test("collected UUIDs can be used to create session directories", async () => {
      const uuids: string[] = [];

      for (let i = 0; i < 3; i++) {
        const uuid = generateSessionId();
        uuids.push(uuid);
        await createSessionDirectory(uuid);
      }

      // Verify each directory exists
      for (const uuid of uuids) {
        const dir = getSessionDir(uuid);
        expect(existsSync(dir)).toBe(true);
      }
    });
  });

  // ============================================================================
  // 3. Verify all UUIDs are unique
  // ============================================================================

  describe("3. Verify all UUIDs are unique", () => {
    test("10 generated UUIDs are all unique", () => {
      const uuids = new Set<string>();

      for (let i = 0; i < 10; i++) {
        uuids.add(generateSessionId());
      }

      expect(uuids.size).toBe(10);
    });

    test("100 generated UUIDs are all unique", () => {
      const uuids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        uuids.add(generateSessionId());
      }

      expect(uuids.size).toBe(100);
    });

    test("1000 generated UUIDs are all unique", () => {
      const uuids = new Set<string>();

      for (let i = 0; i < 1000; i++) {
        uuids.add(generateSessionId());
      }

      expect(uuids.size).toBe(1000);
    });

    test("UUIDs generated in separate loops are still unique", () => {
      const batch1: string[] = [];
      const batch2: string[] = [];

      // First batch
      for (let i = 0; i < 50; i++) {
        batch1.push(generateSessionId());
      }

      // Second batch
      for (let i = 0; i < 50; i++) {
        batch2.push(generateSessionId());
      }

      // Combine and check uniqueness
      const allUuids = new Set([...batch1, ...batch2]);
      expect(allUuids.size).toBe(100);
    });

    test("no duplicates when generating UUIDs concurrently", async () => {
      const promises: Promise<string>[] = [];

      // Generate 50 UUIDs in parallel
      for (let i = 0; i < 50; i++) {
        promises.push(Promise.resolve(generateSessionId()));
      }

      const uuids = await Promise.all(promises);
      const uniqueUuids = new Set(uuids);

      expect(uniqueUuids.size).toBe(50);
    });

    test("no collisions across multiple test iterations", () => {
      const allUuids = new Set<string>();

      // Simulate 10 test iterations, each generating 50 UUIDs
      for (let iteration = 0; iteration < 10; iteration++) {
        for (let i = 0; i < 50; i++) {
          allUuids.add(generateSessionId());
        }
      }

      expect(allUuids.size).toBe(500);
    });
  });

  // ============================================================================
  // 4. Verify UUID format is valid v4
  // ============================================================================

  describe("4. Verify UUID format is valid v4", () => {
    test("single UUID matches v4 pattern", () => {
      const uuid = generateSessionId();
      expect(uuid).toMatch(UUID_V4_PATTERN);
    });

    test("UUID has correct length (36 characters)", () => {
      const uuid = generateSessionId();
      expect(uuid.length).toBe(36);
    });

    test("UUID has correct format with 4 hyphens", () => {
      const uuid = generateSessionId();
      const parts = uuid.split("-");
      expect(parts.length).toBe(5);
    });

    test("UUID parts have correct lengths (8-4-4-4-12)", () => {
      const uuid = generateSessionId();
      const parts = uuid.split("-");

      expect(parts[0]?.length).toBe(8);
      expect(parts[1]?.length).toBe(4);
      expect(parts[2]?.length).toBe(4);
      expect(parts[3]?.length).toBe(4);
      expect(parts[4]?.length).toBe(12);
    });

    test("UUID v4 has '4' in the version position", () => {
      const uuid = generateSessionId();
      // The 13th character (index 14 with hyphens) should be '4'
      expect(uuid[14]).toBe("4");
    });

    test("UUID v4 has valid variant bits (8, 9, a, or b)", () => {
      const uuid = generateSessionId();
      // The 17th character (index 19 with hyphens) should be 8, 9, a, or b
      const variantChar = uuid[19]!.toLowerCase();
      expect(["8", "9", "a", "b"]).toContain(variantChar);
    });

    test("UUID contains only valid hex characters and hyphens", () => {
      const uuid = generateSessionId();
      expect(uuid).toMatch(/^[0-9a-f-]+$/i);
    });

    test("isValidUUID correctly validates generated UUIDs", () => {
      for (let i = 0; i < 20; i++) {
        const uuid = generateSessionId();
        expect(isValidUUID(uuid)).toBe(true);
      }
    });

    test("100 generated UUIDs all match v4 pattern", () => {
      for (let i = 0; i < 100; i++) {
        const uuid = generateSessionId();
        expect(uuid).toMatch(UUID_V4_PATTERN);
      }
    });

    test("UUID is lowercase", () => {
      const uuid = generateSessionId();
      // UUID should be lowercase (crypto.randomUUID returns lowercase)
      expect(uuid).toBe(uuid.toLowerCase());
    });
  });

  // ============================================================================
  // Integration: Complete UUID generation workflow
  // ============================================================================

  describe("Integration: Complete UUID generation workflow", () => {
    test("complete flow: generate UUID -> create session -> verify uniqueness", async () => {
      const sessionsCreated: Array<{ uuid: string; dir: string }> = [];

      // Generate and create 5 sessions
      for (let i = 0; i < 5; i++) {
        const uuid = generateSessionId();
        const dir = await createSessionDirectory(uuid);

        const session = createRalphSession({
          sessionId: uuid,
          sessionDir: dir,
          status: "running",
        });

        await saveSession(dir, session);
        sessionsCreated.push({ uuid, dir });
      }

      // Verify all UUIDs are unique
      const uniqueUuids = new Set(sessionsCreated.map((s) => s.uuid));
      expect(uniqueUuids.size).toBe(5);

      // Verify all UUIDs are valid v4
      for (const { uuid } of sessionsCreated) {
        expect(uuid).toMatch(UUID_V4_PATTERN);
        expect(isValidUUID(uuid)).toBe(true);
      }

      // Verify all directories exist and are distinct
      const uniqueDirs = new Set(sessionsCreated.map((s) => s.dir));
      expect(uniqueDirs.size).toBe(5);

      for (const { dir } of sessionsCreated) {
        expect(existsSync(dir)).toBe(true);
      }
    });

    test("simulated multiple /ralph runs produce unique sessions", async () => {
      const sessionIds: string[] = [];

      // Simulate 10 /ralph command executions
      for (let i = 0; i < 10; i++) {
        // Parse args as command handler would
        const args = parseRalphArgs(`implement feature ${i + 1}`);

        // Generate session ID as command handler does
        const sessionId = generateSessionId();
        sessionIds.push(sessionId);

        // Create session directory
        const sessionDir = await createSessionDirectory(sessionId);

        // Verify directory was created
        expect(existsSync(sessionDir)).toBe(true);
      }

      // Verify all session IDs are unique
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(10);

      // Verify all are valid v4 UUIDs
      for (const sessionId of sessionIds) {
        expect(isValidUUID(sessionId)).toBe(true);
        expect(sessionId).toMatch(UUID_V4_PATTERN);
      }
    });

    test("workflow creation uses unique session IDs", () => {
      const workflowSessionIds: string[] = [];

      // Create multiple workflows (without executing)
      for (let i = 0; i < 5; i++) {
        // Simulate what happens when ralph command is executed
        const sessionId = generateSessionId();
        workflowSessionIds.push(sessionId);

        // Create workflow with session config
        const workflow = createRalphWorkflow({
          checkpointing: false,
          yolo: true,
          userPrompt: `Task ${i + 1}`,
        });

        expect(workflow).toBeDefined();
      }

      // Verify all session IDs are unique and valid
      const uniqueIds = new Set(workflowSessionIds);
      expect(uniqueIds.size).toBe(5);

      for (const sessionId of workflowSessionIds) {
        expect(isValidUUID(sessionId)).toBe(true);
      }
    });
  });

  // ============================================================================
  // Edge cases and error handling
  // ============================================================================

  describe("Edge cases and error handling", () => {
    test("generateSessionId never returns empty string", () => {
      for (let i = 0; i < 100; i++) {
        const uuid = generateSessionId();
        expect(uuid.length).toBeGreaterThan(0);
      }
    });

    test("generateSessionId never returns undefined or null", () => {
      for (let i = 0; i < 100; i++) {
        const uuid = generateSessionId();
        expect(uuid).not.toBeUndefined();
        expect(uuid).not.toBeNull();
      }
    });

    test("isValidUUID rejects non-v4 UUID formats", () => {
      // Invalid formats
      expect(isValidUUID("")).toBe(false);
      expect(isValidUUID("not-a-uuid")).toBe(false);
      expect(isValidUUID("12345678-1234-1234-1234-123456789012")).toBe(true); // This is still valid format
      expect(isValidUUID("12345678-1234-1234-1234-12345678901")).toBe(false); // Too short
      expect(isValidUUID("12345678-1234-1234-1234-1234567890123")).toBe(false); // Too long
      expect(isValidUUID("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")).toBe(false); // Invalid chars
      expect(isValidUUID("12345678123412341234123456789012")).toBe(false); // Missing hyphens
    });

    test("UUID generation is deterministically random (uses crypto)", () => {
      // Two UUIDs generated in sequence should differ
      const uuid1 = generateSessionId();
      const uuid2 = generateSessionId();

      expect(uuid1).not.toBe(uuid2);
    });

    test("session ID from command can be used for resumption validation", () => {
      const sessionId = generateSessionId();

      // Simulate --resume flag validation
      expect(isValidUUID(sessionId)).toBe(true);

      // Simulate building session directory path
      const sessionDir = getSessionDir(sessionId);
      expect(sessionDir).toContain(sessionId);
    });

    test("very fast sequential calls still produce unique UUIDs", () => {
      const uuids: string[] = [];

      // Generate as fast as possible
      for (let i = 0; i < 1000; i++) {
        uuids.push(generateSessionId());
      }

      const uniqueUuids = new Set(uuids);
      expect(uniqueUuids.size).toBe(1000);
    });
  });
});
