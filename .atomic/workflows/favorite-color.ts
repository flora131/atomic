// .atomic/workflows/favorite-color.ts
//
// Minimal two-node workflow to test stage → askUserQuestion data flow.

import { defineWorkflow } from "@bastani/atomic-workflows";
import type { StageOutput } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "favorite-color",
  description:
    "A minimal workflow with one stage and one ask-user-question node to verify data flows between them.",
  globalState: {
    greeting: { default: "" },
    userAnswer: { default: "" },
    reflection: { default: "" },
  },
})
  .version("0.1.0")

  .stage({
    name: "generate-greeting",
    agent: null,
    description: "Generate a greeting message",
    prompt: (ctx) =>
      `You are a friendly assistant. The user said: "${ctx.userPrompt}".
Respond with a short greeting and ask them what their favorite color is.
Keep it to 1-2 sentences.`,
    outputMapper: (response) => ({ greeting: response }),
  })

  .askUserQuestion({
    name: "favorite-color",
    description: "Ask the user their favorite color",
    question: (state) => ({
      question: state.greeting || "What is your favorite color?",
      header: "Quick Question",
      options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }],
    }),
    outputMapper: (answer: string | string[]) => ({
      userAnswer: String(answer),
    }),
  })

  .stage({
    name: "reflect-on-answer",
    agent: null,
    description: "Reflect on the user's color choice",
    prompt: (ctx) => {
      const answer = (ctx.stageOutputs.get("favorite-color")?.parsedOutput as Record<string, unknown>)?.userAnswer ?? "unknown";
      return `The user chose "${answer}" as their favorite color.
Write a fun 1-2 sentence reflection on what that color choice might say about them.`;
    },
    outputMapper: (response) => ({ reflection: response }),
  })

  .compile();
