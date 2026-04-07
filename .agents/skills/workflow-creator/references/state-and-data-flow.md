# State and Data Flow

Data flows between sessions via `ctx.save()`, `ctx.transcript()`, and `ctx.getMessages()`. Within a session, use plain TypeScript variables. This is the programmatic equivalent of `globalState` and reducers.

## Between sessions: `ctx.save()` → `ctx.transcript()` / `ctx.getMessages()`

### Saving output

Each SDK has its own save pattern:

```ts
// Claude — pass session ID (auto-reads transcript)
ctx.save(ctx.sessionId);

// Copilot — pass SessionEvent[] from getMessages()
ctx.save(await session.getMessages());

// OpenCode — pass response { info, parts } from session.prompt()
ctx.save(result.data!);
```

### Retrieving as rendered text

`ctx.transcript(name)` returns `{ path: string, content: string }`:
- `path` — absolute file path to the transcript on disk
- `content` — extracted assistant text, ready to embed in prompts

```ts
.session({
  name: "synthesize",
  run: async (ctx) => {
    const research = await ctx.transcript("research");

    // Use rendered text in a prompt
    await claudeQuery({
      paneId: ctx.paneId,
      prompt: `Synthesize this research:\n${research.content}`,
    });

    // Or reference the file path (useful for Claude file triggers)
    await claudeQuery({
      paneId: ctx.paneId,
      prompt: `Read ${research.path} and summarize the key findings.`,
    });

    ctx.save(ctx.sessionId);
  },
})
```

### Retrieving as raw messages

`ctx.getMessages(name)` returns `SavedMessage[]` — the native SDK messages exactly as stored:

```ts
.session({
  name: "analyze-results",
  run: async (ctx) => {
    const messages = await ctx.getMessages("research");

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
  },
})
```

## Within a session: TypeScript variables

Use closures and variables for state within a single session:

```ts
.session({
  name: "review-fix",
  run: async (ctx) => {
    // Local state — plain variables
    let consecutiveClean = 0;
    let priorOutput = "";
    const findings: string[] = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      const result = await claudeQuery({
        paneId: ctx.paneId,
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
        paneId: ctx.paneId,
        prompt: buildFixSpec(review, ctx.userPrompt),
      });
      priorOutput = fixResult.output;
    }

    // All local state is available here
    console.log(`Total findings across cycles: ${findings.length}`);
    ctx.save(ctx.sessionId);
  },
})
```

## File-based persistence

For data that needs to survive session restarts or be accessible outside the workflow, use file I/O:

```ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

.session({
  name: "generate-report",
  run: async (ctx) => {
    // Write artifacts to session directory
    const artifactDir = join(ctx.sessionDir, "artifacts");
    await mkdir(artifactDir, { recursive: true });

    const report = { timestamp: Date.now(), status: "complete" };
    await writeFile(
      join(artifactDir, "report.json"),
      JSON.stringify(report, null, 2),
    );

    // Read artifacts from a prior session
    const priorReport = JSON.parse(
      await readFile(join(ctx.sessionDir, "..", "plan", "artifacts", "report.json"), "utf-8"),
    );
  },
})
```

## Shared helper functions

Extract SDK-agnostic logic into shared helpers. This is the key pattern for building workflows that work across all three SDKs:

```
.atomic/workflows/
├── claude/my-workflow/index.ts     # Claude SDK code
├── copilot/my-workflow/index.ts    # Copilot SDK code
├── opencode/my-workflow/index.ts   # OpenCode SDK code
└── my-workflow/helpers/
    ├── prompts.ts                  # Prompt builders
    ├── parsers.ts                  # Response parsers
    └── validation.ts              # Validation logic
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
// .atomic/workflows/claude/my-workflow/index.ts
import { buildPlanPrompt, buildReviewPrompt } from "../../my-workflow/helpers/prompts.ts";
import { parseReviewResult } from "../../my-workflow/helpers/parsers.ts";

// ... use in run() callbacks
```

## Data flow patterns

### Linear pipeline

```
Session A → ctx.save() → Session B reads via ctx.transcript("A")
                        → ctx.save() → Session C reads via ctx.transcript("B")
```

### Fan-in (multiple prior sessions)

```ts
.session({
  name: "merge",
  run: async (ctx) => {
    const research = await ctx.transcript("research");
    const analysis = await ctx.transcript("analysis");
    const userFeedback = await ctx.transcript("feedback");

    await claudeQuery({
      paneId: ctx.paneId,
      prompt: `Combine these inputs:
Research: ${research.content}
Analysis: ${analysis.content}
Feedback: ${userFeedback.content}`,
    });
    ctx.save(ctx.sessionId);
  },
})
```

### Accumulating state across sessions

Since sessions run sequentially, each session can read all prior sessions:

```ts
.session({
  name: "session-3",
  run: async (ctx) => {
    // Read from any prior session
    const s1 = await ctx.transcript("session-1");
    const s2 = await ctx.transcript("session-2");

    // Combine and process
    const combined = `${s1.content}\n${s2.content}`;
    // ...
  },
})
```
