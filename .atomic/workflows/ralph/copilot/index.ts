/**
 * Ralph workflow for Copilot — plan → orchestrate → review → debug loop.
 *
 * One CopilotClient backs every iteration; each loop step creates a fresh
 * sub-session bound to the appropriate sub-agent (planner, orchestrator,
 * reviewer, debugger). The loop terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two consecutive reviewer passes return zero findings.
 *
 * A loop is one cycle of plan → orchestrate → review. When a review returns
 * zero findings on the FIRST pass we re-run only the reviewer (still inside
 * the same loop iteration) to confirm; if that confirmation pass is also
 * clean we stop. The debugger only runs when findings remain, and its
 * markdown report is fed back into the next iteration's planner.
 *
 * Run: atomic workflow -n ralph -a copilot "<your spec>"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type { SessionEvent } from "@github/copilot-sdk";

import {
  buildPlannerPrompt,
  buildOrchestratorPrompt,
  buildReviewPrompt,
  buildDebuggerReportPrompt,
  parseReviewResult,
  extractMarkdownBlock,
} from "../helpers/prompts.ts";
import { hasActionableFindings } from "../helpers/review.ts";
import { safeGitStatusS } from "../helpers/git.ts";

const MAX_LOOPS = 10;
const CONSECUTIVE_CLEAN_THRESHOLD = 2;
/**
 * Per-agent send timeout. `CopilotSession.sendAndWait` defaults to 60s, which
 * is far too short for real planner/orchestrator/reviewer/debugger work — a
 * timeout there throws and aborts the whole workflow before the next stage
 * can run. 30 minutes gives each sub-agent ample headroom while still
 * surfacing truly hung sessions.
 */
const AGENT_SEND_TIMEOUT_MS = 30 * 60 * 1000;

/** Concatenate the text content of every assistant message in an event stream. */
function getLastAssistantText(messages: SessionEvent[]): string {
  const assistantMessages = messages.filter(
    (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
      m.type === "assistant.message",
  );
  const last = assistantMessages.at(-1);
  if (!last) return "";
  return last.data.content;
}

export default defineWorkflow({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
})
  .session({
    name: "ralph-loop",
    description:
      "Drive plan/orchestrate/review/debug iterations until clean or capped",
    run: async (ctx) => {
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();

      let lastMessages: SessionEvent[] = [];

      /**
       * Spin up a fresh sub-session bound to the named agent, send the
       * prompt, await the response, then disconnect. Returns the text of the
       * last assistant message so the caller can parse it.
       */
      async function runAgent(agent: string, prompt: string): Promise<string> {
        const session = await client.createSession({
          agent,
          onPermissionRequest: approveAll,
        });
        await client.setForegroundSessionId(session.sessionId);

        await session.sendAndWait({ prompt }, AGENT_SEND_TIMEOUT_MS);

        const messages = await session.getMessages();
        lastMessages = messages;

        await session.disconnect();
        return getLastAssistantText(messages);
      }

      try {
        let consecutiveClean = 0;
        let debuggerReport = "";

        for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
          // ── Plan ──────────────────────────────────────────────────────────
          // Capture the planner's final text. The Copilot SDK creates a fresh
          // session for each sub-agent and disconnects when we're done, so
          // the orchestrator below will NOT see the planner's in-session
          // context automatically — we must forward it explicitly.
          const plannerNotes = await runAgent(
            "planner",
            buildPlannerPrompt(ctx.userPrompt, {
              iteration,
              debuggerReport: debuggerReport || undefined,
            }),
          );

          // ── Orchestrate ───────────────────────────────────────────────────
          // Pass the original user spec AND the planner's trailing commentary
          // into the fresh orchestrator session. The task list (via
          // TaskCreate/TaskList) is the primary handoff channel, but this
          // covers ambiguity and any notes that didn't fit in task bodies.
          await runAgent(
            "orchestrator",
            buildOrchestratorPrompt(ctx.userPrompt, { plannerNotes }),
          );

          // ── Review (first pass) ───────────────────────────────────────────
          let gitStatus = await safeGitStatusS();
          let reviewRaw = await runAgent(
            "reviewer",
            buildReviewPrompt(ctx.userPrompt, { gitStatus, iteration }),
          );
          let parsed = parseReviewResult(reviewRaw);

          if (!hasActionableFindings(parsed, reviewRaw)) {
            consecutiveClean += 1;
            if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) {
              break;
            }

            // Confirmation pass — re-run reviewer only, NOT plan/orchestrate.
            gitStatus = await safeGitStatusS();
            reviewRaw = await runAgent(
              "reviewer",
              buildReviewPrompt(ctx.userPrompt, {
                gitStatus,
                iteration,
                isConfirmationPass: true,
              }),
            );
            parsed = parseReviewResult(reviewRaw);

            if (!hasActionableFindings(parsed, reviewRaw)) {
              consecutiveClean += 1;
              if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) {
                break;
              }
            } else {
              consecutiveClean = 0;
              // fall through to debugger
            }
          } else {
            consecutiveClean = 0;
          }

          // ── Debug (only if findings remain AND another iteration is allowed) ─
          if (
            hasActionableFindings(parsed, reviewRaw) &&
            iteration < MAX_LOOPS
          ) {
            const debuggerRaw = await runAgent(
              "debugger",
              buildDebuggerReportPrompt(parsed, reviewRaw, {
                iteration,
                gitStatus,
              }),
            );
            debuggerReport = extractMarkdownBlock(debuggerRaw);
          }
        }

        ctx.save(lastMessages);
      } finally {
        await client.stop();
      }
    },
  })
  .compile();
