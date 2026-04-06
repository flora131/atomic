/**
 * Demo 1: Headless elicitation (self-contained)
 *
 * The SDK spawns the CLI internally. Elicitation dialogs are handled by YOUR
 * code via the `onElicitationRequest` callback — here we use simple readline
 * prompts, but you could render a web form, Slack modal, etc.
 *
 * Run:  bun run examples/copilot-ui-headless.ts
 */

import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type { ElicitationContext, ElicitationResult, ElicitationSchema } from "@github/copilot-sdk";
import * as readline from "node:readline";

// ── Helpers ──────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

function renderSchema(schema: ElicitationSchema): string {
  return JSON.stringify(schema, null, 2);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Copilot SDK – Headless Elicitation Demo");
  console.log("═══════════════════════════════════════════════\n");

  // 1. Start the SDK client (spawns the CLI process internally)
  const client = new CopilotClient();
  await client.start();
  console.log("✅ Client started\n");

  // 2. Create a session WITH an elicitation handler
  //    This is what enables session.capabilities.ui.elicitation
  const session = await client.createSession({
    onPermissionRequest: approveAll,

    onElicitationRequest: async (ctx: ElicitationContext): Promise<ElicitationResult> => {
      console.log("┌────────────────────────────────────────────");
      console.log(`│ 📋 Elicitation from: ${ctx.elicitationSource ?? "SDK"}`);
      console.log(`│ 💬 ${ctx.message}`);
      if (ctx.requestedSchema) {
        console.log(`│ Schema: ${renderSchema(ctx.requestedSchema)}`);
      }
      console.log("└────────────────────────────────────────────");

      const answer = await prompt("   Accept? (y/n) → ");
      if (answer.toLowerCase() !== "y") {
        return { action: "decline" };
      }

      // Build response content from schema properties
      const schema = ctx.requestedSchema;
      const content: Record<string, string | boolean> = {};

      if (schema?.properties) {
        for (const [key, def] of Object.entries(schema.properties)) {
          if (def.type === "boolean") {
            const val = await prompt(`   ${key} (true/false) → `);
            content[key] = val.toLowerCase() === "true";
          } else if ("enum" in def && def.enum) {
            const options = def.enum.join(", ");
            const val = await prompt(`   ${key} [${options}] → `);
            content[key] = val;
          } else {
            const val = await prompt(`   ${key} → `);
            content[key] = val;
          }
        }
      }

      return { action: "accept", content };
    },
  });

  console.log(`✅ Session created: ${session.sessionId}`);
  console.log(`   Elicitation supported: ${session.capabilities.ui?.elicitation}\n`);

  // 3. Exercise the session.ui convenience methods
  //    Each call triggers our onElicitationRequest handler above
  if (session.capabilities.ui?.elicitation) {
    console.log("── Calling session.ui methods ──\n");

    // confirm()
    const ok = await session.ui.confirm("Ready to proceed?");
    console.log(`   ➜ confirm result: ${ok}\n`);

    // select()
    const lang = await session.ui.select("Favorite language?", [
      "TypeScript",
      "Rust",
      "Go",
      "Python",
    ]);
    console.log(`   ➜ select result: ${lang}\n`);

    // input()
    const name = await session.ui.input("What's your name?", {
      title: "Name",
      minLength: 1,
      maxLength: 50,
    });
    console.log(`   ➜ input result: ${name}\n`);

    // Generic elicitation with full schema
    const result = await session.ui.elicitation({
      message: "Configure deployment",
      requestedSchema: {
        type: "object",
        properties: {
          region: { type: "string", enum: ["us-east", "eu-west", "ap-south"] },
          dryRun: { type: "boolean", default: true },
        },
        required: ["region"],
      },
    });
    console.log(`   ➜ elicitation result: ${result.action}`, result.content, "\n");
  }

  // 4. Send a chat message to prove the session works end-to-end
  console.log("── Sending a chat message ──\n");

  const done = new Promise<void>((resolve) => {
    session.on("assistant.message", (event) => {
      process.stdout.write(event.data.content);
    });
    session.on("session.idle", () => {
      console.log("\n");
      resolve();
    });
  });

  await session.send({ prompt: "Say hello and tell me a fun fact in under 30 words." });
  await done;

  // 5. Clean up
  await session.disconnect();
  await client.stop();
  console.log("👋 Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
