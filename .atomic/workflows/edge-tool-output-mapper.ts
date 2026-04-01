// .atomic/workflows/edge-tool-output-mapper.ts
//
// Edge case: Tool nodes with `outputMapper` transforms.
// The tool's `execute` returns raw data, then `outputMapper` reshapes
// it before merging into state. Tests: tool-level outputMapper,
// chained tools where downstream reads transformed output.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-tool-output-mapper",
    description:
      "Tools with outputMapper transforms. " +
      "Tests that tool outputMapper reshapes execute results before state merge.",
    globalState: {
      rawData: { default: "" },
      transformed: { default: "" },
      final: { default: "" },
    },
  })
  .version("0.1.0")

  .tool({
    name: "produce-raw",
    description: "Produce raw data",
    execute: async () => ({
      rawData: "hello-world",
      extra: "ignored-by-mapper",
    }),
    outputMapper: (result) => ({
      rawData: String(result.rawData).toUpperCase(),
    }),
  })

  .tool({
    name: "transform-data",
    description: "Transform using outputMapper",
    execute: async (ctx) => ({
      value: `processed:${ctx.state.rawData}`,
    }),
    outputMapper: (result) => ({
      transformed: `[${result.value}]`,
    }),
  })

  .tool({
    name: "finalize",
    description: "Final assembly",
    execute: async (ctx) => ({
      final: `raw=${ctx.state.rawData},transformed=${ctx.state.transformed}`,
    }),
  })

  .compile();
