import { describe, expect, test } from "bun:test";
import { StreamRunRuntime } from "@/state/runtime/stream-run-runtime.ts";

describe("StreamRunRuntime", () => {
  test("completes a visible foreground run with accumulated content", async () => {
    const runtime = new StreamRunRuntime();
    const run = runtime.startRun();

    runtime.appendContent(run.runId, "Hello");
    runtime.appendContent(run.runId, " world");

    const completed = runtime.completeRun(run.runId);

    expect(completed).toEqual({
      content: "Hello world",
      wasInterrupted: false,
    });
    await expect(run.result).resolves.toEqual({
      content: "Hello world",
      wasInterrupted: false,
    });
  });

  test("interrupts an older foreground run when a replacement starts", async () => {
    const runtime = new StreamRunRuntime();
    const firstRun = runtime.startRun();
    runtime.appendContent(firstRun.runId, "partial");

    const secondRun = runtime.startRun();

    await expect(firstRun.result).resolves.toEqual({
      content: "partial",
      wasInterrupted: true,
    });
    expect(runtime.getActiveForegroundRunId()).toBe(secondRun.runId);
  });

  test("tracks hidden workflow runs separately from visibility", async () => {
    const runtime = new StreamRunRuntime();
    const run = runtime.startRun({
      visibility: "hidden",
      kind: "workflow-hidden",
    });

    expect(runtime.isHidden(run.runId)).toBe(true);
    runtime.appendContent(run.runId, "{\"ok\":true}");
    runtime.completeRun(run.runId);

    await expect(run.result).resolves.toEqual({
      content: "{\"ok\":true}",
      wasInterrupted: false,
    });
  });

  test("binds and resolves runs by message id", () => {
    const runtime = new StreamRunRuntime();
    const run = runtime.startRun();

    runtime.bindMessage(run.runId, "msg-123");

    const boundRun = runtime.getRunByMessageId("msg-123");
    expect(boundRun?.id).toBe(run.runId);
  });

  test("marks failed runs as interrupted for workflow callers", async () => {
    const runtime = new StreamRunRuntime();
    const run = runtime.startRun();
    runtime.appendContent(run.runId, "some output");

    runtime.failRun(run.runId, { wasCancelled: true });

    await expect(run.result).resolves.toEqual({
      content: "some output",
      wasInterrupted: true,
      wasCancelled: true,
    });
  });
});
