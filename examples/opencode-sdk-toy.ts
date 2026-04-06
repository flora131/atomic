/**
 * Toy example: OpenCode SDK headless usage
 *
 * Starts a server, creates a session, sends a prompt, and prints the response.
 *
 * Usage:
 *   bun examples/opencode-sdk-toy.ts
 *
 * Note: There is no `session.ui` in the SDK. The SDK runs headlessly.
 *       The `tui.*` API exists to control an *already-running* TUI, not to launch one.
 */

import { createOpencode } from "@opencode-ai/sdk"

async function main() {
  console.log("⏳ Starting OpenCode server...")
  const { client, server } = await createOpencode({
    timeout: 10_000,
  })

  try {
    // Health check
    // const health = await client.global.health()
    // console.log(`✅ Server healthy — version ${health.data?.version}`)

    // Create a session
    const session = await client.session.create({
      body: { title: "Toy Example Session" },
    })
    console.log(`📋 Created session: ${session.data?.id}`)

    // Send a prompt
    console.log("💬 Sending prompt...")
    const result = await client.session.prompt({
      path: { id: session.data!.id },
      body: {
        parts: [{ type: "text", text: "Say hello in 10 words or fewer." }],
      },
    })

    // Print the assistant response parts
    const parts = result.data?.parts ?? []
    for (const part of parts) {
      if (part.type === "text") {
        console.log(`🤖 Response: ${part.text}`)
      }
    }

    // Clean up session
    await client.session.delete({ path: { id: session.data!.id } })
    console.log("🗑️  Session deleted")
  } finally {
    server.close()
    console.log("🛑 Server closed")
  }
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
