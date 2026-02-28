/**
 * Unit tests for pipeline-logger diagnostic logging utility
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  pipelineLog,
  isPipelineDebug,
  resetPipelineDebugCache,
} from "./pipeline-logger.ts";

describe("Pipeline Logger", () => {
  let originalEnv: string | undefined;
  let debugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    originalEnv = process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();
    debugSpy = spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ATOMIC_DEBUG;
    } else {
      process.env.ATOMIC_DEBUG = originalEnv;
    }
    resetPipelineDebugCache();
    debugSpy.mockRestore();
  });

  test("isPipelineDebug() returns false when ATOMIC_DEBUG is not set", () => {
    delete process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(false);
  });

  test("isPipelineDebug() returns true when ATOMIC_DEBUG=1", () => {
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(true);
  });

  test("isPipelineDebug() returns false when ATOMIC_DEBUG=0", () => {
    process.env.ATOMIC_DEBUG = "0";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(false);
  });

  test("isPipelineDebug() caches the result", () => {
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(true);

    // Change env but don't reset cache — should still return true
    process.env.ATOMIC_DEBUG = "0";
    expect(isPipelineDebug()).toBe(true);
  });

  test("pipelineLog() emits nothing when debug is off", () => {
    delete process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();

    pipelineLog("EventBus", "schema_drop", { type: "stream.text.delta" });
    expect(debugSpy).not.toHaveBeenCalled();
  });

  test("pipelineLog() emits console.debug when debug is on", () => {
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();

    pipelineLog("EventBus", "schema_drop", { type: "stream.text.delta" });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const msg = debugSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("[Pipeline:EventBus]");
    expect(msg).toContain("schema_drop");
    expect(msg).toContain("stream.text.delta");
  });

  test("pipelineLog() works without data parameter", () => {
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();

    pipelineLog("Dispatcher", "flush");
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const msg = debugSpy.mock.calls[0]![0] as string;
    expect(msg).toBe("[Pipeline:Dispatcher] flush");
  });

  test("pipelineLog() includes structured data as JSON", () => {
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();

    pipelineLog("Wire", "filter_unowned", { total: 10, owned: 7, droppedUnowned: 3 });
    const msg = debugSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('"total":10');
    expect(msg).toContain('"droppedUnowned":3');
  });

  test("pipelineLog() supports all pipeline stages", () => {
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();

    const stages = ["EventBus", "Dispatcher", "Wire", "Consumer", "Subagent"] as const;
    for (const stage of stages) {
      pipelineLog(stage, "test_action");
    }
    expect(debugSpy).toHaveBeenCalledTimes(5);

    for (let i = 0; i < stages.length; i++) {
      const msg = debugSpy.mock.calls[i]![0] as string;
      expect(msg).toContain(`[Pipeline:${stages[i]}]`);
    }
  });

  test("resetPipelineDebugCache() allows re-evaluation", () => {
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(true);

    process.env.ATOMIC_DEBUG = "0";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(false);
  });
});
