#!/usr/bin/env bun
import { defineWorkflow, type WorkflowDefinition } from "@bastani/atomic-sdk";

export default defineWorkflow({
  name: "demo-wf",
  description: "Demo workflow for SDK host integration test",
  inputs: [],
})
  .for("claude")
  .run(async (_ctx) => {
    // no-op run for fixture purposes
  })
  .compile() as unknown as WorkflowDefinition;

if (import.meta.main) {
  console.log("user main ran");
}
