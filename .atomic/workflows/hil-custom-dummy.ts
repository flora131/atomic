import { defineWorkflow, Type } from "@bastani/workflows";
import type { TableChoice } from "./lib/table-selector.js";
import { tableSelectorFactory } from "./lib/table-selector.js";

/**
 * Dummy workflow for manually testing advanced `ctx.ui.custom` widget prompts
 * (issue #1339: interactive + headless runs reaching ctx.ui.custom).
 *
 * The custom widget is a fully interactive, theme-aware TABLE SELECTOR
 * (see ./lib/table-selector.ts — kept out of this file because workflow
 * discovery validates every runtime export as a workflow definition):
 *   - box-drawing borders, themed header, per-status cell colors
 *   - full-row selection highlight (selectedBg) with a ❯ pointer
 *   - ↑/↓ or j/k to move, 1-6 to jump, g/G or Home/End for first/last
 *   - `s` cycles the sort column (indicator ▲ in the header)
 *   - responsive layout: SIZE/AGE columns drop out on narrow viewports
 *   - Enter resumes the workflow with the selected row via done(value)
 *
 * Interactive repro / verification:
 *   /workflow hil-custom-dummy
 *   → warmup stage completes, then the table mounts as an awaiting-input
 *     node; open the graph (/workflow connect or F2), focus the node,
 *     press Enter, and drive the table.
 *
 * Headless repro / verification of the graceful failure path:
 *   atomic -p '/workflow hil-custom-dummy skip_warmup=true'
 *   → must NOT die with a raw TypeError; expect the clear
 *     "interactive ctx.ui.custom is unavailable in headless..." error
 *     (or awaiting_input brokering for detached interactive-host runs).
 */
export default defineWorkflow("hil-custom-dummy")
  .description(
    "Dummy workflow for manually testing advanced ctx.ui.custom HIL widget prompts: an optional warmup stage completes first, then a themed interactive table selector (sortable, responsive, full-row highlight) must be answered interactively (issue #1339 repro).",
  )
  .input(
    "skip_warmup",
    Type.Boolean({
      default: false,
      description:
        "Skip the LLM warmup stage and jump straight to the ctx.ui.custom prompt. Defaults to false so the repro shows earlier stages completing before the interactive call.",
    }),
  )
  .output("choice", Type.String())
  .output("rowId", Type.String())
  .output("warmupRan", Type.Boolean())
  .output("answeredAfterMs", Type.Number())
  .run(async (ctx) => {
    const skipWarmup = ctx.inputs.skip_warmup === true;

    if (!skipWarmup) {
      // Mirrors the issue report: earlier stages complete, then the run
      // reaches the interactive ctx.ui.custom call.
      await ctx.stage("warmup", { noTools: "all" }).prompt(
        [
          "This is a tiny warmup stage for the hil-custom-dummy workflow.",
          "Reply exactly: READY",
          "Do not ask questions. Do not call tools.",
        ].join("\n"),
      );
    }

    const startedAt = Date.now();

    const picked: TableChoice = await ctx.ui.custom<TableChoice>(tableSelectorFactory, {
      label: "Pick a build artifact (table selector)",
      replayIdentity: "hil-custom-dummy/table-v1",
    });

    return {
      choice: picked.name,
      rowId: picked.id,
      warmupRan: !skipWarmup,
      answeredAfterMs: Date.now() - startedAt,
    };
  })
  .compile();
