import { defineWorkflow } from "../../define-workflow.ts";

export default defineWorkflow({
  name: "with-one-stage-wf",
  description: "fixture: calls ctx.stage once",
  inputs: [],
})
  .for("claude")
  .run(async (ctx) => {
    await (ctx as unknown as { stage(name: string): Promise<unknown> }).stage("step-1");
  })
  .compile();
