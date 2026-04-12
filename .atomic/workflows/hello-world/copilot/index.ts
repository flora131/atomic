import { defineWorkflow } from "@bastani/atomic/workflows";

const SEND_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Build the greeting prompt from the structured inputs. The picker and
 * CLI flag parser both populate `ctx.inputs` — this workflow exercises
 * the full structured-input pipeline end to end.
 */
function buildHelloPrompt(inputs: Record<string, string>): string {
  const greeting = inputs.greeting ?? "Hello";
  const style = inputs.style ?? "casual";
  const notes = inputs.notes?.trim() ?? "";
  const base = `${greeting} Please respond with a ${style} hello-world greeting.`;
  return notes ? `${base}\n\nAdditional guidance:\n${notes}` : base;
}

export default defineWorkflow<"copilot">({
    name: "hello-world",
    description: "A simple single-session hello world workflow",
    inputs: [
      {
        name: "greeting",
        type: "string",
        required: true,
        description: "the opening phrase the agent should echo back",
        placeholder: "Hello, world!",
      },
      {
        name: "style",
        type: "enum",
        required: true,
        description: "tone of the response",
        values: ["formal", "casual", "robotic"],
        default: "casual",
      },
      {
        name: "notes",
        type: "text",
        description: "extra guidance for the agent (optional)",
        placeholder: "anything you want to add…",
      },
    ],
  })
  .run(async (ctx) => {
    const prompt = buildHelloPrompt(ctx.inputs);
    await ctx.stage(
      { name: "hello", description: "Say hello to the world" },
      {},
      {},
      async (s) => {
        await s.session.sendAndWait({ prompt }, SEND_TIMEOUT_MS);
        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
