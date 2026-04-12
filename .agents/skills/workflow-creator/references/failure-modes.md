# Failure Modes

Common, **silent** ways workflows break across Claude Code, Copilot CLI, and
OpenCode — and the wrong-vs-right patterns to avoid them.

**Read this before you ship a multi-session workflow.** Most failures here
don't throw — they produce degraded output that looks plausible, which is
the hardest kind of bug to catch in review.

## When to consult

- Before writing a planner → orchestrator → reviewer handoff (Copilot / OpenCode)
- When a stage receives context from a prior stage and the output smells off
- When a review/fix loop works on small inputs but drifts on large ones
- When a JSON/markdown parser in a helper stops matching the model's output
- When you cannot explain where a particular sentence in a downstream prompt came from

## Silent vs. loud

| Severity | What happens | Detection |
|---|---|---|
| **Silent** | Wrong output, no exception. Downstream stages consume garbage. | Requires end-to-end observation. Easy to miss in review. |
| **Loud** | Exception thrown, stage aborts. | Stack trace surfaces in logs. |

Silent failures are catalogued first below. Loud failures are grouped at the end.

---

## Quick reference

| # | Failure | Affected | Silent? |
|---|---|---|---|
| [F1](#f1-copilot-getlastassistanttext-returns-empty-string) | Copilot: `getLastAssistantText` returns empty string | Copilot | silent |
| [F2](#f2-copilot-sub-agent-messages-pollute-getmessages-stream) | Copilot: sub-agent messages pollute `getMessages()` stream | Copilot | silent |
| [F3](#f3-opencode-result-parts-contain-non-text-parts) | OpenCode: `result.data.parts` contains non-text parts | OpenCode | silent |
| [F4](#f4-claudequery-output-includes-tui-scrollback-not-just-the-last-turn) | Claude: `s.session.query()` output includes TUI scrollback, not just the last turn | Claude | silent |
| [F5](#f5-fresh-session-wipes-prior-stage-context) | Fresh session wipes prior stage context | Copilot, OpenCode | silent |
| [F6](#f6-planner-prompts-that-dont-request-trailing-commentary-produce-empty-handoffs) | Planner prompts that don't request trailing commentary produce empty handoffs | all | silent |
| [F7](#f7-continued-sessions-accumulate-state-across-loop-iterations) | Continued sessions accumulate state across loop iterations (lost-in-middle) | all | silent |
| [F8](#f8-fenced-block-parsers-break-when-the-model-adds-prose) | Fenced-block parsers break when the model adds prose before/after | all | silent |
| [F9](#f9-ssave-receives-the-wrong-shape) | `s.save()` receives the wrong shape for the SDK | all | silent |
| [F10](#f10-copilot-sendandwait-default-60s-timeout-throws) | Copilot: `sendAndWait` default 60s timeout throws | Copilot | loud |
| [F11](#f11-manual-claude-session-initialization-resolved-by-runtime) | ~~Manual Claude session initialization~~ (resolved by runtime) | Claude | N/A |
| [F12](#f12-resume-session-tries-to-swap-agents) | Resume session tries to swap agents | Copilot, OpenCode | loud |
| [F13](#f13-parallel-siblings-read-each-others-transcripts) | Parallel siblings read each other's transcripts | all | loud |
| [F14](#f14-forgetting-to-await-ctxstage) | Forgetting to `await` `ctx.stage()` | all | silent |
| [F15](#f15-using-a-pending-sessionhandle-before-completion) | Using a pending `SessionHandle` before completion | all | silent |

---

## F1. Copilot: `getLastAssistantText` returns empty string

**Symptom.** The orchestrator (or any downstream stage) receives an empty
`plannerNotes` / `reviewerOutput` despite the prior agent running successfully
and producing visible output in the TUI.

**Root cause.** Copilot emits an **empty terminating `assistant.message` event**
after every turn that included a tool call. The actual prose + toolRequests
live in the earlier `assistant.message` event; the trailing one has
`content: ""` and no `toolRequests`. Picking `.at(-1).data.content` reliably
lands on the empty terminator and throws away the real content.

Verified empirically with a toy script against Copilot CLI 1.0.22: a
single-turn "think then call tool" prompt produced 2 assistant.message
events, `[{length: 512, toolRequests: 1}, {length: 0, toolRequests: 0}]`.
The second one is what `.at(-1)` returns.

The event type carries both `content: string` and `toolRequests?: [...]` —
see `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:1408-1455`.

This means the bug affects **any** stage whose final turn includes a tool
call — not just tool-calls-only turns. Planner, reviewer, debugger, and
orchestrator stages all hit it if they end on a tool invocation.

**Affected SDKs.** Copilot only.

### ❌ Wrong

```ts
function getLastAssistantText(messages: SessionEvent[]): string {
  const assistantMessages = messages.filter(
    (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
      m.type === "assistant.message",
  );
  return assistantMessages.at(-1)?.data.content ?? "";
}
```

### ✅ Right

```ts
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
```

**Detection.** Log the returned text length after every `runAgent` call
during development. An empty or surprisingly short string for a stage
that clearly ran is the signature.

---

## F2. Copilot: sub-agent messages pollute `getMessages()` stream

**Symptom.** Downstream stages receive a snippet of text that doesn't match
what the top-level agent said — it looks like a sub-agent's output.

**Root cause.** `assistant.message` events carry a `parentToolCallId?: string`
field, documented as *"Tool call ID of the parent tool invocation when this
event originates from a sub-agent"*. When the top-level agent delegates,
`getMessages()` returns **the complete history including sub-agent messages**.
Filters that don't exclude `parentToolCallId` can pick a sub-agent's final
message via `.at(-1)`.

**Affected SDKs.** Copilot.

### ❌ Wrong

```ts
messages.filter((m) => m.type === "assistant.message")
```

### ✅ Right

```ts
messages.filter(
  (m) => m.type === "assistant.message" && !m.data.parentToolCallId,
)
```

**Detection.** Same as F1 — diff what you extract against the TUI
scrollback for the top-level agent.

---

## F3. OpenCode: `result.data.parts` contains non-text parts

**Symptom.** Concatenated response text contains `[object Object]`,
truncated content, or swallows tool-call payloads into the prompt.

**Root cause.** `client.session.prompt()` returns `result.data.parts: Part[]`
where parts can be `type: "text" | "tool" | "file" | "reasoning" | ...`.
Naive `.map(p => p.text).join()` emits `undefined` for non-text parts.

**Affected SDKs.** OpenCode.

### ❌ Wrong

```ts
const text = result.data!.parts.map((p) => p.text).join("\n");
```

### ✅ Right

```ts
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}
```

**Detection.** Grep extracted text for `[object Object]` or `undefined`.

---

## F4. Claude: `s.session.query()` output includes TUI scrollback, not just the last turn

**Symptom.** Parsers matching "the last fenced JSON block" pick up an old
turn's JSON because the captured output contains multiple turns of scrollback.

**Root cause.** `s.session.query()` captures the tmux pane's visible scrollback after output stabilizes — it's not a scoped
"this call's response only" string. Earlier sub-agent output, prior-turn
assistant text, and even the user's own prompt echo all end up in
`result.output`.

**Affected SDKs.** Claude (tmux-based query).

### ❌ Wrong

```ts
// Assumes `output` is only the latest turn's JSON
const parsed = JSON.parse(reviewResult.output);
```

### ✅ Right — extract the LAST fenced block, not the first

```ts
export function extractLastFencedBlock(
  content: string,
  lang = "json",
): string | null {
  const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)\\n```", "g");
  let last: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match[1]) last = match[1];
  }
  return last;
}
```

The ralph helpers in `src/sdk/workflows/builtin/ralph/helpers/prompts.ts`
(`parseReviewResult`, `extractMarkdownBlock`) use this pattern — always take
the **last** block, never the first.

**Detection.** Run the workflow twice in the same session; if the
downstream parser returns stale data from the prior iteration, F4 is the
cause.

---

## F5. Fresh session wipes prior stage context

**Symptom.** The orchestrator says "I don't see a task list" or "what
specification are you referring to?" even though the planner clearly ran.

**Root cause.** `client.createSession()` / `client.session.create()` always
returns a **fresh, empty conversation**. The CLIENT object is just the
transport — each session is independent. The new session sees only what you
put in its first prompt.

**Affected SDKs.** Copilot, OpenCode. (Claude's tmux pane model is
different — context accumulates in the same pane, so this failure mode
does NOT apply to `s.session.query()`.)

### ❌ Wrong

```ts
await runAgent("planner", buildPlannerPrompt(ctx.userPrompt));
// orchestrator is a fresh session — it has no idea what the planner produced
await runAgent("orchestrator", buildOrchestratorPrompt());
```

### ✅ Right — explicit handoff

```ts
const plannerNotes = await runAgent("planner", buildPlannerPrompt(ctx.userPrompt));
await runAgent(
  "orchestrator",
  buildOrchestratorPrompt(ctx.userPrompt, { plannerNotes }),
);
```

Alternatives: write to shared state (`TaskCreate`/`TaskList`, files, git) and
have the next stage read from there, or keep the follow-up inside the same
stage callback when it needs the full live conversation. Provider-level resume
is an advanced same-role escape hatch, not the normal stage-to-stage handoff.

**Full write-up.** `agent-sessions.md` §"Critical pitfall: session lifecycle
controls what context is available".

---

## F6. Planner prompts that don't request trailing commentary produce empty handoffs

**Symptom.** F1 / F5 are fixed, extraction is correct — and the orchestrator
still receives empty `plannerNotes` because the planner's last turn legitimately
had no prose.

**Root cause.** This is a **prompt engineering** bug, not a code bug. When a
prompt ends with "call `TaskList` to verify" and does not explicitly ask for
trailing commentary, many models end the turn with just the tool call and
no text at all. There's nothing in any turn's `content` to extract because
the model never wrote any.

**Affected SDKs.** All three — though Claude's pane scrollback masks it by
still capturing something visible.

### ❌ Wrong — silent handoff

```ts
return `# Planning

${spec}

Decompose the specification into tasks via TaskCreate. After creating all
tasks, call TaskList to verify.`;
```

### ✅ Right — explicit trailing commentary requirement

```ts
return `# Planning

${spec}

Decompose the specification into tasks via TaskCreate. After creating all
tasks, call TaskList to verify.

## Final output (required)

After the TaskList call, write a short "Handoff Notes" section with:
- Risks or ambiguities the orchestrator must know about
- Any assumptions you made that could be wrong
- Ordering constraints that don't fit into task bodies

The orchestrator will run in a fresh session — anything not in your
TaskCreate calls or this section will be lost.`;
```

**Pair this fix with F1.** Even with the correct extraction helper, you need
the model to actually produce text for the helper to extract.

**Detection.** Log the extracted handoff text during development. An empty
string + a correctly-fixed extraction helper = F6.

---

## F7. Continued sessions accumulate state across loop iterations (lost-in-middle)

**Symptom.** A review/fix loop works on iterations 1-3 then starts
producing worse output — misidentifying files, hallucinating line numbers,
or "forgetting" a requirement that was clearly stated in the original spec.

**Root cause.** Each loop iteration adds turns to the same continued
session, and context grows past the attention window. The model starts
dropping middle-of-context information (classic lost-in-middle).

**Affected SDKs.** All three. Claude's long tmux pane is especially
vulnerable because the scrollback captures every intermediate turn.

### ❌ Wrong — unbounded loop on a single session

```ts
await ctx.stage({ name: "review-loop" }, {}, {}, async (s) => {
  for (let i = 0; i < 20; i++) {
    await s.session.query(buildReviewPrompt());
    await s.session.query(buildFixPrompt());
  }
});
```

### ✅ Right — compact or reset between iterations

Options, in order of preference:

1. **Compact** — summarize prior turns via the SDK's compaction mechanism
   (Claude's `/compact`, OpenCode's summarizer, a sidecar summarization call
   for Copilot). Keeps decisions and file paths; drops verbose tool output.
2. **Offload to files** — write intermediate findings to files and reference
   them by path in the next iteration's prompt (`filesystem-context` skill).
3. **Fresh session per iteration with explicit handoff** — see F5's pattern;
   lose the in-session reasoning but gain a clean context window.

```ts
await ctx.stage({ name: "review-loop" }, {}, {}, async (s) => {
  const MAX_TURNS_BEFORE_COMPACT = 10;
  let turnsSinceCompact = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (turnsSinceCompact >= MAX_TURNS_BEFORE_COMPACT) {
      await s.session.query("/compact");
      turnsSinceCompact = 0;
    }
    await s.session.query(buildReviewPrompt());
    turnsSinceCompact += 1;
  }
});
```

**Consult.** `context-degradation`, `context-compression`, `context-optimization`.

**Detection.** Quality-vs-iteration chart. If quality degrades past
iteration N, N is your safe-turn budget before compaction.

---

## F8. Fenced-block parsers break when the model adds prose

**Symptom.** `JSON.parse(content)` throws, or a "matches the first fenced
block" regex picks up a code example inside prose instead of the actual
structured output.

**Root cause.** A prompt asks for `only JSON inside a single fenced block`
and the model adds a sentence of explanation, a "# Summary" heading, or
quotes a snippet of its own reasoning in a code fence earlier in the reply.

**Affected SDKs.** All three — this is a model-behavior issue, not
SDK-specific.

### ❌ Wrong

```ts
const parsed = JSON.parse(content);
// or:
const match = content.match(/```json\n([\s\S]*?)\n```/);
```

### ✅ Right — layered fallback: direct parse → last fenced block → last balanced object

```ts
export function parseReviewResult(content: string): ReviewResult | null {
  // 1. Direct JSON
  try {
    const parsed = JSON.parse(content);
    if (parsed?.findings && parsed?.overall_correctness) return parsed;
  } catch { /* fall through */ }

  // 2. LAST fenced code block (not the first — prose often quotes examples)
  const blockRe = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let lastBlock: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(content)) !== null) {
    if (m[1]) lastBlock = m[1];
  }
  if (lastBlock) {
    try {
      const parsed = JSON.parse(lastBlock);
      if (parsed?.findings && parsed?.overall_correctness) return parsed;
    } catch { /* fall through */ }
  }

  // 3. Last balanced object containing the required key
  // (implementation in src/sdk/workflows/builtin/ralph/helpers/prompts.ts)
  return null;
}
```

**Detection.** Fuzz test the parser against real model output captured
over several runs. If 1 in 20 runs fails to parse, you have F8.

---

## F9. `s.save()` receives the wrong shape

**Symptom.** `s.transcript("stage-name")` returns an empty or malformed
`content` string in the next stage.

**Root cause.** Each SDK has a different contract for what `s.save()`
expects, and the runtime doesn't type-check the argument beyond "anything".

**Affected SDKs.** All three — the mistake is in the workflow author's code.

### Correct shapes

| SDK | Correct argument |
|---|---|
| Claude | `s.save(s.sessionId)` — pass the session ID; the runtime reads the transcript file |
| Copilot | `s.save(await s.session.getMessages())` — pass `SessionEvent[]` |
| OpenCode | `s.save(result.data!)` — pass the `{ info, parts }` object |

### ❌ Wrong

```ts
// Claude — saves the wrong thing
s.save(result.output);

// Copilot — saves an empty array if called before sendAndWait
s.save(await s.session.getMessages());
// Or saves one message object instead of the array
s.save((await s.session.getMessages()).at(-1));

// OpenCode — missing the data unwrap
s.save(result);
```

### ✅ Right

See the per-SDK examples in `SKILL.md` §"Write the Workflow File" and the
`SessionContext` reference table.

**Detection.** Read `s.transcript(name).content` in the next stage and
log the length. A 0-length or JSON-that-isn't-prose signature = F9.

---

## Loud failures (throw, but still worth knowing)

## F10. Copilot: `sendAndWait` default 60s timeout throws

**Symptom.** `Timeout after 60000ms waiting for session.idle`. Every
subsequent `ctx.stage()` call never executes — the throw propagates out of
`run()` and halts the workflow.

**Full write-up.** `agent-sessions.md` §"Critical pitfall: `sendAndWait` has
a 60-second default timeout".

**Fix.** Always pass an explicit timeout as the second argument.

```ts
const SEND_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
await s.session.sendAndWait({ prompt }, SEND_TIMEOUT_MS);
```

---

## F11. ~~Manual Claude session initialization~~ (resolved by runtime)

This failure mode is now handled automatically by the runtime. When using
`s.session.query()`, the runtime initializes the Claude CLI session during stage
setup before the user callback runs. Manual session initialization
is no longer needed — `s.client` and `s.session` arrive fully
initialized.

**Previously required (now unnecessary):**

```ts
// OLD — no longer needed; the runtime handles session initialization
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  // Manual init was required before the runtime managed lifecycle
  await s.session.query(ctx.userPrompt);
  s.save(s.sessionId);
});
```

**Current pattern:**

```ts
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  const result = await s.session.query(ctx.userPrompt);
  s.save(s.sessionId);
});
```

---

## F12. Provider-level resume tries to swap agents

**Symptom.** Resumed Copilot / OpenCode session behaves as the original
agent instead of the requested new one — or the SDK throws "agent mismatch"
on resume.

**Root cause.** Each session is **bound to one agent at creation time**.
`resumeSession` reattaches the conversation but does not change the agent.

**Fix.** Use provider-level resume only for multi-turn work within the same
role. To swap agents, create a new session (fresh) and forward context via
F5's pattern. In normal workflow code, prefer a same-stage multi-turn session
over trying to reopen a prior stage.

---

## F13. Parallel siblings read each other's transcripts

**Symptom.** `s.transcript("sibling-name")` inside a parallel session
throws or returns empty.

**Root cause.** `s.transcript()` only exposes **prior completed sessions** —
ones whose callback has returned and whose saves have flushed. Sessions
launched concurrently via `Promise.all([ctx.stage(...), ctx.stage(...)])` run
at the same time; forward-only data flow is enforced.

**Fix.** Restructure to either a linear chain, a "fan-out, then merge"
pattern where a subsequent session reads both, or use external
shared state (files, DB) if siblings genuinely need to coordinate.

```ts
// Fan-out → merge
await ctx.stage({ name: "describe" }, {}, {}, async (s) => { /* ... */ });

await Promise.all([
  ctx.stage({ name: "summarize-a" }, {}, {}, async (s) => {
    const d = await s.transcript("describe"); // OK — prior completed session
    // s.transcript("summarize-b") would fail here — sibling not yet complete
  }),
  ctx.stage({ name: "summarize-b" }, {}, {}, async (s) => {
    const d = await s.transcript("describe"); // OK — prior completed session
  }),
]);

await ctx.stage({ name: "merge" }, {}, {}, async (s) => {
  const a = await s.transcript("summarize-a"); // OK — prior completed session
  const b = await s.transcript("summarize-b"); // OK — prior completed session
});
```

---

## F14. Forgetting to `await` `ctx.stage()`

**Symptom.** A session runs (its tmux window opens, the agent does work)
but the orchestrator doesn't wait for it. Subsequent sessions that depend
on its output via `transcript()` or `getMessages()` see empty or missing
data. The workflow may finish "successfully" before the session's callback
has returned.

**Root cause.** `ctx.stage()` returns a `Promise<SessionHandle<T>>`.
Without `await`, the session is spawned but the `.run()` callback continues
immediately. The session's save never reaches the `completedRegistry`
before downstream code tries to read it.

**Affected SDKs.** All three — this is a TypeScript control-flow bug, not
SDK-specific.

### ❌ Wrong

```ts
// Missing await — session fires but orchestrator doesn't wait
ctx.stage({ name: "research" }, {}, {}, async (s) => {
  // ... agent work ...
  s.save(s.sessionId);
});

// This runs before "research" completes
await ctx.stage({ name: "synthesize" }, {}, {}, async (s) => {
  const r = await s.transcript("research"); // empty or throws
});
```

### ✅ Right

```ts
await ctx.stage({ name: "research" }, {}, {}, async (s) => {
  // ... agent work ...
  s.save(s.sessionId);
});

await ctx.stage({ name: "synthesize" }, {}, {}, async (s) => {
  const r = await s.transcript("research"); // works
});
```

**Detection.** If a session's graph node shows as "running" while
downstream sessions are already executing, you likely dropped an `await`.
TypeScript's `@typescript-eslint/no-floating-promises` lint rule catches
this at compile time.

---

## F15. Using a pending `SessionHandle` before completion

**Symptom.** `handle.result` is `undefined` or stale, or
`s.transcript(handle)` throws / returns empty even though the session
eventually completes.

**Root cause.** `ctx.stage()` returns a `SessionHandle<T>` whose
`.result` is only populated after the callback returns. If you store the
promise but access the handle before awaiting it, the result field is
not yet set and the session is not in the `completedRegistry`.

**Affected SDKs.** All three.

### ❌ Wrong

```ts
// Start both but access handles before awaiting
const handleA = ctx.stage({ name: "a" }, {}, {}, async (s) => { /* ... */ return 42; });
const handleB = ctx.stage({ name: "b" }, {}, {}, async (s) => {
  // handleA is a Promise, not a resolved SessionHandle
  const transcript = await s.transcript(handleA); // fails
});
```

### ✅ Right

```ts
// Await first, then use the resolved handle
const handleA = await ctx.stage({ name: "a" }, {}, {}, async (s) => { /* ... */ return 42; });

await ctx.stage({ name: "b" }, {}, {}, async (s) => {
  const transcript = await s.transcript(handleA); // works — handleA is resolved
  console.log(handleA.result); // 42
});
```

For parallel sessions, use `Promise.all()` and access handles only after
all promises resolve:

```ts
const [a, b] = await Promise.all([
  ctx.stage({ name: "a" }, {}, {}, async (s) => { /* ... */ return "x"; }),
  ctx.stage({ name: "b" }, {}, {}, async (s) => { /* ... */ return "y"; }),
]);
// a.result === "x", b.result === "y"
```

**Detection.** TypeScript's type system helps — `ctx.stage()` returns
`Promise<SessionHandle<T>>`, not `SessionHandle<T>` directly. If you're
accessing `.result` without awaiting, the type will be `Promise`, not `T`.

---

## Design checklist

Before shipping a multi-session workflow, walk the list:

- [ ] Every `s.session.sendAndWait` call passes an explicit timeout (F10)
- [ ] Every fresh-session handoff forwards context explicitly (F5)
- [ ] Every prompt whose output feeds a downstream stage explicitly requests trailing commentary (F6)
- [ ] Response-text extraction uses the per-SDK correct pattern (F1-F4)
- [ ] Structured-output parsers extract the LAST fenced block, not the first (F8)
- [ ] `s.save()` receives the per-SDK correct shape — Copilot uses `s.session.getMessages()` (F9)
- [ ] Loops over 10 iterations have a compaction / reset strategy (F7)
- [ ] Parallel groups only read from prior completed sessions, never siblings (F13)
- [ ] Every `ctx.stage()` call is `await`ed (F14)
- [ ] `SessionHandle` values are only used after the promise resolves (F15)
- [ ] If provider-level resume/fork is used at all, it stays within the same agent role (F12)
