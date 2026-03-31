// .atomic/workflows/edge-max-output-bytes.ts
//
// Edge case: Stage with maxOutputBytes truncation.
// A verbose stage is capped, and a downstream stage reads the truncated
// output. Tests: output truncation, originalByteLength tracking,
// downstream stage receiving limited output.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-max-output-bytes",
    description:
      "Stage with maxOutputBytes=200 followed by a downstream stage " +
      "reading the truncated output. Tests output size limiting.",
    globalState: {
      verbose: { default: "" },
      wasTruncated: { default: false },
      digest: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "generate-verbose",
    agent: null,
    description: "📝 Generate verbose output",
    prompt: (ctx) =>
      `Write a very detailed, paragraph-long analysis of: "${ctx.userPrompt}". ` +
      `Include many specific details and examples. Aim for at least 500 words.`,
    outputMapper: (response) => ({ verbose: response }),
    maxOutputBytes: 200,
  })

  .tool({
    name: "check-truncation",
    description: "Check if output was truncated",
    execute: async (ctx) => {
      const stageOut = ctx.getNodeOutput?.("generate-verbose") as Record<string, unknown> | undefined;
      return {
        wasTruncated: stageOut?.originalByteLength !== undefined,
      };
    },
  })

  .stage({
    name: "digest",
    agent: null,
    description: "📋 Digest the (possibly truncated) output",
    prompt: (ctx) => {
      const raw = ctx.stageOutputs.get("generate-verbose")?.rawResponse ?? "";
      const original = ctx.stageOutputs.get("generate-verbose")?.originalByteLength;
      const wasTruncated = original !== undefined;
      return `Summarize this in one sentence (truncated=${wasTruncated}, ` +
        `visible=${raw.length} chars):\n"${raw}"`;
    },
    outputMapper: (response) => ({ digest: response }),
  })

  .compile();
