# Control Flow

Control flow in workflows is plain TypeScript inside `run()`. Use `if`/`else` for conditionals, `for`/`while` for loops, and `break`/`continue` for early termination.

## Conditional branching

Use standard `if`/`else` to branch execution:

```ts
.session({
  name: "triage-and-act",
  run: async (ctx) => {
    // Step 1: Classify the request
    const triageResult = await claudeQuery({
      paneId: ctx.paneId,
      prompt: `Classify this as "bug", "feature", or "question": ${ctx.userPrompt}`,
    });

    const classification = triageResult.output.toLowerCase();

    // Step 2: Branch based on classification
    if (classification.includes("bug")) {
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: "Diagnose and fix the bug described above.",
      });
    } else if (classification.includes("feature")) {
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: "Design and implement the feature described above.",
      });
    } else {
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: "Research and answer the question above.",
      });
    }

    ctx.save(ctx.sessionId);
  },
})
```

## Bounded loops

Use `for` or `while` loops with explicit bounds:

```ts
.session({
  name: "iterative-refinement",
  run: async (ctx) => {
    const MAX_ITERATIONS = 5;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Iteration ${i + 1}: Improve the implementation.`,
      });

      // Check if we're done
      if (result.output.includes("LGTM") || result.output.includes("no issues")) {
        break;
      }
    }

    ctx.save(ctx.sessionId);
  },
})
```

## Review/fix loop pattern

The Ralph workflow demonstrates a production-grade review/fix loop with consecutive clean-pass detection:

```ts
.session({
  name: "review-fix",
  description: "Iterative review and fix until clean",
  run: async (ctx) => {
    const MAX_CYCLES = 10;
    const CLEAN_THRESHOLD = 2;
    let consecutiveClean = 0;
    let priorDebuggerOutput = "";

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // Step 1: Review
      const reviewResult = await claudeQuery({
        paneId: ctx.paneId,
        prompt: buildReviewPrompt(ctx.userPrompt, priorDebuggerOutput),
      });
      const reviewRaw = reviewResult.output;

      // Step 2: Parse findings (deterministic computation)
      const review = parseReviewResult(reviewRaw);

      // Step 3: Check if clean
      if (!hasActionableFindings(review, reviewRaw)) {
        consecutiveClean++;
        if (consecutiveClean >= CLEAN_THRESHOLD) {
          break; // Two clean passes → done
        }
        continue; // One clean pass → verify again
      }

      // Findings found — reset clean streak
      consecutiveClean = 0;

      // Step 4: Build fix prompt
      const fixPrompt = review
        ? buildFixSpecFromReview(review, ctx.userPrompt)
        : buildFixSpecFromRawReview(reviewRaw, ctx.userPrompt);

      // Step 5: Apply fix
      const fixResult = await claudeQuery({
        paneId: ctx.paneId,
        prompt: fixPrompt || "Fix any remaining issues.",
      });
      priorDebuggerOutput = fixResult.output;
    }

    ctx.save(ctx.sessionId);
  },
})
```

### Same pattern with Copilot

```ts
.session({
  name: "review-fix",
  run: async (ctx) => {
    const client = new CopilotClient({ cliUrl: ctx.serverUrl });
    await client.start();
    const session = await client.createSession({ onPermissionRequest: approveAll });
    await client.setForegroundSessionId(session.sessionId);

    const MAX_CYCLES = 10;
    let consecutiveClean = 0;

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      await session.sendAndWait({ prompt: buildReviewPrompt(ctx.userPrompt) });
      const reviewRaw = getLastAssistantText(await session.getMessages());
      const review = parseReviewResult(reviewRaw);

      if (!hasActionableFindings(review, reviewRaw)) {
        consecutiveClean++;
        if (consecutiveClean >= 2) break;
        continue;
      }
      consecutiveClean = 0;

      const fixPrompt = review
        ? buildFixSpecFromReview(review, ctx.userPrompt)
        : buildFixSpecFromRawReview(reviewRaw, ctx.userPrompt);

      await session.sendAndWait({ prompt: fixPrompt || "Fix remaining issues." });
    }

    ctx.save(await session.getMessages());
    await session.disconnect();
    await client.stop();
  },
})
```

## Multi-turn conversations

Within a single session, each SDK call adds to the conversation context:

```ts
.session({
  name: "guided-implementation",
  run: async (ctx) => {
    // Claude remembers all prior turns within the same pane
    await claudeQuery({ paneId: ctx.paneId, prompt: "Step 1: Set up the project structure." });
    await claudeQuery({ paneId: ctx.paneId, prompt: "Step 2: Implement the core logic." });
    await claudeQuery({ paneId: ctx.paneId, prompt: "Step 3: Add error handling." });
    await claudeQuery({ paneId: ctx.paneId, prompt: "Step 4: Write tests." });
    ctx.save(ctx.sessionId);
  },
})
```

## Error handling and retry patterns

### Try/catch with fallback

```ts
run: async (ctx) => {
  try {
    await claudeQuery({ paneId: ctx.paneId, prompt: ctx.userPrompt });
  } catch (error) {
    // Retry with simpler prompt
    await claudeQuery({
      paneId: ctx.paneId,
      prompt: `The previous attempt failed. Please try a simpler approach: ${ctx.userPrompt}`,
    });
  }
  ctx.save(ctx.sessionId);
},
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

run: async (ctx) => {
  await retryWithBackoff(() =>
    claudeQuery({ paneId: ctx.paneId, prompt: ctx.userPrompt })
  );
  ctx.save(ctx.sessionId);
},
```

## Combining patterns

Combine loops, conditionals, and data passing:

```ts
.session({
  name: "adaptive-implementation",
  run: async (ctx) => {
    const analysis = await ctx.transcript("analyze");

    // Determine strategy based on analysis
    const isComplex = analysis.content.includes("complex");
    const maxIterations = isComplex ? 10 : 3;

    for (let i = 0; i < maxIterations; i++) {
      const result = await claudeQuery({
        paneId: ctx.paneId,
        prompt: i === 0
          ? `Implement based on:\n${analysis.content}`
          : "Continue improving the implementation.",
      });

      // Check completion criteria
      if (result.output.includes("all tests pass")) {
        break;
      }
    }

    ctx.save(ctx.sessionId);
  },
})
```
