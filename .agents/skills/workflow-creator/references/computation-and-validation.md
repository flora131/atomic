# Computation and Validation

Deterministic computation — validation, data transforms, file I/O, API calls — is written as plain TypeScript inside `.run()` or session callbacks. No LLM session is needed. This is the programmatic equivalent of a `.tool()` node.

## Inline computation

Any TypeScript code inside a session callback that doesn't call an SDK prompt function is deterministic computation:

```ts
await ctx.stage({ name: "validate-and-fix", description: "Validate, then fix if needed" }, {}, {}, async (s) => {
  // Step 1: Deterministic — parse prior session's output
  const messages = await s.getMessages("planner");
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

`s.session.query()` returns `{ output: string, delivered: boolean }` — the captured response text.

```ts
const result = await s.session.query("...");
const text = result.output; // Already a string
```

### Copilot

`s.session.getMessages()` returns `SessionEvent[]`. Concatenate every
top-level assistant turn's non-empty content — picking only `.at(-1)` is a
silent-failure trap. See `failure-modes.md` §F1 / §F2 for the full
explanation.

```ts
import type { SessionEvent } from "@github/copilot-sdk";

/** Concatenate every top-level assistant turn's non-empty content. */
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

// Usage:
const messages = await s.session.getMessages();
const text = getAssistantText(messages);
```

### OpenCode

`session.prompt()` returns `{ data: { info, parts } }`. Extract text parts:

```ts
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

// Usage:
const text = extractResponseText(result.data!.parts);
```

## Validation patterns

### JSON parsing with fallback

```ts
function parseJsonResponse(text: string): Record<string, unknown> | null {
  // Try direct parse
  try { return JSON.parse(text); } catch {}

  // Try extracting from markdown code fence
  const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (match?.[1]) {
    try { return JSON.parse(match[1]); } catch {}
  }

  // Try extracting JSON object from prose
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
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

    const scores = JSON.parse(
      result.output.match(/\`\`\`json\s*\n([\s\S]*?)\n\`\`\`/)?.[1] ?? result.output,
    );

    if (!scores.pass) {
      await s.session.query(`Fix these quality issues:\n${scores.issues.join("\n")}`);
    }

    s.save(s.sessionId);
  });
})
```
