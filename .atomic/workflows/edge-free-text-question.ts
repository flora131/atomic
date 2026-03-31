// .atomic/workflows/edge-free-text-question.ts
//
// Edge case: askUserQuestion with no predefined options — free-text input.
// Tests: omitting `options` in question config, free-form text capture,
// downstream stage consuming free-text answer.

import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-free-text-question",
    description:
      "askUserQuestion with no options — free-text only. " +
      "Tests free-form input and downstream consumption.",
    globalState: {
      topic: { default: "" },
      feedback: { default: "" },
      summary: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "intro",
    agent: null,
    description: "📝 Introduction",
    prompt: (ctx) => `Briefly introduce the topic: "${ctx.userPrompt}"`,
    outputMapper: (response) => ({ topic: response }),
  })

  // Free-text question — no options array
  .askUserQuestion({
    name: "get-feedback",
    description: "Collect free-form feedback",
    question: {
      question: "What specific feedback or instructions do you have?",
      header: "Free-Text Input",
    },
    outputMapper: (answer: string | string[]) => ({
      feedback: answer === USER_DECLINED_ANSWER ? "" : String(answer),
    }),
  })

  .stage({
    name: "incorporate-feedback",
    agent: null,
    description: "✨ Incorporate feedback",
    prompt: (ctx) => {
      const topic = ctx.state.topic;
      const feedback = ctx.state.feedback;
      return `Topic: ${topic}\nUser feedback: "${feedback}"\nIncorporate the feedback and produce a final summary.`;
    },
    outputMapper: (response) => ({ summary: response }),
  })

  .compile();
