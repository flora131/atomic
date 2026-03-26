import type { BaseState, ExecutionContext } from "@/services/workflows/graph/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type {
  StageOptions,
  ToolOptions,
  AskUserQuestionOptions,
} from "@/services/workflows/dsl/types.ts";

const BASE_STATE_FIELDS = new Set(["executionId", "lastUpdated", "outputs"]);

interface StateTracker {
  readonly proxy: BaseState;
  readonly accessed: Set<string>;
}

export function createStateTracker(): StateTracker {
  const accessed = new Set<string>();
  const proxy = new Proxy({} as BaseState, {
    get(_target, prop, _receiver) {
      if (typeof prop === "string") {
        accessed.add(prop);
      }
      return "";
    },
    has(_target, prop) {
      if (typeof prop === "string") {
        accessed.add(prop);
      }
      return true;
    },
  });
  return { proxy, accessed };
}

function filterUserFields(accessed: Set<string>): string[] {
  return [...accessed].filter((f) => !BASE_STATE_FIELDS.has(f));
}

export function inferStageOutputs(outputMapper: StageOptions["outputMapper"]): string[] {
  try {
    const result = outputMapper("");
    return Object.keys(result);
  } catch { return []; }
}

export function inferStageReads(prompt: StageOptions["prompt"]): string[] {
  const tracker = createStateTracker();
  const ctx: StageContext = {
    userPrompt: "",
    stageOutputs: new Map(),
    tasks: [],
    abortSignal: new AbortController().signal,
    state: tracker.proxy,
    contextPressure: undefined,
  };
  try { prompt(ctx); } catch {}
  return filterUserFields(tracker.accessed);
}

export function inferAskUserOutputs(onAnswer: AskUserQuestionOptions["onAnswer"]): string[] {
  if (!onAnswer) return [];
  try {
    const result = onAnswer("");
    return Object.keys(result);
  } catch { return []; }
}

export function inferAskUserReads(question: AskUserQuestionOptions["question"]): string[] {
  if (typeof question !== "function") return [];
  const tracker = createStateTracker();
  try { question(tracker.proxy); } catch {}
  return filterUserFields(tracker.accessed);
}

export function inferToolReads(execute: ToolOptions["execute"]): string[] {
  const tracker = createStateTracker();
  const ctx: ExecutionContext<BaseState> = {
    state: tracker.proxy,
    config: {},
    errors: [],
  };
  try {
    const promise = execute(ctx);
    promise.catch(() => {});
  } catch {}
  return filterUserFields(tracker.accessed);
}

export interface InferredMetadata { reads: string[]; outputs: string[]; }

export function inferStageMetadata(config: StageOptions): InferredMetadata {
  return {
    reads: config.reads ?? inferStageReads(config.prompt),
    outputs: config.outputs ?? inferStageOutputs(config.outputMapper),
  };
}

export function inferAskUserMetadata(config: AskUserQuestionOptions): InferredMetadata {
  return {
    reads: config.reads ?? inferAskUserReads(config.question),
    outputs: config.outputs ?? inferAskUserOutputs(config.onAnswer),
  };
}

export function inferToolMetadata(config: ToolOptions): InferredMetadata {
  return {
    reads: config.reads ?? inferToolReads(config.execute),
    outputs: config.outputs ?? [],
  };
}
