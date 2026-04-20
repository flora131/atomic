# State and Data Flow

Data flows between sessions via `s.save()` (in the producing session) and `transcript()` / `getMessages()` (in consuming sessions or at the `.run()` level). Within a session, use plain TypeScript variables. This is the programmatic equivalent of `globalState` and reducers.

## Between sessions: `s.save()` → `transcript()` / `getMessages()`

**Completion rule:** `transcript()` and `getMessages()` can only access data from sessions whose callbacks have already returned (i.e., sessions in the `completedRegistry`). In a `Promise.all()` group, sibling sessions cannot read each other's output — only sessions that completed before the group started are available.

### Saving output

Each SDK has its own save pattern:

```ts
// Claude — pass session ID (auto-reads transcript)
s.save(s.sessionId);

// Copilot — pass SessionEvent[] from getMessages()
s.save(await s.session.getMessages());

// OpenCode — pass response { info, parts } from session.prompt()
s.save(result.data!);
```

### Retrieving as rendered text

`s.transcript(handle)` returns `{ path: string, content: string }`:
- `path` — absolute file path to the transcript on disk
- `content` — extracted assistant text, ready to embed in prompts

Pass the session handle returned by a prior `ctx.stage()` call (handle-based, recommended). The string name `s.transcript("name")` also works when no handle is in scope.

```ts
.run(async (ctx) => {
  const researchHandle = await ctx.stage({ name: "research" }, {}, {}, async (s) => {
    await s.session.query("Research the topic.");
    s.save(s.sessionId);
  });

  await ctx.stage({ name: "synthesize" }, {}, {}, async (s) => {
    const research = await s.transcript(researchHandle);

    // Use rendered text in a prompt
    await s.session.query(`Synthesize this research:\n${research.content}`);

    // Or reference the file path (useful for Claude file triggers)
    await s.session.query(`Read ${research.path} and summarize the key findings.`);

    s.save(s.sessionId);
  });
})
```

### Retrieving as raw messages

`s.getMessages(handle)` returns `SavedMessage[]` — the native SDK messages exactly as stored:

```ts
.run(async (ctx) => {
  const researchHandle = await ctx.stage({ name: "research" }, {}, {}, async (s) => {
    // ... research work ...
    s.save(s.sessionId);
  });

  await ctx.stage({ name: "analyze-results" }, {}, {}, async (s) => {
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
  const planHandle = await ctx.stage({ name: "plan" }, {}, {}, async (s) => {
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
  await ctx.stage({ name: "review-fix" }, {}, {}, async (s) => {
    // Local state — plain variables
    let consecutiveClean = 0;
    let priorOutput = "";
    const findings: string[] = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      const result = await s.session.query(
        buildReviewPrompt((s.inputs.prompt ?? ""), priorOutput),
      );

      // Accumulate findings
      const review = parseReviewResult(extractAssistantText(result, 0));
      if (review) {
        findings.push(...review.findings.map(f => f.title));
      }

      // Track clean streak
      if (!hasActionableFindings(review, extractAssistantText(result, 0))) {
        consecutiveClean++;
        if (consecutiveClean >= 2) break;
        continue;
      }
      consecutiveClean = 0;

      // Apply fix
      const fixResult = await s.session.query(buildFixSpec(review, (s.inputs.prompt ?? "")));
      priorOutput = extractAssistantText(fixResult, 0);
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
  const planHandle = await ctx.stage({ name: "plan" }, {}, {}, async (s) => {
    // Write artifacts to session directory
    const artifactDir = join(s.sessionDir, "artifacts");
    await mkdir(artifactDir, { recursive: true });

    const report = { timestamp: Date.now(), status: "complete" };
    await writeFile(
      join(artifactDir, "report.json"),
      JSON.stringify(report, null, 2),
    );

    s.save(s.sessionId);
  });

  await ctx.stage({ name: "generate-report" }, {}, {}, async (s) => {
    // Read prior session's output via transcript (preferred over path traversal)
    const planTranscript = await s.transcript(planHandle);

    // Or read artifacts using the transcript's path to locate the session directory
    const planSessionDir = join(planTranscript.path, "..");
    const priorReport = JSON.parse(
      await readFile(join(planSessionDir, "artifacts", "report.json"), "utf-8"),
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

For tolerant JSON parsing, see `failure-modes.md` §F8 — the canonical
`parseReviewResult` helper uses a layered fallback (direct parse → last
fenced block → last balanced object) that survives prose interleaving.
Copy that implementation into `helpers/parsers.ts` and import.

```ts
// .atomic/workflows/my-workflow/helpers/parsers.ts
export interface ReviewResult {
  findings: Array<{ title: string; body: string; priority: number }>;
  overall_correctness: string;
}

// See failure-modes.md §F8 for the full implementation.
export function parseReviewResult(text: string): ReviewResult | null {
  // ... three-layer fallback per §F8
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
  const researchHandle = await ctx.stage({ name: "research" }, {}, {}, async (s) => {
    // ... research work ...
    s.save(s.sessionId);
  });
  const analysisHandle = await ctx.stage({ name: "analysis" }, {}, {}, async (s) => {
    // ... analysis work ...
    s.save(s.sessionId);
  });
  const feedbackHandle = await ctx.stage({ name: "feedback" }, {}, {}, async (s) => {
    // ... feedback work ...
    s.save(s.sessionId);
  });

  await ctx.stage({ name: "merge" }, {}, {}, async (s) => {
    const research = await s.transcript(researchHandle);
    const analysis = await s.transcript(analysisHandle);
    const userFeedback = await s.transcript(feedbackHandle);

    await s.session.query(`Combine these inputs:
Research: ${research.content}
Analysis: ${analysis.content}
Feedback: ${userFeedback.content}`);
    s.save(s.sessionId);
  });
})
```

### Accumulating state across sessions

Each session can read all prior completed steps (but not parallel siblings):

```ts
.run(async (ctx) => {
  const h1 = await ctx.stage({ name: "session-1" }, {}, {}, async (s) => {
    // ...
    s.save(s.sessionId);
  });
  const h2 = await ctx.stage({ name: "session-2" }, {}, {}, async (s) => {
    // ...
    s.save(s.sessionId);
  });

  await ctx.stage({ name: "session-3" }, {}, {}, async (s) => {
    // Read from any prior completed session via its handle
    const s1 = await s.transcript(h1);
    const s2 = await s.transcript(h2);

    // Combine and process
    const combined = `${s1.content}\n${s2.content}`;
    // ...
  });
})
```

## Context-Aware Transcript Handoff

When passing transcripts between sessions, compress at the boundary to prevent downstream context degradation. Use structured summaries that preserve actionable information while dropping verbose tool output (applies `context-compression` + `context-degradation`):

```ts
// helpers/compression.ts
export function compressTranscript(content: string, maxTokenEstimate: number = 4000): string {
  // Rough estimate: ~4 chars/token for English prose, ~2-3 for code.
  // For precise budgeting, use the provider's tokenizer instead.
  const maxChars = maxTokenEstimate * 4;
  if (content.length <= maxChars) return content;

  // Preserve first and last sections (recency + primacy bias)
  const headSize = Math.floor(maxChars * 0.4);
  const tailSize = Math.floor(maxChars * 0.4);
  const head = content.slice(0, headSize);
  const tail = content.slice(-tailSize);

  return `${head}\n\n[... ${content.length - headSize - tailSize} chars compressed ...]\n\n${tail}`;
}
```

```ts
await ctx.stage({ name: "synthesize" }, {}, {}, async (s) => {
  const research = await s.transcript("research");
  // Compress before injecting into prompt to stay within token budget
  const compressed = compressTranscript(research.content, 4000);
  await s.session.query(`Synthesize this research:\n${compressed}`);
  s.save(s.sessionId);
});
```

## File-Based Coordination

Use the filesystem as a coordination layer instead of inlining large data into prompts. This applies `filesystem-context`:

```ts
.run(async (ctx) => {
  await ctx.stage({ name: "plan" }, {}, {}, async (s) => {
    await s.session.query(`Create a plan for: ${(s.inputs.prompt ?? "")}\n\nWrite it to plan.md.`);
    s.save(s.sessionId);
  });

  await ctx.stage({ name: "execute" }, {}, {}, async (s) => {
    // Reference the file by path — lets the agent read selectively
    await s.session.query(`Read plan.md and implement each task. Mark tasks done as you go.`);
    s.save(s.sessionId);
  });
})
```
