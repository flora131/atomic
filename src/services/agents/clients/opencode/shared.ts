import type { Event as OpenCodeEvent } from "@opencode-ai/sdk/v2/client";
import type { OpenCodeSessionCompactionState } from "@/services/agents/clients/opencode/compaction.ts";

export const CONTEXT_OVERFLOW_PATTERNS = [
  "contextoverflowerror",
  "context_length_exceeded",
  "context length exceeded",
  "context window",
  "maximum context length",
  "input is too long",
  "input exceeds context window",
  "exceeds the model's maximum context",
  "token limit",
  "too many tokens",
  "request too large",
  "prompt is too long",
];

export type OpenCodeSessionStatus = "idle" | "busy" | "retry";

export interface OpenCodeSessionState {
  inputTokens: number;
  outputTokens: number;
  isClosed: boolean;
  contextWindow: number | null;
  systemToolsBaseline: number | null;
  compaction: OpenCodeSessionCompactionState;
}

export interface AtomicManagedOpenCodeServerState {
  url: string;
  close: () => void;
  leaseCount: number;
}

export function parseOpenCodeSessionStatus(
  status: unknown,
): OpenCodeSessionStatus | undefined {
  if (status === "idle" || status === "busy" || status === "retry") {
    return status;
  }

  if (typeof status !== "object" || status === null) {
    return undefined;
  }

  const statusRecord = status as {
    type?: unknown;
    status?: unknown;
    value?: unknown;
  };

  const candidates = [statusRecord.type, statusRecord.status, statusRecord.value];
  for (const candidate of candidates) {
    if (candidate === "idle" || candidate === "busy" || candidate === "retry") {
      return candidate;
    }
  }

  return undefined;
}

export function assertNeverEvent(value: never): never {
  throw new Error(`Unhandled OpenCode event: ${JSON.stringify(value)}`);
}

export function getOpenCodeNativeMeta(
  native: OpenCodeEvent | null | undefined,
): Readonly<Record<string, string | number | boolean | null | undefined>> | undefined {
  if (!native) {
    return undefined;
  }

  const meta: Record<string, string | number | boolean | null | undefined> = {};
  const properties = native.properties;

  if ("sessionID" in properties && typeof properties.sessionID === "string") {
    meta.nativeSessionId = properties.sessionID;
  }
  if ("messageID" in properties && typeof properties.messageID === "string") {
    meta.nativeMessageId = properties.messageID;
  }
  if ("partID" in properties && typeof properties.partID === "string") {
    meta.nativePartId = properties.partID;
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

function asErrorRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asNonEmptyErrorString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function extractOpenCodeErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (error instanceof Error) {
    return error.message;
  }

  const direct = asNonEmptyErrorString(error);
  if (direct) {
    return direct;
  }

  const record = asErrorRecord(error);
  if (!record) {
    return fallback;
  }

  const directFields = [
    record.message,
    record.error,
    record.details,
    record.reason,
    record.stderr,
    record.stdout,
  ];

  for (const field of directFields) {
    const value = asNonEmptyErrorString(field);
    if (value) {
      return value;
    }
  }

  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const entries = record.errors
      .map((entry) => extractOpenCodeErrorMessage(entry, ""))
      .filter((entry) => entry.length > 0);
    if (entries.length > 0) {
      return entries.join("; ");
    }
  }

  try {
    return JSON.stringify(record);
  } catch {
    return fallback;
  }
}

export function isContextOverflowError(error: Error | string): boolean {
  const message = typeof error === "string" ? error : error.message;
  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedMessage) {
    return false;
  }

  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => normalizedMessage.includes(pattern));
}
