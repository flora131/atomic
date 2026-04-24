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
runtime populates it from whichever invocation surface the user chose.

### Input precedence (highest → lowest)

CLI flags always win. Under them, the order depends on the composition shape:

- **Single-workflow worker** (`createWorker(def)`):
  ```
  CLI flags > worker.run({ inputs }) / worker.start(inputs) > defineWorkflow defaults
  ```
- **Multi-workflow dispatcher** (`createDispatcher(registry, { inputs })`):
  ```
  CLI flags > dispatcher.run(name, agent, { inputs }) > createDispatcher({ inputs }) > defineWorkflow defaults
  ```

`defineWorkflow` field `default` is always the final fallback if no
higher-precedence value supplies one.

### Invocation surfaces

| Surface | How values are supplied | How they land in `ctx.inputs` |
|---|---|---|
| **Single-worker, positional** — `bun run src/claude-worker.ts "fix the bug"` | Trailing prompt tokens (workflow has no declared schema — free-form only) | `{ prompt: "fix the bug" }` |
| **Single-worker, structured** — `bun run src/claude-worker.ts --research_doc=notes.md --focus=standard` | One `--<field>=<value>` flag per declared input | `{ research_doc: "notes.md", focus: "standard" }` |
| **Dispatcher, named** — `bun run src/dispatcher.ts -n gen-spec -a claude --research_doc=notes.md` | `-n` picks the workflow, `-a` picks the agent, flags per declared input | Same as above |
| **Interactive picker** — `atomic workflow -a claude` (dispatcher only) | User fills in a form rendered from the declared schema | Whatever the user typed, keyed by field name |
| **Programmatic (single)** — `worker.run({ inputs })` | Typed `InputsOf<def["inputs"]>` | Merged under CLI flags; above `defineWorkflow` defaults |
| **Programmatic (dispatcher)** — `dispatcher.run(name, agent, { inputs })` | Plain `Record<string, string>` | Merged under CLI flags; above `createDispatcher` defaults |

Workflow code is the same either way — it always reads
`ctx.inputs.<name>`. The invocation surface is a CLI concern, not a
workflow concern.

### Auto-registered CLI flags

- **`createWorker(def)`** registers a `--<name>` CLI flag for every input
  declared on the single bound workflow. No union, no conflicts.
- **`createDispatcher(registry)`** inspects the registry at construction
  time and registers a `--<name>` flag for every input declared across
  *all* workflows (the union). See §"CLI flag union and conflict rules"
  below for the full collision contract and reserved-name list.

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
  .for("claude")
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
  .for("claude")
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

**Style convention.** Inside a stage callback, both `s.inputs.<name>` and
`ctx.inputs.<name>` resolve to the same value. Either of these patterns
works:

- **Destructure once at the top of `.run()`** so each stage closes over a
  bare local. Best when many stages reference the same input.
- **Inline access** with `(s.inputs.<name> ?? "")` at each call site. Best
  for short workflows or when each stage uses a different field.

Pick whichever reads cleaner for your workflow. Examples in other reference
files use the inline form for brevity in focused snippets.

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

## CLI flag union and conflict rules

`createDispatcher(registry)` builds the union of all declared inputs across
every workflow in the registry at construction time. Each distinct input name
becomes one `--<name>` CLI flag shared by all workflows that declare it.

### Same name, different type → throws at `createDispatcher` time

If two registered workflows declare the same input name with **different
types**, `createWorker` throws immediately (fail fast at composition root):

```
[atomic/worker] Input name conflict: "focus" is declared as "enum" in
"claude/gen-spec" but as "string" in "copilot/gen-spec".
Workflows sharing an input name must agree on the type.
```

Same name + same type: the flag is shared silently — one `--focus` covers
both workflows. This is the intended pattern for cross-agent workflow
variants.

### Reserved flag names

The following input names are rejected by `defineWorkflow` because they
collide with the worker's own CLI flags:

```
name, agent, detach, list, help, version
```

Declaring an input with any of these names throws at `defineWorkflow` time
(before the workflow can be registered into any registry):

```
[atomic] Input name "name" is reserved by the worker CLI.
Rename it. Reserved names: name, agent, detach, list, help, version.
```

This is enforced in `defineWorkflow`, not in `createWorker`, so the error
surfaces at workflow authoring time — it cannot be registered.

## The interactive picker

`atomic workflow -a <agent>` (no `-n`) launches the interactive
picker (TTY only — non-interactive contexts skip straight to `--help`).
The picker is a `WorkflowPickerPanel` component that takes a `Registry`
prop. It:

1. Calls `registry.list()` and filters to workflows whose `agent` field
   matches `<agent>`. No source labels — registry entries are just
   workflows someone registered; where they came from is irrelevant.
2. Shows a Telescope-style fuzzy list. The user types to filter,
   arrows (or ⌃j/⌃k) to navigate, ↵ to lock in a selection.
3. Renders the selected workflow's form. One field per declared input,
   type-specific rendering (`string` → single-row input, `text` →
   multi-row textarea, `enum` → radio row). Free-form workflows
   (no declared inputs) fall back to a single `prompt` text field.
4. Validates required fields on ⌃d. If any are empty, focus jumps to
   the first invalid field.
5. Confirms with a y/n modal, then tears down the picker and hands
   off to the workflow executor — same live-run surface users see
   when they invoke the workflow with `-n` directly.

The picker is the preferred discovery path for users who don't
remember flag names. Structured workflows benefit the most from it
because the form teaches the schema as the user fills it in.

User apps can mount the same picker against their own registry by
wiring `worker.start()` — if `-n` is omitted and `process.stdout.isTTY`
is true, the worker automatically launches the picker over the
user-supplied registry.

## Duplicate registration

Registering the same `${agent}/${name}` key twice throws at composition-root
time (before any workflow runs):

```
[atomic] Duplicate workflow registration: "claude/my-workflow" is already registered.
```

There is no silent shadowing. Pick distinct `(agent, name)` pairs across all
workflows in the registry. For the full key-scheme and validate-on-register
contract see `registry-and-validation.md`.

## Invocation details

See SKILL.md §"Invocation surfaces" for the full table. This section covers
flag-parsing nuances specific to structured inputs.

Both `--flag=value` and `--flag value` forms are accepted. Short flags
(`-x value`) are NOT parsed as structured inputs — only long-form
`--<name>` flags resolve against the schema.

The `-d` / `--detach` flag composes with any named shape (positional
prompt, structured flags) and is independent of the inputs schema.

```bash
# User's own app
bun run src/dispatcher.ts -n gen-spec -a claude --focus=standard --research_doc=notes.md
bun run src/dispatcher.ts -n gen-spec -a claude --focus standard --research_doc notes.md

# Atomic builtins (same flag semantics)
atomic workflow -n gen-spec -a claude --focus=standard --research_doc=notes.md
```

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
