/**
 * Pane-navigation demo workflow (OpenCode).
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
  .for("opencode")
  .run(async (ctx) => {
    await ctx.stage(
      { name: "alpha", description: "Window 1 — say A" },
      {},
      {
        title: "alpha",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: "Reply with a single line: 'alpha'." }],
        });
        s.save(result.data!);
      },
    );

    await ctx.stage(
      { name: "bravo", description: "Window 2 — say B" },
      {},
      {
        title: "bravo",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: "Reply with a single line: 'bravo'." }],
        });
        s.save(result.data!);
      },
    );

    await ctx.stage(
      { name: "charlie", description: "Window 3 — say C" },
      {},
      {
        title: "charlie",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: "Reply with a single line: 'charlie'." }],
        });
        s.save(result.data!);
      },
    );
  })
  .compile();
