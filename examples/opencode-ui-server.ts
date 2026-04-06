/**
 * Demo: OpenCode TUI + Server Mode (Remote Puppeting)
 *
 * Analogous to copilot-ui-server.ts — connects to an ALREADY RUNNING
 * OpenCode TUI and controls it remotely via the SDK's tui.* API.
 *
 * Prerequisites:
 *   1. Start OpenCode with the server enabled in a separate terminal:
 *        opencode
 *   2. Note the server address (default: http://localhost:4096)
 *
 * Run:
 *   bun run examples/opencode-ui-server.ts
 *   bun run examples/opencode-ui-server.ts http://localhost:5000
 *
 * What happens:
 *   - The SDK connects to the ALREADY RUNNING OpenCode (no new process spawned)
 *   - tui.* calls control the TUI remotely (open dialogs, inject prompts, etc.)
 *   - You can create sessions, send prompts, and watch the TUI respond
 */

import { createOpencodeClient } from "@opencode-ai/sdk"
import * as readline from "node:readline"

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    }),
  )
}

async function main() {
  const baseUrl = process.argv[2] ?? "http://localhost:4096"

  console.log("═══════════════════════════════════════════════")
  console.log("  OpenCode SDK – TUI Remote-Control Demo")
  console.log("═══════════════════════════════════════════════\n")
  console.log(`Connecting to: ${baseUrl}\n`)

  // 1. Connect to the existing OpenCode server (no process spawned)
  const client = createOpencodeClient({ baseUrl })

  // 3. List existing sessions
  const sessions = await client.session.list()
  const sessionList = sessions.data ?? []
  console.log(`📋 Existing sessions: ${sessionList.length}`)
  for (const s of sessionList) {
    console.log(`   • ${s.id} — ${s.title ?? "(untitled)"}`)
  }
  console.log()

  // 4. Show a toast in the TUI
  console.log("── Showing toast in the TUI ──")
  await client.tui.showToast({
    body: { message: "👋 Hello from the SDK!", variant: "success" },
  })
  console.log("   ✅ Toast sent — check the TUI!\n")

  // 5. Open some TUI dialogs
  console.log("── Opening TUI dialogs ──\n")

  await prompt("   Press Enter to open the model selector in the TUI...")
  await client.tui.openModels()
  console.log("   ✅ Model selector opened\n")

  await prompt("   Press Enter to open the theme selector...")
  await client.tui.openThemes()
  console.log("   ✅ Theme selector opened\n")

  await prompt("   Press Enter to open the session selector...")
  await client.tui.openSessions()
  console.log("   ✅ Session selector opened\n")

  // 6. Puppet the prompt — inject text and submit
  console.log("── Puppeting the prompt ──\n")

  await client.tui.clearPrompt()
  await client.tui.appendPrompt({
    body: { text: "Say hello! I'm controlling you via the SDK." },
  })
  console.log("   ✅ Prompt text injected — check the TUI!")

  const submit = await prompt("   Submit the prompt? (y/n) → ")
  if (submit.toLowerCase() === "y") {
    await client.tui.submitPrompt()
    console.log("   ✅ Prompt submitted!\n")
  } else {
    console.log("   ⏭️  Skipped\n")
  }

  // 7. Create a session and send a prompt programmatically (headless path)
  console.log("── Headless session (no TUI puppeting) ──\n")

  const session = await client.session.create({
    body: { title: "SDK Remote Demo" },
  })
  console.log(`   📋 Created session: ${session.data?.id}`)

  const result = await client.session.prompt({
    path: { id: session.data!.id },
    body: {
      parts: [{ type: "text", text: "What is 2+2? Answer in one word." }],
    },
  })

  const parts = result.data?.parts ?? []
  for (const part of parts) {
    if (part.type === "text") {
      console.log(`   🤖 Response: ${part.text}`)
    }
  }

  // 8. Show completion toast
  await client.tui.showToast({
    body: { message: "Demo complete! 🎉", variant: "success" },
  })

  // Clean up the headless session
  await client.session.delete({ path: { id: session.data!.id } })
  console.log("\n👋 Done!")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
