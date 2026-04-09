# User Input

Collecting user input mid-workflow is achieved through SDK-specific APIs. This is the programmatic equivalent of `.askUserQuestion()`.

## Claude

### Via `canUseTool` callback

The Claude Agent SDK provides a `canUseTool` callback for runtime approval and user interaction:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

// Inside a ctx.session() callback:
async (s) => {
  const result = query({
    prompt: "Implement the feature, but ask me before making any database changes.",
    options: {
      canUseTool: async (toolName, toolInput, options) => {
        if (toolName === "Write" && toolInput.file_path?.includes("migration")) {
          // Prompt the user for approval
          const approved = await promptUser("Allow database migration?");
          return approved
            ? { behavior: "allow" }
            : { behavior: "deny", message: "User declined migration" };
        }
        return { behavior: "allow" };
      },
    },
  });
  for await (const msg of result) { /* process */ }
},
```

### Via `AskUserQuestion` tool

Allow the agent to ask the user questions by including `AskUserQuestion` in `allowedTools`:

```ts
const result = query({
  prompt: ctx.userPrompt,
  options: {
    allowedTools: ["Read", "Write", "Edit", "Bash", "AskUserQuestion"],
  },
});
```

### Via streaming input

For interactive sessions, use streaming mode to feed user input:

```ts
const q = query({ prompt: ctx.userPrompt, options: { ... } });

// Feed additional input while the agent is running
q.streamInput("Here's the additional context you asked for...");
```

## Copilot

### Via `onUserInputRequest`

Handle `ask_user` tool requests from the agent:

```ts
const session = await client.createSession({
  onPermissionRequest: approveAll,
  onUserInputRequest: async (request) => {
    // request.question contains the agent's question
    // Return the user's answer
    const answer = await promptUser(request.question);
    return answer;
  },
});
```

### Via `onElicitationRequest`

For form-style UI with structured options:

```ts
const session = await client.createSession({
  onPermissionRequest: approveAll,
  onElicitationRequest: async (request) => {
    // request contains form fields and options
    // Return structured response
    return {
      action: "submit",
      values: { strategy: "conservative", confirm: true },
    };
  },
});
```

### Programmatic approval

For fully autonomous workflows, use `approveAll` to skip all permission prompts:

```ts
import { approveAll } from "@github/copilot-sdk";

const session = await client.createSession({
  onPermissionRequest: approveAll,
});
```

### Custom permission handling

For fine-grained control over permissions:

```ts
const session = await client.createSession({
  onPermissionRequest: async (request) => {
    // request.kind: "shell" | "write" | "read" | "mcp" | "custom-tool" | "url" | "memory" | "hook"
    if (request.kind === "shell" && request.command?.includes("rm -rf")) {
      return { kind: "denied-permanently", reason: "Dangerous command" };
    }
    return { kind: "approved" };
  },
});
```

## OpenCode

### Via TUI control endpoints

OpenCode uses TUI control endpoints for user interaction:

```ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

// Inside a ctx.session() callback:
async (s) => {
  const client = createOpencodeClient({ baseUrl: s.serverUrl });

  // Wait for the next TUI control request
  const controlRequest = await client.tui.next();

  // Respond to the control request
  await client.tui.response({
    requestID: controlRequest.data!.id,
    response: "User's answer here",
  });
},
```

### Via permission handling

Handle permission requests programmatically:

```ts
// Subscribe to events and handle permission requests
const unsubscribe = await client.event.subscribe((event) => {
  if (event.type === "permission.requested") {
    client.session.permission({
      sessionID: event.sessionID,
      permissionID: event.permissionID,
      approved: true,
    });
  }
});
```

## Combining user input with control flow

Use user input results in conditional logic:

```ts
// Inside a ctx.session() callback:
async (s) => {
  // Get the plan from a previous session
  const plan = await s.transcript("plan");
  await createClaudeSession({ paneId: s.paneId });

  // Ask the user (implementation depends on which SDK you're using)
  const approved = await getUserApproval(`Approve this plan?\n${plan.content}`);

  if (approved) {
    await claudeQuery({ paneId: s.paneId, prompt: "Execute the plan." });
  } else {
    await claudeQuery({ paneId: s.paneId, prompt: "Revise the plan." });
  }

  s.save(s.sessionId);
},
```
