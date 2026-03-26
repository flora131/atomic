import { describe, expect, test } from "bun:test";
import {
  createStateTracker,
  inferStageOutputs,
  inferStageReads,
  inferAskUserOutputs,
  inferAskUserReads,
  inferToolReads,
  inferToolOutputs,
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
  test("returns single key from outputMapper", () => {
    const outputMapper = (answer: string | string[]) => ({ userChoice: answer });
    expect(inferAskUserOutputs(outputMapper)).toEqual(["userChoice"]);
  });

  test("returns multiple keys from outputMapper", () => {
    const outputMapper = (answer: string | string[]) => ({
      approved: true,
      reason: answer,
    });
    expect(inferAskUserOutputs(outputMapper)).toEqual(["approved", "reason"]);
  });

  test("returns empty array when outputMapper is undefined", () => {
    expect(inferAskUserOutputs(undefined)).toEqual([]);
  });

  test("returns empty array when outputMapper throws", () => {
    const outputMapper = (_answer: string | string[]): Record<string, unknown> => {
      throw new Error("handler crashed");
    };
    expect(inferAskUserOutputs(outputMapper)).toEqual([]);
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

  test("captures direct ctx.state.field accesses", () => {
    const execute = async (ctx: ExecutionContext<BaseState>) => {
      const findings = (ctx.state as any).findings;
      return { count: findings, total: (ctx.state as any).totalTokens };
    };
    const reads = inferToolReads(execute);
    expect(reads).toContain("findings");
    expect(reads).toContain("totalTokens");
  });

  test("captures destructured state accesses", () => {
    const execute = async (ctx: ExecutionContext<BaseState>) => {
      const { plan, feedback } = ctx.state as any;
      return { result: `${plan}-${feedback}` };
    };
    const reads = inferToolReads(execute);
    expect(reads).toContain("plan");
    expect(reads).toContain("feedback");
  });

  test("does not execute the function body (no side effects)", () => {
    let sideEffectTriggered = false;
    const execute = async (ctx: ExecutionContext<BaseState>) => {
      sideEffectTriggered = true;
      const value = (ctx.state as any).someField;
      return { result: value };
    };
    inferToolReads(execute);
    expect(sideEffectTriggered).toBe(false);
  });

  test("returns empty array when execute has no state accesses", () => {
    const execute = async () => {
      return { result: "static" };
    };
    expect(inferToolReads(execute)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5b. inferToolOutputs
// ---------------------------------------------------------------------------

describe("inferToolOutputs", () => {
  test("returns keys from outputMapper", () => {
    const outputMapper = (_result: Record<string, unknown>) => ({ formatted: "data", count: 1 });
    expect(inferToolOutputs(outputMapper)).toEqual(["formatted", "count"]);
  });

  test("returns empty array when outputMapper is undefined", () => {
    expect(inferToolOutputs(undefined)).toEqual([]);
  });

  test("returns empty array when outputMapper throws", () => {
    const outputMapper = (_result: Record<string, unknown>): Record<string, unknown> => {
      throw new Error("mapper crashed");
    };
    expect(inferToolOutputs(outputMapper)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. inferStageMetadata (unified)
// ---------------------------------------------------------------------------

describe("inferStageMetadata", () => {
  test("always infers reads from prompt function", () => {
    const config = {
      name: "test-stage",
      agent: "test-agent",
      description: "A test stage",
      prompt: (ctx: StageContext) => {
        const s = ctx.state as unknown as Record<string, unknown>;
        return `${s.plan}`;
      },
      outputMapper: (_response: string) => ({ result: _response }),
    };
    const meta = inferStageMetadata(config);
    expect(meta.reads).toContain("plan");
    expect(meta.outputs).toEqual(["result"]);
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
  test("always infers reads from question function", () => {
    const config = {
      name: "ask-review",
      question: (state: BaseState) => {
        const s = state as unknown as Record<string, unknown>;
        return { question: `Review: ${s.plan}` };
      },
      outputMapper: (answer: string | string[]) => ({ approved: answer }),
    };
    const meta = inferAskUserMetadata(config);
    expect(meta.reads).toContain("plan");
    expect(meta.outputs).toEqual(["approved"]);
  });

  test("infers reads and outputs when not explicitly provided", () => {
    const config = {
      name: "ask-review",
      question: (state: BaseState) => {
        const s = state as unknown as Record<string, unknown>;
        return { question: `Review: ${s.plan}` };
      },
      outputMapper: (answer: string | string[]) => ({
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
  test("infers reads from execute and outputs from outputMapper", () => {
    const config = {
      name: "transform-tool",
      execute: async (ctx: ExecutionContext<BaseState>) => {
        const s = ctx.state as unknown as Record<string, unknown>;
        return { result: s.data };
      },
      outputMapper: (result: Record<string, unknown>) => result,
    };
    const meta = inferToolMetadata(config);
    expect(meta.reads).toContain("data");
    // outputMapper({}) returns {}, so no outputs inferred
    expect(meta.outputs).toEqual([]);
  });

  test("infers reads when not provided, outputs defaults to empty when no outputMapper", () => {
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

  test("infers outputs from outputMapper keys", () => {
    const config = {
      name: "transform-tool",
      execute: async () => ({ raw: "data" }),
      outputMapper: (_result: Record<string, unknown>) => ({ formatted: "data", count: 1 }),
    };
    const meta = inferToolMetadata(config);
    expect(meta.outputs).toEqual(["formatted", "count"]);
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
