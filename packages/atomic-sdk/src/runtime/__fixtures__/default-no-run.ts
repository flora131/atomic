/**
 * Fixture: a module with a default export that is NOT a workflow object
 * (no `run` function). Used by run-manager.test.ts to assert that
 * import validation surfaces an error rather than silently succeeding.
 */
export default {
  name: "not-a-workflow",
};
