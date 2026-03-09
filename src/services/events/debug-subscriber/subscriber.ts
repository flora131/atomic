import type { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import { resolveStreamDebugLogConfig } from "./config.ts";
import type { RawStreamLogEntry } from "./config.ts";
import { initEventLog } from "./log-writer.ts";

export async function attachDebugSubscriber(bus: EventBus): Promise<{
  unsubscribe: () => Promise<void>;
  logPath: string | null;
  rawLogPath: string | null;
  logDirPath: string | null;
  writeRawLine: (
    line: string,
    metadata?: {
      sessionId?: string;
      runId?: number;
      component?: RawStreamLogEntry["component"];
    },
  ) => void;
}> {
  const debugConfig = resolveStreamDebugLogConfig();
  if (!debugConfig.enabled) {
    return {
      unsubscribe: async () => {},
      logPath: null,
      rawLogPath: null,
      logDirPath: null,
      writeRawLine: () => {},
    };
  }

  const {
    write,
    writeDiagnostic,
    writeRawLine,
    close,
    logPath,
    rawLogPath,
    logDirPath,
  } = await initEventLog({
    logDir: debugConfig.logDir,
  });

  writeDiagnostic({
    category: "startup",
    data: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      bunVersion: typeof Bun !== "undefined" ? Bun.version : undefined,
      cwd: process.cwd(),
      debugConfig,
      env: {
        DEBUG: process.env.DEBUG,
        LOG_DIR: process.env.LOG_DIR,
        NODE_ENV: process.env.NODE_ENV,
      },
      argv: process.argv,
      memoryUsage: process.memoryUsage(),
    },
  });

  const unsubBus = bus.onAll((event: BusEvent) => {
    write(event);
    if (debugConfig.consolePreviewEnabled) {
      const preview = JSON.stringify(event.data).slice(0, 100);
      console.debug(`[EventBus] ${event.type} run=${event.runId} ${preview}`);
    }
  });

  const unsubInternalError = bus.onInternalError((busError) => {
    writeDiagnostic({
      category: "bus_error",
      error: busError.error instanceof Error
        ? busError.error.message
        : String(busError.error),
      stack: busError.error instanceof Error
        ? busError.error.stack
        : undefined,
      data: {
        kind: busError.kind,
        eventType: busError.eventType,
        eventData: busError.eventData,
      },
    });
  });

  const onUncaughtException = (error: Error): void => {
    writeDiagnostic({
      category: "process_error",
      error: error.message,
      stack: error.stack,
      data: { kind: "uncaughtException", name: error.name },
    });
  };

  const onUnhandledRejection = (reason: unknown): void => {
    writeDiagnostic({
      category: "process_error",
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      data: { kind: "unhandledRejection" },
    });
  };

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  const unsubscribe = async (): Promise<void> => {
    unsubBus();
    unsubInternalError();
    process.removeListener("uncaughtException", onUncaughtException);
    process.removeListener("unhandledRejection", onUnhandledRejection);
    await close();
  };

  return { unsubscribe, logPath, rawLogPath, logDirPath, writeRawLine };
}
