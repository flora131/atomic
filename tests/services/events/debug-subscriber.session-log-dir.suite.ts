/**
 * Unit tests for getActiveSessionLogDir / setActiveSessionLogDir / clearActiveSessionLogDir.
 *
 * These functions track the per-session debug log directory so that SDK option
 * builders (Claude, Copilot) can write their debug output alongside Atomic's own
 * diagnostic files.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  getActiveSessionLogDir,
  setActiveSessionLogDir,
  clearActiveSessionLogDir,
} from "@/services/events/debug-subscriber/config.ts";

describe("getActiveSessionLogDir — session log directory registry", () => {
  // Always clean up module-level state after each test so tests are isolated.
  afterEach(() => {
    clearActiveSessionLogDir();
  });

  test("returns undefined when no session log dir has been set", () => {
    clearActiveSessionLogDir();
    expect(getActiveSessionLogDir()).toBeUndefined();
  });

  test("returns the path after setActiveSessionLogDir() is called", () => {
    const dir = "/tmp/atomic-debug/2024-01-01T120000";
    setActiveSessionLogDir(dir);
    expect(getActiveSessionLogDir()).toBe(dir);
  });

  test("returns undefined after clearActiveSessionLogDir() is called", () => {
    setActiveSessionLogDir("/tmp/atomic-debug/2024-01-01T120000");
    clearActiveSessionLogDir();
    expect(getActiveSessionLogDir()).toBeUndefined();
  });

  test("allows overwriting the stored directory with a new path", () => {
    const firstDir = "/tmp/atomic-debug/session-1";
    const secondDir = "/tmp/atomic-debug/session-2";

    setActiveSessionLogDir(firstDir);
    expect(getActiveSessionLogDir()).toBe(firstDir);

    setActiveSessionLogDir(secondDir);
    expect(getActiveSessionLogDir()).toBe(secondDir);
  });

  test("multiple clear calls are idempotent", () => {
    clearActiveSessionLogDir();
    clearActiveSessionLogDir();
    expect(getActiveSessionLogDir()).toBeUndefined();
  });
});
