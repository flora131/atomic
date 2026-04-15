import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"copilot">({
  name: "coding-backwards-design",
  description: "Restylize a website using the Coding Backwards methodology: Readme first, skeletons, progressive build, and documentation.",
  inputs: [
    {
      name: "target_url",
      type: "string",
      required: false,
      description: "The URL of the website to analyze and restylize",
      placeholder: "https://jamesbuckhouse.com",
    },
    {
      name: "design_reference",
      type: "text",
      required: false,
      description: "Design concept or reference image/theme to apply",
      placeholder: "Big Sur art theme",
    },
    {
      name: "dev_command",
      type: "string",
      required: false,
      description: "Command to start the local dev server",
      placeholder: "npm run dev",
    }
  ],
})
  .run(async (ctx) => {
    // Stage 1: Visual Analysis (Playwright)
    const analysis = await ctx.stage(
      { name: "visual-analysis", description: "Use Playwright CLI to visually analyze the existing site." },
      {}, {},
      async (s) => {
        await s.session.send({
          prompt: `You are an expert Frontend Architect. Use 'playwright-cli' to crawl ${ctx.inputs.target_url}. 
          Extract the DOM/layout structure and document the core UX elements.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 2: Critique
    const critique = await ctx.stage(
      { name: "design-critique", description: "Critique the current design against the target aesthetic." },
      {}, {},
      async (s) => {
        const transcript = await s.transcript(analysis);
        await s.session.send({
          prompt: `Read the visual analysis at ${transcript.path}. Use the 'critique' skill to evaluate the design against this target aesthetic: "${ctx.inputs.design_reference}". 
          List the exact CSS, spacing, and typographic transformations required.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 3: Write the Readme (Coding Backwards - Step 1)
    const readme = await ctx.stage(
      { name: "write-readme", description: "Write the architectural plan as if the project is already finished." },
      {}, {},
      async (s) => {
        const transcript = await s.transcript(critique);
        await s.session.send({
          prompt: `Read the critique at ${transcript.path}. Do NOT write any application code yet. 
          Write a comprehensive 'DESIGN_README.md' for this project. It must include:
          - Project outcomes (how the "${ctx.inputs.design_reference}" aesthetic is achieved).
          - The exact file structure needed for the new design components.
          - The CSS architecture (e.g., variables, utility classes).
          Save this file to the root directory.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 4: Make Skeleton Files (Coding backwards - Step 2)
    const skeletons = await ctx.stage(
      { name: "make-skeletons", description: "Create empty placeholder files and functions." },
      {}, {},
      async (s) => {
        const transcript = await s.transcript(readme);
        await s.session.send({
          prompt: `Read the DESIGN_README.md referenced in ${transcript.path}. 
          Create the necessary skeleton files for the updated components. 
          Only write empty placeholder functions and basic structural exports. Do NOT implement the actual CSS or logic yet.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 5: Progressive Build-n-Test (Coding Backwards - Step 3)
    const implement = await ctx.stage(
      { name: "progressive-build", description: "Iteratively build out the UI using a ralph loop." },
      {}, {},
      async (s) => {
        const transcript = await s.transcript(skeletons);
        const devInstructions = ctx.inputs.dev_command
          ? `Run '${ctx.inputs.dev_command}' to start the local web server and enable hot-reloading.`
          : `Assume the local development server is already running.`;

        await s.session.send({
          prompt: `Read the skeleton structure established in ${transcript.path}. 
          ${devInstructions}
          Use a ralph loop to implement the code PROGRESSIVELY. 
          1. Pick one skeleton component.
          2. Implement the styling for that specific component to match the "${ctx.inputs.design_reference}" aesthetic.
          3. Save, observe the hot-reload or compiler errors, and fix them.
          4. Do not move on to the next component until the current one is rendering correctly.`
        });
        s.save(await s.session.getMessages());
      }
    );

    // Stage 6: Explain It To Me & Visual QA (Coding Backwards - Step 4)
    await ctx.stage(
      { name: "explain-and-qa", description: "Comment the codebase and perform final visual validation." },
      {}, {},
      async (s) => {
        const transcript = await s.transcript(implement);
        await s.session.send({
          prompt: `Read the implementation history at ${transcript.path}. 
          First, go through the newly written code and add 'Explain it to me' style comments. Explain *why* specific CSS or layout choices were made so a human developer can learn from it.
          Second, use 'playwright-cli' to take screenshots of the final local site and verify it matches the intent of "${ctx.inputs.design_reference}".`
        });
        s.save(await s.session.getMessages());
      }
    );
  })
  .compile();