/**
 * Builtin workflow: ralph
 *
 * Shape: Plan → orchestrate → review loop with bounded iteration.
 * Human-in-the-loop (HIL) via ctx.ui.editor() / ctx.ui.confirm() between
 * iterations.  Bounded by a JS for-loop; terminates early when the reviewer
 * approves or the iteration cap is reached.
 *
 * Inputs:
 *   prompt         — required text: the task/goal for ralph to accomplish.
 *   max_iterations — optional number (default 3): hard cap on plan→act→review cycles.
 *
 * cross-ref spec §5.11; v0.x packages/atomic/src/commands/builtin-[star]/ralph/
 */

import { defineWorkflow } from "../src/index.js";
const DEFAULT_MAX_ITERATIONS = 3;

export default defineWorkflow("ralph")
  .description(
    "Plan → orchestrate → review loop with bounded iteration and human-in-the-loop checkpoints.",
  )
  .input("prompt", {
    type: "text",
    required: true,
    description: "The task or goal for ralph to plan, execute, and refine.",
  })
  .input("max_iterations", {
    type: "number",
    default: DEFAULT_MAX_ITERATIONS,
    description: `Hard cap on plan→act→review cycles (default ${DEFAULT_MAX_ITERATIONS}).`,
  })
  .run(async (ctx) => {
    const { prompt, max_iterations } = ctx.inputs as {
      prompt: string;
      max_iterations: number;
    };
    const cap =
      typeof max_iterations === "number" && max_iterations > 0
        ? max_iterations
        : DEFAULT_MAX_ITERATIONS;

    // Stage 0 — Initial plan: produce a structured execution plan.
    const planStage = ctx.stage("plan");
    let plan = await planStage.prompt(
      `You are a planning agent. Produce a numbered, step-by-step execution plan for the following task. Be concrete and actionable.\n\nTask: ${prompt}`,
    );

    let lastResult = "";
    let approved = false;
    let iterationsCompleted = 0;

    for (let iteration = 1; iteration <= cap; iteration++) {
      iterationsCompleted = iteration;
      // HIL: show the current plan and let the user edit before executing.
      const editedPlan = await ctx.ui.editor(
        `# Iteration ${iteration}/${cap} — Review Plan\n\n${plan}\n\n# Edit the plan above if needed, then save to proceed.`,
      );
      plan = editedPlan.trim() || plan;

      // Stage N — Orchestrate: execute the (possibly edited) plan.
      const orchestrator = ctx.stage(`orchestrate-${iteration}`);
      const result = await orchestrator.prompt(
        `You are an orchestrator agent. Execute the following plan step by step. Report your actions and outcomes.\n\nPlan:\n${plan}\n\nTask context: ${prompt}`,
      );
      lastResult = result;

      // Stage N — Review: evaluate the execution result.
      const reviewer = ctx.stage(`review-${iteration}`);
      const review = await reviewer.prompt(
        `Evaluate the orchestrator's execution result against the original task. Reply with EXACTLY one of:\n  APPROVED — task is complete and satisfactory.\n  REVISE: <brief feedback> — further iteration needed.\n\nTask: ${prompt}\n\nExecution result:\n${result}`,
      );

      const upperReview = review.trim().toUpperCase();
      if (upperReview.startsWith("APPROVED")) {
        approved = true;
        break;
      }

      // Extract feedback and ask the human whether to continue.
      const feedback = review.replace(/^REVISE:\s*/i, "").trim();
      const continueLoop =
        iteration < cap
          ? await ctx.ui.confirm(
              `Iteration ${iteration} complete. Reviewer feedback:\n\n${feedback}\n\nContinue to iteration ${iteration + 1}?`,
            )
          : false;

      if (!continueLoop) {
        break;
      }

      // Incorporate reviewer feedback into the next plan.
      const replanner = ctx.stage(`replan-${iteration}`);
      plan = await replanner.prompt(
        `Revise the execution plan based on the reviewer's feedback.\n\nOriginal task: ${prompt}\n\nPrevious plan:\n${plan}\n\nReviewer feedback:\n${feedback}\n\nOutput the revised plan only.`,
      );
    }

    return {
      result: lastResult,
      plan,
      approved,
      iterations_completed: iterationsCompleted,
    };
  })
  .compile();
