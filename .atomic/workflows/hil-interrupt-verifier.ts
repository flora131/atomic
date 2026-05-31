import { defineWorkflow } from "@bastani/workflows";

function checkpointText(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "workflow HiL answer interrupt while main chat is blocked in ask_user_question";
}

export default defineWorkflow("hil-interrupt-verifier")
  .description(
    "Manual verifier for workflow HiL answer notices interrupting a blocking main-chat ask_user_question modal.",
  )
  .input("checkpoint", {
    type: "text",
    default: "workflow HiL answer interrupt while main chat is blocked in ask_user_question",
    description: "Short label included in the verifier prompt so you can identify this run.",
  })
  .run(async (ctx) => {
    const checkpoint = checkpointText(ctx.inputs.checkpoint);

    await ctx.stage("setup", { noTools: "all" }).prompt(
      [
        "This is a setup stage for the hil-interrupt-verifier workflow.",
        "Reply exactly: READY",
        "Do not ask questions. Do not call tools.",
      ].join("\n"),
    );

    const answer = await ctx.ui.select(
      [
        "HiL interrupt verifier prompt.",
        "",
        `Checkpoint: ${checkpoint}`,
        "",
        "Manual verification steps:",
        "1. Leave this workflow prompt pending.",
        "2. In the main chat, start any prompt that makes the assistant call ask_user_question so the main chat shows a blocking question modal.",
        "3. Return to this workflow prompt and choose the first option yourself in the workflow panel. Do not ask the main-chat assistant to send the workflow answer for you.",
        "",
        "Expected result after the fix: the main-chat ask_user_question modal is dismissed/aborted, and the main chat receives an interrupt notice saying this workflow HiL prompt was answered. The notice should include run/stage/prompt metadata and tell the assistant not to ask the same question again.",
      ].join("\n"),
      [
        "Answered while main chat ask_user_question was open",
        "Answered while main chat was idle",
        "Could not verify",
      ],
    );

    return {
      checkpoint,
      answer,
      expected: "Main chat receives workflows:hil-answer-notice via interrupt delivery immediately after this prompt is answered.",
    };
  })
  .compile();
