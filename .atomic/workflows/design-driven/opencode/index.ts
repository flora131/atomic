/**
 * Design-Driven workflow for OpenCode — a generalized "Coding Backwards"
 * frontend implementation pipeline.
 *
 * Mirrors the Claude variant but adapted for the OpenCode SDK's session
 * model: `client.session.prompt({ sessionID, parts, agent?, format? })`,
 * native `format: { type: "json_schema" }` structured output, and inline
 * `agent` selection on each prompt call (rather than Claude's `@agent`
 * syntax or Copilot's per-stage agent config).
 *
 * Works with any design source: live websites, screenshots, Figma references,
 * written design briefs, or aesthetic descriptions. The agent makes judgment
 * calls about tooling, technology, and implementation strategy — the workflow
 * orchestrates the stages and enforces quality via a Ralph-style review loop.
 *
 * Stages:
 *   1. Design Discovery     — Analyze whatever references are provided
 *   2. Design Critique      — Evaluate and produce transformation requirements
 *   3. Architecture Plan    — "Coding Backwards" Step 1: Write the DESIGN.md
 *   4. Scaffold             — "Coding Backwards" Step 2: Create skeleton files
 *   5. Progressive Build    — "Coding Backwards" Step 3: Iterative implementation
 *                              (TODO: add a --interactive flag that shows the
 *                               user the playwright views if they want to see
 *                               how each component is being built)
 *   6. Visual Analysis      — Ralph-style bounded loop: visual analysis + dual
 *                              code reviewers + debugger
 *   7. Documentation        — Code comments and final screenshot
 *
 * Run: atomic workflow -n coding-backwards-design -a opencode "<your spec>"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";
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
// OpenCode accepts raw JSON Schema objects in `format.schema`, so we
// define the schema as a flat JSON Schema (no `name`/`strict` wrapper
// like Claude's outputFormat).
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
};

/** Concatenate the text-typed parts of an OpenCode response. */
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

/**
 * Extract a {@link StructuredReviewResult} from an OpenCode prompt response.
 * Prefers the SDK's `info.structured_output` field; falls back to raw text.
 */
function extractReview(data: {
  info?: Record<string, unknown>;
  parts: Array<{ type: string; [key: string]: unknown }>;
}): StructuredReviewResult {
  const raw = extractResponseText(data.parts);
  const structuredOutput = data.info?.structured_output;
  if (structuredOutput && typeof structuredOutput === "object") {
    return {
      structured: filterActionable(structuredOutput as ReviewResult),
      raw,
    };
  }
  return { structured: null, raw };
}

export default defineWorkflow<"opencode">({
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
      { title: "design-discovery" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: `You are an expert design analyst. Your job is to produce a COMPLETE design brief by analyzing the provided references.

You have access to the \`/playwright-cli\` skill for browser automation — use it for any live URLs or Figma links below.

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

- **Live URLs**: Open the site with the browser automation skill, take full-page and section screenshots, capture the DOM via 'snapshot', and run JavaScript to extract all images, text, links, and metadata. Scroll to trigger lazy-loaded content.
- **Image files** (screenshots, mockups): Read and analyze them visually for layout, typography, colors, spacing, and component patterns.
- **Figma links**: Open and capture the designs with the browser automation skill. Extract component structures, spacing, and tokens.
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
            },
          ],
        });
        s.save(result.data!);
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
      { title: "design-critique" },
      async (s) => {
        const discoveryTranscript = await s.transcript(discovery);
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: `Read the design brief at ${discoveryTranscript.path}.

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
            },
          ],
        });
        s.save(result.data!);
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
          "Write the architectural plan (DESIGN.md) as if the project is already finished.",
      },
      {},
      { title: "architecture-plan" },
      async (s) => {
        const discoveryTranscript = await s.transcript(discovery);
        const critiqueTranscript = await s.transcript(critique);
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: `Read the design brief at ${discoveryTranscript.path} and the critique at ${critiqueTranscript.path}.

Do NOT write any application code yet.

Write a comprehensive 'DESIGN.md' for this project. Write it as if the project is ALREADY FINISHED — describe what was built, not what will be built. This is the "Coding Backwards" methodology: writing the documentation first forces clarity about what we're building.

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

Save DESIGN.md to the project root.

The choice of technology, file structure, and architecture is YOURS based on what best serves the specification. For example:
- A simple portfolio clone might use plain HTML/CSS/JS
- A component library might use React + Tailwind
- A complex app might need a framework with routing

Choose what fits. The README should justify the choice.`,
            },
          ],
        });
        s.save(result.data!);
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
      { title: "scaffold" },
      async (s) => {
        const discoveryTranscript = await s.transcript(discovery);
        const planTranscript = await s.transcript(architecturePlan);
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: `Read the DESIGN.md referenced in ${planTranscript.path} and the design brief at ${discoveryTranscript.path}.

Create all the scaffold files as specified in DESIGN.md. This is "Coding Backwards" Step 2: create every file with its structure, real content, and clear TODOs for visual implementation.

## Key Principles

1. **Real content first**: Every piece of content from the design brief must be wired into the scaffold. Images use real URLs via proper markup (e.g., <img src="..." alt="...">), text content uses the real text, links use real hrefs. No placeholders where real content exists.

2. **Structure before style**: Files should have correct structure (HTML elements, component hierarchy, module exports) but visual styling can be partially deferred with TODO comments for the progressive build stage.

3. **Foundation values present**: Design tokens (colors, spacing, typography, etc.) should have their REAL values from the critique — these aren't "empty" since later stages depend on them.

4. **Working preview**: Create a dev server setup so the scaffold can be viewed immediately, even before visual polish is applied. The dev server command should match: ${devCommand}

5. **Technology alignment**: Use whatever technology the DESIGN.md specifies. The scaffold structure should follow the file structure documented there.

After creating all files, verify that:
- The dev server can start successfully
- Real content is wired in (no empty image sources, no lorem ipsum where real text exists)
- The file structure matches DESIGN.md`,
            },
          ],
        });
        s.save(result.data!);
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

    // ── 5a: Extract structured component plan ────────────────────
    const componentPlan = await ctx.stage(
      {
        name: "component-plan",
        description:
          "Extract structured component build plan from DESIGN.md",
      },
      {},
      { title: "component-plan" },
      async (s) => {
        const scaffoldTranscript = await s.transcript(scaffold);
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: `Read the DESIGN.md in the project root and the scaffold transcript at ${scaffoldTranscript.path}.

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
            },
          ],
          format: {
            type: "json_schema" as const,
            schema: COMPONENT_PLAN_JSON_SCHEMA,
          },
        });
        s.save(result.data!);

        const structuredOutput = (
          result.data!.info as Record<string, unknown> | undefined
        )?.structured_output;
        if (structuredOutput && typeof structuredOutput === "object") {
          return structuredOutput as ComponentPlan;
        }
        return null;
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
            { title: `build-${phase.priority}-${component.name}` },
            async (s) => {
              const result = await s.client.session.prompt({
                sessionID: s.session.id,
                parts: [
                  {
                    type: "text",
                    text: `Read DESIGN.md and the relevant source files: ${component.files.join(", ")}.

Implement the **${component.name}** component for priority phase **${phase.priority}**.

## What to implement
${component.description}

## Rules
- Fill in all visual properties left as TODOs in the scaffold — colors, shadows, transitions, hover states, typography, spacing, etc.
- Use the exact design token values from DESIGN.md.
- ONLY modify files for this component: ${component.files.join(", ")}. Do NOT modify other files.
- If images or external content fail to load, investigate the cause (CORS, hotlinking, broken URL). Fix it — never use placeholders.
- Do NOT start or stop the dev server. A separate verification stage handles that.`,
                  },
                ],
              });
              s.save(result.data!);
            },
          ),
        ),
      );

      // ── Verification gate for this priority phase ──────────────
      await ctx.stage(
        {
          name: `verify-${phase.priority}`,
          description: `Playwright verification of all ${phase.priority} components`,
        },
        {},
        { title: `verify-${phase.priority}` },
        async (s) => {
          const componentNames = components.map((c) => c.name).join(", ");
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: `You have access to the \`/playwright-cli\` skill for browser automation.

Start the dev server: ${devCommand}

Verify ALL components from the **${phase.priority}** phase: ${componentNames}.

For each component:
1. Navigate to the section/page where it appears.
2. Take a screenshot.
3. Verify:
   - Real content displays correctly (images load, text is accurate).
   - Visual styling matches DESIGN.md (colors, typography, spacing).
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

2. **Inject the detection script** into the page via the browser automation skill. Evaluate this JavaScript in the browser:
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
              },
            ],
          });
          s.save(result.data!);
        },
      );
    }

    // ──────────────────────────────────────────────────────────────
    // Stage 6: Visual Analysis
    //
    // Ralph-style bounded iteration: fix → changeset → visual
    // analysis + infra discovery (parallel) → dual code reviewers
    // (with visual findings injected) → debugger.
    // Three review sources are merged: visual analysis, reviewer A,
    // reviewer B. Terminates when all three agree the implementation
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
      "6. The frontend can be previewed via the dev server and the `/playwright-cli` skill.",
    ].join("\n");

    for (let iteration = 1; iteration <= MAX_QA_LOOPS; iteration++) {
      // ── Fix (iterations 2+, applies debugger report) ─────────────
      if (iteration > 1 && debuggerReport) {
        await ctx.stage(
          {
            name: `fix-${iteration}`,
            description: `Apply fixes from debugger report (iteration ${iteration})`,
          },
          {},
          { title: `fix-${iteration}` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [
                {
                  type: "text",
                  text: `You have access to the \`/playwright-cli\` skill for browser automation.

You have the following debugger report identifying issues to fix:

<debugger_report>
${debuggerReport}
</debugger_report>

Start the dev server: ${devCommand}

Fix each issue identified in the debugger report. For each issue:
1. Read the relevant source files.
2. Implement the fix.
3. Verify the fix works — navigate to the affected area, reproduce the original scenario, and confirm the issue no longer occurs.
4. Move to the next issue.

After all fixes are applied and verified, STOP the dev server.

CRITICAL: Do NOT introduce new bugs while fixing existing ones. If a fix changes behavior in one area, verify that other areas still work correctly.`,
                },
              ],
            });
            s.save(result.data!);
          },
        );
      }

      // ── Capture branch changeset for reviewers ──────────────────
      const changeset = await captureBranchChangeset();

      // ── Infrastructure discovery + visual analysis (parallel) ────
      const discoveryPrompts = buildInfraDiscoveryPrompts();

      const [locatorResult, analyzerResult, patternResult, visualResult] =
        await Promise.all([
          ctx.stage(
            { name: `infra-locate-${iteration}`, headless: true },
            {},
            { title: `infra-locate-${iteration}` },
            async (s) => {
              const result = await s.client.session.prompt({
                sessionID: s.session.id,
                parts: [
                  { type: "text", text: discoveryPrompts.locator },
                ],
                agent: "codebase-locator",
              });
              s.save(result.data!);
              return extractResponseText(result.data!.parts);
            },
          ),
          ctx.stage(
            { name: `infra-analyze-${iteration}`, headless: true },
            {},
            { title: `infra-analyze-${iteration}` },
            async (s) => {
              const result = await s.client.session.prompt({
                sessionID: s.session.id,
                parts: [
                  { type: "text", text: discoveryPrompts.analyzer },
                ],
                agent: "codebase-analyzer",
              });
              s.save(result.data!);
              return extractResponseText(result.data!.parts);
            },
          ),
          ctx.stage(
            { name: `infra-patterns-${iteration}`, headless: true },
            {},
            { title: `infra-patterns-${iteration}` },
            async (s) => {
              const result = await s.client.session.prompt({
                sessionID: s.session.id,
                parts: [
                  { type: "text", text: discoveryPrompts.patternFinder },
                ],
                agent: "codebase-pattern-finder",
              });
              s.save(result.data!);
              return extractResponseText(result.data!.parts);
            },
          ),
          // ── Visual Analysis ──────────────────────────────────────
          // Starts the dev server, navigates every route with
          // Playwright, takes screenshots, and produces structured
          // ReviewResult findings for visual/layout/content issues
          // that are invisible in a code diff.
          ctx.stage(
            { name: `visual-analysis-${iteration}` },
            {},
            { title: `visual-analysis-${iteration}` },
            async (s) => {
              const result = await s.client.session.prompt({
                sessionID: s.session.id,
                parts: [
                  {
                    type: "text",
                    text: `You are a visual QA analyst. Your job is to verify the rendered frontend against its design specification and produce structured review findings.

You have access to the \`/playwright-cli\` skill for browser automation.

## Design Specification

<spec>
${spec}
</spec>

## Dev Server

Start the dev server: ${devCommand}

## Route Discovery

Read the router source file (look for router.js, router.ts, or equivalent) and the main entry point to discover ALL defined routes. Then systematically verify every route.

## Visual Analysis Process

For EACH route:

### 1. Navigate & Screenshot
Navigate to the route and take a full-page screenshot.

### 2. Programmatic Health Checks
Run these JavaScript checks in the browser:

**Broken images:**
\`\`\`js
Array.from(document.querySelectorAll('img')).filter(i => i.complete && i.naturalWidth === 0).map(i => ({src: i.src, alt: i.alt}))
\`\`\`

**Zero-dimension elements (invisible content):**
\`\`\`js
Array.from(document.querySelectorAll('section, main, article, [role="region"], .card, .grid')).filter(el => { const r = el.getBoundingClientRect(); return r.width === 0 || r.height === 0; }).map(el => ({tag: el.tagName, class: el.className, id: el.id}))
\`\`\`

**Content height ratio (layout collapse detection):**
\`\`\`js
(() => { const main = document.querySelector('main'); if (!main) return null; const mainH = main.getBoundingClientRect().height; const viewH = window.innerHeight; return { mainHeight: mainH, viewportHeight: viewH, ratio: mainH / viewH }; })()
\`\`\`

**Console errors:**
Check for any JavaScript errors in the browser console.

### 3. Visual Comparison
Compare each route's rendered output against the design specification and any reference screenshots (reference-*.png files in the project root):
- Does the layout match the design intent?
- Is content properly styled (not unstyled/collapsed/invisible)?
- Are design tokens applied correctly (colors, typography, spacing)?
- Are interactive elements visually present (buttons styled, links visible, hover states)?
- Does the page have appropriate visual weight — not just a sliver of text in a sea of empty space?

### 4. Content Verification
- Count items in grids/collections and compare to the data source files.
- Verify all images load (use the programmatic check above).
- Verify text content is real, not placeholder.

## Severity Guide

- **P0** (priority 0): Route unreachable, page blank/crashes, broken JavaScript, main content invisible
- **P1** (priority 1): Broken images, layout collapse (content < 20% of viewport when it should fill), missing interactive behaviors, navigation broken
- **P2** (priority 2): Visual mismatch vs design spec (wrong colors, spacing, typography), missing hover states, minor styling issues

## Output

Produce your findings as a structured review result. Each finding must include:
- A descriptive title prefixed with severity (e.g., "[P1] 9 broken film poster images on /film")
- The specific route and what's wrong
- The source file and line range causing the issue (read the source to identify this)
- Confidence score

Set overall_correctness to "patch is incorrect" if ANY P0 or P1 finding exists.

When finished, STOP the dev server.`,
                  },
                ],
                format: {
                  type: "json_schema" as const,
                  schema: REVIEW_RESULT_JSON_SCHEMA,
                },
              });
              s.save(result.data!);
              return extractReview(
                result.data! as {
                  info?: Record<string, unknown>;
                  parts: Array<{ type: string; [key: string]: unknown }>;
                },
              );
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

      // ── Format visual analysis findings for reviewer injection ──
      const visualFindings = visualResult.result.structured;
      const visualFindingsContext = visualFindings?.findings?.length
        ? [
            "### Visual Analysis Findings (Playwright)\n",
            "The following issues were observed in the rendered browser output.\n",
            "Validate each against the code. Confirm as real findings or explain why they are false positives.\n",
            ...visualFindings.findings.map(
              (f, i) =>
                `${i + 1}. **${f.title}**\n   ${f.body}${f.code_location ? `\n   File: ${f.code_location.absolute_file_path}:${f.code_location.line_range.start}-${f.code_location.line_range.end}` : ""}`,
            ),
          ].join("\n")
        : "";

      // ── Dual parallel reviewers with structured output ──────────
      const reviewPrompt = buildReviewPrompt(qaSpec, {
        changeset,
        iteration,
        discoveryContext: visualFindingsContext
          ? discoveryContext + "\n\n---\n\n" + visualFindingsContext
          : discoveryContext,
      });

      const reviewStage = async (name: string) =>
        ctx.stage(
          { name },
          {},
          { title: name },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [{ type: "text", text: reviewPrompt }],
              agent: "reviewer",
              format: {
                type: "json_schema" as const,
                schema: REVIEW_RESULT_JSON_SCHEMA,
              },
            });
            s.save(result.data!);
            return extractReview(
              result.data! as {
                info?: Record<string, unknown>;
                parts: Array<{ type: string; [key: string]: unknown }>;
              },
            );
          },
        );

      const [reviewA, reviewB] = await Promise.all([
        reviewStage(`reviewer-${iteration}-a`),
        reviewStage(`reviewer-${iteration}-b`),
      ]);

      // Merge all three review sources: visual analysis + reviewer A + reviewer B
      const codeReviewMerged = mergeReviewResults(
        reviewA.result,
        reviewB.result,
      );
      const merged = mergeReviewResults(visualResult.result, codeReviewMerged);
      const parsed = merged.structured;
      const reviewRaw = merged.raw;

      // All three review sources agree the code is clean → done
      if (!hasActionableFindings(parsed, reviewRaw)) break;

      // ── Debug (only if another iteration is allowed) ────────────
      if (iteration < MAX_QA_LOOPS) {
        const debugger_ = await ctx.stage(
          { name: `debugger-${iteration}` },
          {},
          { title: `debugger-${iteration}` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [
                {
                  type: "text",
                  text: buildDebuggerReportPrompt(parsed, reviewRaw, {
                    iteration,
                    changeset,
                  }),
                },
              ],
              agent: "debugger",
            });
            s.save(result.data!);
            return extractResponseText(result.data!.parts);
          },
        );

        debuggerReport = extractMarkdownBlock(debugger_.result);
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
      { title: "documentation" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: `Start the dev server: ${devCommand}

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
            },
          ],
        });
        s.save(result.data!);
      },
    );
  })
  .compile();
