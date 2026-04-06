/**
 * Demo 2: TUI + Server mode
 *
 * Prerequisites:
 *   1. Start the CLI with its TUI + server in a separate terminal:
 *        copilot --ui-server
 *   2. Note the server address (e.g. "localhost:8080")
 *
 * Run:  bun run examples/copilot-ui-server.ts <server-url>
 *
 * Example:
 *   bun run examples/copilot-ui-server.ts localhost:8080
 *   bun run examples/copilot-ui-server.ts 8080
 *   bun run examples/copilot-ui-server.ts http://127.0.0.1:9000
 *
 * What happens:
 *   - The SDK connects to the ALREADY RUNNING CLI (no new process spawned)
 *   - session.ui dialogs render IN THE CLI's TUI (Terminal 1)
 *   - Foreground session APIs (get/set) control which session the TUI shows
 */

import { CopilotClient, approveAll } from "@github/copilot-sdk";

async function main() {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error("Usage: bun run examples/copilot-ui-server.ts <server-url>");
    console.error("  e.g. bun run examples/copilot-ui-server.ts localhost:8080");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════");
  console.log("  Copilot SDK – TUI + Server Mode Demo");
  console.log("═══════════════════════════════════════════════\n");
  console.log(`Connecting to: ${serverUrl}\n`);

  // 1. Connect to the existing CLI server (no process spawned)
  const client = new CopilotClient({ cliUrl: serverUrl });
  await client.start();
  console.log("✅ Connected to CLI server\n");

  // 2. Check what session is currently in the foreground
  const currentFg = await client.getForegroundSessionId();
  console.log(`📺 Current foreground session: ${currentFg ?? "(none)"}\n`);

  // 3. List existing sessions
  const sessions = await client.listSessions();
  console.log(`📋 Existing sessions: ${sessions.length}`);
  for (const s of sessions) {
    console.log(`   • ${s.sessionId} — ${s.summary ?? "(no summary)"}`);
  }
  console.log();

  // 4. Listen for foreground changes
  const unsubFg = client.on("session.foreground", (event) => {
    console.log(`📺 Foreground changed → ${event.sessionId}`);
  });

  // 5. Create a new session
  const session = await client.createSession({
    onPermissionRequest: approveAll,
    // No onElicitationRequest needed — the TUI handles dialogs!
  });
  console.log(`✅ New session created: ${session.sessionId}`);
  console.log(`   Elicitation supported: ${session.capabilities.ui?.elicitation}\n`);

  // 6. Switch the TUI to our new session
  await client.setForegroundSessionId(session.sessionId);
  console.log("📺 Switched TUI to our session\n");

  // 7. Use session.ui — dialogs appear in the CLI's TUI (Terminal 1)!
  if (session.capabilities.ui?.elicitation) {
    console.log("── session.ui calls (look at the CLI TUI for dialogs!) ──\n");

    const ok = await session.ui.confirm("Proceed with the demo?");
    console.log(`   ➜ confirm: ${ok}`);

    const color = await session.ui.select("Pick a color", ["red", "green", "blue", "yellow"]);
    console.log(`   ➜ select: ${color}`);

    const name = await session.ui.input("Enter your name:", {
      title: "Name",
      minLength: 1,
      maxLength: 30,
    });
    console.log(`   ➜ input: ${name}`);

    const result = await session.ui.elicitation({
      message: "Configure settings",
      requestedSchema: {
        type: "object",
        properties: {
          theme: { type: "string", enum: ["light", "dark", "auto"] },
          notifications: { type: "boolean", default: true },
        },
        required: ["theme"],
      },
    });
    console.log(`   ➜ elicitation: ${result.action}`, result.content);
    console.log();
  } else {
    console.log("⚠️  Elicitation not available — the TUI may not support it.\n");
  }

  // 8. Send a message — the response streams in the TUI and here
  console.log("── Sending chat message ──\n");

  const done = new Promise<void>((resolve) => {
    session.on("assistant.message", (event) => {
      process.stdout.write(event.data.content);
    });
    session.on("session.idle", () => {
      console.log("\n");
      resolve();
    });
  });

  await session.send({ prompt: "Say hello! I connected to you via the SDK." });
  await done;

  // 9. Restore original foreground session if there was one
  if (currentFg) {
    await client.setForegroundSessionId(currentFg);
    console.log(`📺 Restored original foreground session: ${currentFg}`);
  }

  // 10. Clean up
  unsubFg();
  await session.disconnect();
  await client.stop();
  console.log("👋 Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
