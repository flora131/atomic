# State and Data Flow

Data flows between sessions via `s.save()` (in the producing session) and `transcript()` / `getMessages()` (in consuming sessions or at the `.run()` level). Within a session, use plain TypeScript variables. This is the programmatic equivalent of `globalState` and reducers.

> **Note:** All Claude examples below assume `createClaudeSession({ paneId: s.paneId })` is called at the start of each session callback before any `claudeQuery()` calls.

## Between sessions: `s.save()` → `transcript()` / `getMessages()`

**Completion rule:** `transcript()` and `getMessages()` can only access data from sessions whose callbacks have already returned (i.e., sessions in the `completedRegistry`). In a `Promise.all()` group, sibling sessions cannot read each other's output — only sessions that completed before the group started are available.

### Saving output

Each SDK has its own save pattern:

```ts
// Claude — pass session ID (auto-reads transcript)
s.save(s.sessionId);

// Copilot — pass SessionEvent[] from getMessages()
s.save(await session.getMessages());

// OpenCode — pass response { info, parts } from session.prompt()
s.save(result.data!);
```

### Retrieving as rendered text

`s.transcript(handle)` returns `{ path: string, content: string }`:
- `path` — absolute file path to the transcript on disk
- `content` — extracted assistant text, ready to embed in prompts

Pass the session handle returned by a prior `ctx.session()` call (handle-based, recommended). The string name `s.transcript("name")` also works when no handle is in scope.

```ts
.run(async (ctx) => {
  const researchHandle = await ctx.session({ name: "research" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    await claudeQuery({ paneId: s.paneId, prompt: "Research the topic." });
    s.save(s.sessionId);
  });

  await ctx.session({ name: "synthesize" }, async (s) => {
    const research = await s.transcript(researchHandle);
    await createClaudeSession({ paneId: s.paneId });

    // Use rendered text in a prompt
    await claudeQuery({
      paneId: s.paneId,
      prompt: `Synthesize this research:\n${research.content}`,
    });

    // Or reference the file path (useful for Claude file triggers)
    await claudeQuery({
      paneId: s.paneId,
      prompt: `Read ${research.path} and summarize the key findings.`,
    });

    s.save(s.sessionId);
  });
})
```

### Retrieving as raw messages

`s.getMessages(handle)` returns `SavedMessage[]` — the native SDK messages exactly as stored:

```ts
.run(async (ctx) => {
  const researchHandle = await ctx.session({ name: "research" }, async (s) => {
    // ... research work ...
    s.save(s.sessionId);
  });

  await ctx.session({ name: "analyze-results" }, async (s) => {
    const messages = await s.getMessages(researchHandle);

    // messages is SavedMessage[], where each entry is:
    //   { provider: "copilot", data: SessionEvent }
    //   { provider: "opencode", data: SessionPromptResponse }
    //   { provider: "claude", data: SessionMessage }

    // Process raw messages for detailed analysis
    for (const msg of messages) {
      if (msg.provider === "copilot") {
        // Access Copilot-specific fields
        const event = msg.data;
      }
    }
  });
})
```

### Returning values from session callbacks

Session callbacks can return a value directly. The handle exposes it via `.result`:

```ts
.run(async (ctx) => {
  const planHandle = await ctx.session({ name: "plan" }, async (s) => {
    // ... planning work ...
    return { taskCount: 5, priority: "high" };
  });

  // Access the returned value on the handle
  console.log(planHandle.result.taskCount); // 5
})
```

## Within a session: TypeScript variables

Use closures and variables for state within a single session:

```ts
.run(async (ctx) => {
  await ctx.session({ name: "review-fix" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    // Local state — plain variables
    let consecutiveClean = 0;
    let priorOutput = "";
    const findings: string[] = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      const result = await claudeQuery({
        paneId: s.paneId,
        prompt: buildReviewPrompt(ctx.userPrompt, priorOutput),
      });

      // Accumulate findings
      const review = parseReviewResult(result.output);
      if (review) {
        findings.push(...review.findings.map(f => f.title));
      }

      // Track clean streak
      if (!hasActionableFindings(review, result.output)) {
        consecutiveClean++;
        if (consecutiveClean >= 2) break;
        continue;
      }
      consecutiveClean = 0;

      // Apply fix
      const fixResult = await claudeQuery({
        paneId: s.paneId,
        prompt: buildFixSpec(review, ctx.userPrompt),
      });
      priorOutput = fixResult.output;
    }

    // All local state is available here
    console.log(`Total findings across cycles: ${findings.length}`);
    s.save(s.sessionId);
  });
})
```

## File-based persistence

For data that needs to survive session restarts or be accessible outside the workflow, use file I/O:

```ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

.run(async (ctx) => {
  await ctx.session({ name: "plan" }, async (s) => {
    // ... plan session ...
  });

  await ctx.session({ name: "generate-report" }, async (s) => {
    // Write artifacts to session directory
    const artifactDir = join(s.sessionDir, "artifacts");
    await mkdir(artifactDir, { recursive: true });

    const report = { timestamp: Date.now(), status: "complete" };
    await writeFile(
      join(artifactDir, "report.json"),
      JSON.stringify(report, null, 2),
    );

    // Read artifacts from a prior session
    const priorReport = JSON.parse(
      await readFile(join(s.sessionDir, "..", "plan", "artifacts", "report.json"), "utf-8"),
    );
  });
})
```

## Shared helper functions

Extract SDK-agnostic logic into shared helpers. This is the key pattern for building workflows that work across all three SDKs:

```
.atomic/workflows/
└── my-workflow/
    ├── claude/index.ts             # Claude SDK code
    ├── copilot/index.ts            # Copilot SDK code
    ├── opencode/index.ts           # OpenCode SDK code
    └── helpers/
        ├── prompts.ts              # Prompt builders
        ├── parsers.ts              # Response parsers
        └── validation.ts           # Validation logic
```

### Prompt builders

```ts
// .atomic/workflows/my-workflow/helpers/prompts.ts
export function buildPlanPrompt(spec: string): string {
  return `Decompose into tasks:\n${spec}`;
}

export function buildReviewPrompt(spec: string, priorOutput?: string): string {
  let prompt = `Review the implementation against:\n${spec}`;
  if (priorOutput) {
    prompt += `\n\nPrior fixes:\n${priorOutput}`;
  }
  return prompt;
}
```

### Response parsers

```ts
// .atomic/workflows/my-workflow/helpers/parsers.ts
export interface ReviewResult {
  findings: Array<{ title: string; body: string; priority: number }>;
  overall_correctness: string;
}

export function parseReviewResult(text: string): ReviewResult | null {
  try {
    const match = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (match?.[1]) return JSON.parse(match[1]);
    return JSON.parse(text);
  } catch {
    return null;
  }
}
```

### Usage in workflows

```ts
// .atomic/workflows/my-workflow/claude/index.ts
import { buildPlanPrompt, buildReviewPrompt } from "../helpers/prompts.ts";
import { parseReviewResult } from "../helpers/parsers.ts";

// ... use in run() callbacks
```

## Data flow patterns

### Linear pipeline

```
Session A → s.save() → Session B reads via s.transcript(handleA)
                       → s.save() → Session C reads via s.transcript(handleB)
```

### Fan-in (multiple prior sessions)

```ts
.run(async (ctx) => {
  const researchHandle = await ctx.session({ name: "research" }, async (s) => {
    // ... research work ...
    s.save(s.sessionId);
  });
  const analysisHandle = await ctx.session({ name: "analysis" }, async (s) => {
    // ... analysis work ...
    s.save(s.sessionId);
  });
  const feedbackHandle = await ctx.session({ name: "feedback" }, async (s) => {
    // ... feedback work ...
    s.save(s.sessionId);
  });

  await ctx.session({ name: "merge" }, async (s) => {
    const research = await s.transcript(researchHandle);
    const analysis = await s.transcript(analysisHandle);
    const userFeedback = await s.transcript(feedbackHandle);
    await createClaudeSession({ paneId: s.paneId });

    await claudeQuery({
      paneId: s.paneId,
      prompt: `Combine these inputs:
Research: ${research.content}
Analysis: ${analysis.content}
Feedback: ${userFeedback.content}`,
    });
    s.save(s.sessionId);
  });
})
```

### Accumulating state across sessions

Each session can read all prior completed steps (but not parallel siblings):

```ts
.run(async (ctx) => {
  const h1 = await ctx.session({ name: "session-1" }, async (s) => {
    // ...
    s.save(s.sessionId);
  });
  const h2 = await ctx.session({ name: "session-2" }, async (s) => {
    // ...
    s.save(s.sessionId);
  });

  await ctx.session({ name: "session-3" }, async (s) => {
    // Read from any prior completed session via its handle
    const s1 = await s.transcript(h1);
    const s2 = await s.transcript(h2);

    // Combine and process
    const combined = `${s1.content}\n${s2.content}`;
    // ...
  });
})
```
