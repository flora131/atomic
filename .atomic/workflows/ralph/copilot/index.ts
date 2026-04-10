/**
 * Ralph workflow for Copilot — plan → orchestrate → review → debug loop.
 *
 * Each sub-agent invocation spawns its own visible session in the graph,
 * so users can see each iteration's progress in real time. The loop
 * terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two consecutive reviewer passes return zero findings.
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

/**
 * Concatenate the text content of every top-level assistant message in the
 * event stream.
 *
 * Why not just `.at(-1)`? Two traps:
 *
 * 1. A single Copilot turn is one `assistant.message` event that carries BOTH
 *    prose AND a `toolRequests[]` array. When the model ends a turn with
 *    tool-calls-only (e.g. the planner's final `TaskList` verification call),
 *    `content` is an empty string — picking the final message drops the
 *    planner's actual reasoning from the earlier turns.
 * 2. `assistant.message` events have a `parentToolCallId` field populated when
 *    they originate from a sub-agent spawned by the parent. `getMessages()`
 *    returns the complete history including those, so `.at(-1)` can land on a
 *    sub-agent's final message instead of the top-level agent's. Filter them
 *    out to get only the agent's own turns.
 *
 * Joining every non-empty top-level content string preserves the full
 * commentary across all turns, which is what downstream stages (e.g. the
 * orchestrator reading the planner's handoff) actually need.
 */
function getAssistantText(messages: SessionEvent[]): string {
  return messages
    .filter(
      (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
        m.type === "assistant.message" && !m.data.parentToolCallId,
    )
    .map((m) => m.data.content)
    .filter((c) => c.length > 0)
    .join("\n\n");
}

export default defineWorkflow({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
})
  .run(async (ctx) => {
    let consecutiveClean = 0;
    let debuggerReport = "";
    // Track the most recent session so the next stage can declare it as a
    // dependency — this chains planner → orchestrator → reviewer → [confirm]
    // → [debugger] → next planner in the graph instead of showing every
    // stage as an independent sibling under the root.
    let prevStage: string | undefined;
    const depsOn = (): string[] | undefined =>
      prevStage ? [prevStage] : undefined;

    for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
      // ── Plan ──────────────────────────────────────────────────────────
      const plannerName = `planner-${iteration}`;
      const planner = await ctx.session(
        { name: plannerName, dependsOn: depsOn() },
        async (s) => {
          const client = new CopilotClient({ cliUrl: s.serverUrl });
          await client.start();
          const session = await client.createSession({
            agent: "planner",
            onPermissionRequest: approveAll,
          });
          await client.setForegroundSessionId(session.sessionId);
          await session.sendAndWait(
            {
              prompt: buildPlannerPrompt(s.userPrompt, {
                iteration,
                debuggerReport: debuggerReport || undefined,
              }),
            },
            AGENT_SEND_TIMEOUT_MS,
          );
          const messages = await session.getMessages();
          s.save(messages);
          await session.disconnect();
          await client.stop();
          return getAssistantText(messages);
        },
      );
      prevStage = plannerName;

      // ── Orchestrate ───────────────────────────────────────────────────
      const orchName = `orchestrator-${iteration}`;
      await ctx.session(
        { name: orchName, dependsOn: depsOn() },
        async (s) => {
          const client = new CopilotClient({ cliUrl: s.serverUrl });
          await client.start();
          const session = await client.createSession({
            agent: "orchestrator",
            onPermissionRequest: approveAll,
          });
          await client.setForegroundSessionId(session.sessionId);
          await session.sendAndWait(
            {
              prompt: buildOrchestratorPrompt(s.userPrompt, {
                plannerNotes: planner.result,
              }),
            },
            AGENT_SEND_TIMEOUT_MS,
          );
          s.save(await session.getMessages());
          await session.disconnect();
          await client.stop();
        },
      );
      prevStage = orchName;

      // ── Review (first pass) ───────────────────────────────────────────
      let gitStatus = await safeGitStatusS();
      const reviewerName = `reviewer-${iteration}`;
      const review = await ctx.session(
        { name: reviewerName, dependsOn: depsOn() },
        async (s) => {
          const client = new CopilotClient({ cliUrl: s.serverUrl });
          await client.start();
          const session = await client.createSession({
            agent: "reviewer",
            onPermissionRequest: approveAll,
          });
          await client.setForegroundSessionId(session.sessionId);
          await session.sendAndWait(
            {
              prompt: buildReviewPrompt(s.userPrompt, {
                gitStatus,
                iteration,
              }),
            },
            AGENT_SEND_TIMEOUT_MS,
          );
          const messages = await session.getMessages();
          s.save(messages);
          await session.disconnect();
          await client.stop();
          return getAssistantText(messages);
        },
      );
      prevStage = reviewerName;

      let reviewRaw = review.result;
      let parsed = parseReviewResult(reviewRaw);

      if (!hasActionableFindings(parsed, reviewRaw)) {
        consecutiveClean += 1;
        if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) break;

        // Confirmation pass — re-run reviewer only
        gitStatus = await safeGitStatusS();
        const confirmName = `reviewer-${iteration}-confirm`;
        const confirm = await ctx.session(
          { name: confirmName, dependsOn: depsOn() },
          async (s) => {
            const client = new CopilotClient({ cliUrl: s.serverUrl });
            await client.start();
            const session = await client.createSession({
              agent: "reviewer",
              onPermissionRequest: approveAll,
            });
            await client.setForegroundSessionId(session.sessionId);
            await session.sendAndWait(
              {
                prompt: buildReviewPrompt(s.userPrompt, {
                  gitStatus,
                  iteration,
                  isConfirmationPass: true,
                }),
              },
              AGENT_SEND_TIMEOUT_MS,
            );
            const messages = await session.getMessages();
            s.save(messages);
            await session.disconnect();
            await client.stop();
            return getAssistantText(messages);
          },
        );
        prevStage = confirmName;

        reviewRaw = confirm.result;
        parsed = parseReviewResult(reviewRaw);

        if (!hasActionableFindings(parsed, reviewRaw)) {
          consecutiveClean += 1;
          if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) break;
        } else {
          consecutiveClean = 0;
        }
      } else {
        consecutiveClean = 0;
      }

      // ── Debug (only if findings remain AND another iteration is allowed) ─
      if (hasActionableFindings(parsed, reviewRaw) && iteration < MAX_LOOPS) {
        const debuggerName = `debugger-${iteration}`;
        const debugger_ = await ctx.session(
          { name: debuggerName, dependsOn: depsOn() },
          async (s) => {
            const client = new CopilotClient({ cliUrl: s.serverUrl });
            await client.start();
            const session = await client.createSession({
              agent: "debugger",
              onPermissionRequest: approveAll,
            });
            await client.setForegroundSessionId(session.sessionId);
            await session.sendAndWait(
              {
                prompt: buildDebuggerReportPrompt(parsed, reviewRaw, {
                  iteration,
                  gitStatus,
                }),
              },
              AGENT_SEND_TIMEOUT_MS,
            );
            const messages = await session.getMessages();
            s.save(messages);
            await session.disconnect();
            await client.stop();
            return getAssistantText(messages);
          },
        );
        prevStage = debuggerName;
        debuggerReport = extractMarkdownBlock(debugger_.result);
      }
    }
  })
  .compile();
