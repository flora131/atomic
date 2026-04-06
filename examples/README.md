# SDK Examples

Examples demonstrating Copilot SDK and Claude Agent SDK capabilities.

---

## Claude Agent SDK – Session Inspector

Inspect, read, and resume local Claude Code sessions using the SDK's session
management APIs (`listSessions`, `getSessionMessages`, `resume`).

> **Note:** The Claude Agent SDK cannot attach to a *running* Claude Code
> process. Sessions are JSONL files on disk. "Resume" starts a new SDK process
> that loads prior conversation history, giving the agent full context.

```bash
# List sessions for the current project
bun run examples/claude-session-inspector.ts list

# Read messages from a specific session
bun run examples/claude-session-inspector.ts read <session-id>

# Resume a session with a follow-up (requires ANTHROPIC_API_KEY)
bun run examples/claude-session-inspector.ts resume <session-id> "fix the tests"

# Continue the most recent session (requires ANTHROPIC_API_KEY)
bun run examples/claude-session-inspector.ts continue "what did you change?"
```

---

## Copilot SDK – `session.ui` Demos

Two demos showing how `session.ui` (elicitation) works with the Copilot SDK.

---

## Demo 1: Headless (self-contained)

**No extra setup.** The SDK spawns the CLI internally. Your code handles
elicitation via `onElicitationRequest` — you build whatever UI you want
(here we use simple `readline` prompts).

```bash
bun run examples/copilot-ui-headless.ts
```

---

## Demo 2: TUI + Server mode

The CLI runs in its own terminal with the full TUI, and your SDK script
connects to it as an external client. The CLI's TUI renders the dialogs
natively — your script just calls `session.ui.confirm()` etc.

### Step 1 — Start the CLI in server mode

In **Terminal 1**:

```bash
copilot --ui-server --port 8080
```

This starts the interactive TUI **and** exposes a JSON-RPC server.
Note the port it prints (or check the logs). If it doesn't print a port,
the default is usually visible in the CLI output or you can pass
`--port 8080` if the flag is supported.

### Step 2 — Run the SDK demo

In **Terminal 2**, pass the server URL:

```bash
bun run examples/copilot-ui-server.ts localhost:8080
```

Replace `localhost:8080` with whatever address the CLI exposed.

The script will:
1. Connect to the running CLI (no new process spawned)
2. Query the foreground session
3. Create a new session and switch the TUI to it
4. Call `session.ui.confirm/select/input` — the dialogs appear **in Terminal 1's TUI**
5. Send a chat message and stream the response
6. Clean up

---

## What's the difference?

| | Headless | TUI + Server |
|---|---|---|
| Who spawns the CLI? | SDK (automatic) | You (manually) |
| Who renders dialogs? | Your `onElicitationRequest` handler | CLI's built-in TUI |
| Foreground session APIs? | ❌ | ✅ `getForeground` / `setForeground` |
| Multi-client? | N/A | ✅ Multiple SDK clients can connect |
| Best for… | Scripts, CI, custom UIs | Extending the interactive CLI |
