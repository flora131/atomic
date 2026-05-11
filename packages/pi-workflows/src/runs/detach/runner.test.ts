/**
 * runner.test.ts
 *
 * Verifies:
 *   - runDetached returns immediately without awaiting the background promise.
 *   - statusRuns lists detached run while delayed stage is active (RFC §5).
 *   - killRun aborts delayed stage and records killed terminal state (RFC §6).
 *   - Detached promise rejection does not produce unhandled rejection; store
 *     records failed status (RFC §7).
 */

import { test, expect, describe } from "bun:test";
import { runDetached } from "./runner.js";
import { statusRuns, killRun } from "./status.js";
import { createStore } from "../../store.js";
import { createCancellationRegistry } from "./cancellation-registry.js";
import { createJobTracker } from "./job-tracker.js";
import { defineWorkflow } from "../../workflows/define-workflow.js";
import type { WorkflowDefinition } from "../../shared/types.js";
import type { PromptAdapter } from "../sync/stage-runner.js";

// ---------------------------------------------------------------------------
// Deferred adapter — a prompt adapter that holds until explicitly released
// ---------------------------------------------------------------------------

interface DeferredAdapter {
  adapter: PromptAdapter;
  release(value?: string): void;
  rejectWith(err: Error): void;
}

function makeDeferredAdapter(): DeferredAdapter {
  let resolveFn!: (value: string) => void;
  let rejectFn!: (reason: unknown) => void;
  const holdPromise = new Promise<string>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  // Prevent unhandled rejection on the hold promise itself when rejected
  holdPromise.catch(() => {});
  return {
    adapter: {
      prompt: (_text: string) => holdPromise,
    },
    release: (value = "released") => resolveFn(value),
    rejectWith: (err: Error) => rejectFn(err),
  };
}

function makeDelayedWorkflow(name: string): WorkflowDefinition {
  return defineWorkflow(name)
    .run(async (ctx) => {
      await ctx.stage("delayed-stage").prompt("waiting for input");
      return { done: true };
    })
    .compile() as WorkflowDefinition;
}

function makeThrowingWorkflow(name: string): WorkflowDefinition {
  return defineWorkflow(name)
    .run(async (_ctx) => {
      throw new Error(`${name} internal error`);
    })
    .compile() as WorkflowDefinition;
}

// ---------------------------------------------------------------------------
// RFC §4 (runner-level) — runDetached returns before background settles
// ---------------------------------------------------------------------------

describe("runDetached — returns immediately", () => {
  test("accepted result returned synchronously before background completes", async () => {
    const deferred = makeDeferredAdapter();
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeDelayedWorkflow("immediate-return-wf");

    let backgroundSettled = false;
    const accepted = runDetached(def, {}, {
      store,
      cancellation,
      jobs,
      adapters: {
        prompt: {
          prompt: async (text) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            backgroundSettled = true;
            return text;
          },
        },
      },
    });

    // runDetached must have returned before background settled
    expect(backgroundSettled).toBe(false);
    expect(accepted.action).toBe("run");
    expect(accepted.status).toBe("running");
    expect(accepted.detached).toBe(true);
    expect(accepted.runId).toBeTruthy();

    // Cleanup — let background finish
    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
  });

  test("accepted result message contains workflow name", () => {
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = defineWorkflow("named-wf-result")
      .run(async () => ({}))
      .compile() as WorkflowDefinition;

    const accepted = runDetached(def, {}, { store, cancellation, jobs });
    expect(accepted.message).toContain("named-wf-result");
    expect(accepted.stages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RFC §5 — statusRuns lists detached run while delayed stage active
// ---------------------------------------------------------------------------

describe("statusRuns — lists detached run during active stage", () => {
  test("in-flight run appears in statusRuns while stage is blocked on prompt", async () => {
    const deferred = makeDeferredAdapter();
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeDelayedWorkflow("status-listed-wf");

    const accepted = runDetached(def, {}, {
      store,
      cancellation,
      jobs,
      adapters: { prompt: deferred.adapter },
    });

    // While stage is blocked, statusRuns should list this run
    const runs = statusRuns({ store });
    const found = runs.find((r) => r.runId === accepted.runId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("status-listed-wf");
    expect(found?.status).toBe("running");

    // Cleanup — release the stage
    deferred.release();
    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
  });

  test("completed run no longer listed in statusRuns (default: in-flight only)", async () => {
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = defineWorkflow("completes-quickly-wf")
      .run(async () => ({ done: true }))
      .compile() as WorkflowDefinition;

    const accepted = runDetached(def, {}, { store, cancellation, jobs });
    const job = jobs.get(accepted.runId);
    // Wait for background to finish
    if (job) await job.promise;

    // Small yield to allow store update propagation
    await new Promise((resolve) => setTimeout(resolve, 5));

    const runs = statusRuns({ store });
    expect(runs.find((r) => r.runId === accepted.runId)).toBeUndefined();
  });

  test("statusRuns all:true includes completed run", async () => {
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = defineWorkflow("completes-all-flag-wf")
      .run(async () => ({}))
      .compile() as WorkflowDefinition;

    const accepted = runDetached(def, {}, { store, cancellation, jobs });
    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const runsAll = statusRuns({ all: true, store });
    expect(runsAll.find((r) => r.runId === accepted.runId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// RFC §6 — killRun aborts delayed stage, records killed terminal state
// ---------------------------------------------------------------------------

describe("killRun — aborts delayed stage and records killed state", () => {
  test("kill during active stage: store records killed status", async () => {
    const deferred = makeDeferredAdapter();
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeDelayedWorkflow("kill-during-stage-wf");

    const accepted = runDetached(def, {}, {
      store,
      cancellation,
      jobs,
      adapters: { prompt: deferred.adapter },
    });

    // Run is active — kill it
    const killResult = killRun(accepted.runId, { store, cancellation });
    expect(killResult.ok).toBe(true);
    if (killResult.ok) {
      expect(killResult.previousStatus).toBe("running");
    }

    // Wait for background promise to settle after abort
    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Store must reflect killed terminal state
    const run = store.runs().find((r) => r.id === accepted.runId);
    expect(run?.status).toBe("killed");
    expect(run?.endedAt).toBeDefined();
  });

  test("kill signals abort to the cancellation controller", async () => {
    const deferred = makeDeferredAdapter();
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeDelayedWorkflow("kill-aborts-controller-wf");

    const accepted = runDetached(def, {}, {
      store,
      cancellation,
      jobs,
      adapters: { prompt: deferred.adapter },
    });

    // Before kill: not aborted
    expect(cancellation.isAborted(accepted.runId)).toBe(false);

    killRun(accepted.runId, { store, cancellation });

    // After kill: aborted
    expect(cancellation.isAborted(accepted.runId)).toBe(true);

    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
  });

  test("kill result: ok:false not_found for unknown runId", () => {
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const result = killRun("no-such-run", { store, cancellation });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
    }
  });

  test("kill after already killed: ok:false already_ended", async () => {
    const deferred = makeDeferredAdapter();
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeDelayedWorkflow("double-kill-wf");

    const accepted = runDetached(def, {}, {
      store,
      cancellation,
      jobs,
      adapters: { prompt: deferred.adapter },
    });

    killRun(accepted.runId, { store, cancellation });

    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Second kill attempt
    const secondKill = killRun(accepted.runId, { store, cancellation });
    expect(secondKill.ok).toBe(false);
    if (!secondKill.ok) {
      expect(secondKill.reason).toBe("already_ended");
    }
  });
});

// ---------------------------------------------------------------------------
// RFC §7 — detached rejection swallowed; store records failed status
// ---------------------------------------------------------------------------

describe("runDetached — rejection swallowed, failed status recorded", () => {
  test("throwing workflow: background promise resolves (no unhandled rejection)", async () => {
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeThrowingWorkflow("throwing-wf");

    const accepted = runDetached(def, {}, { store, cancellation, jobs });

    // Track any unhandled rejection
    let unhandledRejection: unknown = undefined;
    const handler = (reason: unknown) => { unhandledRejection = reason; };
    process.on("unhandledRejection", handler);

    // Wait for background to settle — voidPromise must fulfill (swallows rejection)
    const job = jobs.get(accepted.runId);
    expect(job).toBeDefined();
    // The void promise should resolve (not reject) because runner swallows errors
    await expect(job!.promise).resolves.toBeUndefined();

    // Give event loop a tick for any unhandled rejection to surface
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", handler);

    expect(unhandledRejection).toBeUndefined();
  });

  test("throwing workflow: store records failed status after background settles", async () => {
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeThrowingWorkflow("throwing-status-wf");

    const accepted = runDetached(def, {}, { store, cancellation, jobs });

    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const run = store.runs().find((r) => r.id === accepted.runId);
    expect(run?.status).toBe("failed");
    expect(run?.endedAt).toBeDefined();
  });

  test("job unregistered from tracker after rejection settles", async () => {
    const store = createStore();
    const cancellation = createCancellationRegistry();
    const jobs = createJobTracker();
    const def = makeThrowingWorkflow("throwing-unregister-wf");

    const accepted = runDetached(def, {}, { store, cancellation, jobs });
    expect(jobs.has(accepted.runId)).toBe(true);

    const job = jobs.get(accepted.runId);
    if (job) await job.promise;
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(jobs.has(accepted.runId)).toBe(false);
  });
});
