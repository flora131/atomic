import { defineWorkflow } from "@bastani/workflows";

const INVALID_MODES = ["date", "function", "nan", "infinity", "undefined-property", "undefined-array"] as const;

export default defineWorkflow("contract-invalid")
  .description("Manual negative validation workflow: intentionally returns non-JSON-serializable values and should fail before completion.")
  .input("mode", {
    type: "select",
    choices: INVALID_MODES,
    default: "date",
    description: "Which invalid return value to produce. Every mode should fail runtime output validation.",
  })
  .output("result", {
    required: true,
    description: "Declared as any JSON-serializable value, but this workflow intentionally violates that contract.",
  })
  .run(async (ctx) => {
    const mode = ctx.inputs.mode;

    await ctx.stage("contract-marker", { noTools: "all" }).prompt(
      [
        `This is a manual negative workflow contract test for mode: ${mode}.`,
        "Reply exactly: CONTRACT_INVALID_STAGE_OK",
        "Do not ask questions. Do not call tools.",
      ].join("\n"),
    );

    switch (mode) {
      case "date":
        return {
          result: new Date() as never,
        };
      case "function":
        return {
          result: (() => "not serializable") as never,
        };
      case "nan":
        return {
          result: Number.NaN,
        };
      case "infinity":
        return {
          result: Number.POSITIVE_INFINITY,
        };
      case "undefined-property":
        return {
          result: "contains an undefined nested property",
          details: {
            present: true,
            missing: undefined as never,
          },
        };
      case "undefined-array":
        return {
          result: ["first", undefined as never, "third"],
        };
    }
  })
  .compile();
