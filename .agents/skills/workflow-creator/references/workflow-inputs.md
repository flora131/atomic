# Workflow Inputs

Workflows collect structured data from the user at invocation time through
a single uniform API: `ctx.inputs` (and `s.inputs` inside stage
callbacks). This reference covers how the inputs pipe works, how to
declare input schemas, and how values reach the workflow from the CLI
and the interactive picker.

## The inputs pipe

Every workflow run receives a typed inputs object. When the workflow
declares an `inputs` schema, only the declared field names are valid
keys — accessing undeclared fields is a compile-time error. The
runtime populates it from whichever invocation surface the user chose:

| Surface | How values are supplied | How they land in `ctx.inputs` |
|---|---|---|
| **Named run, positional** — `atomic workflow -n hello -a claude "fix the bug"` | A single positional prompt string (the workflow must declare a `prompt` input) | `{ prompt: "fix the bug" }` |
| **Named run, structured** — `atomic workflow -n gen-spec -a claude --research_doc=notes.md --focus=standard` | One `--<field>=<value>` flag per declared input | `{ research_doc: "notes.md", focus: "standard" }` |
| **Interactive picker** — `atomic workflow -a claude` | The user fills in a form rendered from the declared schema | Whatever the user typed, keyed by field name |

Workflow code is the same either way — it always reads
`ctx.inputs.<name>`. The invocation surface is a CLI concern, not a
workflow concern.

## Reading inputs

Workflows that accept a user prompt should declare it explicitly as an
input. Destructure it once at the top of `.run()` so every stage can
close over a bare string:

```ts
defineWorkflow({
    name: "answer",
    description: "Single-turn answer",
    inputs: [
      { name: "prompt", type: "text", required: true, description: "question to answer" },
    ],
  })
  .for<"claude">()
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";

    await ctx.stage({ name: "answer" }, {}, {}, async (s) => {
      await s.session.query(prompt);
      s.save(s.sessionId);
    });
  })
  .compile();
```

For structured workflows, read each declared field by name. Pull them
out of `ctx.inputs` once for readability and so downstream stages can
close over locals:

```ts
defineWorkflow({
    name: "gen-spec",
    description: "Convert a research doc into a detailed execution spec",
    inputs: [
      { name: "research_doc", type: "string", required: true },
      {
        name: "focus",
        type: "enum",
        required: true,
        values: ["minimal", "standard", "exhaustive"],
        default: "standard",
      },
      { name: "notes", type: "text" },
    ],
  })
  .for<"claude">()
  .run(async (ctx) => {
    const { research_doc, focus } = ctx.inputs;
    const notes = ctx.inputs.notes ?? "";

    await ctx.stage({ name: "write-spec" }, {}, {}, async (s) => {
      await s.session.query(
        `Read ${research_doc} and produce a ${focus} spec.` +
          (notes ? `\n\nExtra guidance:\n${notes}` : ""),
      );
      s.save(s.sessionId);
    });
  })
  .compile();
```

The nullish coalescing on `notes` handles the optional field case —
declared-but-unset inputs resolve to `undefined` unless they have a
`default`.

## Declaring an input schema

Pass an `inputs` array to `defineWorkflow({ ... })`. Each entry is a
`WorkflowInput`:

```ts
interface WorkflowInput {
  /** Field name — becomes the CLI flag (`--<name>`) and form label. */
  name: string;
  /** Input kind: string | text | enum */
  type: "string" | "text" | "enum";
  /** Whether the field must be non-empty before the workflow can run. */
  required?: boolean;
  /** Short description shown as the field caption. */
  description?: string;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** Default value — enums use this to pick their initial value. */
  default?: string;
  /** Allowed values — required when `type` is `"enum"`. */
  values?: readonly string[];
}
```

### Picking a field type

| Type | Use when | Picker renders as | Example |
|---|---|---|---|
| `string` | Short single-line values — identifiers, file paths, branch names | Single-row text input | `research_doc: "notes.md"` |
| `text` | Longer free-form prose — specs, prompts, extra context | Multi-row text area | `spec: "Build a..."` |
| `enum` | A fixed set of allowed values | Radio-button row | `focus: "standard" \| "minimal" \| "exhaustive"` |

Rule of thumb: use `enum` whenever there's a closed set of options — it
gives users discoverable choices instead of making them remember magic
strings, and the CLI will reject invalid values at parse time.

### Validation enforced by the runtime

The `defineWorkflow` builder validates the schema at compile time and
rejects authoring mistakes immediately — you won't discover them in
production:

- **Input names must be valid CLI flag tails** — start with a letter,
  then letters/digits/underscores/dashes. `1bad` is rejected because
  `--1bad` isn't a parseable flag.
- **Enum inputs must declare `values`** — an enum with no choices is
  always invalid.
- **Enum `default` must be in `values`** — prevents drift between the
  default and the allowed set.
- **No duplicate names** — two inputs with the same `name` shadow each
  other and are rejected.

At invocation time, the CLI does a second pass to catch runtime errors
before spinning up any tmux session:

- **Required fields must be non-empty** (whitespace-only strings are
  treated as empty). Missing required fields produce a clear
  `Missing required input --<name>` error and exit non-zero.
- **Enum values must be in the allowed list.** `--focus=bogus` produces
  `Invalid value for --focus: "bogus". Expected one of: minimal, standard, exhaustive.`
- **Unknown flags are rejected.** A `--random_flag=value` that isn't in
  the schema produces `Unknown input --random_flag` with the valid
  flag list appended.

This validation runs before any workflow code, so a malformed
invocation can never reach your `.run()` callback in a half-filled
state.

## Declaring a prompt input

Workflows that accept a user prompt should declare it explicitly in their
`inputs` array rather than relying on an implicit key:

```ts
inputs: [
  { name: "prompt", type: "text", required: true, description: "task to perform" },
]
```

This gives the same CLI ergonomics — `atomic workflow -n hello -a claude "fix the bug"` still works — while providing compile-time safety. Accessing `ctx.inputs.prompt` without declaring it is a type error.

For workflows that need both a free-form prompt AND structured parameters,
declare all fields in the schema:

```ts
inputs: [
  { name: "prompt", type: "text", required: true, description: "what to build" },
  { name: "focus", type: "enum", required: true, values: ["minimal", "standard", "exhaustive"], default: "standard" },
  { name: "notes", type: "text", description: "extra context" },
]
```

## The interactive picker

`atomic workflow -a <agent>` (no `-n`) launches the interactive
picker. The picker:

1. Discovers all workflows compatible with `<agent>` across local,
   global, and builtin sources.
2. Loads each workflow's metadata (description + declared inputs).
3. Shows a Telescope-style fuzzy list. The user types to filter,
   arrows to navigate, ↵ to lock in a selection.
4. Renders the selected workflow's form. The picker renders one field
   per declared input with type-specific rendering.
5. Validates required fields on ⌃s. If any are empty, focus jumps to
   the first invalid field and the run button stays disabled.
6. Confirms with a y/n modal, then tears down the picker and hands
   off to the workflow executor — same live-run surface users see
   when they invoke the workflow with `-n` directly.

The picker is the preferred discovery path for users who don't
remember flag names. Structured workflows benefit the most from it
because the form teaches the schema as the user fills it in.

## Builtin protection

Builtin workflows (the ones shipped inside the SDK — currently `ralph`
and `deep-research-codebase`) are **reserved**. A local or global
workflow with the same name will not shadow the builtin at resolution
time — the runtime drops user-defined workflows with reserved names
before any precedence merge. This prevents a user from accidentally
redefining the canonical version of a workflow in a way that confuses
teammates or breaks automation.

You'll still see shadowed local/global workflows in
`atomic workflow list` output so the collision is visible, but running
`atomic workflow -n ralph -a claude` will always land on the builtin.

The practical implication: **don't name a new workflow `ralph` or
`deep-research-codebase`**. Pick a distinct name and you'll never hit
this.

## Invocation cheat sheet

```bash
# List everything, grouped by source
atomic workflow list

# Launch the picker for a pinned agent
atomic workflow -a claude

# Free-form, positional prompt
atomic workflow -n hello -a claude "hello world"

# Structured, one flag per field
atomic workflow -n gen-spec -a claude \
  --research_doc=research/docs/2026-04-11-auth.md \
  --focus=standard \
  --notes="pay special attention to session token storage"

# Structured, long-form flag value (= form)
atomic workflow -n gen-spec -a claude --focus standard --research_doc notes.md

# Detached (background) — starts the orchestrator on the atomic tmux
# socket and returns immediately. The command prints the session name
# and hints for attaching later. Use this for scripted / CI runs where
# the caller shouldn't block on the TUI.
atomic workflow -n hello -a claude -d "hello world"
atomic workflow session connect atomic-wf-claude-hello-<id>   # attach later
```

Both `--flag=value` and `--flag value` forms are accepted. Short flags
(`-x value`) are NOT parsed as structured inputs — only long-form
`--<name>` flags resolve against the schema.

The `-d` / `--detach` flag composes with any named shape (positional
prompt, structured flags) and is independent of the inputs schema.

## Pitfalls

### Declare every field you access

With typed inputs, accessing `ctx.inputs.foo` when `foo` is not declared
in the workflow's `inputs` array is a compile-time error. If your workflow
needs a prompt field, declare it:

```ts
inputs: [
  { name: "prompt", type: "text", required: true, description: "task prompt" },
]
```

The CLI rejects positional prompt strings for workflows that don't declare
a `prompt` input.

### Don't rename inputs across workflow versions

Declared input names are part of the workflow's public API — they map
directly to `--<name>` flags and field identifiers in the picker.
Renaming a field is a breaking change for any script that invokes the
workflow. If you need to rename, add the new name alongside the old,
migrate callers, then remove the old name in a later change.

### Don't put secrets in `default`

Defaults are visible in the picker and printed in CLI errors. They're
fine for values like `"standard"` but not for API keys or auth tokens.
Read those from environment variables inside the workflow instead.
