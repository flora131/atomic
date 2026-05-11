/**
 * Stage runner — creates a StageContext for a given stage.
 * Handles prompt / complete / subagent adapters.
 */

import type { StageContext, SubagentStageOpts, CompleteStageOpts } from "../../shared/types.js";

export interface PromptAdapter {
  prompt(text: string): Promise<string>;
}

export interface CompleteAdapter {
  complete(text: string, opts?: CompleteStageOpts): Promise<string>;
}

/**
 * Execution metadata threaded from the executor into stage adapter calls.
 * Not exposed to workflow authors — StageContext public API is unchanged.
 */
export interface SubagentStageMeta {
  /** Run ID of the containing workflow execution. */
  runId: string;
  /** Stage ID of the current stage. */
  stageId: string;
  /** Human-readable stage name. */
  stageName: string;
  /** AbortSignal propagated from the executor's own AbortController. */
  signal?: AbortSignal;
}

export interface SubagentAdapter {
  /**
   * Delegate stage to a sub-agent.
   * @param opts   - Public subagent options (agent, task, context).
   * @param meta   - Execution metadata (runId, stageId, stageName, signal)
   *                 injected by the stage-runner; overrides ambient process.env
   *                 fallback in the adapter implementation.
   */
  subagent(opts: SubagentStageOpts, meta?: SubagentStageMeta): Promise<string>;
}

export interface StageAdapters {
  prompt?: PromptAdapter;
  complete?: CompleteAdapter;
  subagent?: SubagentAdapter;
}

export interface StageRunnerOpts {
  stageId: string;
  stageName: string;
  adapters: StageAdapters;
  /** Run ID of the containing workflow execution — forwarded to subagent adapter. */
  runId: string;
  /** AbortSignal from the executor's own AbortController — forwarded to subagent adapter. */
  signal?: AbortSignal;
}

export function createStageContext(opts: StageRunnerOpts): StageContext {
  const { stageId, stageName, adapters, runId, signal } = opts;

  return {
    name: stageName,

    async prompt(text: string): Promise<string> {
      if (adapters.prompt) {
        return adapters.prompt.prompt(text);
      }
      // Deterministic stub in test environments
      if (process.env["NODE_ENV"] === "test") {
        return `[stub:${stageName}:${text.slice(0, 30)}]`;
      }
      throw new Error(
        "pi-workflows: prompt adapter not configured — provide a PromptAdapter via RunOpts.prompt",
      );
    },

    async complete(text: string, completeOpts?: CompleteStageOpts): Promise<string> {
      if (adapters.complete) {
        return adapters.complete.complete(text, completeOpts);
      }
      throw new Error(
        "pi-workflows: complete adapter not configured — provide a CompleteAdapter via RunOpts.complete",
      );
    },

    async subagent(subagentOpts: SubagentStageOpts): Promise<string> {
      if (adapters.subagent) {
        const meta: SubagentStageMeta = { runId, stageId, stageName, signal };
        return adapters.subagent.subagent(subagentOpts, meta);
      }
      throw new Error(
        "pi-workflows: subagent requires pi-subagents — install npm:pi-subagents",
      );
    },
  };
}
