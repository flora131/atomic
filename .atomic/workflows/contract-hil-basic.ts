import { defineWorkflow } from "@bastani/workflows";

export default defineWorkflow("contract-hil-basic")
  .description("Manual no-import HIL smoke test: one normal stage plus input/confirm/select/editor prompts and serializable outputs.")
  .input("seed", {
    type: "text",
    default: "basic-hil",
    description: "Seed text echoed through HIL prompts and output.",
  })
  .output("result", { type: "text", required: true })
  .output("hil", { type: "object", required: true })
  .output("events", { type: "array", required: true })
  .run(async (ctx) => {
    const seed = ctx.inputs.seed;
    await ctx.stage("basic-marker", { noTools: "all" }).prompt(
      [
        `Basic HIL workflow marker for seed: ${seed}`,
        "Reply exactly: CONTRACT_HIL_BASIC_STAGE_OK",
        "Do not ask questions. Do not call tools.",
      ].join("\n"),
    );

    const name = await ctx.ui.input(`Basic HIL input. Type a short label for ${seed}.`);
    const confirmed = await ctx.ui.confirm(`Basic HIL confirm. Continue with label "${name}"?`);
    const choice = await ctx.ui.select("Basic HIL select. Pick a serializable branch.", [
      "alpha",
      "beta",
      "gamma",
    ] as const);
    const edited = await ctx.ui.editor(JSON.stringify({ seed, name, confirmed, choice }, null, 2));

    return {
      result: `basic HIL completed for ${seed}: ${choice}`,
      hil: {
        seed,
        name,
        confirmed,
        choice,
        editedLength: edited.length,
        editedPreview: edited.slice(0, 80),
      },
      events: [
        { kind: "stage", name: "basic-marker" },
        { kind: "input", valueLength: name.length },
        { kind: "confirm", value: confirmed },
        { kind: "select", value: choice },
        { kind: "editor", valueLength: edited.length },
      ],
    };
  })
  .compile();
