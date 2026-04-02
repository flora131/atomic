import { readdirSync, copyFileSync } from "fs";
import { join } from "path";
import type { AgentType } from "@/services/models/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import { isWindows } from "@/services/system/detect.ts";
import {
  clearActiveDiagnosticWriter,
  clearActiveSessionLogDir,
  getActiveSessionLogDir,
  resolveStreamDebugLogConfig,
  setActiveDiagnosticWriter,
  setActiveSessionLogDir,
} from "./config.ts";
import type { RawStreamLogEntry } from "./config.ts";
import { initEventLog } from "./log-writer.ts";

/**
 * Resolve the OpenCode log directory using platform-appropriate conventions.
 * - Windows: %LOCALAPPDATA%\opencode\log
 * - Unix: $XDG_DATA_HOME/opencode/log or ~/.local/share/opencode/log
 */
function resolveOpencodeLogDir(): string {
  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA
      || join(process.env.USERPROFILE || "", "AppData", "Local");
    return join(localAppData, "opencode", "log");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME
    || join(process.env.HOME || "", ".local", "share");
  return join(xdgDataHome, "opencode", "log");
}

export async function attachDebugSubscriber(bus: EventBus, agentType?: AgentType): Promise<{
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

  // If a session log directory was pre-created (e.g. early in chatCommand
  // to support SDK options that read the path at build time), reuse it
  // instead of generating a new timestamped directory.
  const preExistingSessionDir = getActiveSessionLogDir();

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
    sessionDir: preExistingSessionDir,
  });

  if (logDirPath) {
    setActiveSessionLogDir(logDirPath);
  }

  setActiveDiagnosticWriter(writeDiagnostic);

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

    // Copy the most recent OpenCode log file into the Atomic session directory,
    // but only when the active agent is actually OpenCode.
    if (agentType === "opencode") {
      try {
        const sessionDir = getActiveSessionLogDir();
        const opencodeLogDir = resolveOpencodeLogDir();
        if (sessionDir) {
          const entries = readdirSync(opencodeLogDir, { withFileTypes: true });
          const logFiles = entries
            .filter((e) => e.isFile())
            .map((e) => e.name)
            .sort();
          if (logFiles.length > 0) {
            const mostRecentLog = logFiles[logFiles.length - 1]!;
            copyFileSync(
              join(opencodeLogDir, mostRecentLog),
              join(sessionDir, "opencode-debug.log"),
            );
          }
        }
      } catch {
        // OpenCode log directory may not exist — silently skip.
      }
    }

    clearActiveSessionLogDir();
    clearActiveDiagnosticWriter();
  };

  return { unsubscribe, logPath, rawLogPath, logDirPath, writeRawLine };
}
