import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as telemetryIndex from "./telemetry/index.ts";

const cliModulePromise = import("./cli.ts");

describe("spawnTelemetryUpload", () => {
  const originalTelemetryUploadFlag = process.env.ATOMIC_TELEMETRY_UPLOAD;
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, "spawn">> | null = null;
  let telemetryEnabledSpy: ReturnType<typeof spyOn<typeof telemetryIndex, "isTelemetryEnabledSync">> | null =
    null;

  afterEach(() => {
    spawnSpy?.mockRestore();
    spawnSpy = null;
    telemetryEnabledSpy?.mockRestore();
    telemetryEnabledSpy = null;

    if (originalTelemetryUploadFlag === undefined) {
      delete process.env.ATOMIC_TELEMETRY_UPLOAD;
    } else {
      process.env.ATOMIC_TELEMETRY_UPLOAD = originalTelemetryUploadFlag;
    }
  });

  test("spawns detached uploader and unreferences child process when telemetry is enabled", async () => {
    delete process.env.ATOMIC_TELEMETRY_UPLOAD;
    telemetryEnabledSpy = spyOn(telemetryIndex, "isTelemetryEnabledSync").mockReturnValue(true);

    const unrefSpy = mock(() => {});
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      { unref: unrefSpy } as unknown as ReturnType<typeof Bun.spawn>,
    );

    const { spawnTelemetryUpload } = await cliModulePromise;
    await spawnTelemetryUpload();

    expect(spawnSpy).not.toBeNull();
    expect(spawnSpy!.mock.calls.length).toBe(1);

    const [argv, options] = spawnSpy!.mock.calls[0]!;
    expect(argv).toEqual([process.execPath, process.argv[1] ?? "atomic", "upload-telemetry"]);
    expect(options).toMatchObject({
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(options).toBeDefined();
    expect(options?.env).toBeDefined();
    if (!options?.env) {
      throw new Error("Expected spawn env to be defined");
    }
    expect(options.env.ATOMIC_TELEMETRY_UPLOAD).toBe("1");
    expect(unrefSpy).toHaveBeenCalledTimes(1);
  });

  test("does not spawn when already running in telemetry upload mode", async () => {
    process.env.ATOMIC_TELEMETRY_UPLOAD = "1";
    telemetryEnabledSpy = spyOn(telemetryIndex, "isTelemetryEnabledSync").mockReturnValue(true);

    spawnSpy = spyOn(Bun, "spawn");

    const { spawnTelemetryUpload } = await cliModulePromise;
    await spawnTelemetryUpload();

    expect(spawnSpy).not.toBeNull();
    expect(spawnSpy!.mock.calls.length).toBe(0);
  });

  test("does not spawn when telemetry is disabled", async () => {
    delete process.env.ATOMIC_TELEMETRY_UPLOAD;
    telemetryEnabledSpy = spyOn(telemetryIndex, "isTelemetryEnabledSync").mockReturnValue(false);

    spawnSpy = spyOn(Bun, "spawn");

    const { spawnTelemetryUpload } = await cliModulePromise;
    await spawnTelemetryUpload();

    expect(spawnSpy).not.toBeNull();
    expect(spawnSpy!.mock.calls.length).toBe(0);
  });
});
