/**
 * Test workflow missing .compile() — should be filtered from list.
 *
 * This is a valid workflow definition but the user hasn't added .compile()
 * indicating they don't want to publish it yet.
 */
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "no-compile",
  description: "This workflow is missing compile() and should NOT appear in the list",
})
  .run(async (ctx) => {
    await ctx.stage(
      { name: "wip", description: "Work in progress stage" },
      {},
      {},
      async (s) => {
        await s.session.query(s.userPrompt);
        s.save(s.sessionId);
      },
    );
  });
// Note: no .compile() call — intentionally omitted
