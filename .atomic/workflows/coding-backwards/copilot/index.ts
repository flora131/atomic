
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"copilot">({
  name: "coding-backwards",
  description: "A workflow to build software following the 'Coding Backwards' methodology.",
})
  .run(async (ctx) => {
    // Stage 1: Write the Readme
    const readme = await ctx.stage(
      { name: "write-readme", description: "Start by writing a detailed README for the project." },
      {},
      {},
      async (s) => {
        await s.session.send({
          prompt: `You are a helpful assistant that guides users through the "Coding Backwards" process.\n\nYour first task is to help the user write a README.md file for their new project. Interview them to write a detailed README covering architecture, data structure, future possibilities etc.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 2: Make Skeleton Files
    const skeleton = await ctx.stage(
      { name: "make-skeleton-files", description: "Create empty placeholder files and functions based on the README." },
      {},
      {},
      async (s) => {
        const transcript = await s.transcript(readme);
        await s.session.send({
          prompt: `Read the transcript from the previous step at ${transcript.path}. Create the file structure with empty files and placeholder functions described in the README. For each file, add a comment at the top with the file name.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 3: Progressive Build-n-Test
    const build = await ctx.stage(
      { name: "progressive-build-n-test", description: "Build and test the application incrementally." },
      {},
      {},
      async (s) => {
        const transcript = await s.transcript(skeleton);
        await s.session.send({
          prompt: `Read the transcript from the previous step at ${transcript.path}. Progressively build and test the application incrementally starting from the skeleton files.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 4: Explain it to Me
    await ctx.stage(
      { name: "explain-it-to-me", description: "Explain the code to the user to ensure understanding." },
      {},
      {},
      async (s) => {
        const transcript = await s.transcript(build);
        await s.session.send({
          prompt: `Read the transcript from the previous step at ${transcript.path}. Explain the implemented code block by block to the user so they learn while building.`
        });
        s.save(await s.session.getMessages());
      }
    );
  })
  .compile();
