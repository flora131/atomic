# User Input (mid-workflow)

This reference covers **mid-workflow** user interaction — pausing a running stage to ask the user a question, approve a permission, or confirm a decision. It's the programmatic equivalent of `.askUserQuestion()`.

For **invocation-time** inputs (the values the user supplies when they launch the workflow from the CLI or the picker), see `workflow-inputs.md` instead. Invocation-time inputs are declared on `defineWorkflow({ inputs: [...] })` and arrive in `ctx.inputs` before any stage starts — the workflow author reads them via `ctx.inputs.<name>`.

## Claude

Never import `query` from `@anthropic-ai/claude-agent-sdk` inside a stage
callback — that's the F17 anti-pattern (see `failure-modes.md` §F17). All
options route through `s.session.query(prompt, sdkOptions)` in headless
stages, or through `chatFlags` in interactive stages.

### Via `canUseTool` callback (headless stages only)

`canUseTool` is an SDK option — it only applies in a headless stage, where
the second argument to `s.session.query()` is forwarded to the Agent SDK as
`Partial<SDKOptions>`. In interactive stages the option is silently ignored
because `s.session.query()` is driving the `claude` CLI binary, not the SDK.

```ts
await ctx.stage(
  { name: "implement", headless: true },
  {}, {},
  async (s) => {
    const messages = await s.session.query(
      "Implement the feature, but ask me before making any database changes.",
      {
        canUseTool: async (toolName, toolInput) => {
          if (toolName === "Write" && typeof toolInput.file_path === "string" && toolInput.file_path.includes("migration")) {
            const approved = await promptUser("Allow database migration?");
            return approved
              ? { behavior: "allow", updatedInput: toolInput }
              : { behavior: "deny", message: "User declined migration" };
          }
          return { behavior: "allow", updatedInput: toolInput };
        },
      },
    );
    s.save(s.sessionId);
    return extractAssistantText(messages, 0);
  },
);
```

### Via `AskUserQuestion` tool

Allow the agent to ask the user questions by including `AskUserQuestion` in
`allowedTools`. This works for both interactive stages (via `chatFlags`) and
headless stages (via sdkOptions on `s.session.query()`).

**Interactive stage** — pass the tool allowlist via `chatFlags`:

```ts
await ctx.stage(
  { name: "implement" },
  { chatFlags: ["--allowed-tools", "Read,Write,Edit,Bash,AskUserQuestion"] },
  {},
  async (s) => {
    await s.session.query(s.inputs.prompt ?? "");
    s.save(s.sessionId);
  },
);
```

**Headless stage** — pass `allowedTools` in the sdkOptions:

```ts
await ctx.stage(
  { name: "implement", headless: true },
  {}, {},
  async (s) => {
    const messages = await s.session.query(s.inputs.prompt ?? "", {
      allowedTools: ["Read", "Write", "Edit", "Bash", "AskUserQuestion"],
    });
    s.save(s.sessionId);
    return extractAssistantText(messages, 0);
  },
);
```

### Via streaming input (headless stages only)

The Agent SDK's `streamInput()` feeds additional input while a query is
running. It's only reachable from headless stages via an async iterable
prompt — pass an `AsyncIterable<SDKUserMessage>` as the first argument to
`s.session.query()` instead of a plain string. In interactive stages, send
follow-up turns with another `s.session.query()` call to the same session.

## Copilot

Session callbacks (`onUserInputRequest`, `onElicitationRequest`,
`onPermissionRequest`) are passed as `sessionOpts` — the third argument to
`ctx.stage()`. The runtime forwards them to `client.createSession()`.
`onPermissionRequest` defaults to `approveAll` when not specified.

### Via `onUserInputRequest`

Handle `ask_user` tool requests from the agent:

```ts
await ctx.stage({ name: "plan" }, {}, {
  onUserInputRequest: async (request) => {
    // request.question contains the agent's question
    const answer = await promptUser(request.question);
    return answer;
  },
}, async (s) => {
  await s.session.send({ prompt: (ctx.inputs.prompt ?? "") });
  s.save(await s.session.getMessages());
});
```

### Via `onElicitationRequest`

For form-style UI with structured options:

```ts
await ctx.stage({ name: "plan" }, {}, {
  onPermissionRequest: approveAll,
  onElicitationRequest: async (request) => {
    // request contains form fields and options
    return {
      action: "submit",
      values: { strategy: "conservative", confirm: true },
    };
  },
}, async (s) => {
  await s.session.send({ prompt: (ctx.inputs.prompt ?? "") });
  s.save(await s.session.getMessages());
});
```

### Programmatic approval

For fully autonomous workflows, use `approveAll` to skip all permission prompts.
This is the **default** when `onPermissionRequest` is not specified in `sessionOpts`:

```ts
import { approveAll } from "@github/copilot-sdk";

// Explicit (same as the default):
await ctx.stage({ name: "plan" }, {}, { onPermissionRequest: approveAll }, async (s) => {
  await s.session.send({ prompt: (ctx.inputs.prompt ?? "") });
  s.save(await s.session.getMessages());
});
```

### Custom permission handling

For fine-grained control over permissions:

```ts
await ctx.stage({ name: "plan" }, {}, {
  onPermissionRequest: async (request) => {
    // request.kind: "shell" | "write" | "read" | "mcp" | "custom-tool" | "url" | "memory" | "hook"
    if (request.kind === "shell" && request.command?.includes("rm -rf")) {
      return { kind: "denied-permanently", reason: "Dangerous command" };
    }
    return { kind: "approved" };
  },
}, async (s) => {
  await s.session.send({ prompt: (ctx.inputs.prompt ?? "") });
  s.save(await s.session.getMessages());
});
```

## OpenCode

The `s.client` and `s.session` are auto-created by the runtime. Use them
directly — no manual client creation needed.

### Via TUI control endpoints

OpenCode uses TUI control endpoints for user interaction:

```ts
// Inside a ctx.stage() callback:
async (s) => {
  // Wait for the next TUI control request
  const controlRequest = await s.client.tui.next();

  // Respond to the control request
  await s.client.tui.response({
    requestID: controlRequest.data!.id,
    response: "User's answer here",
  });
},
```

### Via permission handling

Handle permission requests programmatically:

```ts
// Inside a ctx.stage() callback:
async (s) => {
  // Subscribe to events and handle permission requests
  const unsubscribe = await s.client.event.subscribe((event) => {
    if (event.type === "permission.requested") {
      s.client.session.permission({
        sessionID: event.sessionID,
        permissionID: event.permissionID,
        approved: true,
      });
    }
  });
},
```

## Combining user input with control flow

Use user input results in conditional logic. This Claude example uses
`AskUserQuestion` by including it in `allowedTools` — the agent asks the
user directly, and you parse the response to branch:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

// Inside a ctx.stage() callback (Claude example):
async (s) => {
  const plan = await s.transcript("plan");

  // Let the agent ask the user for approval via AskUserQuestion
  const result = await s.session.query(
    `Here is the plan:\n${plan.content}\n\nAsk the user if they approve this plan. ` +
    `If they approve, execute it. If not, revise it based on their feedback.`,
  );

  s.save(s.sessionId);
},
```

For Copilot, use `onUserInputRequest` in `sessionOpts` (see above). For
OpenCode, use the TUI control endpoints.
