# Running a Workflow on Behalf of the User

When the user asks you to **run** (or "kick off" / "start" / "execute") a
workflow — *not* author one — your job is to translate their request into a
single `atomic workflow` invocation and run it. This is the playbook for that
flow. It is different from the authoring playbook in `SKILL.md`: the workflow
already exists on disk; you just need to invoke it correctly.

## You don't need to pass `-a` or `-d`

When you (the agent) are running inside an atomic chat or workflow pane, the
CLI reads `$ATOMIC_AGENT` from your environment and:

- Fills in `-a <agent>` automatically if you don't pass it.
- Forces detached mode on, so launching a workflow never takes over your pane.

The practical result: your command is just `atomic workflow -n <name> <inputs>`.
No provider flag, no detach flag, no chance of the orchestrator hijacking your
terminal. The CLI prints the session name and returns immediately; you relay
that name to the user.

Override only when the user explicitly asks for a different provider (e.g.
"run it on Copilot") — pass `-a copilot` and the CLI will honor it over the
env var.

## Always list first

**Before anything else, run `atomic workflow list`.** (Optionally filter with
`-a <agent>` if the user's pinned to one — usually unnecessary.) This is a
cheap, read-only call that tells you three things in one shot:

- Whether the workflow the user named actually exists.
- What other workflows are available (so you can suggest close matches on a typo).
- Source + metadata for every discoverable workflow (local vs. global vs. builtin).

Skipping this step is how you end up guessing a name, typing it into
`atomic workflow -n <name>`, and getting a `workflow not found` error you
could have predicted. List first, decide second, run third.

If the user's request is ambiguous ("run the research one"), the list output
is also how you show them the candidates so they can pick — present the
matching names and ask with AskUserQuestion.

## If the workflow doesn't exist: offer to create it

When the listed workflows don't include what the user asked for:

1. **Tell the user explicitly** — "I don't see a `<name>` workflow in
   `.atomic/workflows/` or `~/.atomic/workflows/`. Available: \<short list from
   `atomic workflow list`>."
2. **Check for typos first** — if one of the listed names is a close match,
   surface it via AskUserQuestion ("Did you mean `<close-match>`?") before
   offering to author anything.
3. **Offer to create it** — ask with AskUserQuestion: "Want me to create a
   `<name>` workflow first?" with choices `Yes, create it` / `No, pick from
   the list` / `No, cancel`.
4. **If yes → switch modes** — hand off to the authoring flow in SKILL.md
   (Steps 1-5). Interview the user for intent, write the file at
   `.atomic/workflows/<name>/<agent>/index.ts`, typecheck it, *then* come back
   here and invoke it. Do not skip the typecheck — an uncompiled workflow
   won't run.
5. **If no → stop** — don't fabricate a command that will fail. Let the user
   redirect you.

Never invent a workflow name or silently fall back to a different workflow.
If the thing the user asked for doesn't exist, the correct answer is to say
so and offer concrete next steps.

## Collecting inputs with AskUserQuestion

Once you've confirmed the workflow exists, you need to know two things about
its invocation shape:

1. **Does it declare a `prompt` input?** If so, it's free-form — you pass a
   positional string.
2. **Does it declare structured inputs?** If so, you pass `--<field>=<value>`
   flags, one per required field.

**Use `atomic workflow inputs <name> -a <agent>` to get the schema.** This
prints a JSON envelope with every field's `name`, `type`, `required`,
`default`, `description`, and (for enums) `values` — exactly what
AskUserQuestion needs. The `freeform: true` flag tells you whether the
workflow takes a positional prompt vs. structured flags, with a synthetic
`prompt` field included so the JSON shape is uniform either way.

```bash
atomic workflow inputs gen-spec -a claude
# {"workflow":"gen-spec","agent":"claude","freeform":false,
#  "inputs":[{"name":"research_doc","type":"string","required":true,...},
#            {"name":"focus","type":"enum","values":["minimal","standard","exhaustive"],"default":"standard"}]}
```

Why this command instead of reading the source file: `inputs` is the contract
the CLI actually validates against. It survives refactors, handles built-in
workflows that aren't in the project tree, and never falls out of sync with
the runtime. Reading TypeScript source is a fallback for the rare case where
the command can't resolve the workflow.

Once you have the schema, use the **AskUserQuestion tool** to collect any
values the user hasn't already provided in their message. One question per
missing input field. For enum fields, pass the declared `values` as
multiple-choice options so the user sees exactly what's allowed. Keep
questions tight and purposeful — if the user's message already answers a
question, don't ask it again.

Skip AskUserQuestion entirely when:
- The user already supplied every required value in their message
  ("run ralph on 'add OAuth to the API'" — the prompt is right there).
- The workflow declares no required inputs and needs no prompt.

## End-to-end recipe

1. **List available workflows** — run `atomic workflow list`. Always. This is
   your ground truth.
2. **Resolve the target**:
   - Exact match in the list → continue.
   - Close match → confirm via AskUserQuestion before proceeding.
   - No match → tell the user what's available and offer to author it (see
     previous section). If they decline, stop.
3. **Discover the inputs schema** — run `atomic workflow inputs <name> -a <agent>`
   and parse the JSON.
4. **Ask for missing inputs** — use AskUserQuestion, one question per
   unanswered required field. Enums become multiple-choice.
5. **Invoke** — build one of these commands:
   - Free-form: `atomic workflow -n <name> "<prompt>"`
   - Structured: `atomic workflow -n <name> --<field1>=<value1> --<field2>=<value2>`
6. **Report the session name** the CLI printed and tell the user: "attach any
   time with `atomic workflow session connect <session>` — or
   `atomic workflow session list` to see what's running."

## Monitoring a running workflow

Detached workflows return immediately with a session name; the actual work
runs in the background on the atomic tmux socket. Use `atomic workflow status`
to check whether the workflow is still running, has completed, errored out, or
paused for human input — without attaching to its TUI.

```bash
atomic workflow status atomic-wf-claude-gen-spec-a1b2c3d4
# {"id":"atomic-wf-claude-gen-spec-a1b2c3d4","overall":"in_progress","alive":true,
#  "sessions":[{"name":"orchestrator","status":"running",...}],...}
```

Four overall states the agent must handle distinctly:

| Status | Meaning | What you should do |
|---|---|---|
| `in_progress` | The orchestrator is running and no stage is paused | Wait, or report progress to the user |
| `needs_review` | At least one stage is paused for human input (HIL) — Copilot `ask_user`, OpenCode `question.asked`, Copilot/MCP elicitation | **Surface this to the user immediately** — they need to attach with `atomic workflow session connect <id>` to respond, otherwise the workflow stalls indefinitely |
| `completed` | Workflow finished successfully | Report success and summarize the output |
| `error` | Fatal error or a stage failed | Report the `fatalError` field and offer to investigate logs |

`needs_review` outranks `completed` so a HIL pause near the end is never
reported as done while still waiting on a human. A dead orchestrator with a
stale snapshot is automatically downgraded to `error`.

Omit the id to list every running workflow at once: `atomic workflow status`.
Useful when checking on multiple parallel runs, or when the user just asks
"what's running?".

## Cleaning up sessions

When the user is done with a workflow — or you launched one detached and it's
no longer needed — tear it down with `-y` so no confirmation prompt blocks you:

```bash
atomic session kill atomic-wf-claude-gen-spec-a1b2c3d4 -y
```

The `-y` flag is mandatory for agent use. Without it, the CLI calls
`@clack/prompts confirm`, which expects a TTY and will hang indefinitely in a
non-interactive context. Same flag works for `atomic workflow session kill`
and `atomic chat session kill`. Without an id, `kill -y` tears down every
in-scope session — only do that when the user has asked to stop everything.

## Worked examples

**Example A — workflow exists, structured inputs**

> **User:** "run gen-spec on research/docs/2026-04-11-auth.md"

1. Run `atomic workflow list`. Output includes `gen-spec` under local. Good.
2. Target resolved exactly: `gen-spec`.
3. Run `atomic workflow inputs gen-spec -a claude`. Parse the JSON:
   `research_doc` (required string — already given), `focus` (required enum
   of `minimal|standard|exhaustive`, default `standard`), `notes`
   (optional text).
4. Ask via AskUserQuestion once: "What focus level for the spec?" with
   choices `minimal`, `standard`, `exhaustive`. User picks `standard`. Skip
   `notes` since it's optional.
5. Run: `atomic workflow -n gen-spec --research_doc=research/docs/2026-04-11-auth.md --focus=standard`
6. The CLI prints a session name like `atomic-wf-claude-gen-spec-a1b2c3d4`.
   Tell the user: "Started in the background. Attach with
   `atomic workflow session connect atomic-wf-claude-gen-spec-a1b2c3d4`,
   check progress with `atomic workflow status atomic-wf-claude-gen-spec-a1b2c3d4`,
   or stop it with `atomic session kill atomic-wf-claude-gen-spec-a1b2c3d4 -y`."

**Example B — workflow does not exist**

> **User:** "run the security-audit workflow on src/auth"

1. Run `atomic workflow list`. Available: `ralph`, `deep-research-codebase`,
   `gen-spec`, `review-to-merge`. No `security-audit`.
2. Tell the user: "I don't see a `security-audit` workflow. Available:
   ralph, deep-research-codebase, gen-spec, review-to-merge."
3. Ask via AskUserQuestion: "Want me to create a `security-audit` workflow
   first?" with choices `Yes, create it`, `No, use one of the existing
   workflows`, `No, cancel`.
4. If **Yes**: switch to SKILL.md's Authoring Process — interview the user
   for what the workflow should do, draft it, typecheck, *then* return here
   and invoke it.
5. If **No, use existing**: ask which one via AskUserQuestion over the
   listed options, then continue from step 3 of the recipe.
6. If **Cancel**: stop, no command runs.

## Common mistakes to avoid

- **Skipping `atomic workflow list`** — leads to guessing and
  `workflow not found` errors. It's a one-line command; always run it.
- **Inventing a workflow name** — if it's not in the list, it doesn't exist.
  Say so and offer to author it.
- **Reading the workflow source file to discover inputs** — use
  `atomic workflow inputs <name> -a <agent>` instead. JSON, no TS parsing
  required, always in sync with the runtime. Source-file reads are a
  fallback, not a default.
- **Asking everything at once** — let AskUserQuestion drive one question per
  field. Enum fields are multiple-choice, not free text.
- **Re-asking what the user already said** — read their message first.
- **Forgetting to report the session name** — the user needs it to reattach
  and to query status later.
- **Leaving `needs_review` unreported** — when `atomic workflow status`
  returns `needs_review`, surface it to the user right away. The workflow is
  blocked on human input and will sit forever otherwise.
- **Calling `session kill` without `-y`** — the prompt hangs in a
  non-interactive context. Always pass `-y` from an agent.
