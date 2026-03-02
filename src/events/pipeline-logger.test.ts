/**
 * Unit tests for pipeline-logger diagnostic logging utility
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  pipelineLog,
  pipelineError,
  isPipelineDebug,
  resetPipelineDebugCache,
} from "./pipeline-logger.ts";

describe("Pipeline Logger", () => {
  let originalDebugEnv: string | undefined;
  let originalAtomicDebugEnv: string | undefined;
  let debugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    originalDebugEnv = process.env.DEBUG;
    originalAtomicDebugEnv = process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();
    debugSpy = spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalDebugEnv === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebugEnv;
    }

    if (originalAtomicDebugEnv === undefined) {
      delete process.env.ATOMIC_DEBUG;
    } else {
      process.env.ATOMIC_DEBUG = originalAtomicDebugEnv;
    }

    resetPipelineDebugCache();
    debugSpy.mockRestore();
  });

  test("isPipelineDebug() returns false when debug env is not set", () => {
    delete process.env.DEBUG;
    delete process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(false);
  });

  test("isPipelineDebug() returns true when DEBUG=1", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(true);
  });

  test("isPipelineDebug() returns true with legacy ATOMIC_DEBUG=1", () => {
    delete process.env.DEBUG;
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(true);
  });

  test("isPipelineDebug() returns false when DEBUG=0", () => {
    process.env.DEBUG = "0";
    process.env.ATOMIC_DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(false);
  });

  test("isPipelineDebug() caches the result", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(true);

    // Change env but don't reset cache — should still return true
    process.env.DEBUG = "0";
    expect(isPipelineDebug()).toBe(true);
  });

  test("pipelineLog() emits nothing when debug is off", () => {
    delete process.env.DEBUG;
    delete process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();

    pipelineLog("EventBus", "schema_drop", { type: "stream.text.delta" });
    expect(debugSpy).not.toHaveBeenCalled();
  });

  test("pipelineLog() emits console.debug when debug is on", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();

    pipelineLog("EventBus", "schema_drop", { type: "stream.text.delta" });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const msg = debugSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("[Pipeline:EventBus]");
    expect(msg).toContain("schema_drop");
    expect(msg).toContain("stream.text.delta");
  });

  test("pipelineLog() works without data parameter", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();

    pipelineLog("Dispatcher", "flush");
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const msg = debugSpy.mock.calls[0]![0] as string;
    expect(msg).toBe("[Pipeline:Dispatcher] flush");
  });

  test("pipelineLog() includes structured data as JSON", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();

    pipelineLog("Wire", "filter_unowned", { total: 10, owned: 7, droppedUnowned: 3 });
    const msg = debugSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('"total":10');
    expect(msg).toContain('"droppedUnowned":3');
  });

  test("pipelineLog() supports all pipeline stages", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();

    const stages = ["EventBus", "Dispatcher", "Wire", "Consumer", "Subagent", "Workflow"] as const;
    for (const stage of stages) {
      pipelineLog(stage, "test_action");
    }
    expect(debugSpy).toHaveBeenCalledTimes(6);

    for (let i = 0; i < stages.length; i++) {
      const msg = debugSpy.mock.calls[i]![0] as string;
      expect(msg).toContain(`[Pipeline:${stages[i]}]`);
    }
  });

  test("resetPipelineDebugCache() allows re-evaluation", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(true);

    process.env.DEBUG = "0";
    delete process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();
    expect(isPipelineDebug()).toBe(false);
  });

  test("pipelineError() emits nothing when debug is off", () => {
    delete process.env.DEBUG;
    delete process.env.ATOMIC_DEBUG;
    resetPipelineDebugCache();

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    pipelineError("EventBus", "handler_error", { type: "stream.text.delta" });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("pipelineError() emits console.error when debug is on", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    pipelineError("EventBus", "handler_error", { type: "stream.text.delta" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const msg = errorSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("[Pipeline:EventBus]");
    expect(msg).toContain("handler_error");
    errorSpy.mockRestore();
  });

  test("pipelineError() works for Workflow stage", () => {
    process.env.DEBUG = "1";
    resetPipelineDebugCache();

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    pipelineError("Workflow", "execution_failed", { nodeId: "planner" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const msg = errorSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("[Pipeline:Workflow]");
    expect(msg).toContain("execution_failed");
    expect(msg).toContain("planner");
    errorSpy.mockRestore();
  });
});
