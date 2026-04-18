/**
 * Prompt builders for the open-claude-design workflow.
 *
 * Each builder produces a focused, single-responsibility prompt for one
 * stage of the 5-phase design pipeline. Context-engineering principles:
 *
 *   - Position-aware framing: key context (design prompt, design system)
 *     at the TOP and BOTTOM of every prompt.
 *   - Forward-only data flow: downstream stages embed upstream outputs
 *     verbatim — no re-discovery.
 *   - Trailing-prose guarantee: every prompt asks for a short prose recap
 *     so transcript reads never return empty.
 *   - HIL via AskUserQuestion: explicit instructions to use the tool,
 *     never regular NL conversation, for user decisions.
 */

import { IMPECCABLE_BANS } from "./constants.ts";
import type { ImportContext } from "./import.ts";
import type { DesignSystemData } from "./design-system.ts";

// ============================================================================
// SHARED HELPERS
// ============================================================================

const TRAILING_PROSE_REMINDER =
  "End your turn with a short prose paragraph summarizing what you produced. " +
  "Do NOT end the turn on a tool call — downstream stages read your assistant " +
  "transcript and will see nothing if the final message is a tool invocation.";

const HIL_INSTRUCTION =
  "You MUST use the AskUserQuestion tool (not regular conversation) to ask " +
  "the user for decisions. Do not proceed without the user's explicit " +
  "response via this tool.";

function renderBans(): string {
  return IMPECCABLE_BANS.map((ban) => `- ${ban}`).join("\n");
}

// ============================================================================
// PHASE 1: DESIGN SYSTEM ONBOARDING
// ============================================================================

/** Phase 1 — headless: find CSS/Tailwind/design files in codebase. */
export function buildDesignLocatorPrompt(opts: {
  root: string;
}): string {
  return [
    `<TASK>`,
    `Locate all design-related files in this codebase that define or contain`,
    `visual design tokens, styles, or theming configuration.`,
    `</TASK>`,
    ``,
    `<SCOPE>`,
    `Project root: \`${opts.root}\``,
    `</SCOPE>`,
    ``,
    `<WHAT_TO_FIND>`,
    `- CSS files (*.css, *.scss, *.less, *.pcss)`,
    `- Tailwind config (tailwind.config.*, postcss.config.*)`,
    `- CSS-in-JS theme files (theme.ts, tokens.ts, design-tokens.*)`,
    `- CSS custom property definitions (:root { --color-*, --font-*, --space-* })`,
    `- Component library config (chakra theme, MUI theme, shadcn components.json)`,
    `- Global style entry points (globals.css, app.css, index.css)`,
    `- Design system documentation (*.md files mentioning colors/fonts/spacing)`,
    `- .impeccable.md brand context file`,
    `- package.json (for design-related dependencies)`,
    `</WHAT_TO_FIND>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Return a categorized list with absolute paths:`,
    ``,
    `### Style Files`,
    `- \`<path>\` — <one-line description>`,
    ``,
    `### Theme / Token Files`,
    `- \`<path>\` — <one-line description>`,
    ``,
    `### Configuration`,
    `- \`<path>\` — <one-line description>`,
    ``,
    `### Documentation`,
    `- \`<path>\` — <one-line description>`,
    ``,
    `Omit empty sections.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Focus on LOCATION only — do not read file contents in depth.`,
    `Use absolute paths throughout.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

/** Phase 1 — headless: extract colors, fonts, spacing from located files. */
export function buildDesignAnalyzerPrompt(opts: {
  root: string;
}): string {
  return [
    `<TASK>`,
    `Analyze this codebase to extract existing design tokens: colors,`,
    `typography (fonts, sizes, weights), spacing values, and border/radius`,
    `conventions. Report concrete values found in the code.`,
    `</TASK>`,
    ``,
    `<SCOPE>`,
    `Project root: \`${opts.root}\``,
    `</SCOPE>`,
    ``,
    `<METHOD>`,
    `1. Search for CSS custom properties (--color-*, --font-*, --space-*, etc.)`,
    `2. Search for Tailwind config color/font/spacing definitions`,
    `3. Search for hardcoded hex/rgb/hsl color values in CSS/SCSS files`,
    `4. Search for font-family declarations`,
    `5. Search for consistent spacing patterns (margin/padding values)`,
    `6. Search for border-radius, box-shadow, and transition patterns`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Colors Found`,
    `- \`<token-name or context>\`: <value> — used in <file:line>`,
    ``,
    `### Typography Found`,
    `- Font families: <list with file:line refs>`,
    `- Font sizes: <list with file:line refs>`,
    `- Font weights: <list with file:line refs>`,
    ``,
    `### Spacing Found`,
    `- Common values: <list with file:line refs>`,
    `- Base unit (if detectable): <value>`,
    ``,
    `### Other Tokens`,
    `- Border radius: <values>`,
    `- Box shadows: <values>`,
    `- Transitions: <values>`,
    ``,
    `Omit empty sections. Use file:line references for every value.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Report what EXISTS — do not suggest improvements or alternatives.`,
    `Extract concrete values, not abstractions.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

/** Phase 1 — headless: find existing component patterns in the codebase. */
export function buildDesignPatternPrompt(opts: {
  root: string;
}): string {
  return [
    `<TASK>`,
    `Find existing UI component patterns in this codebase. Identify reusable`,
    `components, their variants, and how they are currently styled.`,
    `</TASK>`,
    ``,
    `<SCOPE>`,
    `Project root: \`${opts.root}\``,
    `</SCOPE>`,
    ``,
    `<WHAT_TO_FIND>`,
    `1. Button components and their variants (primary, secondary, ghost, etc.)`,
    `2. Card / container patterns`,
    `3. Input / form elements`,
    `4. Navigation components (navbar, sidebar, tabs)`,
    `5. Layout patterns (grid, flex, container widths)`,
    `6. Modal / dialog patterns`,
    `7. Table / list patterns`,
    `8. Any component library usage (shadcn, radix, chakra, MUI, etc.)`,
    `</WHAT_TO_FIND>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `For each component pattern found:`,
    ``,
    `#### <Component Name>`,
    `**Where:** \`<file:line>\``,
    `**Variants:** <list of variants if any>`,
    `**Styling approach:** <CSS modules / Tailwind / styled-components / etc.>`,
    `**Key visual properties:** <colors, sizes, borders used>`,
    ``,
    `Aim for 5-10 distinct patterns. Skip trivial or one-off components.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Document what EXISTS — do not propose new components.`,
    `Use file:line references for every claim.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

/**
 * Phase 1 — visible, HIL: present findings and build Design.md with
 * user approval at each decision point.
 */
export function buildDesignSystemBuilderPrompt(opts: {
  root: string;
  locatorOutput: string;
  analyzerOutput: string;
  patternsOutput: string;
  existingImpeccable: string;
}): string {
  const impeccableSection =
    opts.existingImpeccable.trim().length > 0
      ? `<EXISTING_BRAND_CONTEXT>
The project has an existing .impeccable.md brand context file:

${opts.existingImpeccable.trim()}
</EXISTING_BRAND_CONTEXT>`
      : `<EXISTING_BRAND_CONTEXT>
No .impeccable.md file found. You will build the design system from scratch
using the codebase analysis below.
</EXISTING_BRAND_CONTEXT>`;

  return [
    `<TASK>`,
    `You are a design system builder. Three specialist sub-agents have analyzed`,
    `the codebase for design tokens and patterns. Your job is to present their`,
    `findings to the user, get approval for each design element category via`,
    `the AskUserQuestion tool, and then write a structured Design.md file.`,
    `</TASK>`,
    ``,
    impeccableSection,
    ``,
    `<CODEBASE_ANALYSIS>`,
    ``,
    `### Design File Locations`,
    opts.locatorOutput.trim() || "(no design files found)",
    ``,
    `### Extracted Design Tokens`,
    opts.analyzerOutput.trim() || "(no tokens extracted)",
    ``,
    `### Component Patterns`,
    opts.patternsOutput.trim() || "(no patterns found)",
    ``,
    `</CODEBASE_ANALYSIS>`,
    ``,
    `<PROCESS>`,
    ``,
    `${HIL_INSTRUCTION}`,
    ``,
    `Follow these steps in order:`,
    ``,
    `**Step 1 — Colors:** Present the colors found in the codebase analysis.`,
    `Use AskUserQuestion to ask: "Here are the colors I found in your codebase.`,
    `Which should be part of your design system?"`,
    `Provide options: ["Approve these colors", "Modify colors", "Start from scratch"]`,
    `If "Modify" or "Start from scratch", follow up with another AskUserQuestion.`,
    ``,
    `**Step 2 — Typography:** Present the font families and scale found.`,
    `Use AskUserQuestion to ask about the primary font stack.`,
    `Provide options based on what was found, plus "Suggest alternatives".`,
    ``,
    `**Step 3 — Spacing:** Present the spacing values found.`,
    `Use AskUserQuestion to ask: "Which spacing base unit should I use?"`,
    `Provide options: ["4pt base", "8pt base", "Keep existing values"]`,
    ``,
    `**Step 4 — Components:** Present the component patterns found.`,
    `Briefly summarize — no AskUserQuestion needed for this step.`,
    ``,
    `**Step 5 — Final Approval:** Write the complete Design.md file content,`,
    `then use AskUserQuestion to ask: "Here is your complete design system.`,
    `Approve or request changes?"`,
    `Provide options: ["Approve Design.md", "Request changes"]`,
    `If "Request changes", iterate until approved.`,
    ``,
    `**Step 6 — Write File:** Once approved, write the Design.md file to:`,
    `\`${opts.root}/Design.md\``,
    ``,
    `</PROCESS>`,
    ``,
    `<DESIGN_MD_FORMAT>`,
    `The Design.md file MUST follow this exact structure:`,
    ``,
    "```markdown",
    `# Design System — [Project Name]`,
    ``,
    `## Colors`,
    `### Primary`,
    `- \`--color-primary\`: <value>`,
    `### Neutral`,
    `- \`--color-bg\`: <value>`,
    `### Semantic`,
    `- \`--color-success\`: <value>`,
    ``,
    `## Typography`,
    `### Font Stack`,
    `- Primary: <font-family>`,
    `- Monospace: <font-family>`,
    `### Scale`,
    `- \`--text-xs\`: <value>`,
    ``,
    `## Spacing`,
    `### Base Unit: <value>`,
    `- \`--space-1\`: <value>`,
    ``,
    `## Components`,
    `### Identified Patterns`,
    `- <Component> (<variants>)`,
    ``,
    `## Anti-Patterns (from impeccable)`,
    `- NO side-stripe borders`,
    `- NO gradient text`,
    `- NO AI color palette`,
    `- NO reflex fonts`,
    ``,
    `## Brand Context (from .impeccable.md)`,
    `[Embedded if available]`,
    "```",
    `</DESIGN_MD_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `- Use AskUserQuestion for EVERY decision point (Steps 1-3, 5).`,
    `- Do NOT skip any step or auto-approve on the user's behalf.`,
    `- Include the Anti-Patterns section with all impeccable bans.`,
    `- If no existing tokens are found, propose reasonable defaults and confirm with user.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

// ============================================================================
// PHASE 2: IMPORT
// ============================================================================

/** Phase 2 — headless: navigate URL, screenshot, extract DOM/CSS. */
export function buildWebCapturePrompt(opts: {
  url: string;
  screenshotDir: string;
}): string {
  return [
    `<TASK>`,
    `Navigate to the URL below, take a screenshot, and extract the key visual`,
    `design elements (layout, colors, typography, component patterns) as a`,
    `structured reference for generating a new design.`,
    `</TASK>`,
    ``,
    `<URL>${opts.url}</URL>`,
    ``,
    `<METHOD>`,
    `1. Use playwright-cli to navigate to the URL.`,
    `2. Take a full-page screenshot and save it to: \`${opts.screenshotDir}/reference.png\``,
    `3. Extract the page's visual design characteristics:`,
    `   - Overall layout structure (grid, sidebar, header, etc.)`,
    `   - Color scheme (primary, accent, background, text colors)`,
    `   - Typography (font families, sizes visible)`,
    `   - Key component patterns (buttons, cards, inputs, navigation)`,
    `   - Spacing and visual rhythm`,
    `4. If the page has multiple views/states, capture the most representative one.`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Layout`,
    `<description of overall structure>`,
    ``,
    `### Visual Style`,
    `- Colors: <observed color palette>`,
    `- Typography: <observed fonts and sizes>`,
    `- Spacing: <observed rhythm>`,
    ``,
    `### Key Components`,
    `- <component>: <description>`,
    ``,
    `### Screenshot`,
    `Saved to: \`${opts.screenshotDir}/reference.png\``,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Focus on extractable design patterns, not content.`,
    `If the URL fails to load, report the error and continue with whatever partial info is available.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

/** Phase 2 — headless: parse document reference (DOCX/PPTX/XLSX/image/PDF). */
export function buildFileParserPrompt(opts: {
  filePath: string;
}): string {
  return [
    `<TASK>`,
    `Parse the reference document below and extract design-relevant information`,
    `(visual specs, wireframes, mockup descriptions, brand guidelines, color`,
    `palettes, typography specs) that can inform design generation.`,
    `</TASK>`,
    ``,
    `<FILE>${opts.filePath}</FILE>`,
    ``,
    `<METHOD>`,
    `1. Read the file using the appropriate tool (Read for text/markdown/images,`,
    `   liteparse for DOCX/PPTX/XLSX/PDF).`,
    `2. Extract design-relevant content:`,
    `   - Color specifications or palettes`,
    `   - Typography preferences`,
    `   - Layout descriptions or wireframes`,
    `   - Component requirements`,
    `   - Brand guidelines or constraints`,
    `   - Any visual mockup descriptions`,
    `3. Ignore non-design content (business logic, data models, etc.)`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Design Requirements Extracted`,
    `<bulleted list of design-relevant requirements>`,
    ``,
    `### Visual Specifications`,
    `<any specific colors, fonts, sizes mentioned>`,
    ``,
    `### Layout Requirements`,
    `<any layout or structural requirements>`,
    ``,
    `If the file contains no design-relevant information, say so explicitly.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Extract only design-relevant information.`,
    `Do not fabricate specifications not present in the document.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

// ============================================================================
// PHASE 3: GENERATION
// ============================================================================

/** Phase 3 — visible: generate first design version. */
export function buildGeneratorPrompt(opts: {
  prompt: string;
  outputType: string;
  designSystem: DesignSystemData;
  importContext: ImportContext;
  root: string;
  outputDir: string;
}): string {
  const referenceSection =
    opts.importContext.webCapture || opts.importContext.fileParse
      ? `<REFERENCE_CONTEXT>
${opts.importContext.webCapture ? `### Web Reference\n${opts.importContext.webCapture}\n` : ""}
${opts.importContext.fileParse ? `### File Reference\n${opts.importContext.fileParse}\n` : ""}
</REFERENCE_CONTEXT>`
      : "";

  const outputTypeInstructions: Record<string, string> = {
    prototype: `Generate a fully interactive HTML/CSS/JS application with multiple views/screens,
working navigation, real interactions (clicks, hovers, form submissions), and state
changes. Full visual fidelity with design system tokens applied.`,

    wireframe: `Generate a low-fidelity structural layout with boxes, placeholder text, and visual
hierarchy WITHOUT polish. Use grayscale, minimal styling. Focus on information
architecture. Run the /shape skill first to produce a design brief before generating.`,

    page: `Generate a single, fully designed page at full fidelity (colors, typography, spacing
from Design.md). No multi-screen navigation or complex state. One screen, fully polished.`,

    component: `Generate a single reusable UI element rendered as a component showcase with multiple
variants and interactive states. Show the component in isolation with different sizes,
colors, and states (default, hover, active, disabled, etc.).`,
  };

  return [
    `<DESIGN_REQUEST>`,
    opts.prompt,
    `</DESIGN_REQUEST>`,
    ``,
    `<OUTPUT_TYPE>`,
    `You are generating a **${opts.outputType}**.`,
    ``,
    outputTypeInstructions[opts.outputType] ?? outputTypeInstructions.prototype,
    `</OUTPUT_TYPE>`,
    ``,
    `<DESIGN_SYSTEM>`,
    opts.designSystem.raw,
    `</DESIGN_SYSTEM>`,
    ``,
    referenceSection,
    ``,
    `<GENERATION_INSTRUCTIONS>`,
    ``,
    `1. Load the /impeccable skill context for design quality guidelines.`,
    `2. ${opts.outputType === "wireframe" ? "Run /shape first to produce a design brief, then generate based on that brief." : "Generate the design directly based on the design request and design system."}`,
    `3. Write all generated files to: \`${opts.outputDir}/\``,
    `   - \`${opts.outputDir}/index.html\` — Main HTML file`,
    `   - \`${opts.outputDir}/styles.css\` — All CSS styles`,
    `   - \`${opts.outputDir}/script.js\` — All JavaScript (if needed)`,
    `4. Apply ALL design system tokens from the <DESIGN_SYSTEM> section above.`,
    `   Use CSS custom properties for every color, font, and spacing value.`,
    `5. Follow ALL impeccable DON'T guidelines and absolute bans.`,
    ``,
    `</GENERATION_INSTRUCTIONS>`,
    ``,
    `<ABSOLUTE_BANS>`,
    `These anti-patterns are BANNED. Do not use them under any circumstances:`,
    ``,
    renderBans(),
    `</ABSOLUTE_BANS>`,
    ``,
    `<QUALITY_REQUIREMENTS>`,
    `- Semantic HTML (proper heading hierarchy, landmarks, ARIA where needed)`,
    `- CSS custom properties for all design tokens (--color-*, --font-*, --space-*)`,
    `- Mobile-first responsive design`,
    `- Self-contained: all CSS inline or in styles.css, all JS in script.js`,
    `- No external CDN dependencies — everything must work offline`,
    `- The HTML file must be openable directly in a browser`,
    `</QUALITY_REQUIREMENTS>`,
    ``,
    `<CONSTRAINTS>`,
    `Write the actual files — do not just describe what you would create.`,
    `Apply the design system tokens from Design.md — do not invent new colors/fonts.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<DESIGN_REQUEST_REMINDER>`,
    opts.prompt,
    `</DESIGN_REQUEST_REMINDER>`,
  ].join("\n");
}

// ============================================================================
// PHASE 4: REFINEMENT LOOP
// ============================================================================

/** Phase 4 — visible, HIL: collect user feedback on the current design. */
export function buildRefineFeedbackPrompt(opts: {
  prompt: string;
  designDir: string;
  iteration: number;
  maxIterations: number;
}): string {
  return [
    `<TASK>`,
    `You are collecting user feedback on the current design iteration.`,
    `This is iteration ${opts.iteration} of ${opts.maxIterations}.`,
    `</TASK>`,
    ``,
    `<DESIGN_LOCATION>`,
    `The current design files are at: \`${opts.designDir}/\``,
    `- \`${opts.designDir}/index.html\``,
    `- \`${opts.designDir}/styles.css\``,
    `- \`${opts.designDir}/script.js\``,
    `</DESIGN_LOCATION>`,
    ``,
    `<PROCESS>`,
    ``,
    `${HIL_INSTRUCTION}`,
    ``,
    `1. Briefly summarize what was generated or changed in the current iteration.`,
    `2. Tell the user they can open \`${opts.designDir}/index.html\` in a browser to preview.`,
    `3. Use AskUserQuestion to ask: "How would you like to proceed?"`,
    `   Provide these options:`,
    `   - "Approve and export" — finalize the design and create handoff bundle`,
    `   - "Request specific changes" — describe what to modify`,
    `   - "Run full critique" — automated design quality analysis`,
    `   - "Start over" — regenerate from scratch`,
    `4. If the user selects "Request specific changes", capture their feedback`,
    `   using a follow-up AskUserQuestion with free-text input.`,
    `5. Echo back the user's choice and feedback clearly.`,
    ``,
    `If the user chose "Approve and export", include the phrase "user approved"`,
    `in your response so the workflow can detect completion.`,
    `</PROCESS>`,
    ``,
    `<ORIGINAL_REQUEST>`,
    opts.prompt,
    `</ORIGINAL_REQUEST>`,
    ``,
    `<CONSTRAINTS>`,
    `- Do NOT make any changes to the design files yourself.`,
    `- Do NOT skip the AskUserQuestion — the user MUST choose.`,
    `- Keep your summary brief (2-3 sentences).`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

/** Phase 4 — headless: automated design critique with structured output. */
export function buildCritiquePrompt(opts: {
  designDir: string;
  designSystem: DesignSystemData;
  userFeedback: string;
}): string {
  return [
    `<TASK>`,
    `Perform a comprehensive design critique of the generated design files.`,
    `Combine automated scanning with design review expertise.`,
    `</TASK>`,
    ``,
    `<DESIGN_LOCATION>`,
    `\`${opts.designDir}/index.html\``,
    `\`${opts.designDir}/styles.css\``,
    `\`${opts.designDir}/script.js\``,
    `</DESIGN_LOCATION>`,
    ``,
    `<DESIGN_SYSTEM>`,
    opts.designSystem.raw,
    `</DESIGN_SYSTEM>`,
    ``,
    `<USER_FEEDBACK>`,
    opts.userFeedback.trim() || "(no specific user feedback)",
    `</USER_FEEDBACK>`,
    ``,
    `<CRITIQUE_METHOD>`,
    ``,
    `**Assessment A — Design Review (LLM analysis):**`,
    `1. Read all three design files in full.`,
    `2. Check design system compliance: are Design.md tokens actually used?`,
    `3. Check visual hierarchy, layout balance, and information architecture.`,
    `4. Check for AI slop anti-patterns:`,
    renderBans(),
    `5. Check accessibility basics (contrast, semantic HTML, ARIA).`,
    `6. Check responsiveness (media queries, flexible layouts).`,
    `7. Address any specific points from the user feedback above.`,
    ``,
    `**Assessment B — Automated scanning:**`,
    `Run this command if the \`impeccable\` CLI is available:`,
    `\`npx impeccable --json ${opts.designDir}\``,
    `If it returns exit code 2, parse the JSON findings.`,
    `If it's not available, skip this assessment.`,
    ``,
    `</CRITIQUE_METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Report findings with P0-P3 severity:`,
    ``,
    `### P0 — Critical (must fix before export)`,
    `- <finding with file:line reference>`,
    ``,
    `### P1 — Important`,
    `- <finding>`,
    ``,
    `### P2 — Moderate`,
    `- <finding>`,
    ``,
    `### P3 — Minor (informational)`,
    `- <finding>`,
    ``,
    `### User Feedback Alignment`,
    `- <how well the current design addresses user feedback>`,
    ``,
    `### Scanner Results`,
    `- <results from npx impeccable --json, or "scanner not available">`,
    ``,
    `Omit empty severity sections.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Be specific — cite file:line for every finding.`,
    `Prioritize user feedback alignment over general design critique.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

/** Phase 4 — headless: visual validation via playwright screenshot. */
export function buildScreenshotValidationPrompt(opts: {
  designDir: string;
  scratchDir: string;
}): string {
  return [
    `<TASK>`,
    `Render the generated design in a browser via playwright and take a`,
    `screenshot for visual validation. Describe what you see.`,
    `</TASK>`,
    ``,
    `<DESIGN_FILE>`,
    `\`${opts.designDir}/index.html\``,
    `</DESIGN_FILE>`,
    ``,
    `<METHOD>`,
    `1. Use playwright-cli to open \`${opts.designDir}/index.html\` as a local file.`,
    `2. Set viewport to 1280x800 (standard desktop).`,
    `3. Wait for the page to fully render (fonts, animations, etc.).`,
    `4. Take a screenshot and save to: \`${opts.scratchDir}/screenshot-validation.png\``,
    `5. If the page has interactive elements, take a second screenshot after`,
    `   hovering over the primary CTA button (if present).`,
    `6. Describe what you observe visually:`,
    `   - Does the layout render correctly?`,
    `   - Are there any visual glitches, overflow issues, or broken layouts?`,
    `   - Do colors and typography look intentional?`,
    `   - Is there enough contrast for readability?`,
    `   - Any elements that appear AI-generated or generic?`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Render Status`,
    `<success/failure, any console errors>`,
    ``,
    `### Visual Assessment`,
    `- Layout: <assessment>`,
    `- Colors: <assessment>`,
    `- Typography: <assessment>`,
    `- Spacing: <assessment>`,
    `- Interactions: <assessment if applicable>`,
    ``,
    `### Issues Found`,
    `- <issue description>`,
    ``,
    `### Screenshot`,
    `Saved to: \`${opts.scratchDir}/screenshot-validation.png\``,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Report what you SEE — do not speculate about code issues.`,
    `If the HTML fails to render, report the error.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}

/** Phase 4 — visible: apply feedback + critique findings to the design. */
export function buildApplyChangesPrompt(opts: {
  prompt: string;
  designDir: string;
  designSystem: DesignSystemData;
  userFeedback: string;
  critiqueOutput: string;
  screenshotOutput: string;
  iteration: number;
}): string {
  return [
    `<DESIGN_REQUEST>`,
    opts.prompt,
    `</DESIGN_REQUEST>`,
    ``,
    `<TASK>`,
    `Apply refinements to the design based on user feedback, automated critique`,
    `findings, and visual validation results. This is iteration ${opts.iteration}.`,
    `</TASK>`,
    ``,
    `<DESIGN_LOCATION>`,
    `Edit these files in place:`,
    `- \`${opts.designDir}/index.html\``,
    `- \`${opts.designDir}/styles.css\``,
    `- \`${opts.designDir}/script.js\``,
    `</DESIGN_LOCATION>`,
    ``,
    `<DESIGN_SYSTEM>`,
    opts.designSystem.raw,
    `</DESIGN_SYSTEM>`,
    ``,
    `<USER_FEEDBACK>`,
    opts.userFeedback.trim() || "(no specific user feedback)",
    `</USER_FEEDBACK>`,
    ``,
    `<CRITIQUE_FINDINGS>`,
    opts.critiqueOutput.trim() || "(no critique findings)",
    `</CRITIQUE_FINDINGS>`,
    ``,
    `<VISUAL_VALIDATION>`,
    opts.screenshotOutput.trim() || "(no visual validation performed)",
    `</VISUAL_VALIDATION>`,
    ``,
    `<CHANGE_PRIORITY>`,
    `Apply changes in this priority order:`,
    `1. User feedback — the user's requests take highest priority`,
    `2. P0 critique findings — critical issues that must be fixed`,
    `3. P1 critique findings — important issues`,
    `4. Visual validation issues — rendering problems`,
    `5. P2 critique findings — moderate issues (if time permits)`,
    `6. Skip P3 findings — they are informational only`,
    `</CHANGE_PRIORITY>`,
    ``,
    `<ABSOLUTE_BANS>`,
    `These anti-patterns are BANNED. Remove them if found, never introduce them:`,
    ``,
    renderBans(),
    `</ABSOLUTE_BANS>`,
    ``,
    `<INSTRUCTIONS>`,
    `1. Load the /impeccable skill for design quality guidelines.`,
    `2. Read the current design files.`,
    `3. Plan your changes based on the priority order above.`,
    `4. Apply changes by editing the files in place.`,
    `5. Ensure all design system tokens from Design.md are still used correctly.`,
    `6. Do NOT remove functionality that was working correctly.`,
    `7. After making changes, briefly summarize what you changed and why.`,
    `</INSTRUCTIONS>`,
    ``,
    `<CONSTRAINTS>`,
    `- Edit files in place — do not create new files.`,
    `- Maintain design system compliance — use tokens from Design.md.`,
    `- User feedback overrides automated critique when they conflict.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
    ``,
    `<DESIGN_REQUEST_REMINDER>`,
    opts.prompt,
    `</DESIGN_REQUEST_REMINDER>`,
  ].join("\n");
}

// ============================================================================
// PHASE 5: EXPORT / HANDOFF
// ============================================================================

/** Phase 5 — visible: export design and prepare handoff content. */
export function buildExportPrompt(opts: {
  prompt: string;
  designDir: string;
  finalDesignDir: string;
  designSystem: DesignSystemData;
  outputType: string;
}): string {
  return [
    `<TASK>`,
    `Export the final design and create handoff documentation.`,
    `</TASK>`,
    ``,
    `<DESIGN_LOCATION>`,
    `Source design files: \`${opts.designDir}/\``,
    `Final export directory: \`${opts.finalDesignDir}/\``,
    `</DESIGN_LOCATION>`,
    ``,
    `<PROCESS>`,
    ``,
    `${HIL_INSTRUCTION}`,
    ``,
    `1. Use AskUserQuestion to ask: "How would you like to export?"`,
    `   Provide options:`,
    `   - "HTML + handoff bundle" — complete export with implementation guide`,
    `   - "HTML only" — just the design files`,
    ``,
    `2. Copy the design files to the export directory:`,
    `   - \`${opts.designDir}/index.html\` → \`${opts.finalDesignDir}/design/index.html\``,
    `   - \`${opts.designDir}/styles.css\` → \`${opts.finalDesignDir}/design/styles.css\``,
    `   - \`${opts.designDir}/script.js\` → \`${opts.finalDesignDir}/design/script.js\``,
    ``,
    `3. Write \`${opts.finalDesignDir}/design-intent.md\`:`,
    `   - Original design request`,
    `   - Key design decisions made during generation`,
    `   - Design rationale for layout, color, and typography choices`,
    `   - Output type: ${opts.outputType}`,
    ``,
    `4. Write \`${opts.finalDesignDir}/component-specs.md\`:`,
    `   - List each distinct component in the design`,
    `   - For each: name, purpose, variants, key CSS properties, interaction states`,
    `   - Reference the design system tokens used`,
    ``,
    `5. Report the final export location to the user.`,
    ``,
    `</PROCESS>`,
    ``,
    `<ORIGINAL_REQUEST>`,
    opts.prompt,
    `</ORIGINAL_REQUEST>`,
    ``,
    `<CONSTRAINTS>`,
    `- Create the export directory structure if it doesn't exist.`,
    `- The design-intent.md and component-specs.md files should be concise and actionable.`,
    `- Do NOT modify the original design files — only copy them.`,
    TRAILING_PROSE_REMINDER,
    `</CONSTRAINTS>`,
  ].join("\n");
}
