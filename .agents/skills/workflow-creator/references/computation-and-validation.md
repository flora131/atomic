# Computation and Validation

Deterministic computation — validation, data transforms, file I/O, API calls — is written as plain TypeScript inside `.run()` or session callbacks. No LLM session is needed. This is the programmatic equivalent of a `.tool()` node.

## Inline computation

Any TypeScript code inside a session callback that doesn't call an SDK prompt function is deterministic computation. Prefer handle-based lookups (`s.getMessages(plannerHandle)`) over string names when a handle is in scope — it preserves type information and survives stage renames:

```ts
const plannerHandle = await ctx.stage({ name: "planner" }, {}, {}, async (s) => { /* ... */ });

await ctx.stage({ name: "validate-and-fix", description: "Validate, then fix if needed" }, {}, {}, async (s) => {
  // Step 1: Deterministic — parse prior session's output (handle-based lookup)
  const messages = await s.getMessages(plannerHandle);
  const planText = extractText(messages);
  const plan = JSON.parse(planText);

  // Step 2: Deterministic — validate the plan
  const isValid = plan.tasks?.length > 0 && plan.tasks.every((t: { id: string; description: string }) => t.id && t.description);

  if (!isValid) {
    // Step 3: Agent session — ask the agent to fix the plan
    await s.session.query("The plan is invalid. Please create a valid plan with tasks.");
  } else {
    // Step 4: Agent session — execute the valid plan
    await s.session.query(`Execute this plan:\n${JSON.stringify(plan.tasks)}`);
  }

  s.save(s.sessionId);
});
```

## Parsing SDK responses

Each SDK returns responses in different formats. Use helpers to extract text:

### Claude

`s.session.query()` returns `SessionMessage[]` — the native SDK transcript messages from this turn. Use `extractAssistantText()` to extract the plain text:

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

const result = await s.session.query("...");
const text = extractAssistantText(result, 0); // Extract text from SessionMessage[]
```

### Copilot

`s.session.getMessages()` returns `SessionEvent[]`. Concatenate every
top-level assistant turn's non-empty content — picking only `.at(-1)` is a
silent-failure trap (see `failure-modes.md` §F1 / §F2). Use the
`getAssistantText` helper defined in `failure-modes.md` §F1:

```ts
// Usage:
const messages = await s.session.getMessages();
const text = getAssistantText(messages);
```

### OpenCode

`session.prompt()` returns `{ data: { info, parts } }`. Filter for text
parts only — non-text parts produce `[object Object]` (see
`failure-modes.md` §F3). Use the `extractResponseText` helper defined
there:

```ts
// Usage:
const text = extractResponseText(result.data!.parts);
```

## Validation patterns

### JSON parsing with fallback

Use a layered fallback: direct parse, then the **last** fenced block (not
the first — see `failure-modes.md` §F4 / §F8 for why), then last balanced
object:

```ts
function parseJsonResponse(text: string): Record<string, unknown> | null {
  // 1. Direct parse
  try { return JSON.parse(text); } catch {}

  // 2. LAST fenced code block (prose often quotes examples before the real output)
  const blockRe = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let lastBlock: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    if (m[1]) lastBlock = m[1];
  }
  if (lastBlock) {
    try { return JSON.parse(lastBlock); } catch {}
  }

  // 3. Last balanced JSON object
  const objRe = /\{[\s\S]*\}/g;
  let lastObj: string | null = null;
  while ((m = objRe.exec(text)) !== null) {
    if (m[0]) lastObj = m[0];
  }
  if (lastObj) {
    try { return JSON.parse(lastObj); } catch {}
  }

  return null;
}
```

### Zod validation

Import Zod directly in your workflow file for runtime validation:

```ts
import { z } from "zod";

const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "error"]),
  blockedBy: z.array(z.string()).optional(),
});

// In run():
const parsed = parseJsonResponse(responseText);
const result = TaskSchema.array().safeParse(parsed?.tasks);
if (!result.success) {
  console.error("Validation failed:", result.error.issues);
}
```

## File I/O

Read and write files directly in `run()`:

```ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

// Inside a ctx.stage() callback:
async (s) => {
  // Write to session directory
  const outputDir = join(s.sessionDir, "artifacts");
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "report.json"), JSON.stringify(data));

  // Read from project
  const config = await readFile("./tsconfig.json", "utf-8");
},
```

## API calls

Make HTTP requests for external integrations:

```ts
// Inside a ctx.stage() callback:
async (s) => {
  const response = await fetch("https://api.example.com/data");
  const data = await response.json();

  // Use the data in a prompt
  await s.session.query(`Process this data:\n${JSON.stringify(data)}`);
  s.save(s.sessionId);
},
```

## Data transforms

Transform data between sessions:

```ts
// Inside a ctx.stage() callback:
async (s) => {
  const raw = await s.getMessages("planner");

  // Transform: extract only task IDs and descriptions
  const tasks = extractTasks(raw).map(t => ({
    id: t.id,
    description: t.description,
    priority: calculatePriority(t),
  }));

  // Sort by priority
  tasks.sort((a, b) => b.priority - a.priority);

  // Pass to agent
  await s.session.query(`Execute these tasks in order:\n${JSON.stringify(tasks)}`);
  s.save(s.sessionId);
},
```

## Quality Gate with LLM-as-Judge

Add automated quality checkpoints using evaluation rubrics. This pattern applies `evaluation` + `advanced-evaluation`:

```ts
.run(async (ctx) => {
  const impl = await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
    await s.session.query((s.inputs.prompt ?? ""));
    s.save(s.sessionId);
  });

  await ctx.stage({ name: "quality-gate" }, {}, {}, async (s) => {
    const implTranscript = await s.transcript(impl);
    const result = await s.session.query(
      `You are a code quality judge. Score this implementation 1-5 for:
- **Correctness**: Does it solve the stated problem?
- **Completeness**: Are edge cases handled?
- **Style**: Does it follow project conventions?

## Implementation to judge
${implTranscript.content}

Respond with JSON: { "correctness": N, "completeness": N, "style": N, "pass": boolean, "issues": [...] }`,
    );

    const scores = parseJsonResponse(extractAssistantText(result, 0));

    if (!scores.pass) {
      await s.session.query(`Fix these quality issues:\n${scores.issues.join("\n")}`);
    }

    s.save(s.sessionId);
  });
})
```
