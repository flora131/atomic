import { defineWorkflow } from "@bastani/workflows";

const FLAVORS = ["vanilla", "chocolate", "strawberry"] as const;

export default defineWorkflow("contract-valid")
  .description("Manual validation workflow: returns declared JSON-serializable outputs for input/output contract testing.")
  .input("message", {
    type: "text",
    required: true,
    description: "Message to echo into serializable outputs.",
  })
  .input("count", {
    type: "number",
    default: 2,
    description: "Number of serializable checklist items to generate.",
  })
  .input("enabled", {
    type: "boolean",
    default: true,
    description: "Boolean value echoed into output metadata.",
  })
  .input("flavor", {
    type: "select",
    choices: FLAVORS,
    default: "vanilla",
    description: "Select input used to verify select typing and validation.",
  })
  .output("result", {
    type: "text",
    required: true,
    description: "Human-readable summary.",
  })
  .output("echo", {
    type: "object",
    required: true,
    description: "Serializable object echoing typed inputs.",
  })
  .output("items", {
    type: "array",
    required: true,
    description: "Serializable array generated from the count input.",
  })
  .output("count", {
    type: "number",
    required: true,
    description: "Finite numeric output.",
  })
  .output("enabled", {
    type: "boolean",
    required: true,
    description: "Boolean output.",
  })
  .output("flavor", {
    type: "string",
    required: true,
    description: "Selected flavor output.",
  })
  .run(async (ctx) => {
    const message = ctx.inputs.message;
    const count = Math.max(0, Math.min(10, Math.floor(ctx.inputs.count)));
    const enabled = ctx.inputs.enabled;
    const flavor = ctx.inputs.flavor;

    const items = Array.from({ length: count }, (_, index) => ({
      index: index + 1,
      label: `${flavor}-${index + 1}`,
      message,
      enabled,
    }));

    await ctx.stage("contract-marker", { noTools: "all" }).prompt(
      [
        "This is a manual workflow contract smoke test.",
        "Reply exactly: CONTRACT_VALID_STAGE_OK",
        "Do not ask questions. Do not call tools.",
      ].join("\n"),
    );

    return {
      result: `contract-valid echoed ${count} item${count === 1 ? "" : "s"} for ${flavor}`,
      echo: {
        message,
        count,
        enabled,
        flavor,
        nested: {
          ok: true,
          tags: ["json", "serializable", "declared-outputs"],
        },
      },
      items,
      count,
      enabled,
      flavor,
    };
  })
  .compile();
