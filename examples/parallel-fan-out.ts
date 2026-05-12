/**
 * Parallel fan-out example — three specialist stages + aggregator.
 *
 * Demonstrates Promise.all-based parallelism: the GraphFrontierTracker
 * infers that the three specialist stages run in parallel because they are
 * declared inside Promise.all. The aggregator stage waits for all three.
 *
 * Run: node --experimental-strip-types examples/parallel-fan-out.ts
 */
import { defineWorkflow, createRegistry } from "../src/index.js";
import type { WorkflowDefinition } from "../src/shared/types.js";
import { lastAssistantText } from "../workflows/helpers.js";

const workflow = defineWorkflow("parallel-research")
  .description("Scout → three parallel specialist stages → aggregator.")
  .input("topic", {
    type: "text",
    required: true,
    description: "Research topic to investigate across three specialist angles.",
  })
  .input("max_partitions", {
    type: "number",
    default: 3,
    description: "Number of specialist stages (default 3).",
  })
  .run(async (ctx) => {
    const { topic } = ctx.inputs as { topic: string; max_partitions: number };

    // Stages inside Promise.all are inferred as parallel by GraphFrontierTracker.
    const [authReport, dbReport, apiReport] = await Promise.all([
      (async () => {
        const stage = await ctx.stage("auth-specialist");
        await stage.prompt(`Research authentication patterns for: ${topic}`);
        return lastAssistantText(stage.messages);
      })(),
      (async () => {
        const stage = await ctx.stage("db-specialist");
        await stage.prompt(`Research database layer for: ${topic}`);
        return lastAssistantText(stage.messages);
      })(),
      (async () => {
        const stage = await ctx.stage("api-specialist");
        await stage.prompt(`Research API surface for: ${topic}`);
        return lastAssistantText(stage.messages);
      })(),
    ]);

    // Aggregator stage waits for all three (fan-in).
    const aggregator = await ctx.stage("aggregator");
    await aggregator.prompt(
      `Synthesize these three specialist reports into a unified document:\n\n` +
      `## Auth\n${authReport}\n\n## Database\n${dbReport}\n\n## API\n${apiReport}`
    );
    const summary = lastAssistantText(aggregator.messages);

    return { summary };
  })
  .compile();

// Register in a registry and inspect.
const registry = createRegistry().register(workflow as WorkflowDefinition<Record<string, unknown>>);

console.log("Registered workflows:", registry.names());
console.log("");
console.log("Workflow:    ", workflow.name);
console.log("Description: ", workflow.description);
console.log("Inputs:      ", JSON.stringify(workflow.inputs, null, 2));
console.log("");
console.log("Place this file in .omp/workflows/ or register it programmatically.");
console.log("Start it from oh-my-pi chat: /workflow parallel-research topic=\"auth migration\"");
