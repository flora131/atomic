import { defineWorkflow } from "../../../index.ts";

/**
 * Addy Osmani SHIP — one canary decision, re-runnable per rollout step.
 *
 * Called once per monitoring window that the `shipping-and-launch` skill
 * defines:
 *   - `step=team` — 24-hour team-enable window (HITL gate G17)
 *   - `step=5|25|50|100` — per-percentage canary windows (HITL gate G18)
 *
 * The human watches their own observability dashboards for the duration
 * of the window, then re-invokes this workflow with the observed
 * metrics. The agent applies the decision table from
 * `shipping-and-launch` (error rate, P95 latency, client JS errors,
 * business metrics) and returns one of ADVANCE / HOLD / ROLLBACK — the
 * final call is confirmed by the human via `AskUserQuestion`.
 *
 * Each invocation appends its decision + evidence to
 * `docs/rollout/<flag_name>.md` so the rollout log is durable across
 * re-runs.
 *
 * This workflow is short (minutes). It is NOT the right tool for the
 * monitoring itself — treat it as the post-monitoring decision step.
 * Suitable for manual re-runs or as a step in an automated pipeline
 * that gathers metrics and invokes Atomic per step.
 *
 * Self-contained: the shipping-and-launch rollout-decision table is
 * inlined in the stage prompt below. The workflow does not call any
 * external slash command or look up any external skill, so it runs in
 * a fresh repo without the `addyosmani/agent-skills` plugin being
 * installed. The `SlashCommand` tool is deliberately omitted from
 * `--allowed-tools` for the same reason.
 */

const ADDY_TOOLS = [
  "--allowed-tools",
  "Read,Write,Edit,Bash,Grep,Glob,Task,WebFetch,WebSearch,AskUserQuestion,TodoWrite",
] as const;

const CHAT_FLAGS = [
  ...ADDY_TOOLS,
  "--allow-dangerously-skip-permissions",
  "--dangerously-skip-permissions",
] as const;

/**
 * Preamble prepended to every stage prompt. The TUI only surfaces a HITL
 * prompt when the agent invokes the `AskUserQuestion` tool — prose like
 * "reply 'confirm'" is invisible to the runtime and lets the agent proceed
 * unilaterally. Every gate MUST call the tool. Prose is not a gate.
 */
const HITL_TOOL_RULE = [
  "============================================================",
  "HITL_TOOL_RULE — READ BEFORE EVERY GATE",
  "============================================================",
  "Every HITL gate in this stage MUST be delivered by invoking the",
  "`AskUserQuestion` tool. Do NOT emit the gate as prose.",
  "",
  "The TUI ONLY renders a blocking prompt when you CALL the tool. Sentences",
  "like \"reply 'confirm'\", \"let me know\", \"correct me now or I will proceed\",",
  "or \"tell me if this looks right\" are INVISIBLE to the user and the stage",
  "will continue unilaterally — that is a bug. Prose is NEVER a gate.",
  "",
  "For every HITL gate listed below:",
  "  1. Build the question(s) in your head.",
  "  2. INVOKE the `AskUserQuestion` tool (NOT plain text).",
  "  3. WAIT for the tool result before doing anything else.",
  "  4. Only act on the tool result; treat silence as \"no answer yet\".",
  "",
  "Example tool invocation (pseudo-schema — use the real tool):",
  "  AskUserQuestion({",
  "    questions: [{",
  "      question: \"Canary decision for this window? (HITL Gate G17/G18)\",",
  "      header: \"Canary decision\",",
  "      multiSelect: false,",
  "      options: [",
  "        { label: \"ADVANCE\",  description: \"metrics green, proceed\" },",
  "        { label: \"HOLD\",     description: \"metrics borderline, wait\" },",
  "        { label: \"ROLLBACK\", description: \"red, flip flag off\" }",
  "      ]",
  "    }]",
  "  })",
  "",
  "If a gate is BLOCKING and the tool call fails, STOP and surface the",
  "error — do not fall back to prose.",
  "============================================================",
  "",
].join("\n");

export default defineWorkflow({
  name: "addy-ship-canary",
  description:
    "Apply Addy's rollout decision table (ADVANCE / HOLD / ROLLBACK) for one monitoring window — team 24h or canary 5/25/50/100. Re-run once per step.",
  inputs: [
    {
      name: "step",
      type: "enum",
      required: true,
      description:
        "rollout step this invocation covers — `team` for the 24h team-enable window (G17), 5/25/50/100 for the canary percentages (G18)",
      values: ["team", "5", "25", "50", "100"],
    },
    {
      name: "flag_name",
      type: "string",
      required: true,
      description: "feature flag identifier (used to locate docs/rollout/<flag_name>.md)",
    },
    {
      name: "pr_url",
      type: "string",
      required: true,
      description: "PR URL for context re-load (the agent reads it for change summary + baseline reference)",
    },
    {
      name: "baseline_error_rate",
      type: "string",
      required: true,
      description: "baseline error rate (flag OFF, or previous step) — e.g. '0.12%'",
    },
    {
      name: "baseline_p95",
      type: "string",
      required: true,
      description: "baseline P95 latency — e.g. '180ms'",
    },
    {
      name: "observed_error_rate",
      type: "string",
      required: true,
      description: "observed error rate in this window — e.g. '0.15%'",
    },
    {
      name: "observed_p95",
      type: "string",
      required: true,
      description: "observed P95 latency in this window — e.g. '195ms'",
    },
    {
      name: "observed_client_js_errors",
      type: "string",
      required: true,
      description:
        "client JS error summary — new error types + their session rate — e.g. 'no new types' or 'TypeError in CursorPanel @ 0.05%'",
    },
    {
      name: "business_metrics",
      type: "text",
      required: false,
      description:
        "optional: business metric deltas (conversion, engagement, etc.). Free-form text; describe each metric, baseline, observed, and delta.",
    },
  ],
})
  .for<"claude">()
  .run(async (ctx) => {
    const step = (ctx.inputs.step ?? "team") as
      | "team"
      | "5"
      | "25"
      | "50"
      | "100";
    const flagName = ctx.inputs.flag_name ?? "";
    const prUrl = ctx.inputs.pr_url ?? "";
    const baselineErrorRate = ctx.inputs.baseline_error_rate ?? "";
    const baselineP95 = ctx.inputs.baseline_p95 ?? "";
    const observedErrorRate = ctx.inputs.observed_error_rate ?? "";
    const observedP95 = ctx.inputs.observed_p95 ?? "";
    const observedClientJsErrors = ctx.inputs.observed_client_js_errors ?? "";
    const businessMetrics = ctx.inputs.business_metrics ?? "";

    const stepLabel =
      step === "team"
        ? "team enable (24h monitoring window — HITL gate G17)"
        : `canary at ${step}% (HITL gate G18)`;

    const blockingGate = step === "team" ? "G17" : "G18";

    await ctx.stage(
      {
        name: `ship-canary-${step}`,
        description: `SHIP/canary: decide ADVANCE / HOLD / ROLLBACK at step ${step}`,
      },
      { chatFlags: [...CHAT_FLAGS] },
      {},
      async (s) => {
        await s.session.query(
          [
            HITL_TOOL_RULE,
            `Decide ADVANCE / HOLD / ROLLBACK for the following rollout step: **${stepLabel}**.`,
            "",
            "Use Addy Osmani's shipping-and-launch rollout-decision table,",
            "inlined below. Do NOT attempt to invoke a `/ship` slash command",
            "or look up a `shipping-and-launch` skill; neither is guaranteed",
            "to be installed in this repo. Work directly from the table.",
            "",
            "Rollout Decision Thresholds:",
            "",
            "| Metric | ADVANCE (green) | HOLD (yellow) | ROLLBACK (red) |",
            "|--------|-----------------|---------------|----------------|",
            "| Error rate | Within 10% of baseline | 10-100% above baseline | >2x baseline |",
            "| P95 latency | Within 20% of baseline | 20-50% above baseline | >50% above baseline |",
            "| Client JS errors | No new error types | New errors at <0.1% of sessions | New errors at >0.1% of sessions |",
            "| Business metrics | Neutral or positive | Decline <5% (may be noise) | Decline >5% |",
            "",
            "Observed numbers for this window:",
            `- Flag: \`${flagName}\``,
            `- PR: ${prUrl}`,
            `- Step: ${stepLabel}`,
            "- Metrics:",
            `  - Error rate — baseline ${baselineErrorRate} / observed ${observedErrorRate}`,
            `  - P95 latency — baseline ${baselineP95} / observed ${observedP95}`,
            `  - Client JS errors — ${observedClientJsErrors}`,
            businessMetrics
              ? `  - Business metrics — ${businessMetrics}`
              : "  - Business metrics — (none provided)",
            "",
            "Do this:",
            `  1. Read \`docs/rollout/${flagName}.md\` if it exists — respect prior decisions; the log is append-only.`,
            `  2. Read the PR (${prUrl}) for change context if needed.`,
            "  3. Apply the decision table to each metric independently. The worst verdict across metrics is the window verdict (red > yellow > green).",
            "  4. Honour the absolute 'When to Roll Back' red-threshold triggers (data-integrity issues → ROLLBACK regardless of percentage; error rate >2x baseline → ROLLBACK; P95 >50% above baseline → ROLLBACK; new-client-error rate >0.1% of sessions → ROLLBACK).",
            `  5. HITL GATE ${blockingGate} (BLOCKING): INVOKE the \`AskUserQuestion\` tool with the per-metric verdict summary as the question and options [ADVANCE, HOLD, ROLLBACK]. WAIT for the tool result. Honour the human's final call even if it disagrees with the agent's recommendation ('Human makes the final call.'). Do NOT emit the verdicts as prose only — the TUI cannot see it and the rollout will drift.`,
            `  6. Append an entry to \`docs/rollout/${flagName}.md\` under a '## Step ${step} — <timestamp>' heading with: per-metric baseline/observed/delta/verdict, window summary, agent recommendation, human verdict, rationale, next action (e.g. 'advance to ${step === "team" ? "5%" : step === "100" ? "run addy-ship-cleanup" : "next step"}').`,
            "  7. If the verdict is ROLLBACK, also emit the rollback execution plan inline (feature-flag flip, redeploy previous version, monitor recovery). Rollback triggers must be acted on immediately — do not wait for the next window.",
            "",
            "Red-flag surfacing — when ANY of these conditions are present, INVOKE the `AskUserQuestion` tool restating the red flag verbatim with options [STOP / HOLD, Override (require reason), ROLLBACK]. Do NOT emit the red flag as a prose warning only.",
            "- 'The numbers look borderline but let's ship it anyway' → recommend HOLD.",
            "- 'Data integrity issue — only a few users affected' → recommend ROLLBACK regardless of percentage.",
            "",
            "Final output: the written verdict + the appended rollout log entry.",
          ].join("\n"),
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
