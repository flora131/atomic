import { describe, expect, test } from "bun:test";
import {
  createStateTracker,
  inferStageOutputs,
  inferStageReads,
  inferAskUserOutputs,
  inferAskUserReads,
  inferToolReads,
  inferStageMetadata,
  inferAskUserMetadata,
  inferToolMetadata,
} from "@/services/workflows/dsl/infer-reads-outputs.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type { BaseState, ExecutionContext } from "@/services/workflows/graph/types.ts";

// ---------------------------------------------------------------------------
// 1. inferStageOutputs
// ---------------------------------------------------------------------------

describe("inferStageOutputs", () => {
  test("returns single key from outputMapper", () => {
    const mapper = (_response: string) => ({ summary: _response });
    expect(inferStageOutputs(mapper)).toEqual(["summary"]);
  });

  test("returns multiple keys from outputMapper", () => {
    const mapper = (_response: string) => ({
      plan: _response,
      tasks: [],
      metadata: {},
    });
    expect(inferStageOutputs(mapper)).toEqual(["plan", "tasks", "metadata"]);
  });

  test("returns empty array when outputMapper throws", () => {
    const mapper = (_response: string): Record<string, unknown> => {
      throw new Error("boom");
    };
    expect(inferStageOutputs(mapper)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. inferStageReads
// ---------------------------------------------------------------------------

describe("inferStageReads", () => {
  test("captures single state field access", () => {
    const prompt = (ctx: StageContext) => `Value: ${ctx.state.executionId}, Plan: ${(ctx.state as unknown as Record<string, unknown>).plan}`;
    const reads = inferStageReads(prompt);
    expect(reads).toContain("plan");
  });

  test("captures multiple state field accesses", () => {
    const prompt = (ctx: StageContext) => {
      const s = ctx.state as unknown as Record<string, unknown>;
      return `${s.plan} ${s.feedback} ${s.code}`;
    };
    const reads = inferStageReads(prompt);
    expect(reads).toContain("plan");
    expect(reads).toContain("feedback");
    expect(reads).toContain("code");
  });

  test("returns empty array when prompt does not access state", () => {
    const prompt = (ctx: StageContext) => `Hello ${ctx.userPrompt}`;
    expect(inferStageReads(prompt)).toEqual([]);
  });

  test("filters out BaseState fields (executionId, lastUpdated, outputs)", () => {
    const prompt = (ctx: StageContext) => {
      const _ = ctx.state.executionId;
      const __ = ctx.state.lastUpdated;
      const ___ = ctx.state.outputs;
      return `${_}${__}${___}`;
    };
    expect(inferStageReads(prompt)).toEqual([]);
  });

  test("captures accesses before a throw", () => {
    const prompt = (ctx: StageContext) => {
      const s = ctx.state as unknown as Record<string, unknown>;
      const _ = s.plan;
      const __ = s.feedback;
      throw new Error("prompt builder crashed");
      return `${_}${__}`;
    };
    const reads = inferStageReads(prompt);
    expect(reads).toContain("plan");
    expect(reads).toContain("feedback");
  });

  test("captures conditional state access", () => {
    const prompt = (ctx: StageContext) => {
      const s = ctx.state as unknown as Record<string, unknown>;
      return s.feedback ? `Feedback: ${s.feedback}` : "No feedback";
    };
    const reads = inferStageReads(prompt);
    expect(reads).toContain("feedback");
  });
});

// ---------------------------------------------------------------------------
// 3. inferAskUserOutputs
// ---------------------------------------------------------------------------

describe("inferAskUserOutputs", () => {
  test("returns single key from onAnswer", () => {
    const onAnswer = (answer: string | string[]) => ({ userChoice: answer });
    expect(inferAskUserOutputs(onAnswer)).toEqual(["userChoice"]);
  });

  test("returns multiple keys from onAnswer", () => {
    const onAnswer = (answer: string | string[]) => ({
      approved: true,
      reason: answer,
    });
    expect(inferAskUserOutputs(onAnswer)).toEqual(["approved", "reason"]);
  });

  test("returns empty array when onAnswer is undefined", () => {
    expect(inferAskUserOutputs(undefined)).toEqual([]);
  });

  test("returns empty array when onAnswer throws", () => {
    const onAnswer = (_answer: string | string[]): Record<string, unknown> => {
      throw new Error("handler crashed");
    };
    expect(inferAskUserOutputs(onAnswer)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. inferAskUserReads
// ---------------------------------------------------------------------------

describe("inferAskUserReads", () => {
  test("returns empty array for static question config", () => {
    const question = { question: "Do you approve?" };
    expect(inferAskUserReads(question)).toEqual([]);
  });

  test("captures state accesses from dynamic question function", () => {
    const question = (state: BaseState) => {
      const s = state as unknown as Record<string, unknown>;
      return { question: `Review the plan: ${s.plan}` };
    };
    expect(inferAskUserReads(question)).toContain("plan");
  });

  test("captures multiple state accesses from dynamic question function", () => {
    const question = (state: BaseState) => {
      const s = state as unknown as Record<string, unknown>;
      return {
        question: `Plan: ${s.plan}, Code: ${s.code}`,
        header: `Status: ${s.status}`,
      };
    };
    const reads = inferAskUserReads(question);
    expect(reads).toContain("plan");
    expect(reads).toContain("code");
    expect(reads).toContain("status");
  });
});

// ---------------------------------------------------------------------------
// 5. inferToolReads
// ---------------------------------------------------------------------------

describe("inferToolReads", () => {
  test("captures synchronous state accesses", () => {
    const execute = async (ctx: ExecutionContext<BaseState>) => {
      const s = ctx.state as unknown as Record<string, unknown>;
      const plan = s.plan;
      return { processed: plan };
    };
    const reads = inferToolReads(execute);
    expect(reads).toContain("plan");
  });

  test("captures state accesses via cast pattern", () => {
    const execute = async (ctx: ExecutionContext<BaseState>) => {
      const state = ctx.state as unknown as Record<string, unknown>;
      const code = state.sourceCode;
      const lang = state.language;
      return { result: `${code}-${lang}` };
    };
    const reads = inferToolReads(execute);
    expect(reads).toContain("sourceCode");
    expect(reads).toContain("language");
  });
});

// ---------------------------------------------------------------------------
// 6. inferStageMetadata (unified)
// ---------------------------------------------------------------------------

describe("inferStageMetadata", () => {
  test("explicit reads/outputs take precedence over inference", () => {
    const config = {
      name: "test-stage",
      agent: "test-agent",
      description: "A test stage",
      prompt: (ctx: StageContext) => {
        const s = ctx.state as unknown as Record<string, unknown>;
        return `${s.plan}`;
      },
      outputMapper: (_response: string) => ({ result: _response }),
      reads: ["explicitField"],
      outputs: ["explicitOutput"],
    };
    const meta = inferStageMetadata(config);
    expect(meta.reads).toEqual(["explicitField"]);
    expect(meta.outputs).toEqual(["explicitOutput"]);
  });

  test("infers reads and outputs when not explicitly provided", () => {
    const config = {
      name: "test-stage",
      agent: "test-agent",
      description: "A test stage",
      prompt: (ctx: StageContext) => {
        const s = ctx.state as unknown as Record<string, unknown>;
        return `${s.plan} ${s.feedback}`;
      },
      outputMapper: (_response: string) => ({
        summary: _response,
        score: 0,
      }),
    };
    const meta = inferStageMetadata(config);
    expect(meta.reads).toContain("plan");
    expect(meta.reads).toContain("feedback");
    expect(meta.outputs).toEqual(["summary", "score"]);
  });
});

// ---------------------------------------------------------------------------
// 7. inferAskUserMetadata (unified)
// ---------------------------------------------------------------------------

describe("inferAskUserMetadata", () => {
  test("explicit reads/outputs take precedence over inference", () => {
    const config = {
      name: "ask-review",
      question: (state: BaseState) => {
        const s = state as unknown as Record<string, unknown>;
        return { question: `Review: ${s.plan}` };
      },
      onAnswer: (answer: string | string[]) => ({ approved: answer }),
      reads: ["manualRead"],
      outputs: ["manualOutput"],
    };
    const meta = inferAskUserMetadata(config);
    expect(meta.reads).toEqual(["manualRead"]);
    expect(meta.outputs).toEqual(["manualOutput"]);
  });

  test("infers reads and outputs when not explicitly provided", () => {
    const config = {
      name: "ask-review",
      question: (state: BaseState) => {
        const s = state as unknown as Record<string, unknown>;
        return { question: `Review: ${s.plan}` };
      },
      onAnswer: (answer: string | string[]) => ({
        approved: true,
        comment: answer,
      }),
    };
    const meta = inferAskUserMetadata(config);
    expect(meta.reads).toContain("plan");
    expect(meta.outputs).toEqual(["approved", "comment"]);
  });
});

// ---------------------------------------------------------------------------
// 8. inferToolMetadata (unified)
// ---------------------------------------------------------------------------

describe("inferToolMetadata", () => {
  test("explicit reads/outputs take precedence over inference", () => {
    const config = {
      name: "transform-tool",
      execute: async (ctx: ExecutionContext<BaseState>) => {
        const s = ctx.state as unknown as Record<string, unknown>;
        return { result: s.data };
      },
      reads: ["manualRead"],
      outputs: ["manualOutput"],
    };
    const meta = inferToolMetadata(config);
    expect(meta.reads).toEqual(["manualRead"]);
    expect(meta.outputs).toEqual(["manualOutput"]);
  });

  test("infers reads when not provided, outputs defaults to empty array", () => {
    const config = {
      name: "transform-tool",
      execute: async (ctx: ExecutionContext<BaseState>) => {
        const s = ctx.state as unknown as Record<string, unknown>;
        return { result: s.sourceCode };
      },
    };
    const meta = inferToolMetadata(config);
    expect(meta.reads).toContain("sourceCode");
    expect(meta.outputs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. createStateTracker
// ---------------------------------------------------------------------------

describe("createStateTracker", () => {
  test("records property access via get", () => {
    const tracker = createStateTracker();
    const _value = (tracker.proxy as unknown as Record<string, unknown>).myField;
    expect(tracker.accessed.has("myField")).toBe(true);
  });

  test("records property access via 'in' operator", () => {
    const tracker = createStateTracker();
    const _exists = "someField" in tracker.proxy;
    expect(tracker.accessed.has("someField")).toBe(true);
    expect(_exists).toBe(true);
  });

  test("returns inert string values for any property access", () => {
    const tracker = createStateTracker();
    const value = (tracker.proxy as unknown as Record<string, unknown>).anything;
    expect(value).toBe("");
    expect(typeof value).toBe("string");
  });
});
