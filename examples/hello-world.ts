/**
 * Hello-world example — simplest possible workflow.
 *
 * Demonstrates defineWorkflow builder, input declaration, and compile().
 * Does NOT require a pi binary — inspects the compiled definition only.
 *
 * Run: bun examples/hello-world.ts
 */
import { defineWorkflow } from "../src/index.js";

const workflow = defineWorkflow("hello-world")
  .description("Greet the user with a single stage.")
  .input("name", {
    type: "text",
    default: "world",
    description: "Name to greet.",
  })
  .run(async (ctx) => {
    // Stage bodies run inside an pi sub-session at execution time.
    // This stub satisfies the type; replace with real ctx.stage() calls when
    // wired to an pi runtime via the executor.
    const greet = ctx.stage("greet");
    const greeting = await greet.prompt(
      `Say hello to ${String(ctx.inputs.name)} in a warm, one-sentence greeting.`
    );
    return { greeting };
  })
  .compile();

// --- Inspect the compiled definition (no pi binary required) ---
console.log("name:           ", workflow.name);
console.log("normalizedName: ", workflow.normalizedName);
console.log("description:    ", workflow.description);
console.log("inputs:         ", JSON.stringify(workflow.inputs, null, 2));
console.log("");
console.log("Workflow compiled successfully. Register it with createRegistry() or");
console.log("place this file in .pi/workflows/ to auto-discover it in pi.");
