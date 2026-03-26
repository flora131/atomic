/**
 * Test Workflow: Ask User Question Nodes
 *
 * Exercises: .askUserQuestion() with static questions, dynamic questions,
 *            multi-select, free-text, and onAnswer mapping
 * Validates: AskUserQuestionOptions, AskUserQuestionConfig, state-dependent factories
 */
import type { BaseState } from "@bastani/atomic-workflows";
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-ask-user",
    description: "Tests all askUserQuestion variants: static, dynamic, multi-select, free-text",
    globalState: {
      strategy: { default: "moderate" },
      selectedIssues: { default: () => [] as string[], reducer: "replace" },
      userFeedback: { default: "" },
      userApproved: { default: false },
    },
  })
  .version("1.0.0")
  // Static question with predefined options
  .askUserQuestion({
    name: "pick-strategy",
    description: "Select implementation strategy",
    question: {
      question: "Which implementation strategy should we use?",
      header: "Strategy Selection",
      options: [
        { label: "Conservative", description: "Minimal changes, low risk" },
        { label: "Moderate", description: "Balanced approach" },
        { label: "Aggressive", description: "Full refactor, high reward" },
      ],
    },
    onAnswer: (answer) => ({ strategy: String(answer) }),
    outputs: ["strategy"],
  })
  .stage({
    name: "plan",
    agent: "planner",
    description: "📋 PLAN",
    outputs: ["tasks"],
    prompt: (ctx) => `Plan using ${ctx.state.strategy} strategy:\n${ctx.userPrompt}`,
    outputMapper: (response) => ({ tasks: response }),
  })
  // Dynamic question that reads workflow state
  .askUserQuestion({
    name: "review-plan",
    description: "User reviews the generated plan",
    question: (_state: BaseState) => ({
      question: "The planner generated a plan. Approve it?",
      header: "Plan Review",
      options: [
        { label: "Approve", description: "Proceed with implementation" },
        { label: "Revise", description: "Go back and re-plan" },
      ],
    }),
    onAnswer: (answer) => ({ userApproved: answer === "Approve" }),
    outputs: ["userApproved"],
  })
  // Multi-select question
  .askUserQuestion({
    name: "select-issues",
    description: "Select which issues to address",
    question: {
      question: "Which issues should we prioritize?",
      header: "Issue Selection",
      options: [
        { label: "Performance", description: "Optimize slow code paths" },
        { label: "Security", description: "Fix vulnerabilities" },
        { label: "UX", description: "Improve user experience" },
        { label: "Testing", description: "Increase test coverage" },
      ],
      multiSelect: true,
    },
    onAnswer: (answers) => ({ selectedIssues: answers }),
    outputs: ["selectedIssues"],
  })
  // Free-text input (no options)
  .askUserQuestion({
    name: "additional-feedback",
    description: "Collect free-text feedback",
    question: {
      question: "Any additional instructions for the implementation?",
      header: "User Feedback",
    },
    onAnswer: (answer) => ({ userFeedback: String(answer) }),
    outputs: ["userFeedback"],
  })
  .stage({
    name: "implement",
    description: "⚡ IMPLEMENT",
    prompt: (ctx) => {
      return [
        `Strategy: ${ctx.state.strategy}`,
        `Approved: ${ctx.state.userApproved}`,
        `Issues: ${(ctx.state.selectedIssues as string[]).join(", ")}`,
        `Feedback: ${ctx.state.userFeedback}`,
        `Task: ${ctx.userPrompt}`,
      ].join("\n");
    },
    outputMapper: () => ({}),
  })
  .compile();
