/**
 * Parallel fan-out example — three specialist stages + aggregator.
 *
 * Demonstrates Promise.all-based parallelism: the GraphFrontierTracker
 * infers that the three specialist stages run in parallel because they are
 * declared inside Promise.all. The aggregator stage waits for all three.
 *
 * Run: bun examples/parallel-fan-out.ts
 */
import { defineWorkflow, createRegistry } from "@bastani/workflows";
import type { WorkflowDefinition } from "../packages/workflows/src/shared/types.js";

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
        const stage = ctx.stage("auth-specialist");
        return await stage.prompt(`Research authentication patterns for: ${topic}`);
      })(),
      (async () => {
        const stage = ctx.stage("db-specialist");
        return await stage.prompt(`Research database layer for: ${topic}`);
      })(),
      (async () => {
        const stage = ctx.stage("api-specialist");
        return await stage.prompt(`Research API surface for: ${topic}`);
      })(),
    ]);

    // Aggregator stage waits for all three (fan-in).
    const aggregator = ctx.stage("aggregator");
    const summary = await aggregator.prompt(
      `Synthesize these three specialist reports into a unified document:\n\n` +
      `## Auth\n${authReport}\n\n## Database\n${dbReport}\n\n## API\n${apiReport}`
    );

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
console.log("Place this file in .pi/workflows/ or register it programmatically.");
console.log("Start it from pi chat: /workflow parallel-research topic=\"auth migration\"");
