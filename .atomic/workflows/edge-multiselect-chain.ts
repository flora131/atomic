// .atomic/workflows/edge-multiselect-chain.ts
//
// Edge case: Multi-select askUserQuestion → tool processing the array
// answer → conditional branching on the number of selections.
// Tests: multi-select outputMapper receives string[], tool processes
// array state, conditional branches on array length.

import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-multiselect-chain",
    description:
      "Multi-select question → tool processing array → conditional " +
      "on selection count. Tests multi-select data flow.",
    globalState: {
      selectedFeatures: { default: () => [] as string[] },
      selectionCount: { default: 0 },
      feasibility: { default: "" },
      plan: { default: "" },
    },
  })
  .version("0.1.0")

  .askUserQuestion({
    name: "select-features",
    description: "Select features to implement",
    question: {
      question: "Which features should we implement?",
      header: "Feature Selection",
      options: [
        { label: "Auth", description: "User authentication" },
        { label: "API", description: "REST API endpoints" },
        { label: "Dashboard", description: "Analytics dashboard" },
        { label: "Notifications", description: "Push notifications" },
        { label: "Search", description: "Full-text search" },
      ],
      multiSelect: true,
    },
    outputMapper: (answer: string | string[]) => {
      if (answer === USER_DECLINED_ANSWER) {
        return { selectedFeatures: [] as string[], selectionCount: 0 };
      }
      const features = Array.isArray(answer) ? answer : [answer];
      return {
        selectedFeatures: features,
        selectionCount: features.length,
      };
    },
  })

  .tool({
    name: "analyze-selections",
    description: "Analyze the selected features",
    execute: async (ctx) => {
      const features = ctx.state.selectedFeatures as string[];
      const count = features.length;
      const feasibility = count === 0
        ? "none"
        : count <= 2
          ? "easy"
          : count <= 4
            ? "moderate"
            : "complex";
      return { feasibility, selectionCount: count };
    },
  })

  .if((ctx) => ctx.state.selectionCount === 0)
    .stage({
      name: "no-selection",
      agent: null,
      description: "😐 No features selected",
      prompt: () => "The user selected no features. Write a brief message suggesting they try again.",
      outputMapper: (response) => ({ plan: response }),
    })
  .elseIf((ctx) => ctx.state.feasibility === "easy")
    .stage({
      name: "easy-plan",
      agent: null,
      description: "✅ Easy plan",
      prompt: (ctx) =>
        `Create a quick implementation plan for these features: ${JSON.stringify(ctx.state.selectedFeatures)}`,
      outputMapper: (response) => ({ plan: response }),
    })
  .elseIf((ctx) => ctx.state.feasibility === "moderate")
    .stage({
      name: "moderate-plan",
      agent: null,
      description: "⚠️ Moderate plan",
      prompt: (ctx) =>
        `Create a phased implementation plan for these features: ${JSON.stringify(ctx.state.selectedFeatures)}. Suggest what to prioritize.`,
      outputMapper: (response) => ({ plan: response }),
    })
  .else()
    .stage({
      name: "complex-plan",
      agent: null,
      description: "🔴 Complex plan",
      prompt: (ctx) =>
        `Create a detailed multi-sprint plan for ${ctx.state.selectionCount} features: ${JSON.stringify(ctx.state.selectedFeatures)}. Warn about risks.`,
      outputMapper: (response) => ({ plan: response }),
    })
  .endIf()

  .compile();
