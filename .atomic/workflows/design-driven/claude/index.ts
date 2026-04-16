/**
 * Design-Driven workflow for Claude Code — a generalized "Coding Backwards"
 * frontend implementation pipeline.
 *
 * Works with any design source: live websites, screenshots, Figma references,
 * written design briefs, or aesthetic descriptions. The agent makes judgment
 * calls about tooling, technology, and implementation strategy — the workflow
 * orchestrates the stages and enforces quality via a Ralph-style review loop.
 *
 * Stages:
 *   1. Design Discovery     — Analyze whatever references are provided
 *   2. Design Critique       — Evaluate and produce transformation requirements
 *   3. Architecture Plan     — "Coding Backwards" Step 1: Write the README
 *   4. Scaffold              — "Coding Backwards" Step 2: Create skeleton files
 *   5. Progressive Build     — "Coding Backwards" Step 3: Iterative implementation
 *   6. QA + Review/Debug     — Ralph-style bounded loop with dual reviewers
 *   7. Documentation         — Code comments and final screenshot
 *
 * Run: atomic workflow -n coding-backwards-design -a claude "<your spec>"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";
import { query as claudeSdkQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  buildInfraDiscoveryPrompts,
  buildReviewPrompt,
  buildDebuggerReportPrompt,
  extractMarkdownBlock,
  filterActionable,
  mergeReviewResults,
  REVIEW_RESULT_JSON_SCHEMA,
  type ReviewResult,
  type StructuredReviewResult,
} from "../../../../src/sdk/workflows/builtin/ralph/helpers/prompts.ts";
import { hasActionableFindings } from "../../../../src/sdk/workflows/builtin/ralph/helpers/review.ts";
import { captureBranchChangeset } from "../../../../src/sdk/workflows/builtin/ralph/helpers/git.ts";

const MAX_QA_LOOPS = 5;

// ── Component plan structured output for parallel builds ─────────
interface ComponentInfo {
  name: string;
  files: string[];
  description: string;
}

interface ComponentPhase {
  priority: string;
  components: ComponentInfo[];
}

interface ComponentPlan {
  phases: ComponentPhase[];
}

const COMPONENT_PLAN_JSON_SCHEMA = {
  name: "component_plan",
  description: "Components organized by implementation priority phase",
  strict: true,
  schema: {
    type: "object",
    properties: {
      phases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            priority: { type: "string" },
            components: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  files: {
                    type: "array",
                    items: { type: "string" },
                  },
                  description: { type: "string" },
                },
                required: ["name", "files", "description"],
                additionalProperties: false,
              },
            },
          },
          required: ["priority", "components"],
          additionalProperties: false,
        },
      },
    },
    required: ["phases"],
    additionalProperties: false,
  },
};

async function queryWithComponentPlan(
  prompt: string,
): Promise<ComponentPlan | null> {
  let structured: ComponentPlan | null = null;
  for await (const msg of claudeSdkQuery({
    prompt,
    options: {
      outputFormat: {
        type: "json_schema",
        schema: COMPONENT_PLAN_JSON_SCHEMA,
      },
    },
  })) {
    if (msg.type === "result") {
      if (
        msg.subtype === "success" &&
        (msg as Record<string, unknown>).structured_output
      ) {
        structured = (msg as Record<string, unknown>)
          .structured_output as ComponentPlan;
      }
    }
  }
  return structured;
}

async function queryWithStructuredOutput(
  prompt: string,
): Promise<StructuredReviewResult> {
  let structured: ReviewResult | null = null;
  let raw = "";
  for await (const msg of claudeSdkQuery({
    prompt,
    options: {
      outputFormat: {
        type: "json_schema",
        schema: REVIEW_RESULT_JSON_SCHEMA,
      },
    },
  })) {
    if (msg.type === "result") {
      raw = String((msg as Record<string, unknown>).output ?? "");
      if (
        msg.subtype === "success" &&
        (msg as Record<string, unknown>).structured_output
      ) {
        structured = (msg as Record<string, unknown>)
          .structured_output as ReviewResult;
      }
    }
  }
  return {
    structured: structured ? filterActionable(structured) : null,
    raw,
  };
}

function asAgentCall(agentName: string, prompt: string): string {
  return `@"${agentName} (agent)" ${prompt}`;
}

export default defineWorkflow<"claude">({
  name: "coding-backwards-design",
  description:
    "Design-driven frontend implementation using the Coding Backwards methodology: design discovery, critique, readme-first architecture, scaffolding, progressive build, and visual QA with a Ralph-style review loop.",
  inputs: [
    {
      name: "spec",
      type: "text",
      required: true,
      description:
        "What to build. Describe the frontend you want — could be a clone of a site, a new design from references, a component library, etc.",
      placeholder:
        'Clone and restylize jamesbuckhouse.com with a "Big Sur art" theme',
    },
    {
      name: "design_reference",
      type: "text",
      required: false,
      description:
        "Design references to analyze. Can be URLs to live sites, paths to screenshots/images, Figma links, aesthetic descriptions, or any combination.",
      placeholder:
        "https://jamesbuckhouse.com, reference-screenshot.png, Big Sur art theme",
    },
    {
      name: "dev_command",
      type: "string",
      required: false,
      description: "Command to start the local dev server",
      placeholder: "bun run preview/server.js",
    },
  ],
})
  .run(async (ctx) => {
    const spec = ctx.inputs.spec ?? "";
    const designRef = ctx.inputs.design_reference ?? "";
    const devCommand = ctx.inputs.dev_command || "bun run preview/server.js";

    // ──────────────────────────────────────────────────────────────
    // Stage 1: Design Discovery
    //
    // Analyze whatever design references are provided. The agent
    // decides how to extract information based on the input type:
    // URLs → playwright, images → read them, descriptions → parse.
    // The output is always a structured design brief.
    // ──────────────────────────────────────────────────────────────
    const discovery = await ctx.stage(
      {
        name: "design-discovery",
        description:
          "Analyze design references and extract all content, structure, and visual details into a structured design brief.",
      },
      {},
      {},
      async (s) => {
        await s.session.query(
          `You are an expert design analyst. Your job is to produce a COMPLETE design brief by analyzing the provided references.

## Specification

<spec>
${spec}
</spec>

## Design References

<design_reference>
${designRef}
</design_reference>

## Your Task

Analyze every design reference provided above. Use the best tool for each reference type:

- **Live URLs**: Use 'playwright-cli' to open the site, take full-page and section screenshots, capture the DOM via 'snapshot', and run JavaScript to extract all images, text, links, and metadata. Scroll to trigger lazy-loaded content.
- **Image files** (screenshots, mockups): Read and analyze them visually for layout, typography, colors, spacing, and component patterns.
- **Figma links**: Use 'playwright-cli' to open and capture the designs. Extract component structures, spacing, and tokens.
- **Text descriptions**: Parse for aesthetic direction, constraints, and requirements.

## What to Extract

Produce a file called 'DESIGN_BRIEF.md' in the project root with ALL of the following (where applicable):

### Content Inventory
- Every piece of text content (headings, body copy, labels, nav items, footer text)
- Every image with its source URL or file path, alt text, approximate dimensions, and where it appears
- Every link with its text and href
- Any metadata (dates, categories, counts, etc.)

### Layout & Structure
- What sections/pages exist and their order
- Layout type for each section (grid, list, hero, sidebar, etc.)
- Number of items in each collection/grid
- Navigation structure and routes

### Visual Design Tokens
- Color palette (backgrounds, text, accents, borders)
- Typography (font families, sizes, weights, line heights)
- Spacing rhythm (padding, margins, gaps)
- Border radii, shadows, elevation levels
- Any effects (blur, gradients, overlays, animations)

### Component Patterns
- Identify every distinct component type (cards, buttons, navbars, modals, etc.)
- For each: dimensions, spacing, visual treatment, interaction states

### Screenshots & References
Save reference screenshots to the project root:
- Full-page overview as 'reference-screenshot.png'
- Individual section screenshots as 'reference-{section-name}.png'

CRITICAL RULES:
- Do NOT invent or fabricate any content. Only record what actually exists in the references.
- Every image URL must be real and working. If you cannot extract an image URL, note that explicitly.
- If a reference is inaccessible, document what you can observe and note the gap.`,
        );
        s.save(s.sessionId);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Stage 2: Design Critique
    //
    // Evaluate the design brief against the target spec and produce
    // concrete transformation requirements.
    // ──────────────────────────────────────────────────────────────
    const critique = await ctx.stage(
      {
        name: "design-critique",
        description:
          "Critique the design brief against the target specification and produce transformation requirements.",
      },
      {},
      {},
      async (s) => {
        const discoveryTranscript = await s.transcript(discovery);
        await s.session.query(
          `Read the design brief at ${discoveryTranscript.path}.

## Specification

<spec>
${spec}
</spec>

Use the 'critique' skill to evaluate the design references against the target specification.

Your critique must produce CONCRETE transformation requirements:

1. **Content Strategy**: How should content from the references be used in the implementation?
   - Which content is carried over vs. created new?
   - How should images be displayed (real images via <img> tags, never placeholder divs)?
   - What text content maps to which components?

2. **Component Specifications**: For every component identified in the design brief:
   - Exact CSS properties needed (or equivalent in the chosen technology)
   - Dimensions, spacing, colors, typography
   - Interaction states (hover, focus, active, disabled)

3. **Layout Requirements**: Grid/flex structures, responsive behavior, breakpoints.

4. **Technology Recommendations**: Based on the spec, what's the best approach?
   - Plain HTML/CSS/JS? React? Tailwind? Something else?
   - Let the spec and complexity guide this decision.

5. **Visual Identity**: Specific design tokens (colors, radii, shadows, fonts, transitions) needed.

CRITICAL: If the design involves displaying images or artwork from references, the critique must make clear that ALL such content uses real image URLs/sources, never colored placeholder divs. Real content is the hero — the design must frame and enhance it.`,
        );
        s.save(s.sessionId);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Stage 3: Architecture Plan (Coding Backwards — Step 1)
    //
    // Write the architectural plan as if the project is already
    // finished. Technology-agnostic — the agent decides what fits.
    // ──────────────────────────────────────────────────────────────
    const architecturePlan = await ctx.stage(
      {
        name: "architecture-plan",
        description:
          "Write the architectural plan (DESIGN_README.md) as if the project is already finished.",
      },
      {},
      {},
      async (s) => {
        const discoveryTranscript = await s.transcript(discovery);
        const critiqueTranscript = await s.transcript(critique);
        await s.session.query(
          `Read the design brief at ${discoveryTranscript.path} and the critique at ${critiqueTranscript.path}.

Do NOT write any application code yet.

Write a comprehensive 'DESIGN_README.md' for this project. Write it as if the project is ALREADY FINISHED — describe what was built, not what will be built. This is the "Coding Backwards" methodology: writing the documentation first forces clarity about what we're building.

The README must include:

1. **Project Overview**: What was built and why. How the design specification was achieved.

2. **Content Integration Plan**:
   - List every piece of real content (images, text, links) and how it appears in the implementation.
   - If images from external sources are used, specify the exact URLs and how they're referenced in markup.
   - NO placeholder content where real content exists. Every piece of content from the design references must be used.

3. **File Structure**: The exact files created, organized by purpose.

4. **Design System / Tokens**:
   - Color tokens, typography scale, spacing rhythm, shadows, radii, transitions
   - Whatever format fits the chosen technology (CSS custom properties, Tailwind config, JS theme object, etc.)

5. **Component Specifications**: For each component:
   - Purpose and behavior
   - Key implementation details
   - Interaction states

6. **Implementation Priority Order** (P0 through P3):
   - P0: Foundation (tokens, base styles, layout primitives)
   - P1: Core components (the main content-bearing elements)
   - P2: Secondary components (supporting UI)
   - P3: Polish (animations, states, edge cases)

7. **Dev Server & Preview**: How to run and preview the project locally.

Save DESIGN_README.md to the project root.

The choice of technology, file structure, and architecture is YOURS based on what best serves the specification. For example:
- A simple portfolio clone might use plain HTML/CSS/JS
- A component library might use React + Tailwind
- A complex app might need a framework with routing

Choose what fits. The README should justify the choice.`,
        );
        s.save(s.sessionId);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Stage 4: Scaffold (Coding Backwards — Step 2)
    //
    // Create all files with structure and real content wired in.
    // Technology decisions from the architecture plan are followed.
    // ──────────────────────────────────────────────────────────────
    const scaffold = await ctx.stage(
      {
        name: "scaffold",
        description:
          "Create scaffold files with real content wired in, following the architecture plan.",
      },
      {},
      {},
      async (s) => {
        const discoveryTranscript = await s.transcript(discovery);
        const planTranscript = await s.transcript(architecturePlan);
        await s.session.query(
          `Read the DESIGN_README.md referenced in ${planTranscript.path} and the design brief at ${discoveryTranscript.path}.

Create all the scaffold files as specified in DESIGN_README.md. This is "Coding Backwards" Step 2: create every file with its structure, real content, and clear TODOs for visual implementation.

## Key Principles

1. **Real content first**: Every piece of content from the design brief must be wired into the scaffold. Images use real URLs via proper markup (e.g., <img src="..." alt="...">), text content uses the real text, links use real hrefs. No placeholders where real content exists.

2. **Structure before style**: Files should have correct structure (HTML elements, component hierarchy, module exports) but visual styling can be partially deferred with TODO comments for the progressive build stage.

3. **Foundation values present**: Design tokens (colors, spacing, typography, etc.) should have their REAL values from the critique — these aren't "empty" since later stages depend on them.

4. **Working preview**: Create a dev server setup so the scaffold can be viewed immediately, even before visual polish is applied. The dev server command should match: ${devCommand}

5. **Technology alignment**: Use whatever technology the DESIGN_README.md specifies. The scaffold structure should follow the file structure documented there.

After creating all files, verify that:
- The dev server can start successfully
- Real content is wired in (no empty image sources, no lorem ipsum where real text exists)
- The file structure matches DESIGN_README.md`,
        );
        s.save(s.sessionId);
      },
    );

    // ──────────────────────────────────────────────────────────────
    // Stage 5: Progressive Build (Coding Backwards — Step 3)
    //
    // Extract a structured component plan, then build independent
    // components in parallel within each priority phase. A shared
    // Playwright verification gate after each phase ensures visual
    // correctness before advancing to the next priority level.
    // ──────────────────────────────────────────────────────────────

    // Track the last verification stage for QA context
    let lastVerifyStage = scaffold;

    // ── 5a: Extract structured component plan ────────────────────
    const componentPlan = await ctx.stage(
      {
        name: "component-plan",
        description:
          "Extract structured component build plan from DESIGN_README.md",
      },
      {},
      {},
      async (s) => {
        const scaffoldTranscript = await s.transcript(scaffold);
        const plan = await queryWithComponentPlan(
          `Read the DESIGN_README.md in the project root and the scaffold transcript at ${scaffoldTranscript.path}.

Extract a structured implementation plan organized by priority phase (P0, P1, P2, P3).

For each phase, list every component that needs to be implemented:
- **name**: A short kebab-case identifier (e.g., "navbar", "hero-section", "artwork-card").
- **files**: The specific files this component touches (e.g., ["src/css/components/navbar.css", "src/js/Navbar.js"]).
- **description**: What needs to be implemented — the visual properties, interactions, and styling left as TODOs in the scaffold.

IMPORTANT:
- Each component must be independently implementable within its priority phase.
- Files listed for one component must NOT overlap with files for another component in the SAME phase. If two components share a file, group them as one component.
- Foundation work (P0) like design tokens, base styles, and utility classes should be a SINGLE component since they form an interdependent foundation.
- Order phases strictly: P0, P1, P2, P3.`,
        );
        s.save(s.sessionId);
        return plan;
      },
    );

    // ── 5b: Build each priority phase ────────────────────────────
    // Components within a phase are built in parallel via separate
    // subagent stages; phases run sequentially so each level can
    // depend on the foundation laid by the previous one.
    const phases = componentPlan.result?.phases ?? [];

    for (const phase of phases) {
      const components = phase.components;
      if (components.length === 0) continue;

      // Build all independent components in this phase in parallel
      await Promise.all(
        components.map((component) =>
          ctx.stage(
            {
              name: `build-${phase.priority}-${component.name}`,
              description: `Implement ${component.name} (${phase.priority})`,
            },
            {},
            {},
            async (s) => {
              await s.session.query(
                `Read DESIGN_README.md and the relevant source files: ${component.files.join(", ")}.

Implement the **${component.name}** component for priority phase **${phase.priority}**.

## What to implement
${component.description}

## Rules
- Fill in all visual properties left as TODOs in the scaffold — colors, shadows, transitions, hover states, typography, spacing, etc.
- Use the exact design token values from DESIGN_README.md.
- ONLY modify files for this component: ${component.files.join(", ")}. Do NOT modify other files.
- If images or external content fail to load, investigate the cause (CORS, hotlinking, broken URL). Fix it — never use placeholders.
- Do NOT start or stop the dev server. A separate verification stage handles that.`,
              );
              s.save(s.sessionId);
            },
          ),
        ),
      );

      // ── Verification gate for this priority phase ──────────────
      lastVerifyStage = await ctx.stage(
        {
          name: `verify-${phase.priority}`,
          description: `Playwright verification of all ${phase.priority} components`,
        },
        {},
        {},
        async (s) => {
          const componentNames = components
            .map((c) => c.name)
            .join(", ");
          await s.session.query(
            `Start the dev server: ${devCommand}

Use 'playwright-cli' to verify ALL components from the **${phase.priority}** phase: ${componentNames}.

For each component:
1. Navigate to the section/page where it appears.
2. Take a screenshot.
3. Verify:
   - Real content displays correctly (images load, text is accurate).
   - Visual styling matches DESIGN_README.md (colors, typography, spacing).
   - Layout and spacing are correct.
   - Interaction states work (hover, click, focus) where applicable.

If ANY component has issues:
1. Document what's wrong.
2. Fix the issue directly in the source files.
3. Re-verify after fixing.

Only proceed when ALL ${phase.priority} components render correctly.

### Anti-Pattern Detection (Impeccable)

After visual verification passes, run anti-pattern detection:

1. **Start the detection server** in a background shell:
   \`bunx impeccable live --port=8400\`
   Wait a moment for the server to be ready (check http://localhost:8400/health returns ok).

2. **Inject the detection script** into the page via 'playwright-cli'. Evaluate this JavaScript in the browser:
   \`\`\`js
   const s = document.createElement('script');
   s.src = 'http://localhost:8400/detect.js';
   document.head.appendChild(s);
   \`\`\`

3. **Wait ~2 seconds** for the script to load and auto-scan, then **evaluate** this in the browser to collect results:
   \`\`\`js
   (window.impeccableScan ? window.impeccableScan() : []).map(r => ({
     tag: r.el.tagName,
     id: r.el.id || null,
     className: r.el.className || null,
     findings: r.findings
   }))
   \`\`\`
   This returns an array of objects with each element's tag/id/className and its anti-pattern findings (each with \`type\` and \`detail\` strings).

4. **If any findings exist**: Fix the flagged anti-patterns in the relevant source files. After fixing, reload the page, re-inject the detection script, and re-scan to confirm all anti-patterns are resolved.

5. **Stop the detection server**:
   \`bunx impeccable live stop\`

When finished, STOP the dev server (kill the background shell).`,
          );
          s.save(s.sessionId);
        },
      );
    }

    // ──────────────────────────────────────────────────────────────
    // Stage 6: QA + Review/Debug Loop
    //
    // Ralph-style bounded iteration: visual QA → infrastructure
    // discovery → dual parallel reviewers → debugger → fix.
    // Terminates when both reviewers agree the implementation
    // is clean, or after MAX_QA_LOOPS iterations.
    // ──────────────────────────────────────────────────────────────
    let debuggerReport = "";

    const qaSpec = [
      `Design specification: ${spec}`,
      "",
      "Requirements:",
      "1. All content from the design references is preserved and displays correctly (real images, real text, real links).",
      "2. The visual design matches the specification (layout, colors, typography, spacing, effects).",
      "3. All interactive behaviors function correctly (navigation, forms, buttons, scroll behaviors, dynamic content).",
      "4. No broken content — no missing images, no placeholder divs where real content should be, no dead links.",
      "5. Responsive layout appropriate to the design.",
      "6. The frontend can be previewed via the dev server and playwright-cli.",
    ].join("\n");

    for (let iteration = 1; iteration <= MAX_QA_LOOPS; iteration++) {
      // ── Visual + Interactive QA ──────────────────────────────────
      await ctx.stage(
        {
          name: `qa-${iteration}`,
          description: `Visual + interactive QA pass (iteration ${iteration})`,
        },
        {},
        {},
        async (s) => {
          const preamble =
            iteration === 1
              ? `Read the build verification history at ${(await s.transcript(lastVerifyStage)).path}.\n\n`
              : debuggerReport
                ? `The previous iteration's debugger identified these issues. Verify whether they have been fixed:\n\n<debugger_report>\n${debuggerReport}\n</debugger_report>\n\n`
                : "";

          await s.session.query(
            `${preamble}Start the dev server: ${devCommand}

Perform comprehensive QA of the built frontend:

### 1. Visual Comparison
Use 'playwright-cli' to:
a. Open the frontend at the dev server URL.
b. Take a full-page screenshot.
c. Compare against the reference screenshots from the design discovery stage.
d. Check each section/component against the design specification:
   - Does the layout match?
   - Does real content display correctly (images load, text is accurate)?
   - Are design tokens applied correctly (colors, typography, spacing)?
   - Are interaction states present (hover, focus, active)?

### 2. Content Verification
- Verify all images load (no broken images).
- Verify text content matches the design references.
- Verify links have correct targets.
- Count items in collections/grids — must match the design references.

### 3. Interactive Behavioral Testing
Test every interactive element:
a. **Navigation**: Click every nav link. Verify correct navigation behavior.
b. **Page/route testing**: Visit every page/route. Verify each loads and renders correctly. Take screenshots.
c. **Forms and inputs**: Find every form. Fill in test data, submit, verify behavior. Unexpected navigation away from a form is a P0 bug.
d. **Buttons and controls**: Click every button, toggle, dropdown. Verify behavior.
e. **Scroll behaviors**: Test scroll-triggered animations, lazy loading, sticky elements.
f. **Dynamic content**: Test client-side interactions, AJAX calls, routing.

### 4. Issue Report
Create/update 'issues.md' listing every discrepancy found:
- What's different from the specification
- Severity (P0 = broken functionality, P1 = wrong behavior, P2 = visual mismatch)
- Root cause hypothesis
- Steps to reproduce

When finished, STOP the dev server.`,
          );
          s.save(s.sessionId);
        },
      );

      // ── Capture branch changeset for reviewers ──────────────────
      const changeset = await captureBranchChangeset();

      // ── Infrastructure discovery (three parallel sub-agents) ────
      const discoveryPrompts = buildInfraDiscoveryPrompts();

      const [locatorResult, analyzerResult, patternResult] =
        await Promise.all([
          ctx.stage(
            { name: `infra-locate-${iteration}`, headless: true },
            {},
            {},
            async (s) => {
              const result = await s.session.query(
                asAgentCall("codebase-locator", discoveryPrompts.locator),
              );
              s.save(s.sessionId);
              return String(result.output ?? "");
            },
          ),
          ctx.stage(
            { name: `infra-analyze-${iteration}`, headless: true },
            {},
            {},
            async (s) => {
              const result = await s.session.query(
                asAgentCall("codebase-analyzer", discoveryPrompts.analyzer),
              );
              s.save(s.sessionId);
              return String(result.output ?? "");
            },
          ),
          ctx.stage(
            { name: `infra-patterns-${iteration}`, headless: true },
            {},
            {},
            async (s) => {
              const result = await s.session.query(
                asAgentCall(
                  "codebase-pattern-finder",
                  discoveryPrompts.patternFinder,
                ),
              );
              s.save(s.sessionId);
              return String(result.output ?? "");
            },
          ),
        ]);

      const discoveryContext = [
        "### Infrastructure Files (codebase-locator)\n\n" +
          locatorResult.result,
        "### Infrastructure Analysis (codebase-analyzer)\n\n" +
          analyzerResult.result,
        "### Build & Test Patterns (codebase-pattern-finder)\n\n" +
          patternResult.result,
      ].join("\n\n---\n\n");

      // ── Dual parallel reviewers with structured output ──────────
      const reviewPrompt = buildReviewPrompt(qaSpec, {
        changeset,
        iteration,
        discoveryContext,
      });

      const [reviewA, reviewB] = await Promise.all([
        ctx.stage(
          { name: `reviewer-${iteration}-a` },
          {},
          {},
          async (s) => {
            const result = await queryWithStructuredOutput(reviewPrompt);
            s.save(s.sessionId);
            return result;
          },
        ),
        ctx.stage(
          { name: `reviewer-${iteration}-b` },
          {},
          {},
          async (s) => {
            const result = await queryWithStructuredOutput(reviewPrompt);
            s.save(s.sessionId);
            return result;
          },
        ),
      ]);

      const merged = mergeReviewResults(reviewA.result, reviewB.result);
      const parsed = merged.structured;
      const reviewRaw = merged.raw;

      // Both reviewers agree the code is clean → done
      if (!hasActionableFindings(parsed, reviewRaw)) break;

      // ── Debug (only if another iteration is allowed) ────────────
      if (iteration < MAX_QA_LOOPS) {
        const debugStage = await ctx.stage(
          { name: `debugger-${iteration}` },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              asAgentCall(
                "debugger",
                buildDebuggerReportPrompt(parsed, reviewRaw, {
                  iteration,
                  changeset,
                }),
              ),
            );
            s.save(s.sessionId);
            return result.output;
          },
        );

        debuggerReport = extractMarkdownBlock(debugStage.result);

        // ── Fix stage ─────────────────────────────────────────────
        await ctx.stage(
          {
            name: `fix-${iteration}`,
            description: `Apply fixes from debugger report (iteration ${iteration})`,
          },
          {},
          {},
          async (s) => {
            await s.session.query(
              `You have the following debugger report identifying issues to fix:

<debugger_report>
${debuggerReport}
</debugger_report>

Start the dev server: ${devCommand}

Fix each issue identified in the debugger report. For each issue:
1. Read the relevant source files.
2. Implement the fix.
3. Verify the fix works using 'playwright-cli' — navigate to the affected area, reproduce the original scenario, and confirm the issue no longer occurs.
4. Move to the next issue.

After all fixes are applied and verified, STOP the dev server.

CRITICAL: Do NOT introduce new bugs while fixing existing ones. If a fix changes behavior in one area, verify that other areas still work correctly.`,
            );
            s.save(s.sessionId);
          },
        );
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Stage 7: Documentation
    //
    // Code comments and final screenshot, run once after the
    // QA + review loop has converged.
    // ──────────────────────────────────────────────────────────────
    await ctx.stage(
      {
        name: "documentation",
        description:
          "Add code documentation and capture final screenshot.",
      },
      {},
      {},
      async (s) => {
        await s.session.query(
          `Start the dev server: ${devCommand}

### 1. Code Documentation
Go through the implemented source files and add concise comments where the reasoning isn't self-evident:
- Explain WHY specific design/implementation choices were made.
- Explain HOW key visual effects are achieved through specific properties or techniques.
- Keep comments brief and educational — one comment block per major decision, not every line.

### 2. Final Screenshot
Take one final full-page screenshot of the completed frontend and save it as 'final-result.png' in the project root.

### 3. Summary
Write a brief summary to stdout describing:
- What was built
- Key design decisions made
- Any known limitations or areas for future improvement

When finished, STOP the dev server.`,
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
