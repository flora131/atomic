export type StreamRunKind = "foreground" | "workflow-hidden" | "background" | "subagent";

export type StreamRunVisibility = "visible" | "hidden";

export type StreamRunStatus = "running" | "completed" | "interrupted" | "error";

export interface StreamRunResult {
  content: string;
  wasInterrupted: boolean;
  wasCancelled?: boolean;
}

export interface StreamRunStartOptions {
  kind?: StreamRunKind;
  visibility?: StreamRunVisibility;
  parentRunId?: string;
  messageId?: string;
}

export interface StreamRunRecord {
  id: string;
  kind: StreamRunKind;
  visibility: StreamRunVisibility;
  status: StreamRunStatus;
  parentRunId?: string;
  messageId?: string;
  content: string;
  startedAt: number;
  completedAt?: number;
  result?: StreamRunResult;
}

export interface StreamRunHandle {
  runId: string;
  kind: StreamRunKind;
  visibility: StreamRunVisibility;
  result: Promise<StreamRunResult>;
}

interface InternalStreamRunRecord extends StreamRunRecord {
  resolve: (result: StreamRunResult) => void;
}

function isForegroundOwnedRun(kind: StreamRunKind): boolean {
  return kind === "foreground" || kind === "workflow-hidden" || kind === "subagent";
}

export class StreamRunRuntime {
  private runs = new Map<string, InternalStreamRunRecord>();
  private runIdByMessageId = new Map<string, string>();
  private activeForegroundRunId: string | null = null;
  /** Maximum number of completed runs to retain for lookup. */
  private static readonly MAX_COMPLETED_RUNS = 100;

  startRun(options: StreamRunStartOptions = {}): StreamRunHandle {
    const visibility = options.visibility ?? "visible";
    const kind = options.kind ?? (visibility === "hidden" ? "workflow-hidden" : "foreground");

    if (isForegroundOwnedRun(kind) && this.activeForegroundRunId) {
      this.interruptRun(this.activeForegroundRunId);
    }

    const runId = crypto.randomUUID();
    let resolveResult: ((result: StreamRunResult) => void) | null = null;
    const result = new Promise<StreamRunResult>((resolve) => {
      resolveResult = resolve;
    });

    const record: InternalStreamRunRecord = {
      id: runId,
      kind,
      visibility,
      status: "running",
      ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
      ...(options.messageId ? { messageId: options.messageId } : {}),
      content: "",
      startedAt: Date.now(),
      resolve: resolveResult!,
    };

    this.runs.set(runId, record);
    if (options.messageId) {
      this.runIdByMessageId.set(options.messageId, runId);
    }
    if (isForegroundOwnedRun(kind)) {
      this.activeForegroundRunId = runId;
    }

    return {
      runId,
      kind,
      visibility,
      result,
    };
  }

  getActiveForegroundRunId(): string | null {
    return this.activeForegroundRunId;
  }

  getRun(runId: string | null | undefined): StreamRunRecord | null {
    if (!runId) return null;
    return this.runs.get(runId) ?? null;
  }

  getRunByMessageId(messageId: string): StreamRunRecord | null {
    const runId = this.runIdByMessageId.get(messageId);
    return runId ? (this.runs.get(runId) ?? null) : null;
  }

  bindMessage(runId: string, messageId: string): void {
    const record = this.runs.get(runId);
    if (!record) return;

    if (record.messageId && record.messageId !== messageId) {
      this.runIdByMessageId.delete(record.messageId);
    }

    record.messageId = messageId;
    this.runIdByMessageId.set(messageId, runId);
  }

  appendContent(runId: string | null | undefined, delta: string): void {
    if (!runId) return;
    const record = this.runs.get(runId);
    if (!record || record.status !== "running") return;
    record.content += delta;
  }

  isHidden(runId: string | null | undefined): boolean {
    return this.getRun(runId)?.visibility === "hidden";
  }

  completeRun(
    runId: string | null | undefined,
    overrides: Partial<StreamRunResult> = {},
  ): StreamRunResult | null {
    return this.finalizeRun(runId, "completed", overrides);
  }

  interruptRun(
    runId: string | null | undefined,
    overrides: Partial<StreamRunResult> = {},
  ): StreamRunResult | null {
    return this.finalizeRun(runId, "interrupted", {
      wasInterrupted: true,
      ...overrides,
    });
  }

  failRun(
    runId: string | null | undefined,
    overrides: Partial<StreamRunResult> = {},
  ): StreamRunResult | null {
    return this.finalizeRun(runId, "error", {
      wasInterrupted: true,
      ...overrides,
    });
  }

  clear(): void {
    for (const record of this.runs.values()) {
      if (record.status === "running") {
        record.resolve({
          content: record.content,
          wasInterrupted: true,
        });
      }
    }
    this.runs.clear();
    this.runIdByMessageId.clear();
    this.activeForegroundRunId = null;
  }

  private finalizeRun(
    runId: string | null | undefined,
    status: Exclude<StreamRunStatus, "running">,
    overrides: Partial<StreamRunResult>,
  ): StreamRunResult | null {
    if (!runId) return null;
    const record = this.runs.get(runId);
    if (!record) return null;

    if (record.status !== "running") {
      return record.result ?? null;
    }

    const result: StreamRunResult = {
      content: overrides.content ?? record.content,
      wasInterrupted: overrides.wasInterrupted ?? (status !== "completed"),
      ...(overrides.wasCancelled !== undefined ? { wasCancelled: overrides.wasCancelled } : {}),
    };

    record.status = status;
    record.completedAt = Date.now();
    record.result = result;
    record.resolve(result);

    if (record.messageId) {
      this.runIdByMessageId.set(record.messageId, record.id);
    }
    if (this.activeForegroundRunId === record.id) {
      this.activeForegroundRunId = null;
    }

    this.pruneCompletedRuns();

    return result;
  }

  /**
   * Remove oldest completed runs when the total exceeds the retention limit.
   * Prevents the runs Map from growing monotonically over long sessions.
   */
  private pruneCompletedRuns(): void {
    if (this.runs.size <= StreamRunRuntime.MAX_COMPLETED_RUNS) return;

    const completedEntries: [string, InternalStreamRunRecord][] = [];
    for (const [id, record] of this.runs) {
      if (record.status !== "running") {
        completedEntries.push([id, record]);
      }
    }

    // Sort by completedAt ascending (oldest first)
    completedEntries.sort((a, b) => (a[1].completedAt ?? 0) - (b[1].completedAt ?? 0));

    const toRemove = this.runs.size - StreamRunRuntime.MAX_COMPLETED_RUNS;
    for (let i = 0; i < toRemove && i < completedEntries.length; i++) {
      const entry = completedEntries[i];
      if (!entry) continue;
      const [id, record] = entry;
      this.runs.delete(id);
      if (record.messageId) {
        this.runIdByMessageId.delete(record.messageId);
      }
    }
  }
}
