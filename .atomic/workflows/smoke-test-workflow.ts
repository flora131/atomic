import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "smoke-test-workflow",
  description: "Minimal workflow for verifier smoke testing.",
})
  .stage({
    name: "only-stage",
    agent: null,
    description: "Echo the incoming prompt",
    prompt: (ctx) => `Echo this back: ${ctx.userPrompt}`,
    outputMapper: (response) => ({ echoedPrompt: response }),
  })
  .compile();
