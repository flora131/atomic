/**
 * Unit tests for createStageContext — metadata propagation through stage adapters.
 *
 * Verifies:
 *  - prompt adapter receives { runId, stageId, stageName, signal } as meta
 *  - complete adapter receives meta and preserves CompleteStageOpts (model, maxTokens)
 *  - subagent adapter receives meta
 *  - AbortSignal threaded end-to-end through meta
 *
 * cross-ref: packages/pi-workflows/src/runs/foreground/stage-runner.ts
 *            packages/pi-workflows/src/shared/types.ts StageExecutionMeta
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createStageContext } from "../../src/runs/foreground/stage-runner.js";
import type {
  StageRunnerOpts,
  PromptAdapter,
  CompleteAdapter,
  SubagentAdapter,
} from "../../src/runs/foreground/stage-runner.js";
import type { StageExecutionMeta, CompleteStageOpts, SubagentStageOpts } from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

function makeOpts(overrides: Partial<StageRunnerOpts> = {}): StageRunnerOpts {
  return {
    stageId: "stage-abc",
    stageName: "My Stage",
    runId: "run-xyz",
    adapters: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// prompt — metadata propagation
// ---------------------------------------------------------------------------

describe("createStageContext — prompt metadata propagation", () => {
  test("prompt adapter receives runId from opts", async () => {
    const received: StageExecutionMeta[] = [];
    const promptAdapter: PromptAdapter = {
      async prompt(_text, meta) {
        received.push(meta!);
        return "ok";
      },
    };
    const ctx = createStageContext(makeOpts({ adapters: { prompt: promptAdapter }, runId: "run-001" }));
    await ctx.prompt("hello");
    assert.equal(received[0]?.runId, "run-001");
  });

  test("prompt adapter receives stageId from opts", async () => {
    const received: StageExecutionMeta[] = [];
    const promptAdapter: PromptAdapter = {
      async prompt(_text, meta) { received.push(meta!); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { prompt: promptAdapter }, stageId: "s-99" }));
    await ctx.prompt("hi");
    assert.equal(received[0]?.stageId, "s-99");
  });

  test("prompt adapter receives stageName from opts", async () => {
    const received: StageExecutionMeta[] = [];
    const promptAdapter: PromptAdapter = {
      async prompt(_text, meta) { received.push(meta!); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { prompt: promptAdapter }, stageName: "Analysis" }));
    await ctx.prompt("analyze");
    assert.equal(received[0]?.stageName, "Analysis");
  });

  test("prompt adapter receives signal from opts", async () => {
    const received: StageExecutionMeta[] = [];
    const signal = makeSignal();
    const promptAdapter: PromptAdapter = {
      async prompt(_text, meta) { received.push(meta!); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { prompt: promptAdapter }, signal }));
    await ctx.prompt("go");
    assert.equal(received[0]?.signal, signal);
  });

  test("prompt adapter receives full meta object in one call", async () => {
    const received: StageExecutionMeta[] = [];
    const signal = makeSignal();
    const promptAdapter: PromptAdapter = {
      async prompt(_text, meta) { received.push(meta!); return "done"; },
    };
    const ctx = createStageContext({
      stageId: "s-42",
      stageName: "Summarise",
      runId: "r-100",
      signal,
      adapters: { prompt: promptAdapter },
    });
    await ctx.prompt("summarise this");
    assert.deepEqual(received[0], { runId: "r-100", stageId: "s-42", stageName: "Summarise", signal });
  });

  test("prompt adapter receives the text passed to ctx.prompt", async () => {
    const texts: string[] = [];
    const promptAdapter: PromptAdapter = {
      async prompt(text) { texts.push(text); return "ack"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { prompt: promptAdapter } }));
    await ctx.prompt("specific text payload");
    assert.deepEqual(texts, ["specific text payload"]);
  });

  test("signal is undefined in meta when opts.signal absent", async () => {
    const received: StageExecutionMeta[] = [];
    const promptAdapter: PromptAdapter = {
      async prompt(_text, meta) { received.push(meta!); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { prompt: promptAdapter } }));
    await ctx.prompt("go");
    assert.equal(received[0]?.signal, undefined);
  });
});

// ---------------------------------------------------------------------------
// complete — metadata propagation + CompleteStageOpts preservation
// ---------------------------------------------------------------------------

describe("createStageContext — complete metadata propagation", () => {
  test("complete adapter receives full meta", async () => {
    const received: StageExecutionMeta[] = [];
    const signal = makeSignal();
    const completeAdapter: CompleteAdapter = {
      async complete(_text, _opts, meta) { received.push(meta!); return "done"; },
    };
    const ctx = createStageContext({
      stageId: "s-7",
      stageName: "Draft",
      runId: "r-55",
      signal,
      adapters: { complete: completeAdapter },
    });
    await ctx.complete("write a draft");
    assert.deepEqual(received[0], { runId: "r-55", stageId: "s-7", stageName: "Draft", signal });
  });

  test("complete adapter receives CompleteStageOpts.model", async () => {
    const receivedOpts: Array<CompleteStageOpts | undefined> = [];
    const completeAdapter: CompleteAdapter = {
      async complete(_text, opts) { receivedOpts.push(opts); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { complete: completeAdapter } }));
    await ctx.complete("write", { model: "gpt-4o" });
    assert.equal(receivedOpts[0]?.model, "gpt-4o");
  });

  test("complete adapter receives CompleteStageOpts.maxTokens", async () => {
    const receivedOpts: Array<CompleteStageOpts | undefined> = [];
    const completeAdapter: CompleteAdapter = {
      async complete(_text, opts) { receivedOpts.push(opts); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { complete: completeAdapter } }));
    await ctx.complete("write", { maxTokens: 512 });
    assert.equal(receivedOpts[0]?.maxTokens, 512);
  });

  test("complete adapter receives both model and maxTokens intact", async () => {
    const receivedOpts: Array<CompleteStageOpts | undefined> = [];
    const completeAdapter: CompleteAdapter = {
      async complete(_text, opts) { receivedOpts.push(opts); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { complete: completeAdapter } }));
    await ctx.complete("write", { model: "claude-opus-4", maxTokens: 1024 });
    assert.deepEqual(receivedOpts[0], { model: "claude-opus-4", maxTokens: 1024 });
  });

  test("complete adapter receives undefined opts when none passed", async () => {
    const receivedOpts: Array<CompleteStageOpts | undefined> = [];
    const completeAdapter: CompleteAdapter = {
      async complete(_text, opts) { receivedOpts.push(opts); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { complete: completeAdapter } }));
    await ctx.complete("write");
    assert.equal(receivedOpts[0], undefined);
  });

  test("complete adapter receives text passed to ctx.complete", async () => {
    const texts: string[] = [];
    const completeAdapter: CompleteAdapter = {
      async complete(text) { texts.push(text); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { complete: completeAdapter } }));
    await ctx.complete("the input text");
    assert.deepEqual(texts, ["the input text"]);
  });

  test("complete meta signal is undefined when opts.signal absent", async () => {
    const received: Array<StageExecutionMeta | undefined> = [];
    const completeAdapter: CompleteAdapter = {
      async complete(_text, _opts, meta) { received.push(meta); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { complete: completeAdapter } }));
    await ctx.complete("hi");
    assert.equal(received[0]?.signal, undefined);
  });
});

// ---------------------------------------------------------------------------
// subagent — metadata propagation
// ---------------------------------------------------------------------------

describe("createStageContext — subagent metadata propagation", () => {
  test("subagent adapter receives full meta", async () => {
    const received: StageExecutionMeta[] = [];
    const signal = makeSignal();
    const subagentAdapter: SubagentAdapter = {
      async subagent(_opts, meta) { received.push(meta!); return "done"; },
    };
    const ctx = createStageContext({
      stageId: "s-sub",
      stageName: "SubStage",
      runId: "r-sub",
      signal,
      adapters: { subagent: subagentAdapter },
    });
    await ctx.subagent({ agent: "coder", task: "fix bug" });
    assert.deepEqual(received[0], { runId: "r-sub", stageId: "s-sub", stageName: "SubStage", signal });
  });

  test("subagent adapter receives SubagentStageOpts intact", async () => {
    const receivedOpts: SubagentStageOpts[] = [];
    const subagentAdapter: SubagentAdapter = {
      async subagent(opts) { receivedOpts.push(opts); return "ok"; },
    };
    const ctx = createStageContext(makeOpts({ adapters: { subagent: subagentAdapter } }));
    await ctx.subagent({ agent: "reviewer", task: "review PR", context: "some context" });
    assert.deepEqual(receivedOpts[0], { agent: "reviewer", task: "review PR", context: "some context" });
  });

  test("throws when subagent adapter absent", async () => {
    const ctx = createStageContext(makeOpts({ adapters: {} }));
    await assert.rejects(ctx.subagent({ agent: "x", task: "y" }), { message: "pi-workflows: subagent requires pi-subagents", });
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("createStageContext — error paths", () => {
  test("complete throws when adapter absent", async () => {
    const ctx = createStageContext(makeOpts({ adapters: {} }));
    await assert.rejects(ctx.complete("text"), { message: "pi-workflows: complete adapter not configured", });
  });

  test("stage name exposed on ctx.name", () => {
    const ctx = createStageContext(makeOpts({ stageName: "Ingest" }));
    assert.equal(ctx.name, "Ingest");
  });
});
