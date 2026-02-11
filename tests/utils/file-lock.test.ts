/**
 * Tests for File Lock Utility
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  getLockPath,
  tryAcquireLock,
  acquireLock,
  releaseLock,
  withLock,
  cleanupStaleLocks,
} from "../../src/utils/file-lock.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

const TEST_DIR = "/tmp/atomic-lock-test";
const TEST_FILE = join(TEST_DIR, "test-file.json");

function setupTestDir() {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe("file-lock", () => {
  beforeEach(() => {
    cleanupTestDir();
    setupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  describe("getLockPath", () => {
    test("appends .lock suffix", () => {
      expect(getLockPath("/path/to/file.json")).toBe("/path/to/file.json.lock");
      expect(getLockPath("research/progress.txt")).toBe("research/progress.txt.lock");
    });
  });

  describe("tryAcquireLock", () => {
    test("acquires lock on unlocked file", () => {
      const result = tryAcquireLock(TEST_FILE);

      expect(result.acquired).toBe(true);
      expect(result.lockPath).toBe(getLockPath(TEST_FILE));
      expect(existsSync(result.lockPath)).toBe(true);

      // Cleanup
      releaseLock(TEST_FILE);
    });

    test("fails to acquire lock when file is already locked", () => {
      // First lock
      const result1 = tryAcquireLock(TEST_FILE, "session1");
      expect(result1.acquired).toBe(true);

      // Second lock attempt should fail
      const result2 = tryAcquireLock(TEST_FILE, "session2");
      expect(result2.acquired).toBe(false);
      expect(result2.error).toContain("locked");
      expect(result2.holder?.pid).toBe(process.pid);

      // Cleanup
      releaseLock(TEST_FILE);
    });

    test("includes sessionId in lock info", () => {
      const result = tryAcquireLock(TEST_FILE, "my-session");
      expect(result.acquired).toBe(true);

      // Check lock file content
      const lockPath = getLockPath(TEST_FILE);
      const content = require("fs").readFileSync(lockPath, "utf-8");
      const lockInfo = JSON.parse(content);

      expect(lockInfo.sessionId).toBe("my-session");
      expect(lockInfo.pid).toBe(process.pid);
      expect(lockInfo.acquiredAt).toBeGreaterThan(0);

      // Cleanup
      releaseLock(TEST_FILE);
    });
  });

  describe("acquireLock", () => {
    test("acquires lock with default timeout", async () => {
      const result = await acquireLock(TEST_FILE);

      expect(result.acquired).toBe(true);
      expect(existsSync(result.lockPath)).toBe(true);

      // Cleanup
      releaseLock(TEST_FILE);
    });

    test("respects timeout", async () => {
      // Acquire first lock
      const result1 = await acquireLock(TEST_FILE);
      expect(result1.acquired).toBe(true);

      // Try to acquire with short timeout
      const startTime = Date.now();
      const result2 = await acquireLock(TEST_FILE, { timeoutMs: 500 });
      const elapsed = Date.now() - startTime;

      expect(result2.acquired).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(400); // Should have waited

      // Cleanup
      releaseLock(TEST_FILE);
    });
  });

  describe("releaseLock", () => {
    test("releases owned lock", () => {
      tryAcquireLock(TEST_FILE);
      const lockPath = getLockPath(TEST_FILE);
      expect(existsSync(lockPath)).toBe(true);

      const released = releaseLock(TEST_FILE);

      expect(released).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });

    test("returns true if file is not locked", () => {
      const released = releaseLock(TEST_FILE);
      expect(released).toBe(true);
    });

    test("force releases lock", () => {
      // Create a lock file with different PID
      const lockPath = getLockPath(TEST_FILE);
      writeFileSync(lockPath, JSON.stringify({ pid: 99999, acquiredAt: Date.now() }));

      // Force release
      const released = releaseLock(TEST_FILE, { force: true });

      expect(released).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  describe("withLock", () => {
    test("executes function while holding lock", async () => {
      let executed = false;

      await withLock(TEST_FILE, () => {
        executed = true;
        // Lock should be held
        const result = tryAcquireLock(TEST_FILE);
        expect(result.acquired).toBe(false);
      });

      expect(executed).toBe(true);
      // Lock should be released
      expect(existsSync(getLockPath(TEST_FILE))).toBe(false);
    });

    test("releases lock even on error", async () => {
      let threw = false;

      try {
        await withLock(TEST_FILE, () => {
          throw new Error("Test error");
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
      // Lock should be released
      expect(existsSync(getLockPath(TEST_FILE))).toBe(false);
    });

    test("returns function result", async () => {
      const result = await withLock(TEST_FILE, () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    test("handles async functions", async () => {
      const result = await withLock(TEST_FILE, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async result";
      });

      expect(result).toBe("async result");
    });
  });

  describe("cleanupStaleLocks", () => {
    test("removes locks for dead processes", () => {
      // Create a lock file with dead process PID
      const lockPath = getLockPath(TEST_FILE);
      writeFileSync(lockPath, JSON.stringify({ pid: 99999, acquiredAt: Date.now() }));
      expect(existsSync(lockPath)).toBe(true);

      const removed = cleanupStaleLocks(TEST_DIR);

      expect(removed).toBe(1);
      expect(existsSync(lockPath)).toBe(false);
    });

    test("keeps locks for live processes", () => {
      // Create a lock for this process
      tryAcquireLock(TEST_FILE);
      const lockPath = getLockPath(TEST_FILE);
      expect(existsSync(lockPath)).toBe(true);

      const removed = cleanupStaleLocks(TEST_DIR);

      expect(removed).toBe(0);
      expect(existsSync(lockPath)).toBe(true);

      // Cleanup
      releaseLock(TEST_FILE);
    });
  });
});
