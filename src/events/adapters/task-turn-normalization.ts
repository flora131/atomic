interface NormalizeAgentTaskMetadataInput {
  task: unknown;
  agentType: unknown;
  isBackground: unknown;
  toolInput?: unknown;
}

interface TurnMetadataState {
  activeTurnId: string | null;
  syntheticCounter: number;
}

export type NormalizedTurnFinishReason =
  | "tool-calls"
  | "stop"
  | "max-tokens"
  | "max-turns"
  | "error"
  | "unknown";

export interface NormalizedTurnEndMetadata {
  turnId: string;
  finishReason?: NormalizedTurnFinishReason;
  rawFinishReason?: string;
}

export interface NormalizedAgentTaskMetadata {
  task: string;
  isBackground: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTurnFinishReasonToken(value: string): NormalizedTurnFinishReason {
  const token = value.trim().toLowerCase().replace(/[\s_]+/g, "-");

  switch (token) {
    case "tool-calls":
    case "tool-calls-required":
    case "tool-call":
    case "toolcall":
    case "toolcalls":
    case "tool-use":
    case "tool-use-required":
    case "tool-use-loop":
    case "tool-use-needed":
      return "tool-calls";
    case "stop":
    case "end-turn":
    case "completed":
    case "complete":
    case "success":
      return "stop";
    case "max-tokens":
    case "max-output-tokens":
    case "length":
    case "token-limit":
      return "max-tokens";
    case "max-turns":
    case "error-max-turns":
    case "turn-limit":
      return "max-turns";
    case "error":
    case "failed":
    case "failure":
      return "error";
    default:
      return "unknown";
  }
}

function extractRawTurnFinishReason(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return asString(value);
  }

  return asString(record.finishReason)
    ?? asString(record.finish_reason)
    ?? asString(record.stopReason)
    ?? asString(record.stop_reason)
    ?? asString(record.reason)
    ?? asString(record.subtype);
}

function normalizeBackgroundFromInput(toolInput: unknown): boolean {
  const record = asRecord(toolInput);
  if (!record) {
    return false;
  }

  if (record.run_in_background === true) {
    return true;
  }

  const mode = asString(record.mode);
  return mode?.toLowerCase() === "background";
}

export function normalizeAgentTaskMetadata(
  input: NormalizeAgentTaskMetadataInput,
): NormalizedAgentTaskMetadata {
  const toolInput = asRecord(input.toolInput);
  const taskFromToolInput = asString(toolInput?.description)
    ?? asString(toolInput?.prompt)
    ?? asString(toolInput?.task);
  const taskFromEvent = asString(input.task);
  const agentType = asString(input.agentType);

  const task = taskFromToolInput
    ?? taskFromEvent
    ?? (agentType ?? "task");

  const isBackground = input.isBackground === true || normalizeBackgroundFromInput(toolInput);

  return {
    task,
    isBackground,
  };
}

function nextSyntheticTurnId(state: TurnMetadataState): string {
  state.syntheticCounter += 1;
  return `turn_${Date.now()}_${state.syntheticCounter}`;
}

export function normalizeTurnStartId(
  value: unknown,
  state: TurnMetadataState,
): string {
  const turnId = asString(value);
  if (turnId) {
    state.activeTurnId = turnId;
    return turnId;
  }

  const generated = nextSyntheticTurnId(state);
  state.activeTurnId = generated;
  return generated;
}

export function normalizeTurnEndId(
  value: unknown,
  state: TurnMetadataState,
): string {
  const turnId = asString(value);
  if (turnId) {
    if (state.activeTurnId === turnId) {
      state.activeTurnId = null;
    }
    return turnId;
  }

  if (state.activeTurnId) {
    const activeTurnId = state.activeTurnId;
    state.activeTurnId = null;
    return activeTurnId;
  }

  return nextSyntheticTurnId(state);
}

export function normalizeTurnEndMetadata(
  value: unknown,
  state: TurnMetadataState,
): NormalizedTurnEndMetadata {
  const turnId = normalizeTurnEndId(value, state);
  const rawFinishReason = extractRawTurnFinishReason(value);

  if (!rawFinishReason) {
    return { turnId };
  }

  return {
    turnId,
    finishReason: normalizeTurnFinishReasonToken(rawFinishReason),
    rawFinishReason,
  };
}

export function createTurnMetadataState(): TurnMetadataState {
  return {
    activeTurnId: null,
    syntheticCounter: 0,
  };
}

export function resetTurnMetadataState(state: TurnMetadataState): void {
  state.activeTurnId = null;
  state.syntheticCounter = 0;
}
