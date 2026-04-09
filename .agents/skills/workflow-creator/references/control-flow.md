# Control Flow

Control flow in workflows is plain TypeScript inside `.run()`. Use `if`/`else` for conditionals, `for`/`while` for loops, and `break`/`continue` for early termination.

There are two levels where control flow can live:

- **Intra-session**: multiple SDK calls within one `ctx.session()` callback — the agent remembers context across all of them.
- **Inter-session**: loops/conditionals at the `.run()` level that spawn multiple `ctx.session()` calls — each iteration becomes its own visible graph node in the UI.

Prefer inter-session control flow when you want the workflow graph to reflect what actually happened at runtime.

## Conditional branching

### Inter-session branching (recommended)

Run a triage session first, then branch at the `.run()` level to spawn a purpose-built session for each outcome. Every branch appears as a distinct node in the graph:

```ts
.run(async (ctx) => {
  // Step 1: Classify the request
  const triage = await ctx.session({ name: "triage" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    const result = await claudeQuery({
      paneId: s.paneId,
      prompt: `Classify this as "bug", "feature", or "question": ${ctx.userPrompt}`,
    });
    s.save(s.sessionId);
    return result.output.toLowerCase();
  });

  const classification = triage.result;

  // Step 2: Branch — each path spawns its own session
  if (classification.includes("bug")) {
    await ctx.session({ name: "fix-bug" }, async (s) => {
      await createClaudeSession({ paneId: s.paneId });
      await claudeQuery({ paneId: s.paneId, prompt: "Diagnose and fix the bug described above." });
      s.save(s.sessionId);
    });
  } else if (classification.includes("feature")) {
    await ctx.session({ name: "implement-feature" }, async (s) => {
      await createClaudeSession({ paneId: s.paneId });
      await claudeQuery({ paneId: s.paneId, prompt: "Design and implement the feature described above." });
      s.save(s.sessionId);
    });
  } else {
    await ctx.session({ name: "answer-question" }, async (s) => {
      await createClaudeSession({ paneId: s.paneId });
      await claudeQuery({ paneId: s.paneId, prompt: "Research and answer the question above." });
      s.save(s.sessionId);
    });
  }
})
```

### Intra-session branching

When the branching logic is simple and you want the agent to retain full context across both the triage and the action, do it all inside a single session callback:

```ts
.run(async (ctx) => {
  await ctx.session({ name: "triage-and-act" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });

    const triageResult = await claudeQuery({
      paneId: s.paneId,
      prompt: `Classify this as "bug", "feature", or "question": ${ctx.userPrompt}`,
    });

    const classification = triageResult.output.toLowerCase();

    if (classification.includes("bug")) {
      await claudeQuery({ paneId: s.paneId, prompt: "Diagnose and fix the bug described above." });
    } else if (classification.includes("feature")) {
      await claudeQuery({ paneId: s.paneId, prompt: "Design and implement the feature described above." });
    } else {
      await claudeQuery({ paneId: s.paneId, prompt: "Research and answer the question above." });
    }

    s.save(s.sessionId);
  });
})
```

## Bounded loops

### Inter-session loops (recommended)

Each iteration spawns its own session, so the graph shows exactly how many passes ran:

```ts
.run(async (ctx) => {
  const MAX_ITERATIONS = 5;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const iteration = await ctx.session({ name: `refine-${i}` }, async (s) => {
      await createClaudeSession({ paneId: s.paneId });
      const result = await claudeQuery({
        paneId: s.paneId,
        prompt: `Iteration ${i}: Improve the implementation.`,
      });
      s.save(s.sessionId);
      return result.output;
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
.run(async (ctx) => {
  await ctx.session({ name: "iterative-refinement" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    const MAX_ITERATIONS = 5;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await claudeQuery({
        paneId: s.paneId,
        prompt: `Iteration ${i + 1}: Improve the implementation.`,
      });

      if (result.output.includes("LGTM") || result.output.includes("no issues")) {
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
.run(async (ctx) => {
  const MAX_CYCLES = 10;
  const CLEAN_THRESHOLD = 2;
  let consecutiveClean = 0;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    // Each review is a visible graph node
    const review = await ctx.session({ name: `review-${cycle}` }, async (s) => {
      await createClaudeSession({ paneId: s.paneId });
      const result = await claudeQuery({
        paneId: s.paneId,
        prompt: buildReviewPrompt(ctx.userPrompt),
      });
      s.save(s.sessionId);
      return result.output;
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
      ? buildFixSpecFromReview(parsed, ctx.userPrompt)
      : buildFixSpecFromRawReview(reviewRaw, ctx.userPrompt);

    // Each fix is also a visible graph node
    await ctx.session({ name: `fix-${cycle}` }, async (s) => {
      await createClaudeSession({ paneId: s.paneId });
      await claudeQuery({
        paneId: s.paneId,
        prompt: fixPrompt || "Fix any remaining issues.",
      });
      s.save(s.sessionId);
    });
  }
})
```

### Same pattern with Copilot

Loops amplify the `sendAndWait` 60-second timeout pitfall — any iteration
whose agent response takes longer than the default throws and kills the
entire surrounding session. Always pass an explicit timeout. See the
"Critical pitfall" section in `agent-sessions.md`.

```ts
// Explicit per-call timeout — see agent-sessions.md pitfall note.
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

.run(async (ctx) => {
  const MAX_CYCLES = 10;
  let consecutiveClean = 0;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    const review = await ctx.session({ name: `review-${cycle}` }, async (s) => {
      const client = new CopilotClient({ cliUrl: s.serverUrl });
      await client.start();
      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);

      await session.sendAndWait(
        { prompt: buildReviewPrompt(ctx.userPrompt) },
        SEND_TIMEOUT_MS,
      );
      const reviewRaw = getAssistantText(await session.getMessages()); // see failure-modes.md §F1

      s.save(await session.getMessages());
      await session.disconnect();
      await client.stop();
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
      ? buildFixSpecFromReview(parsed, ctx.userPrompt)
      : buildFixSpecFromRawReview(reviewRaw, ctx.userPrompt);

    await ctx.session({ name: `fix-${cycle}` }, async (s) => {
      const client = new CopilotClient({ cliUrl: s.serverUrl });
      await client.start();
      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);

      await session.sendAndWait(
        { prompt: fixPrompt || "Fix remaining issues." },
        SEND_TIMEOUT_MS,
      );

      s.save(await session.getMessages());
      await session.disconnect();
      await client.stop();
    });
  }
})
```

## Explicit dependency chains (`dependsOn`)

`SessionRunOptions.dependsOn` lets a session declare which prior sessions it's a successor of. It has two effects, and both matter:

1. **Graph rendering** — each name becomes a parent edge, so the workflow graph draws a real chain (or fan-in) instead of making every top-level `ctx.session()` a sibling under `orchestrator`.
2. **Runtime ordering** — the runtime awaits each named dep before starting. In `Promise.all([...])` patterns, this lets you fan out concurrently and still serialize the edges that matter. If a dep failed, the dependent fails fast with a clear error.

Use `dependsOn` whenever the default behavior (every top-level session shown as a sibling under orchestrator) misrepresents what the workflow actually does. The classic case: an iterative loop where each stage depends on the previous one.

### Why this exists: the sibling-under-root problem

Without `dependsOn`, every top-level `ctx.session()` attaches to `orchestrator`. Two sequential awaits produce a graph that looks like *parallel siblings* even though the JavaScript is strictly sequential:

```ts
// ❌ Graph shows planner and worker as siblings under orchestrator.
// The await runs them in order, but the graph loses that information —
// users can't tell at a glance which stage happened first.
.run(async (ctx) => {
  await ctx.session({ name: "planner" }, async (s) => { /* ... */ });
  await ctx.session({ name: "worker"  }, async (s) => { /* ... */ });
})
```

```ts
// ✅ Graph shows orchestrator → planner → worker as a chain.
.run(async (ctx) => {
  await ctx.session({ name: "planner" }, async (s) => { /* ... */ });
  await ctx.session(
    { name: "worker", dependsOn: ["planner"] },
    async (s) => { /* ... */ },
  );
})
```

### Pattern: "previous stage" chain in a loop

When every stage in a loop is the successor of the last, thread a local `prevStage` variable through each `ctx.session()` call. This is the pattern used by the bundled `ralph` workflow (`.atomic/workflows/ralph/*/index.ts`) — every iteration's planner depends on the previous iteration's debugger, every orchestrator depends on the planner just above it, and so on. The whole multi-iteration pipeline renders as one long spine instead of a mess of siblings:

```ts
.run(async (ctx) => {
  // Track the most recent session so the next stage can wire itself
  // as a successor. `depsOn()` just returns [prevStage] or undefined.
  let prevStage: string | undefined;
  const depsOn = (): string[] | undefined =>
    prevStage ? [prevStage] : undefined;

  for (let i = 1; i <= MAX_LOOPS; i++) {
    const plannerName = `planner-${i}`;
    await ctx.session(
      { name: plannerName, dependsOn: depsOn() },
      async (s) => { /* ... */ },
    );
    prevStage = plannerName;

    const workerName = `worker-${i}`;
    await ctx.session(
      { name: workerName, dependsOn: depsOn() },
      async (s) => { /* ... */ },
    );
    prevStage = workerName;

    // Conditionally appended stages still update prevStage so the next
    // iteration's first stage picks up wherever the chain left off.
    if (needsReview) {
      const reviewerName = `reviewer-${i}`;
      await ctx.session(
        { name: reviewerName, dependsOn: depsOn() },
        async (s) => { /* ... */ },
      );
      prevStage = reviewerName;
    }
  }
})
```

**Why the helper function instead of an inline array?** The helper returns `undefined` on the first iteration (no prior stage exists yet) and `[prevStage]` thereafter. Passing `undefined` makes the first session fall back to the default parent — no special-case branching in the loop body.

### Pattern: parallel fan-out with a gating dep

`dependsOn` is the only way to make `Promise.all([...])` patterns respect "B must wait for A" without serializing the whole group. The runtime awaits each dep's completion promise before starting the dependent session, so B sits idle until A finishes while C runs alongside A.

```ts
.run(async (ctx) => {
  // Gate: A must run first; B and C can run in parallel after A.
  await ctx.session({ name: "A" }, async (s) => { /* ... */ });

  await Promise.all([
    ctx.session(
      { name: "B", dependsOn: ["A"] },
      async (s) => { /* ... */ },
    ),
    ctx.session(
      { name: "C", dependsOn: ["A"] },
      async (s) => { /* ... */ },
    ),
  ]);

  // D waits for BOTH B and C (fan-in) — renders as a merge node.
  await ctx.session(
    { name: "D", dependsOn: ["B", "C"] },
    async (s) => { /* ... */ },
  );
})
```

Because `A` finished before the `Promise.all`, the `dependsOn: ["A"]` check resolves immediately for both `B` and `C` — they start concurrently. `D` waits for both to settle. If either `B` or `C` throws, `D` gets the same error instead of hanging.

### When NOT to use `dependsOn`

- **When siblings really are siblings.** If you have two independent top-level sessions that genuinely don't depend on each other and you *want* the graph to show them as parallel work under orchestrator, don't add `dependsOn`. It's not a style — it's a dependency declaration.
- **For nested sub-sessions inside a callback.** `s.session()` already declares parentage via its enclosing scope: the nested session is a child of the outer session automatically. Adding `dependsOn` there is redundant.
- **Instead of `s.transcript()`.** `dependsOn` controls execution order and graph edges, not data flow. If B needs to *read* A's output, use `s.transcript(aHandle)` — that still requires `await ctx.session(a)` to have completed, which `dependsOn` (or a simple await) guarantees.

## Multi-turn conversations

Within a single session callback, each SDK call adds to the conversation context — the agent remembers every prior turn. This is inherently intra-session:

```ts
.run(async (ctx) => {
  await ctx.session({ name: "guided-implementation" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    // Claude remembers all prior turns within the same pane
    await claudeQuery({ paneId: s.paneId, prompt: "Step 1: Set up the project structure." });
    await claudeQuery({ paneId: s.paneId, prompt: "Step 2: Implement the core logic." });
    await claudeQuery({ paneId: s.paneId, prompt: "Step 3: Add error handling." });
    await claudeQuery({ paneId: s.paneId, prompt: "Step 4: Write tests." });
    s.save(s.sessionId);
  });
})
```

## Error handling and retry patterns

### Try/catch with fallback

```ts
.run(async (ctx) => {
  await ctx.session({ name: "implement" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    try {
      await claudeQuery({ paneId: s.paneId, prompt: ctx.userPrompt });
    } catch (error) {
      // Retry with simpler prompt
      await claudeQuery({
        paneId: s.paneId,
        prompt: `The previous attempt failed. Please try a simpler approach: ${ctx.userPrompt}`,
      });
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
  await ctx.session({ name: "implement" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    await retryWithBackoff(() =>
      claudeQuery({ paneId: s.paneId, prompt: ctx.userPrompt })
    );
    s.save(s.sessionId);
  });
})
```

## Combining patterns

Combine loops, conditionals, and inter-session data passing. Session callbacks return typed values via `SessionHandle<T>.result`, and `s.transcript(handle)` accepts a prior `SessionHandle` to read another session's saved output:

```ts
.run(async (ctx) => {
  // Step 1: Analyse — result is available as a typed handle
  const analysisHandle = await ctx.session({ name: "analyze" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    const result = await claudeQuery({ paneId: s.paneId, prompt: `Analyse the task: ${ctx.userPrompt}` });
    s.save(s.sessionId);
    return result.output;
  });

  const isComplex = analysisHandle.result.includes("complex");
  const maxIterations = isComplex ? 10 : 3;

  // Step 2: Iterative implementation — each pass is a graph node
  for (let i = 1; i <= maxIterations; i++) {
    const impl = await ctx.session({ name: `implement-${i}` }, async (s) => {
      // Pass the analysis transcript into this session
      const analysis = await s.transcript(analysisHandle);
      await createClaudeSession({ paneId: s.paneId });
      const result = await claudeQuery({
        paneId: s.paneId,
        prompt: i === 1
          ? `Implement based on:\n${analysis.content}`
          : "Continue improving the implementation.",
      });
      s.save(s.sessionId);
      return result.output;
    });

    if (impl.result.includes("all tests pass")) {
      break;
    }
  }
})
```
