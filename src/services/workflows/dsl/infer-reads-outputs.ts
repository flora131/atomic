import type { BaseState } from "@/services/workflows/graph/types.ts";
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

export function inferAskUserOutputs(outputMapper: AskUserQuestionOptions["outputMapper"]): string[] {
  if (!outputMapper) return [];
  try {
    const result = outputMapper("");
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
  // Use static source-code analysis instead of executing the function.
  // The previous approach called execute(ctx) with a Proxy-wrapped state to
  // record property accesses, but that ran the entire function body — causing
  // side effects (console.log, network calls, etc.) during compilation.
  try {
    const source = execute.toString();
    const accessed = new Set<string>();

    // 1. Direct property access: .state.fieldName or .state?.fieldName
    const dotAccessPattern = /\.state\??\.(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = dotAccessPattern.exec(source)) !== null) {
      if (match[1]) accessed.add(match[1]);
    }

    // 2. Aliased access: const/let/var X = ....state (with optional type casts)
    //    then X.fieldName
    const aliasPattern = /(?:const|let|var)\s+(\w+)\s*=\s*\w+\.state\b/g;
    const aliases: string[] = [];
    while ((match = aliasPattern.exec(source)) !== null) {
      if (match[1]) aliases.push(match[1]);
    }
    for (const alias of aliases) {
      const aliasAccessPattern = new RegExp(`\\b${alias}\\.(\\w+)`, "g");
      while ((match = aliasAccessPattern.exec(source)) !== null) {
        if (match[1]) accessed.add(match[1]);
      }
    }

    // 3. Destructured access: const/let/var { f1, f2 } = ....state
    const destructurePattern = /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*\w+\.state/g;
    while ((match = destructurePattern.exec(source)) !== null) {
      if (match[1]) {
        const fields = match[1]
          .split(",")
          .map((f) => f.trim().split(/\s*[:=]\s*/)[0]?.trim())
          .filter(Boolean);
        for (const field of fields) {
          if (field) accessed.add(field);
        }
      }
    }

    return filterUserFields(accessed);
  } catch {
    return [];
  }
}

export function inferToolOutputs(outputMapper: ToolOptions["outputMapper"]): string[] {
  if (!outputMapper) return [];
  try {
    const result = outputMapper({});
    return Object.keys(result);
  } catch { return []; }
}

export interface InferredMetadata { reads: string[]; outputs: string[]; }

export function inferStageMetadata(config: StageOptions): InferredMetadata {
  return {
    reads: inferStageReads(config.prompt),
    outputs: inferStageOutputs(config.outputMapper),
  };
}

export function inferAskUserMetadata(config: AskUserQuestionOptions): InferredMetadata {
  return {
    reads: inferAskUserReads(config.question),
    outputs: inferAskUserOutputs(config.outputMapper),
  };
}

export function inferToolMetadata(config: ToolOptions): InferredMetadata {
  return {
    reads: inferToolReads(config.execute),
    outputs: inferToolOutputs(config.outputMapper),
  };
}
