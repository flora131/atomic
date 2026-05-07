/**
 * Pane-navigation demo workflow (Copilot).
 *
 * Mirrors `../claude/index.ts`: three trivial sequential stages so the
 * tmux session has four navigable windows (orchestrator + 3 stages) for
 * the driver CLI in `../cli.ts` to walk with the navigation primitives.
 */

import { defineWorkflow } from "@bastani/atomic-sdk/workflows";

export default defineWorkflow({
  name: "pane-navigation",
  description: "Three-stage workflow used to demo pane navigation primitives",
})
  .for("copilot")
  .run(async (ctx) => {
    await ctx.stage(
      { name: "alpha", description: "Window 1 — say A" },
      {},
      {},
      async (s) => {
        await s.session.send({ prompt: "Reply with a single line: 'alpha'." });
        s.save(await s.session.getMessages());
      },
    );

    await ctx.stage(
      { name: "bravo", description: "Window 2 — say B" },
      {},
      {},
      async (s) => {
        await s.session.send({ prompt: "Reply with a single line: 'bravo'." });
        s.save(await s.session.getMessages());
      },
    );

    await ctx.stage(
      { name: "charlie", description: "Window 3 — say C" },
      {},
      {},
      async (s) => {
        await s.session.send({ prompt: "Reply with a single line: 'charlie'." });
        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
