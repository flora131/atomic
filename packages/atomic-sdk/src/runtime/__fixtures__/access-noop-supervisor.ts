import { defineWorkflow } from "../../define-workflow.ts";

export default defineWorkflow({
  name: "access-noop-supervisor-wf",
  description: "fixture: accesses noop supervisor",
  inputs: [],
})
  .for("claude")
  .run(async (ctx) => {
    const sup = (ctx as unknown as {
      supervisor?: {
        sendInput(...args: unknown[]): void;
        getScrollback(...args: unknown[]): unknown;
      };
    }).supervisor;

    if (sup) {
      try { sup.sendInput("run-id", "stage", "data"); } catch { /* expected */ }
      try { sup.getScrollback("run-id", "stage", 0); } catch { /* expected */ }
    }
  })
  .compile();
