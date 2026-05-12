/**
 * Hello-world example — simplest possible workflow.
 *
 * Demonstrates defineWorkflow builder, input declaration, and compile().
 * Does NOT require a pi binary — inspects the compiled definition only.
 *
 * Run: node --experimental-strip-types examples/hello-world.ts
 */
import { defineWorkflow } from "../src/index.js";
import { lastAssistantText } from "../workflows/helpers.js";

const workflow = defineWorkflow("hello-world")
  .description("Greet the user with a single stage.")
  .input("name", {
    type: "text",
    default: "world",
    description: "Name to greet.",
  })
  .run(async (ctx) => {
    // Stage bodies run inside an oh-my-pi sub-session at execution time.
    // This stub satisfies the type; replace with real ctx.stage() calls when
    // wired to an oh-my-pi runtime via the executor.
    const greet = await ctx.stage("greet");
    await greet.prompt(
      `Say hello to ${String(ctx.inputs.name)} in a warm, one-sentence greeting.`
    );
    const greeting = lastAssistantText(greet.messages);
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
console.log("place this file in .omp/workflows/ to auto-discover it in oh-my-pi.");
