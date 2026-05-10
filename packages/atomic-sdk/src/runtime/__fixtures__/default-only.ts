/**
 * Fixture: a workflow file that exports the compiled definition as the
 * module default.
 */
import { defineWorkflow } from "../../define-workflow.ts";

export default defineWorkflow({
  name: "default-only-wf",
  description: "fixture: default-export workflow",
  inputs: [],
})
  .for("claude")
  .run(async () => {})
  .compile();
