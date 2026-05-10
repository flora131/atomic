import { defineWorkflow } from "../../define-workflow.ts";

export default defineWorkflow({
  name: "throws-on-run-wf",
  description: "fixture: run throws",
  inputs: [],
})
  .for("claude")
  .run(async () => {
    throw new Error("fixture deliberate run failure");
  })
  .compile();
