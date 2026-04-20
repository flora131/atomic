import { defineWorkflow } from "../../../index.ts";

/**
 * Addy Osmani SHIP — post-rollout cleanup.
 *
 * Runs once after the canary has reached 100% and the 1-week
 * post-rollout monitoring window has passed. Confirms stability,
 * removes the feature flag + dead code path, moves the ADR from
 * PROPOSED → Accepted, and updates the CHANGELOG.
 *
 * Per `shipping-and-launch`: "Clean up flags within 2 weeks of full
 * rollout." This workflow exists to make that cleanup a first-class,
 * auditable step rather than something that slips.
 *
 * HITL gates:
 *   - G17 (final): 1-week post-rollout monitor clean confirmation
 *   - G13: dead-code deletion approval (Chesterton's Fence still applies)
 *   - G20: ADR status transition PROPOSED → Accepted (explicit user review)
 *   - G22: deprecation announcement received + zero-usage proof (only if
 *     removing replaced functionality)
 *
 * Self-contained: the shipping-and-launch cleanup steps are inlined
 * in the stage prompt below. The workflow does not invoke any
 * external slash command and does not look up any external skill, so
 * it runs in a fresh repo without the `addyosmani/agent-skills`
 * plugin being installed. `SlashCommand` is deliberately omitted from
 * `--allowed-tools`.
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
  "      question: \"Confirm ADR promotion PROPOSED → Accepted?\",",
  "      header: \"ADR promotion\",",
  "      multiSelect: false,",
  "      options: [",
  "        { label: \"Confirm\",         description: \"flip status and set acceptance date\" },",
  "        { label: \"Request changes\", description: \"hold, describe revisions\" },",
  "        { label: \"Abort\",           description: \"stop cleanup\" }",
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
  name: "addy-ship-cleanup",
  description:
    "Post-rollout cleanup after 100% canary + 1-week monitor: remove flag, promote ADR, update CHANGELOG. Run once after addy-ship-canary step=100 advances.",
  inputs: [
    {
      name: "flag_name",
      type: "string",
      required: true,
      description: "feature flag identifier to remove (must match what was used in addy-ship-canary)",
    },
    {
      name: "pr_url",
      type: "string",
      required: true,
      description: "original feature PR URL — for ADR + CHANGELOG references",
    },
  ],
})
  .for<"claude">()
  .run(async (ctx) => {
    const flagName = ctx.inputs.flag_name ?? "";
    const prUrl = ctx.inputs.pr_url ?? "";

    await ctx.stage(
      {
        name: "ship-cleanup",
        description:
          "SHIP/cleanup: confirm 1-week monitor, remove flag, promote ADR, update CHANGELOG",
      },
      { chatFlags: [...CHAT_FLAGS] },
      {},
      async (s) => {
        await s.session.query(
          [
            HITL_TOOL_RULE,
            "Run post-rollout CLEANUP using Addy Osmani's",
            "shipping-and-launch + documentation-and-adrs +",
            "git-workflow-and-versioning processes (and",
            "deprecation-and-migration only if this feature replaced older",
            "code). The processes are inlined below — do NOT attempt to",
            "invoke a `/ship` slash command or look up any of those skills",
            "by name; none is guaranteed to be installed in this repo. Work",
            "directly from these steps.",
            "",
            `Context: feature flag \`${flagName}\` reached 100% rollout via \`addy-ship-canary\`. The associated PR was ${prUrl}. Read \`docs/rollout/${flagName}.md\` first — it contains the full rollout decision log you will reference.`,
            "",
            "Do this in order:",
            "",
            "  1. **Confirm stability (1-week post-rollout monitor)**.",
            "     HITL GATE G17-final (BLOCKING): INVOKE the `AskUserQuestion` tool with the question 'Has the feature been stable at 100% for the full 1-week post-rollout window, with no red-threshold triggers?' and options [Yes — proceed, No — rollback, Need more time]. WAIT for the tool result. Do NOT proceed on anything short of a clear 'Yes — proceed'. Writing the question as prose is NOT acceptable.",
            "",
            "  2. **Remove the feature flag**.",
            `     - Locate every read site of \`${flagName}\` (grep the codebase).`,
            "     - Keep the path that runs when the flag is ON; delete the flag read and the OFF branch.",
            "     - Delete the flag configuration from the flag management system (LaunchDarkly, config file, whatever is in use).",
            "     - HITL GATE G13 (BLOCKING): before deleting ANY code path, INVOKE the `AskUserQuestion` tool with the question 'Remove the OFF-path code for `" + flagName + "`?' and options [Yes, Review diff first, No]. WAIT for the tool result. Chesterton's Fence still applies — do NOT delete on your own judgment and do NOT write the confirmation request as prose.",
            "     - Commit using Addy's git-workflow-and-versioning cadence (atomic conventional commit, ~100 lines, split if larger): `chore: remove <flag_name> feature flag after 100% rollout`.",
            "",
            "  3. **Promote the ADR**.",
            `     - Find the ADR at \`docs/decisions/ADR-NNN-*.md\` that was written in PROPOSED state by \`addy-define-to-ship-prep\`.`,
            "     - HITL GATE G20 (BLOCKING): INVOKE the `AskUserQuestion` tool with the question 'Promote ADR `<ADR file>` from PROPOSED → Accepted?' and options [Confirm, Request changes, No]. WAIT for the tool result. Do NOT flip the status based on a prose 'please confirm' request.",
            "     - On approval, update the ADR front-matter / status line to `Accepted` and add the acceptance date.",
            "",
            "  4. **Update CHANGELOG**.",
            "     - Under the next release section, add an entry in the correct subsection (Added / Fixed / Changed) describing the feature from the user's perspective.",
            `     - Reference the PR (${prUrl}).`,
            "",
            "  5. **Deprecation cleanup (only if this feature replaced existing functionality)**.",
            "     Apply Addy's deprecation-and-migration process fully (inlined — do NOT look up the skill by name):",
            "     - HITL GATE G22 (BLOCKING): INVOKE the `AskUserQuestion` tool with the question 'Deprecation announcement received by downstream AND zero-usage proof collected for the replaced code?' and options [Confirm, Need evidence, No — hold]. WAIT for the tool result. Do NOT remove replaced code based on a prose confirmation request.",
            "     - On confirmation: remove the replaced code, commit separately.",
            "",
            "  6. **Final summary**.",
            `     Append a '## Cleanup — <timestamp>' section to \`docs/rollout/${flagName}.md\` summarising: flag removed (commit SHA), ADR promoted (file path), CHANGELOG updated (version), deprecation cleanup (if any). This closes out the rollout log.`,
            "",
            "Final output: the list of commits made, the ADR path, the CHANGELOG entry, and the closed-out rollout log path.",
          ].join("\n"),
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
