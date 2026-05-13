/**
 * Builtin workflow: deep-research-codebase
 *
 * Shape: Scout → per-partition specialist sub-agents → aggregator.
 * Each specialist stage is run in parallel (Promise.all).
 *
 * Inputs:
 *   prompt        — required text: the research question / investigation focus.
 *   max_partitions — optional number (default 4): max parallel specialist stages.
 *
 * cross-ref spec §5.11; v0.x packages/atomic/src/commands/builtin-[star]/deep-research-codebase/
 */

import { defineWorkflow } from "../src/index.js";

export default defineWorkflow("deep-research-codebase")
  .description("Scout → per-partition specialists → aggregator (parallel fan-out)")
  .input("prompt", {
    type: "text",
    required: true,
    description: "Research question or investigation focus for the codebase.",
  })
  .input("max_partitions", {
    type: "number",
    default: 4,
    description: "Maximum number of parallel specialist stages (partition cap).",
  })
  .run(async (ctx) => {
    const { prompt, max_partitions } = ctx.inputs as {
      prompt: string;
      max_partitions: number;
    };
    const cap = typeof max_partitions === "number" && max_partitions > 0 ? max_partitions : 4;

    // Stage 1 — Scout: survey the codebase to understand scope.
    const scout = ctx.stage("scout");
    const scoutResult = await scout.prompt(
      `You are a codebase scout. Survey the repository structure and identify key areas relevant to the following research question. Return a newline-separated list of distinct investigation partitions (max ${cap}).\n\nResearch question: ${prompt}`,
    );

    // Stage 2 — Partition: distil the scout output into a clean partition list.
    const partition = ctx.stage("partition");
    const partitionResult = await partition.prompt(
      `Given the scout findings below, extract a clean list of investigation partitions — one per line, no bullet characters, no numbering. Emit at most ${cap} partitions.\n\nScout findings:\n${scoutResult}`,
    );

    const partitions = partitionResult
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, cap);

    // Stage 3 — Parallel specialists: one sub-session per partition.
    const specialistResults = await Promise.all(
      partitions.map(async (partitionName, i) => {
        const specialist = ctx.stage(`specialist-${i + 1}`);
        return specialist.prompt(
          `You are a specialist agent. Investigate the following codebase partition in depth and report your findings.\n\nPartition: ${partitionName}\n\nBroader research question: ${prompt}\n\nScout context:\n${scoutResult}`,
        );
      }),
    );

    // Stage 4 — Aggregator: synthesise all specialist reports.
    const aggregator = ctx.stage("aggregator");
    const aggregate = await aggregator.prompt(
      `You are a research aggregator. Synthesise the specialist reports below into a single coherent research summary that directly answers the original question.\n\nOriginal question: ${prompt}\n\nSpecialist reports:\n${specialistResults.map((r, i) => `--- Partition ${i + 1}: ${partitions[i]} ---\n${r}`).join("\n\n")}`,
    );

    return {
      findings: aggregate,
      partitions,
      specialist_count: specialistResults.length,
    };
  })
  .compile();
