/**
 * Pane-navigation demo workflow (Claude).
 *
 * The point of this workflow is *not* the prompts — it's the tmux layout
 * it produces. Three sequential stages plus the orchestrator window give
 * you four navigable windows on the atomic socket, which is exactly what
 * the driver CLI in `../cli.ts` exercises against the navigation
 * primitives (`nextWindow`, `previousWindow`, `gotoOrchestrator`).
 *
 * Each stage runs a single trivial query so the workflow finishes
 * quickly; the windows persist in tmux while the driver navigates.
 */

import { defineWorkflow } from "@bastani/atomic-sdk/workflows";

export default defineWorkflow({
  name: "pane-navigation",
  description: "Three-stage workflow used to demo pane navigation primitives",
})
  .for("claude")
  .run(async (ctx) => {
    await ctx.stage(
      { name: "alpha", description: "Window 1 — say A" },
      {},
      {},
      async (s) => {
        await s.session.query("Reply with a single line: 'alpha'.");
        s.save(s.sessionId);
      },
    );

    await ctx.stage(
      { name: "bravo", description: "Window 2 — say B" },
      {},
      {},
      async (s) => {
        await s.session.query("Reply with a single line: 'bravo'.");
        s.save(s.sessionId);
      },
    );

    await ctx.stage(
      { name: "charlie", description: "Window 3 — say C" },
      {},
      {},
      async (s) => {
        await s.session.query("Reply with a single line: 'charlie'.");
        s.save(s.sessionId);
      },
    );
  })
  .compile();
