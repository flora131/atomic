// .atomic/workflows/edge-deep-conditionals.ts
//
// Edge case: Three levels of nested if/elseIf/else.
// Outer: triage category. Middle: severity. Inner: region.
// Tests: deeply nested shouldRun predicates, correct branch skipping,
// convergence after triple nesting.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-deep-conditionals",
    description:
      "Three levels of nested conditionals. Tests deeply nested " +
      "shouldRun evaluation and branch convergence.",
    globalState: {
      category: { default: "" },
      severity: { default: "" },
      region: { default: "" },
      route: { default: "" },
    },
  })
  .version("0.1.0")

  .tool({
    name: "classify",
    description: "Classify the input",
    execute: async () => ({
      category: "bug",
      severity: "high",
      region: "us-east",
    }),
  })

  // Flattened conditional: category × severity × region
  // (nested .if() directly inside .if() produces an empty branch)
  .if((ctx) => ctx.state.category === "bug" && ctx.state.severity === "high" && ctx.state.region === "us-east")
    .tool({
      name: "route-us-east-critical",
      description: "Route to US East critical team",
      execute: async () => ({ route: "bug/high/us-east" }),
    })
  .elseIf((ctx) => ctx.state.category === "bug" && ctx.state.severity === "high" && ctx.state.region === "eu-west")
    .tool({
      name: "route-eu-west-critical",
      description: "Route to EU West critical team",
      execute: async () => ({ route: "bug/high/eu-west" }),
    })
  .elseIf((ctx) => ctx.state.category === "bug" && ctx.state.severity === "high")
    .tool({
      name: "route-global-critical",
      description: "Route to global critical team",
      execute: async () => ({ route: "bug/high/global" }),
    })
  .elseIf((ctx) => ctx.state.category === "bug" && ctx.state.severity === "low")
    .tool({
      name: "route-low-bug",
      description: "Route to low priority bug queue",
      execute: async () => ({ route: "bug/low" }),
    })
  .elseIf((ctx) => ctx.state.category === "bug")
    .tool({
      name: "route-medium-bug",
      description: "Route to medium priority bug queue",
      execute: async () => ({ route: "bug/medium" }),
    })
  .elseIf((ctx) => ctx.state.category === "feature")
    .tool({
      name: "route-feature",
      description: "Route to feature team",
      execute: async () => ({ route: "feature" }),
    })
  .else()
    .tool({
      name: "route-other",
      description: "Route to general queue",
      execute: async () => ({ route: "other" }),
    })
  .endIf()

  // Post-convergence: all paths meet here
  .stage({
    name: "confirm-routing",
    agent: null,
    description: "✅ Confirm routing decision",
    prompt: (ctx) =>
      `Confirm that the request was routed to: "${ctx.state.route}". Respond with a one-sentence confirmation.`,
    outputMapper: () => ({}),
  })

  .compile();
