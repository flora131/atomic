/**
 * File Locking Utility
 *
 * Provides a simple file-based locking mechanism to prevent concurrent
 * writes to shared files like progress.txt, feature-list.json, etc.
 *
 * Uses lock files (.lock suffix) with process info to track ownership.
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Lock file content structure.
 */
interface LockInfo {
  /** Process ID that holds the lock */
  pid: number;
  /** Session ID (if available) */
  sessionId?: string;
  /** Timestamp when lock was acquired */
  acquiredAt: number;
  /** Hostname where the lock was acquired */
  hostname?: string;
}

/**
 * Result of a lock acquisition attempt.
 */
export interface LockResult {
  /** Whether the lock was acquired */
  acquired: boolean;
  /** Lock file path */
  lockPath: string;
  /** Error message if lock wasn't acquired */
  error?: string;
  /** Info about the process holding the lock (if not acquired) */
  holder?: LockInfo;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Lock file suffix */
const LOCK_SUFFIX = ".lock";

/** Default lock timeout in milliseconds (30 seconds) */
const DEFAULT_LOCK_TIMEOUT_MS = 30000;

/** Retry interval for lock acquisition */
const LOCK_RETRY_INTERVAL_MS = 100;

// ============================================================================
// LOCK FUNCTIONS
// ============================================================================

/**
 * Get the lock file path for a given file.
 */
export function getLockPath(filePath: string): string {
  return `${filePath}${LOCK_SUFFIX}`;
}

/**
 * Try to acquire a lock on a file.
 *
 * @param filePath - Path to the file to lock
 * @param sessionId - Optional session ID for tracking
 * @returns Lock result
 */
export function tryAcquireLock(filePath: string, sessionId?: string): LockResult {
  const lockPath = getLockPath(filePath);

  // Check if lock file exists
  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, "utf-8");
      const holder = JSON.parse(content) as LockInfo;

      // Check if the lock holder process is still alive
      if (isProcessAlive(holder.pid)) {
        return {
          acquired: false,
          lockPath,
          error: `File is locked by process ${holder.pid}`,
          holder,
        };
      }

      // Lock holder process is dead, remove stale lock
      unlinkSync(lockPath);
    } catch {
      // Invalid lock file, remove it
      try {
        unlinkSync(lockPath);
      } catch {
        // Ignore removal errors
      }
    }
  }

  // Try to create lock file
  const lockInfo: LockInfo = {
    pid: process.pid,
    sessionId,
    acquiredAt: Date.now(),
    hostname: process.env.HOSTNAME,
  };

  try {
    // Ensure directory exists
    const dir = dirname(lockPath);
    if (!existsSync(dir)) {
      const { mkdirSync } = require("fs");
      mkdirSync(dir, { recursive: true });
    }

    // Write lock file with exclusive flag to prevent race conditions
    writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2), { flag: "wx" });
    return { acquired: true, lockPath };
  } catch (error) {
    // Another process might have created the lock
    return {
      acquired: false,
      lockPath,
      error: `Failed to acquire lock: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Acquire a lock with retry and timeout.
 *
 * @param filePath - Path to the file to lock
 * @param options - Lock options
 * @returns Lock result
 */
export async function acquireLock(
  filePath: string,
  options: {
    sessionId?: string;
    timeoutMs?: number;
  } = {}
): Promise<LockResult> {
  const { sessionId, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = tryAcquireLock(filePath, sessionId);
    if (result.acquired) {
      return result;
    }

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
  }

  // Timeout
  return tryAcquireLock(filePath, sessionId);
}

/**
 * Release a lock on a file.
 *
 * @param filePath - Path to the file to unlock
 * @param options - Release options
 * @returns True if lock was released
 */
export function releaseLock(
  filePath: string,
  options: { force?: boolean } = {}
): boolean {
  const lockPath = getLockPath(filePath);

  if (!existsSync(lockPath)) {
    return true; // Already unlocked
  }

  // Verify we own the lock (unless force)
  if (!options.force) {
    try {
      const content = readFileSync(lockPath, "utf-8");
      const holder = JSON.parse(content) as LockInfo;
      if (holder.pid !== process.pid) {
        return false; // We don't own this lock
      }
    } catch {
      // Invalid lock file, safe to remove
    }
  }

  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a function while holding a lock on a file.
 *
 * @param filePath - Path to the file to lock
 * @param fn - Function to execute while holding the lock
 * @param options - Lock options
 * @returns Result of the function
 */
export async function withLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
  options: {
    sessionId?: string;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const lockResult = await acquireLock(filePath, options);

  if (!lockResult.acquired) {
    throw new Error(lockResult.error ?? `Failed to acquire lock for ${filePath}`);
  }

  try {
    return await fn();
  } finally {
    releaseLock(filePath);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a process is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up stale locks for a directory.
 * Removes lock files whose holder processes are no longer alive.
 *
 * @param directory - Directory to clean up
 * @returns Number of stale locks removed
 */
export function cleanupStaleLocks(directory: string): number {
  const { readdirSync } = require("fs");
  let removed = 0;

  try {
    const files = readdirSync(directory) as string[];
    for (const file of files) {
      if (file.endsWith(LOCK_SUFFIX)) {
        const lockPath = join(directory, file);
        try {
          const content = readFileSync(lockPath, "utf-8");
          const holder = JSON.parse(content) as LockInfo;
          if (!isProcessAlive(holder.pid)) {
            unlinkSync(lockPath);
            removed++;
          }
        } catch {
          // Invalid lock file, remove it
          try {
            unlinkSync(lockPath);
            removed++;
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }

  return removed;
}
