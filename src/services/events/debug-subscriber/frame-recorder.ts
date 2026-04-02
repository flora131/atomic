import { join } from "path";
import { ensureDir } from "@/services/system/copy.ts";
import type { CliRenderer, OptimizedBuffer } from "@opentui/core";

export const LOG_FRAMES_DIR_NAME = "frames";
/** Capture every 6th renderer frame (~5 FPS at 30 FPS render rate). */
export const DEFAULT_FRAME_CAPTURE_INTERVAL = 6;
const FRAME_CAPTURE_INTERVAL_ENV = "DEBUG_FRAME_INTERVAL";

/**
 * Resolve the frame capture interval from the environment.
 *
 * - `DEBUG_FRAME_INTERVAL=0` disables frame capture entirely.
 * - Any positive integer overrides the default (6).
 * - Invalid or missing values fall back to the default.
 */
export function resolveFrameCaptureInterval(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[FRAME_CAPTURE_INTERVAL_ENV]?.trim();
  if (!raw) return DEFAULT_FRAME_CAPTURE_INTERVAL;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_FRAME_CAPTURE_INTERVAL;
  return parsed;
}

export interface FrameRecorderConfig {
  /** Session log directory. A `frames/` subdirectory is created inside it. */
  sessionLogDir: string;
  /** Capture one frame every N renderer frames. 0 disables capture. */
  captureInterval?: number;
}

/**
 * Records terminal frames from the OpenTUI renderer to disk.
 *
 * Hooks into `CliRenderer.addPostProcessFn` so it fires after every React
 * render pass. Only every Nth frame is persisted (configurable, default 6).
 *
 * Frame files are plain-text snapshots of the terminal buffer written to
 * `{sessionLogDir}/frames/frame-{seq}-{elapsedMs}.txt`.
 */
export class FrameRecorder {
  private readonly framesDir: string;
  private readonly captureInterval: number;
  private readonly decoder = new TextDecoder();
  private rendererFrameNumber = 0;
  private capturedCount = 0;
  private startMs = 0;
  private renderer: CliRenderer | null = null;
  private active = false;
  private streamActive = false;

  /** Bound reference kept so we can call `removePostProcessFn` with the same identity. */
  private readonly boundPostProcess: (buffer: OptimizedBuffer, deltaTime: number) => void;

  constructor(config: FrameRecorderConfig) {
    this.framesDir = join(config.sessionLogDir, LOG_FRAMES_DIR_NAME);
    this.captureInterval = config.captureInterval ?? DEFAULT_FRAME_CAPTURE_INTERVAL;
    this.boundPostProcess = this.onPostProcess.bind(this);
  }

  /**
   * Attach to a live renderer. Creates the `frames/` directory and begins
   * capturing on each post-process tick.
   */
  async attach(renderer: CliRenderer): Promise<void> {
    if (this.captureInterval <= 0) return;

    this.renderer = renderer;
    await ensureDir(this.framesDir);
    this.startMs = Date.now();
    this.active = true;
    renderer.addPostProcessFn(this.boundPostProcess);
  }

  /**
   * Signal that an agent stream has started. Frame capture resumes.
   */
  resume(): void {
    this.streamActive = true;
  }

  /**
   * Signal that the agent stream has gone idle/errored. Frame capture pauses.
   */
  pause(): void {
    this.streamActive = false;
  }

  /**
   * Post-process callback invoked by OpenTUI after every render pass.
   * Captures the buffer content every `captureInterval` frames, but only
   * while the stream is active to avoid writing frames during idle periods.
   */
  private onPostProcess(buffer: OptimizedBuffer, _deltaTime: number): void {
    if (!this.active || !this.streamActive) return;

    const frame = this.rendererFrameNumber++;
    if (frame % this.captureInterval !== 0) return;

    const bytes = buffer.getRealCharBytes(true);
    const text = this.decoder.decode(bytes);
    const elapsedMs = Date.now() - this.startMs;
    const seq = String(this.capturedCount++).padStart(6, "0");
    const fileName = `frame-${seq}-${elapsedMs}.txt`;

    // Fire-and-forget: writing must not block the render loop.
    Bun.write(join(this.framesDir, fileName), text).catch(() => {});
  }

  /** Detach from the renderer and stop capturing frames. */
  dispose(): void {
    this.active = false;
    if (this.renderer) {
      this.renderer.removePostProcessFn(this.boundPostProcess);
      this.renderer = null;
    }
  }

  /** Number of frames actually written to disk so far. */
  get framesCaptured(): number {
    return this.capturedCount;
  }
}
