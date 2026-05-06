/**
 * Trivial workflow for the sdk-compiled-consumer smoke fixture.
 *
 * Prints "hello from fixture" via a single claude agent step.
 * Kept minimal so smoke tests run fast and the orchestrator pane
 * produces a deterministic success marker.
 */

import { defineWorkflow } from "@bastani/atomic-sdk/workflows";

export const greetWorkflow = defineWorkflow({
  name: "fixture-greet",
  source: import.meta.path,
  description: "Smoke fixture: echo a greeting",
  inputs: [
    {
      name: "who",
      type: "string",
      default: "fixture",
      description: "who to greet",
    },
  ],
})
  .for("claude")
  .run(async (ctx) => {
    await ctx.stage({ name: "greet" }, {}, {}, async (s) => {
      await s.session.query(
        `Reply ONLY with the exact string: hello from fixture (greeting ${ctx.inputs.who})`,
      );
      s.save(s.sessionId);
    });
  })
  .compile();
