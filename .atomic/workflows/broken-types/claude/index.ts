/**
 * Test workflow with TypeScript errors — should be filtered from list.
 */
import { defineWorkflow } from "@bastani/atomic/workflows";

// Type error: assigning a number to a string variable
const name: string = 42;

// Type error: calling a non-existent method
const result = name.nonExistentMethod();

export default defineWorkflow<"claude">({
  name: "broken-types",
  description: "This workflow has TypeScript errors and should NOT appear in the list",
})
  .run(async (ctx) => {
    await ctx.stage(
      { name: "broken", description: "This stage has type errors" },
      {},
      {},
      async (s) => {
        // Type error: passing wrong argument types
        await s.session.query(123 as unknown as string);
        s.save(result);
      },
    );
  })
  .compile();
