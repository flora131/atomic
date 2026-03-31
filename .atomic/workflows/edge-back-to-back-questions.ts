// .atomic/workflows/edge-back-to-back-questions.ts
//
// Edge case: Three askUserQuestion nodes in a row with no agent stages
// between them. Each question's outputMapper feeds into the next question's
// dynamic question text. Tests: consecutive HITL nodes, stageOutputs
// chaining between askUserQuestion nodes, state threading.

import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-back-to-back-questions",
    description:
      "Three consecutive askUserQuestion nodes. Each uses the previous " +
      "answer in its question text. No agent stages between them.",
    globalState: {
      name: { default: "" },
      role: { default: "" },
      team: { default: "" },
      summary: { default: "" },
    },
  })
  .version("0.1.0")

  .askUserQuestion({
    name: "ask-name",
    description: "Ask user their name",
    question: {
      question: "What is your name?",
      header: "Introduction",
    },
    outputMapper: (answer: string | string[]) => ({
      name: answer === USER_DECLINED_ANSWER ? "Anonymous" : String(answer),
    }),
  })

  .askUserQuestion({
    name: "ask-role",
    description: "Ask user their role",
    question: (state) => ({
      question: `Hi ${state.name || "there"}! What is your role?`,
      header: "Role",
      options: [
        { label: "Engineer" },
        { label: "Designer" },
        { label: "Manager" },
        { label: "Other" },
      ],
    }),
    outputMapper: (answer: string | string[]) => ({
      role: answer === USER_DECLINED_ANSWER ? "Unknown" : String(answer),
    }),
  })

  .askUserQuestion({
    name: "ask-team",
    description: "Ask user their team",
    question: (state) => ({
      question: `Got it, ${state.name} the ${state.role}. Which team are you on?`,
      header: "Team",
      options: [
        { label: "Frontend" },
        { label: "Backend" },
        { label: "Platform" },
        { label: "Security" },
      ],
    }),
    outputMapper: (answer: string | string[]) => ({
      team: answer === USER_DECLINED_ANSWER ? "Unassigned" : String(answer),
    }),
  })

  .stage({
    name: "greet",
    agent: null,
    description: "👋 Generate personalized greeting",
    prompt: (ctx) => {
      const nameOut = (ctx.stageOutputs.get("ask-name")?.parsedOutput as Record<string, unknown>)?.name ?? "unknown";
      const roleOut = (ctx.stageOutputs.get("ask-role")?.parsedOutput as Record<string, unknown>)?.role ?? "unknown";
      const teamOut = (ctx.stageOutputs.get("ask-team")?.parsedOutput as Record<string, unknown>)?.team ?? "unknown";
      return `Generate a one-sentence welcome for ${nameOut}, a ${roleOut} on the ${teamOut} team.`;
    },
    outputMapper: (response) => ({ summary: response }),
  })

  .compile();
