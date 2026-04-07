# Computation and Validation

Deterministic computation — validation, data transforms, file I/O, API calls — is written as plain TypeScript inside `run()`. No LLM session is needed. This is the programmatic equivalent of a `.tool()` node.

## Inline computation

Any TypeScript code inside `run()` that doesn't call an SDK prompt function is deterministic computation:

```ts
.session({
  name: "validate-and-fix",
  description: "Validate, then fix if needed",
  run: async (ctx) => {
    // Step 1: Deterministic — parse prior session's output
    const messages = await ctx.getMessages("planner");
    const planText = extractText(messages);
    const plan = JSON.parse(planText);

    // Step 2: Deterministic — validate the plan
    const isValid = plan.tasks?.length > 0 && plan.tasks.every((t: any) => t.id && t.description);

    if (!isValid) {
      // Step 3: Agent session — ask the agent to fix the plan
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: "The plan is invalid. Please create a valid plan with tasks.",
      });
    } else {
      // Step 4: Agent session — execute the valid plan
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Execute this plan:\n${JSON.stringify(plan.tasks)}`,
      });
    }

    ctx.save(ctx.sessionId);
  },
})
```

## Parsing SDK responses

Each SDK returns responses in different formats. Use helpers to extract text:

### Claude

`claudeQuery()` returns `{ output: string }` — the captured pane text.

```ts
const result = await claudeQuery({ paneId: ctx.paneId, prompt: "..." });
const text = result.output; // Already a string
```

### Copilot

`session.getMessages()` returns `SessionEvent[]`. Filter for assistant messages:

```ts
import type { SessionEvent } from "@github/copilot-sdk";

function getLastAssistantText(messages: SessionEvent[]): string {
  const assistantMessages = messages.filter(
    (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
      m.type === "assistant.message",
  );
  return assistantMessages.at(-1)?.data.content ?? "";
}

// Usage:
const messages = await session.getMessages();
const text = getLastAssistantText(messages);
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

run: async (ctx) => {
  // Write to session directory
  const outputDir = join(ctx.sessionDir, "artifacts");
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "report.json"), JSON.stringify(data));

  // Read from project
  const config = await readFile("./tsconfig.json", "utf-8");
},
```

## API calls

Make HTTP requests for external integrations:

```ts
run: async (ctx) => {
  const response = await fetch("https://api.example.com/data");
  const data = await response.json();

  // Use the data in a prompt
  await claudeQuery({
    paneId: ctx.paneId,
    prompt: `Process this data:\n${JSON.stringify(data)}`,
  });
  ctx.save(ctx.sessionId);
},
```

## Data transforms

Transform data between sessions:

```ts
run: async (ctx) => {
  const raw = await ctx.getMessages("planner");

  // Transform: extract only task IDs and descriptions
  const tasks = extractTasks(raw).map(t => ({
    id: t.id,
    description: t.description,
    priority: calculatePriority(t),
  }));

  // Sort by priority
  tasks.sort((a, b) => b.priority - a.priority);

  // Pass to agent
  await claudeQuery({
    paneId: ctx.paneId,
    prompt: `Execute these tasks in order:\n${JSON.stringify(tasks)}`,
  });
  ctx.save(ctx.sessionId);
},
```
