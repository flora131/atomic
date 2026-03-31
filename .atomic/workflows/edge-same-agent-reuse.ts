// .atomic/workflows/edge-same-agent-reuse.ts
//
// Edge case: Same agent definition reused across 3 stages.
// Tests: `name` vs `agent` distinction — same agent powers multiple
// stages, each with its own unique name and distinct prompt/output.
// Verifies: stageOutputs keyed by name (not agent), agent resolution
// deduplication.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-same-agent-reuse",
    description:
      "Three stages all using agent: null. " +
      "Tests name vs agent distinction and output keying.",
    globalState: {
      draft: { default: "" },
      revision: { default: "" },
      polish: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "draft",
    agent: null,
    description: "✏️ Draft",
    prompt: (ctx) => `Write a first draft about: ${ctx.userPrompt}`,
    outputMapper: (response) => ({ draft: response }),
  })

  .stage({
    name: "revise",
    agent: null,
    description: "🔄 Revise",
    prompt: (ctx) => {
      const draft = ctx.stageOutputs.get("draft")?.rawResponse ?? "";
      return `Revise this draft for clarity:\n${draft}`;
    },
    outputMapper: (response) => ({ revision: response }),
  })

  .stage({
    name: "polish",
    agent: null,
    description: "✨ Polish",
    prompt: (ctx) => {
      const revision = ctx.stageOutputs.get("revise")?.rawResponse ?? "";
      return `Polish this text for publication:\n${revision}`;
    },
    outputMapper: (response) => ({ polish: response }),
  })

  .compile();
