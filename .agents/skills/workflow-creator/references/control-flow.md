# Control Flow

Control flow in workflows is plain TypeScript inside `.run()`. Use `if`/`else` for conditionals, `for`/`while` for loops, and `break`/`continue` for early termination.

There are two levels where control flow can live:

- **Intra-session**: multiple SDK calls within one `ctx.stage()` callback — the agent remembers context across all of them.
- **Inter-session**: loops/conditionals at the `.run()` level that spawn multiple `ctx.stage()` calls — each iteration becomes its own visible graph node in the UI.

Prefer inter-session control flow when you want the workflow graph to reflect what actually happened at runtime.

## Conditional branching

### Inter-session branching (recommended)

Run a triage session first, then branch at the `.run()` level to spawn a purpose-built session for each outcome. Every branch appears as a distinct node in the graph:

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

.run(async (ctx) => {
  // Step 1: Classify the request
  const triage = await ctx.stage({ name: "triage" }, {}, {}, async (s) => {
    const result = await s.session.query(
      `Classify this as "bug", "feature", or "question": ${(s.inputs.prompt ?? "")}`,
    );
    s.save(s.sessionId);
    return extractAssistantText(result, 0).toLowerCase();
  });

  const classification = triage.result;

  // Step 2: Branch — each path spawns its own session
  if (classification.includes("bug")) {
    await ctx.stage({ name: "fix-bug" }, {}, {}, async (s) => {
      await s.session.query("Diagnose and fix the bug described above.");
      s.save(s.sessionId);
    });
  } else if (classification.includes("feature")) {
    await ctx.stage({ name: "implement-feature" }, {}, {}, async (s) => {
      await s.session.query("Design and implement the feature described above.");
      s.save(s.sessionId);
    });
  } else {
    await ctx.stage({ name: "answer-question" }, {}, {}, async (s) => {
      await s.session.query("Research and answer the question above.");
      s.save(s.sessionId);
    });
  }
})
```

### Intra-session branching

When the branching logic is simple and you want the agent to retain full context across both the triage and the action, do it all inside a single session callback:

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

.run(async (ctx) => {
  await ctx.stage({ name: "triage-and-act" }, {}, {}, async (s) => {
    const triageResult = await s.session.query(
      `Classify this as "bug", "feature", or "question": ${(s.inputs.prompt ?? "")}`,
    );

    const classification = extractAssistantText(triageResult, 0).toLowerCase();

    if (classification.includes("bug")) {
      await s.session.query("Diagnose and fix the bug described above.");
    } else if (classification.includes("feature")) {
      await s.session.query("Design and implement the feature described above.");
    } else {
      await s.session.query("Research and answer the question above.");
    }

    s.save(s.sessionId);
  });
})
```

## Bounded loops

### Inter-session loops (recommended)

Each iteration spawns its own session, so the graph shows exactly how many passes ran:

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

.run(async (ctx) => {
  const MAX_ITERATIONS = 5;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const iteration = await ctx.stage({ name: `refine-${i}` }, {}, {}, async (s) => {
      const result = await s.session.query(`Iteration ${i}: Improve the implementation.`);
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    });

    if (iteration.result.includes("LGTM") || iteration.result.includes("no issues")) {
      break;
    }
  }
})
```

### Intra-session loops

When the agent must remember every prior iteration's output to make progress, keep the loop inside one session:

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

.run(async (ctx) => {
  await ctx.stage({ name: "iterative-refinement" }, {}, {}, async (s) => {
    const MAX_ITERATIONS = 5;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await s.session.query(`Iteration ${i + 1}: Improve the implementation.`);

      if (extractAssistantText(result, 0).includes("LGTM") || extractAssistantText(result, 0).includes("no issues")) {
        break;
      }
    }

    s.save(s.sessionId);
  });
})
```

## Review/fix loop pattern

The inter-session pattern is the right fit here: every review and every fix becomes its own graph node, so the executed path is fully visible. This is the production-grade approach with consecutive clean-pass detection:

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

.run(async (ctx) => {
  const MAX_CYCLES = 10;
  const CLEAN_THRESHOLD = 2;
  let consecutiveClean = 0;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    // Each review is a visible graph node
    const review = await ctx.stage({ name: `review-${cycle}` }, {}, {}, async (s) => {
      const result = await s.session.query(buildReviewPrompt((s.inputs.prompt ?? "")));
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    });

    const reviewRaw = review.result;
    const parsed = parseReviewResult(reviewRaw);

    if (!hasActionableFindings(parsed, reviewRaw)) {
      consecutiveClean++;
      if (consecutiveClean >= CLEAN_THRESHOLD) {
        break; // Two consecutive clean passes → done
      }
      continue; // One clean pass → verify again
    }

    consecutiveClean = 0;

    const fixPrompt = parsed
      ? buildFixSpecFromReview(parsed, (s.inputs.prompt ?? ""))
      : buildFixSpecFromRawReview(reviewRaw, (s.inputs.prompt ?? ""));

    // Each fix is also a visible graph node
    await ctx.stage({ name: `fix-${cycle}` }, {}, {}, async (s) => {
      await s.session.query(fixPrompt || "Fix any remaining issues.");
      s.save(s.sessionId);
    });
  }
})
```

### Same pattern with Copilot

Copilot lacks a built-in text extractor — define `getAssistantText` as a
helper in your workflow (canonical definition in `failure-modes.md` §F1)
and import it from a sibling file:

```ts
import { getAssistantText } from "../helpers/parsers.ts"; // see failure-modes.md §F1

.run(async (ctx) => {
  const MAX_CYCLES = 10;
  let consecutiveClean = 0;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    const review = await ctx.stage({ name: `review-${cycle}` }, {}, {}, async (s) => {
      await s.session.send({
        prompt: buildReviewPrompt((s.inputs.prompt ?? "")),
      });
      const reviewRaw = getAssistantText(await s.session.getMessages());

      s.save(await s.session.getMessages());
      return reviewRaw;
    });

    const reviewRaw = review.result;
    const parsed = parseReviewResult(reviewRaw);

    if (!hasActionableFindings(parsed, reviewRaw)) {
      consecutiveClean++;
      if (consecutiveClean >= 2) break;
      continue;
    }
    consecutiveClean = 0;

    const fixPrompt = parsed
      ? buildFixSpecFromReview(parsed, (s.inputs.prompt ?? ""))
      : buildFixSpecFromRawReview(reviewRaw, (s.inputs.prompt ?? ""));

    await ctx.stage({ name: `fix-${cycle}` }, {}, {}, async (s) => {
      await s.session.send({
        prompt: fixPrompt || "Fix remaining issues.",
      });

      s.save(await s.session.getMessages());
    });
  }
})
```

## Graph topology: auto-inferred from `await`/`Promise.all`

The runtime automatically infers the workflow graph topology from the JavaScript control flow. No explicit dependency declarations are needed or supported — the graph always reflects the actual execution structure.

### Sequential (`await`): `a → b` edge

Each sequential `await ctx.stage(...)` produces a parent-child edge from the previous stage. The graph draws a real chain:

```ts
// ✅ Graph infers: orchestrator → planner → worker
.run(async (ctx) => {
  await ctx.stage({ name: "planner" }, {}, {}, async (s) => { /* ... */ });
  await ctx.stage({ name: "worker"  }, {}, {}, async (s) => { /* ... */ });
})
```

### Parallel (`Promise.all`): both branch from same parent

Sessions passed to `Promise.all([...])` branch from the same parent and run concurrently. The runtime gives each a sibling edge from the enclosing scope:

```ts
// ✅ Graph infers: orchestrator → [summarize-a, summarize-b] (parallel siblings)
.run(async (ctx) => {
  const [a, b] = await Promise.all([
    ctx.stage({ name: "summarize-a" }, {}, {}, async (s) => { /* ... */ }),
    ctx.stage({ name: "summarize-b" }, {}, {}, async (s) => { /* ... */ }),
  ]);
})
```

### Fan-in: stage after `Promise.all` gets all parallel stages as parents

A stage awaited after a `Promise.all` resolves automatically receives all parallel stages as parents — the graph draws a merge node:

```ts
// ✅ Graph infers: A → [B, C] → D (fan-in merge)
.run(async (ctx) => {
  await ctx.stage({ name: "A" }, {}, {}, async (s) => { /* ... */ });

  await Promise.all([
    ctx.stage({ name: "B" }, {}, {}, async (s) => { /* ... */ }),
    ctx.stage({ name: "C" }, {}, {}, async (s) => { /* ... */ }),
  ]);

  // D receives B and C as parents — rendered as a merge node.
  await ctx.stage({ name: "D" }, {}, {}, async (s) => { /* ... */ });
})
```

### Nested sub-sessions: child of the enclosing session

`s.stage()` inside a callback automatically becomes a child of the enclosing session — no declaration needed:

```ts
await ctx.stage({ name: "outer" }, {}, {}, async (s) => {
  // inner is a child of outer in the graph automatically
  await s.stage({ name: "inner" }, {}, {}, async (s2) => { /* ... */ });
});
```

### Pattern: iterative loop chains

In iterative loops each stage is naturally the successor of the last because `await` serializes them within the loop body. The graph renders as a chain by default:

```ts
// ✅ Graph infers a spine: planner-1 → worker-1 → planner-2 → worker-2 → ...
.run(async (ctx) => {
  for (let i = 1; i <= MAX_LOOPS; i++) {
    await ctx.stage({ name: `planner-${i}` }, {}, {}, async (s) => { /* ... */ });
    await ctx.stage({ name: `worker-${i}` }, {}, {}, async (s) => { /* ... */ });

    if (needsReview) {
      await ctx.stage({ name: `reviewer-${i}` }, {}, {}, async (s) => { /* ... */ });
    }
  }
})
```

Each iteration's stages form a natural chain because each `await` follows the previous one. Conditional stages fit in seamlessly — the graph reflects whatever path was actually executed.

### Headless (background) stages: transparent to graph topology

Headless stages (`{ headless: true }`) are **invisible in the workflow graph** — they don't consume or update the execution frontier. This means they don't affect the parent-child edges inferred for visible stages.

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

// ✅ Graph renders: seed → merge (headless stages are transparent)
.run(async (ctx) => {
  const seed = await ctx.stage({ name: "seed" }, {}, {}, async (s) => {
    const result = await s.session.query("Describe the project.");
    s.save(s.sessionId);
    return extractAssistantText(result, 0);
  });

  // Three parallel headless stages — invisible in the graph
  const [a, b, c] = await Promise.all([
    ctx.stage({ name: "gather-a", headless: true }, {}, {}, async (s) => {
      const result = await s.session.query(`List 3 pros:\n\n${seed.result}`);
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    }),
    ctx.stage({ name: "gather-b", headless: true }, {}, {}, async (s) => {
      const result = await s.session.query(`List 3 cons:\n\n${seed.result}`);
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    }),
    ctx.stage({ name: "gather-c", headless: true }, {}, {}, async (s) => {
      const result = await s.session.query(`List 3 uses:\n\n${seed.result}`);
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    }),
  ]);

  // Visible merge stage — chains from "seed" in the graph (not from headless stages)
  await ctx.stage({ name: "merge" }, {}, {}, async (s) => {
    await s.session.query(
      `Combine:\n\n## Pros\n${a.result}\n\n## Cons\n${b.result}\n\n## Uses\n${c.result}`,
    );
    s.save(s.sessionId);
  });
})
```

**Key behaviors:**
- Headless stages don't produce graph nodes — they are tracked by a background task counter in the statusline instead
- The execution frontier is not updated when a headless stage spawns or settles, so the next visible stage chains from the last visible stage
- Headless stages still participate in `Promise.all()` — the merge stage correctly awaits all three before running
- Return values (`handle.result`) and transcript access (`s.transcript(handle)`) work identically

**When to use headless vs. visible parallel stages:**

| Concern | Use visible (`headless: false`) | Use headless (`headless: true`) |
|---|---|---|
| User needs to see the work | Yes — each stage gets a tmux window | No — tracked by counter only |
| Debugging/monitoring | Yes — visible in graph + pane preview | No — errors tracked but no TUI |
| Data-gathering/analysis | Possible but clutters the graph | Ideal — keeps graph clean |
| Infrastructure discovery | Clutters graph for support work | Ideal — Ralph uses this pattern |

### Note on data flow vs. topology

Graph topology (parent-child edges) is inferred from control flow. Data flow between sessions is separate: use `s.transcript(handle)` to read a prior session's saved output. The two concerns are independent — you do not need explicit dependency declarations to access another session's transcript; you just need that session's `await` to have completed before you read it.

## Multi-turn conversations

Within a single session callback, each SDK call adds to the conversation context — the agent remembers every prior turn. This is inherently intra-session:

```ts
.run(async (ctx) => {
  await ctx.stage({ name: "guided-implementation" }, {}, {}, async (s) => {
    // The session remembers all prior turns within the same callback
    await s.session.query("Step 1: Set up the project structure.");
    await s.session.query("Step 2: Implement the core logic.");
    await s.session.query("Step 3: Add error handling.");
    await s.session.query("Step 4: Write tests.");
    s.save(s.sessionId);
  });
})
```

## Error handling and retry patterns

### Try/catch with fallback

```ts
.run(async (ctx) => {
  await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
    try {
      await s.session.query((s.inputs.prompt ?? ""));
    } catch (error) {
      // Retry with simpler prompt
      await s.session.query(
        `The previous attempt failed. Please try a simpler approach: ${(s.inputs.prompt ?? "")}`,
      );
    }
    s.save(s.sessionId);
  });
})
```

### Retry with exponential backoff

```ts
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw new Error("Unreachable");
}

.run(async (ctx) => {
  await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
    await retryWithBackoff(() => s.session.query((s.inputs.prompt ?? "")));
    s.save(s.sessionId);
  });
})
```

## Combining patterns

Combine loops, conditionals, and inter-session data passing. Session callbacks return typed values via `SessionHandle<T>.result`, and `s.transcript(handle)` accepts a prior `SessionHandle` to read another session's saved output:

```ts
import { extractAssistantText } from "@bastani/atomic/workflows";

.run(async (ctx) => {
  // Step 1: Analyse — result is available as a typed handle
  const analysisHandle = await ctx.stage({ name: "analyze" }, {}, {}, async (s) => {
    const result = await s.session.query(`Analyse the task: ${(s.inputs.prompt ?? "")}`);
    s.save(s.sessionId);
    return extractAssistantText(result, 0);
  });

  const isComplex = analysisHandle.result.includes("complex");
  const maxIterations = isComplex ? 10 : 3;

  // Step 2: Iterative implementation — each pass is a graph node
  for (let i = 1; i <= maxIterations; i++) {
    const impl = await ctx.stage({ name: `implement-${i}` }, {}, {}, async (s) => {
      // Pass the analysis transcript into this session
      const analysis = await s.transcript(analysisHandle);
      const result = await s.session.query(
        i === 1
          ? `Implement based on:\n${analysis.content}`
          : "Continue improving the implementation.",
      );
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    });

    if (impl.result.includes("all tests pass")) {
      break;
    }
  }
})
```
