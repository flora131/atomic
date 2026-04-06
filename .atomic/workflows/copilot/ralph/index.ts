/**
 * Ralph workflow for Copilot — three-session planner → orchestrator → review-fix.
 *
 * Session 1 (planner):     Decompose the user prompt into a structured task list.
 * Session 2 (orchestrator): Drive sub-agents to implement the tasks.
 * Session 3 (review-fix):  Iteratively review and fix until clean (max 10 cycles).
 *
 * Run: atomic workflow -n ralph -a copilot "<your spec>"
 */

import { defineWorkflow } from "@bastani/atomic-workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type { SessionEvent } from "@github/copilot-sdk";

import {
  buildSpecToTasksPrompt,
  buildOrchestratorPrompt,
  buildReviewPrompt,
  buildFixSpecFromReview,
  buildFixSpecFromRawReview,
  parseReviewResult,
} from "../../ralph/helpers/prompts.ts";
import { hasActionableFindings } from "../../ralph/helpers/review.ts";

// ---------------------------------------------------------------------------
// Local helper
// ---------------------------------------------------------------------------

/**
 * Extract the text content of the last assistant message from a Copilot
 * session's event stream.  Returns an empty string when no assistant message
 * is present.
 */
function getLastAssistantText(messages: SessionEvent[]): string {
  const assistantMessages = messages.filter(
    (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
      m.type === "assistant.message",
  );

  const last = assistantMessages.at(-1);
  if (!last) {
    return "";
  }

  return last.data.content;
}

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export default defineWorkflow({
  name: "ralph",
  description:
    "Ralph: planner → orchestrator → review-fix loop for autonomous task execution",
})
  // -------------------------------------------------------------------------
  // Session 1: planner
  // -------------------------------------------------------------------------
  .session({
    name: "planner",
    description: "Decompose the user prompt into an actionable task list",
    run: async (ctx) => {
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();

      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);

      await session.sendAndWait({ prompt: buildSpecToTasksPrompt(ctx.userPrompt) });

      ctx.save(await session.getMessages());

      await session.disconnect();
      await client.stop();
    },
  })

  // -------------------------------------------------------------------------
  // Session 2: orchestrator
  // -------------------------------------------------------------------------
  .session({
    name: "orchestrator",
    description: "Drive sub-agents to implement the planned tasks",
    run: async (ctx) => {
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();

      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);

      await session.sendAndWait({ prompt: buildOrchestratorPrompt() });

      ctx.save(await session.getMessages());

      await session.disconnect();
      await client.stop();
    },
  })

  // -------------------------------------------------------------------------
  // Session 3: review-fix loop
  // -------------------------------------------------------------------------
  .session({
    name: "review-fix",
    description:
      "Iteratively review the implementation and apply fixes until clean",
    run: async (ctx) => {
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();

      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);

      const MAX_CYCLES = 10;
      let consecutiveClean = 0;
      let priorDebuggerOutput = "";

      for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
        // Step 1 — review
        await session.sendAndWait({
          prompt: buildReviewPrompt(ctx.userPrompt, priorDebuggerOutput),
        });

        // Step 2 — extract review text
        const reviewRaw = getLastAssistantText(await session.getMessages());

        // Step 3 — parse structured review
        const review = parseReviewResult(reviewRaw);

        // Step 4 — check for actionable findings
        if (!hasActionableFindings(review, reviewRaw)) {
          consecutiveClean++;
          if (consecutiveClean >= 2) {
            break;
          }
          continue;
        }

        // Reset clean streak
        consecutiveClean = 0;

        // Step 6 — build fix prompt
        let fixPrompt =
          review != null ? buildFixSpecFromReview(review, ctx.userPrompt) : "";

        if (!fixPrompt) {
          fixPrompt = buildFixSpecFromRawReview(reviewRaw, ctx.userPrompt);
        }

        if (!fixPrompt) {
          fixPrompt =
            "The previous review identified issues. Please fix all identified problems and ensure the implementation is correct and complete.";
        }

        // Step 7 — apply fix
        await session.sendAndWait({ prompt: fixPrompt });

        // Step 8 — capture fix output for the next review pass
        priorDebuggerOutput = getLastAssistantText(await session.getMessages());
      }

      ctx.save(await session.getMessages());

      await session.disconnect();
      await client.stop();
    },
  })

  .compile();
