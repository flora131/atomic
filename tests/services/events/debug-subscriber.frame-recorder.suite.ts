import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  FrameRecorder,
  resolveFrameCaptureInterval,
} from "@/services/events/debug-subscriber/frame-recorder.ts";
import type { CliRenderer, OptimizedBuffer } from "@opentui/core";

// ---------------------------------------------------------------------------
// Minimal stub for CliRenderer + OptimizedBuffer.
// We only stub the methods FrameRecorder actually calls so we exercise real
// behaviour: frame counting, interval gating, file I/O, and cleanup.
// ---------------------------------------------------------------------------

function createMockRenderer(): {
  renderer: CliRenderer;
  /** Simulate a render-loop tick by invoking all registered post-process fns. */
  tick: () => void;
} {
  const postProcessFns: Array<(buffer: OptimizedBuffer, deltaTime: number) => void> = [];
  const encoder = new TextEncoder();

  // Minimal OptimizedBuffer stub — returns a fixed frame string.
  let frameContent = "Hello, frame!";
  const buffer = {
    getRealCharBytes(addLineBreaks?: boolean): Uint8Array {
      void addLineBreaks;
      return encoder.encode(frameContent);
    },
    /** Allow tests to change frame content between ticks. */
    set _content(value: string) {
      frameContent = value;
    },
  } as unknown as OptimizedBuffer & { _content: string };

  const renderer = {
    addPostProcessFn(fn: (buf: OptimizedBuffer, dt: number) => void) {
      postProcessFns.push(fn);
    },
    removePostProcessFn(fn: (buf: OptimizedBuffer, dt: number) => void) {
      const idx = postProcessFns.indexOf(fn);
      if (idx !== -1) postProcessFns.splice(idx, 1);
    },
  } as unknown as CliRenderer;

  return {
    renderer,
    tick() {
      for (const fn of postProcessFns) {
        fn(buffer, 16);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveFrameCaptureInterval", () => {
  test("returns default (6) when env is unset", () => {
    expect(resolveFrameCaptureInterval({})).toBe(6);
  });

  test("returns parsed integer from DEBUG_FRAME_INTERVAL", () => {
    expect(resolveFrameCaptureInterval({ DEBUG_FRAME_INTERVAL: "10" })).toBe(10);
  });

  test("returns 0 when explicitly disabled", () => {
    expect(resolveFrameCaptureInterval({ DEBUG_FRAME_INTERVAL: "0" })).toBe(0);
  });

  test("returns default for non-numeric value", () => {
    expect(resolveFrameCaptureInterval({ DEBUG_FRAME_INTERVAL: "abc" })).toBe(6);
  });

  test("returns default for negative value", () => {
    expect(resolveFrameCaptureInterval({ DEBUG_FRAME_INTERVAL: "-5" })).toBe(6);
  });
});

describe("FrameRecorder", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "atomic-frame-recorder-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("captures a frame on the first tick (frame 0)", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir, captureInterval: 1 });
    await recorder.attach(renderer);
    recorder.resume();

    tick();

    // Allow fire-and-forget Bun.write to flush.
    await Bun.sleep(50);

    const files = await readdir(join(testDir, "frames"));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^frame-000000-\d+\.txt$/);

    const content = await readFile(join(testDir, "frames", files[0]!), "utf-8");
    expect(content).toBe("Hello, frame!");

    recorder.dispose();
  });

  test("respects captureInterval — only captures every Nth frame", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir, captureInterval: 3 });
    await recorder.attach(renderer);
    recorder.resume();

    // Tick 9 times: frames 0,1,2,3,4,5,6,7,8
    // Should capture at frames 0, 3, 6 → 3 captures.
    for (let i = 0; i < 9; i++) tick();

    await Bun.sleep(50);

    const files = (await readdir(join(testDir, "frames"))).sort();
    expect(files.length).toBe(3);
    expect(recorder.framesCaptured).toBe(3);

    recorder.dispose();
  });

  test("does not capture when captureInterval is 0 (disabled)", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir, captureInterval: 0 });
    await recorder.attach(renderer);

    tick();
    tick();

    await Bun.sleep(50);

    // frames/ dir should not even be created when interval is 0.
    const entries = await readdir(testDir);
    expect(entries).not.toContain("frames");

    recorder.dispose();
  });

  test("stops capturing after dispose()", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir, captureInterval: 1 });
    await recorder.attach(renderer);
    recorder.resume();

    tick(); // captured
    recorder.dispose();
    tick(); // should NOT be captured (post-process fn removed)

    await Bun.sleep(50);

    const files = await readdir(join(testDir, "frames"));
    expect(files.length).toBe(1);
  });

  test("uses default captureInterval of 6 when not specified — captures every 6th frame", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir });
    await recorder.attach(renderer);
    recorder.resume();

    // Tick 12 times: frames 0–11. With interval 6, captures at frames 0 and 6 → 2 captures.
    for (let i = 0; i < 12; i++) tick();

    await Bun.sleep(50);

    const files = await readdir(join(testDir, "frames"));
    expect(files.length).toBe(2);
    expect(recorder.framesCaptured).toBe(2);

    recorder.dispose();
  });

  test("frame filenames include sequential number and elapsed ms", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir, captureInterval: 1 });
    await recorder.attach(renderer);
    recorder.resume();

    tick();
    tick();
    tick();

    await Bun.sleep(50);

    const files = (await readdir(join(testDir, "frames"))).sort();
    expect(files.length).toBe(3);
    // Verify sequential numbering.
    expect(files[0]).toMatch(/^frame-000000-/);
    expect(files[1]).toMatch(/^frame-000001-/);
    expect(files[2]).toMatch(/^frame-000002-/);

    recorder.dispose();
  });

  test("does not capture frames when stream is not active (paused by default)", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir, captureInterval: 1 });
    await recorder.attach(renderer);

    // Stream is not active — ticks should produce no frames.
    tick();
    tick();
    tick();

    await Bun.sleep(50);

    const files = await readdir(join(testDir, "frames"));
    expect(files.length).toBe(0);
    expect(recorder.framesCaptured).toBe(0);

    recorder.dispose();
  });

  test("captures frames only while resumed, pauses when told", async () => {
    const { renderer, tick } = createMockRenderer();
    const recorder = new FrameRecorder({ sessionLogDir: testDir, captureInterval: 1 });
    await recorder.attach(renderer);

    // Not active yet — no capture.
    tick();
    await Bun.sleep(20);
    expect(recorder.framesCaptured).toBe(0);

    // Resume — captures should start.
    recorder.resume();
    tick();
    tick();
    await Bun.sleep(50);
    expect(recorder.framesCaptured).toBe(2);

    // Pause — captures should stop.
    recorder.pause();
    tick();
    tick();
    await Bun.sleep(50);
    expect(recorder.framesCaptured).toBe(2);

    // Resume again — captures resume.
    recorder.resume();
    tick();
    await Bun.sleep(50);
    expect(recorder.framesCaptured).toBe(3);

    const files = await readdir(join(testDir, "frames"));
    expect(files.length).toBe(3);

    recorder.dispose();
  });
});
