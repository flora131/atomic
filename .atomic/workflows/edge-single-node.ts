// .atomic/workflows/edge-single-node.ts
//
// Edge case: Absolute minimum viable workflow — a single stage + compile.
// Tests: workflow with no globalState, no version(), no argumentHint(),
// just one stage and compile(). Verifies the minimal DSL surface.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-single-node",
    description: "Minimal single-stage workflow — the smallest valid graph.",
  })
  .stage({
    name: "only-stage",
    agent: null,
    description: "🎯 Only stage",
    prompt: (ctx) => `Echo this back verbatim: "${ctx.userPrompt}"`,
    outputMapper: (response) => ({ echo: response }),
  })
  .compile();
