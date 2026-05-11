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

export interface SubagentAdapter {
  subagent(opts: SubagentStageOpts): Promise<string>;
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
}

export function createStageContext(opts: StageRunnerOpts): StageContext {
  const { stageName, adapters } = opts;

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
        return adapters.subagent.subagent(subagentOpts);
      }
      throw new Error(
        "pi-workflows: subagent requires pi-subagents — install npm:pi-subagents",
      );
    },
  };
}
