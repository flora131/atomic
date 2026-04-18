/**
 * Prompt builders for the open-claude-design workflow.
 *
 * Each builder produces a focused, single-responsibility prompt for one
 * specialist sub-agent across the 5 design phases:
 *   Phase 1 — Design System Onboarding
 *   Phase 2 — Import (reference classification & capture)
 *   Phase 3 — Generation
 *   Phase 4 — Refinement (bounded iterative loop)
 *   Phase 5 — Export / Handoff
 *
 * Context-engineering principles applied throughout (matching deep-research-codebase):
 *   • Position-aware framing: key info repeated at TOP and BOTTOM of each prompt
 *   • Trailing-prose guarantee: every prompt ends with prose, NOT a tool call
 *   • Skill activation: skills named explicitly by their key directives
 *   • Forward-only data flow: each prompt only includes context for its stage
 */

import type { DesignSystemContext } from "./design-system.ts";

// ---------------------------------------------------------------------------
// Re-exported types
// ---------------------------------------------------------------------------

export type { DesignSystemContext };

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

export interface GeneratorContext {
  prompt: string;
  reference: string;
  designSystem: DesignSystemContext;
  outputType: string;
  designDir: string;
}

export interface RefineContext {
  prompt: string;
  designDir: string;
  designSystem: DesignSystemContext;
  iteration: number;
  validationFeedback?: string;
}

export interface ExportContext {
  designDir: string;
  finalPath: string;
  designSystem: DesignSystemContext;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRAILING_PROSE_REMINDER =
  "End your response with prose summarizing your findings. Do NOT end with a tool call.";

const MAX_REFINEMENT_ITERATIONS = 8;

/**
 * Shared instruction block that forces agents to call the AskUserQuestion tool
 * rather than just printing question text. Injected into every prompt that
 * requires user interaction.
 */
const ASK_USER_QUESTION_ENFORCEMENT = [
  `<CRITICAL_TOOL_REQUIREMENT>`,
  `When this prompt tells you to use \`AskUserQuestion\`, you MUST call the`,
  `\`AskUserQuestion\` tool. Do NOT just print a question as text. Do NOT output`,
  `JSON with "Awaiting user choice" or similar placeholders. The user CANNOT`,
  `respond unless you invoke the actual tool.`,
  ``,
  `WRONG (do NOT do this):`,
  `  "Please review and approve..." (printed as text — user cannot respond)`,
  `  {"decision": "continue", "feedback": "Awaiting user choice"} (fake JSON — not a tool call)`,
  ``,
  `RIGHT (do this):`,
  `  Call the \`AskUserQuestion\` tool with your question as the argument.`,
  `  Wait for the tool_result containing the user's actual response.`,
  `  Then proceed based on what the user said.`,
  `</CRITICAL_TOOL_REQUIREMENT>`,
].join("\n");

/**
 * Anti-pattern guardrails to prevent generic AI-generated design slop.
 * Injected into generation, refinement, and critique prompts.
 */
const ANTI_PATTERN_GUARDRAILS = [
  `<ANTI_PATTERN_GUARDRAILS>`,
  `Your design MUST NOT look like generic AI-generated output. Actively avoid:`,
  ``,
  `**Layout anti-patterns:**`,
  `- Centered-everything layouts with no visual tension or asymmetry`,
  `- Cookie-cutter 3-column card grids (the "SaaS landing page starter kit" look)`,
  `- Hero section with giant stock-photo background + white text overlay`,
  `- Monotonous section → section → section vertical rhythm with identical spacing`,
  ``,
  `**Visual anti-patterns:**`,
  `- Gratuitous glassmorphism, blur effects, or frosted-glass cards`,
  `- Generic purple-to-blue gradients (the default "AI product" palette)`,
  `- Excessive border-radius on everything (rounded-2xl on every element)`,
  `- Drop shadows on every element (the "floating cards" epidemic)`,
  `- Decorative SVG blobs or mesh gradients used as filler`,
  ``,
  `**Content anti-patterns:**`,
  `- Lorem ipsum or obvious placeholder text — use realistic, contextual content`,
  `- Generic "Get Started" / "Learn More" CTA text without specificity`,
  `- Stock iconography (generic line icons that add no meaning)`,
  ``,
  `**Typography anti-patterns:**`,
  `- Default system fonts with no intentional pairing`,
  `- Uniform font weights throughout (everything is regular or everything is bold)`,
  `- Giant hero text with tiny body text (poor scale progression)`,
  ``,
  `**Instead, strive for:**`,
  `- Intentional asymmetry and visual tension in layouts`,
  `- Purposeful whitespace that creates breathing room, not emptiness`,
  `- Distinctive color application — use the design system palette with conviction`,
  `- Typography that creates clear hierarchy through size, weight, AND spacing`,
  `- Unique layout structures that serve the content, not a template`,
  `- Micro-details that show craft: custom list markers, thoughtful dividers,`,
  `  intentional hover states, considered empty states`,
  `- Content-first design where the layout serves the information architecture`,
  `</ANTI_PATTERN_GUARDRAILS>`,
].join("\n");


// ---------------------------------------------------------------------------
// Phase 1 — Design System Onboarding
// ---------------------------------------------------------------------------

/**
 * Build the design system locator prompt.
 *
 * Instructs the codebase-locator agent to search for CSS/Tailwind/design-related
 * files within the project root.
 */
export function buildDesignSystemLocatorPrompt(root: string): string {
  return [
    `<TASK>`,
    `Find ALL design-related files in the codebase rooted at \`${root}\`.`,
    `You are looking for anything that defines the project's visual design system.`,
    `</TASK>`,
    ``,
    `<SCOPE>`,
    `Search the entire codebase under \`${root}\`.`,
    `</SCOPE>`,
    ``,
    `<WHAT_TO_FIND>`,
    `Locate every file that belongs to one of these categories:`,
    ``,
    `1. **CSS / SCSS / LESS files** — global stylesheets, component styles, utility classes`,
    `2. **Tailwind configuration** — \`tailwind.config.js\`, \`tailwind.config.ts\`, \`tailwind.config.cjs\``,
    `3. **Theme / design token files** — CSS custom properties (CSS variables), JSON tokens, style dictionaries`,
    `4. **Component library entry points** — \`index.ts\`, \`index.js\` under a \`components/\`, \`ui/\`, or \`design-system/\` directory`,
    `5. **Design documentation** — \`.impeccable.md\`, \`DESIGN.md\`, \`design-system.md\`, design ADRs or RFCs`,
    `6. **Font / icon manifests** — \`fonts.css\`, icon library configs`,
    `</WHAT_TO_FIND>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Return a markdown report grouped by category:`,
    ``,
    `### CSS / SCSS / LESS`,
    `- \`<absolute path>\` — 1-line description`,
    ``,
    `### Tailwind Config`,
    `- ...`,
    ``,
    `### Theme / Design Tokens`,
    `- ...`,
    ``,
    `### Component Library Entry Points`,
    `- ...`,
    ``,
    `### Design Documentation`,
    `- ...`,
    ``,
    `### Fonts / Icons`,
    `- ...`,
    ``,
    `Omit sections with no entries. Use absolute paths throughout.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Do NOT read file contents yet — locate only. The analyzer will extract tokens.`,
    `Search ONLY within \`${root}\`. Do not read from outside the project.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Find ALL design-related files in \`${root}\` — CSS, SCSS, Tailwind config, theme/token files,`,
    `component library entry points, and .impeccable.md or similar design documentation.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

/**
 * Build the design system analyzer prompt.
 *
 * Instructs the codebase-analyzer agent to extract design tokens from files
 * located by the locator.
 */
export function buildDesignSystemAnalyzerPrompt(root: string): string {
  return [
    `<TASK>`,
    `Extract all design tokens from the design-related files located in \`${root}\`.`,
    `You are a design token extractor. Your job is to read the files and pull out`,
    `every color, typography value, spacing scale, and component definition.`,
    `</TASK>`,
    ``,
    `<SCOPE>`,
    `Work within \`${root}\`. Use the output from the codebase-locator to identify`,
    `which files to read. Focus on the implementation files, theme configs, and`,
    `CSS custom properties (CSS variables) discovered by the locator.`,
    `</SCOPE>`,
    ``,
    `<EXTRACTION_TARGETS>`,
    `1. **CSS Custom Properties (CSS Variables)** — \`--color-primary\`, \`--font-size-h1\`, etc.`,
    `2. **Tailwind theme configuration** — \`theme.colors\`, \`theme.fontSize\`, \`theme.spacing\`, \`theme.extend\``,
    `3. **Color palettes** — all named colors, semantic colors (primary, secondary, background, text, error, warning)`,
    `4. **Typography scales** — font families, font sizes (h1–h6, body, small, caption), font weights, line heights`,
    `5. **Spacing values** — padding/margin scale (xs, sm, md, lg, xl, 2xl, etc.)`,
    `6. **Border radii and shadows** — design-system-level values, not one-offs`,
    `7. **Reusable components** — component names, their variants, and source file locations`,
    `</EXTRACTION_TARGETS>`,
    ``,
    `<SKILLS>`,
    `Use your **extract** skill to surface tokens from raw CSS/JS/JSON.`,
    `Use your **normalize** skill to unify disparate token formats into a consistent shape.`,
    `</SKILLS>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Produce a structured markdown report:`,
    ``,
    `### Colors`,
    `| Token | Value | Semantic Role |`,
    `|-------|-------|---------------|`,
    `| \`--color-primary\` | \`#6366f1\` | Primary brand |`,
    ``,
    `### Typography`,
    `| Token | Value |`,
    `|-------|-------|`,
    `| heading font | \`Inter, sans-serif\` |`,
    ``,
    `### Spacing`,
    `| Scale | Value |`,
    `|-------|-------|`,
    `| xs | \`4px\` |`,
    ``,
    `### Components`,
    `- **Button** — variants: primary, secondary, ghost — \`src/components/Button.tsx\``,
    ``,
    `### Source Framework`,
    `Note the framework (e.g. Tailwind CSS v3, CSS Modules, styled-components) and config path.`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Use file:line references for every concrete token you extract.`,
    `Do NOT guess values — only report what you can read from actual files.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Extract all CSS custom properties, Tailwind theme config, color palettes, typography scales,`,
    `spacing values, and component catalog from the design files in \`${root}\`.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

/**
 * Build the design system builder prompt.
 *
 * Combines two responsibilities:
 *   1. Synthesize extracted tokens into a design system JSON (quantitative)
 *   2. Build the `.impeccable.md` design context (qualitative) following
 *      impeccable's expected `## Design Context` format
 *
 * The agent reads the repo autonomously to fill in gaps (README, package.json,
 * existing `.impeccable.md`, docs) and only asks the user to confirm or correct
 * the consolidated proposal — not to answer a long questionnaire.
 */
export function buildDesignSystemBuilderPrompt(context: {
  locatorOutput: string;
  analyzerOutput: string;
  importContext?: string;
  userPrompt?: string;
  outputType?: string;
}): string {
  const locator = context.locatorOutput.trim().length > 0
    ? context.locatorOutput.trim()
    : "(locator returned no files)";

  const analyzer = context.analyzerOutput.trim().length > 0
    ? context.analyzerOutput.trim()
    : "(analyzer returned no tokens)";

  const importLines: string[] =
    context.importContext && context.importContext.trim().length > 0
      ? [
          `<IMPORT_CONTEXT>`,
          `The following design context was captured from the user's reference (URL, file, or codebase):`,
          ``,
          context.importContext.trim(),
          `</IMPORT_CONTEXT>`,
          ``,
        ]
      : [];

  const designRequestLines: string[] = context.userPrompt
    ? [
        `<DESIGN_REQUEST>`,
        `The user wants to generate the following:`,
        `**Prompt:** ${context.userPrompt}`,
        `**Output Type:** ${context.outputType ?? "prototype"}`,
        `</DESIGN_REQUEST>`,
        ``,
      ]
    : [];

  return [
    `<TASK>`,
    `Build a complete design foundation for this project by:`,
    `1. Synthesizing design tokens into \`.open-claude-design/design-system.json\``,
    `2. Writing qualitative design context to \`.impeccable.md\` following impeccable's expected format`,
    ``,
    `You must produce BOTH files. The design system JSON captures quantitative tokens (colors,`,
    `fonts, spacing). The \`.impeccable.md\` captures qualitative context (who uses this, what`,
    `it should feel like, aesthetic direction, design principles).`,
    `</TASK>`,
    ``,
    `<LOCATOR_FINDINGS>`,
    locator,
    `</LOCATOR_FINDINGS>`,
    ``,
    `<ANALYZER_FINDINGS>`,
    analyzer,
    `</ANALYZER_FINDINGS>`,
    ``,
    ...importLines,
    ...designRequestLines,
    `<SKILLS>`,
    `Use your **colorize** skill to evaluate and present the color palette.`,
    `Use your **typeset** skill to evaluate and present the typography scale.`,
    `</SKILLS>`,
    ``,
    `<METHOD>`,
    `## Step 1: Context Discovery (autonomous — no user interaction)`,
    ``,
    `Read the codebase to infer as much qualitative design context as you can.`,
    `You CANNOT infer this from CSS tokens alone — you need to read project docs:`,
    ``,
    `- **README.md** / **README** — project purpose, target audience, stated goals`,
    `- **package.json** — project name, description, dependencies (design libraries hint at aesthetic)`,
    `- **Existing \`.impeccable.md\`** — if it already exists, READ IT FIRST and preserve/merge its content`,
    `- **CLAUDE.md** / other instruction files — may contain design context or brand guidelines`,
    `- **Any design docs found by the locator** — DESIGN.md, design-system.md, brand guides, ADRs`,
    ``,
    `From these sources, draft answers for:`,
    `- **Users**: Who uses this product? What is their context? What job are they doing?`,
    `- **Brand Personality**: 3 words that describe the brand voice. What tone? What emotions?`,
    `- **Aesthetic Direction**: Visual tone, references, anti-references, light/dark theme choice`,
    `- **Design Principles**: 3-5 opinionated principles that should guide all design decisions`,
    ``,
    `For a greenfield repo with minimal docs, infer what you can from the project name,`,
    `description, and tech stack. It is OK to have sparse context — do NOT fabricate details.`,
    ``,
    `## Step 2: Organize Design Tokens`,
    ``,
    `Group the extracted tokens from the analyzer findings into a coherent design system:`,
    `- Colors (primary, secondary, background, text, + semantic variants)`,
    `- Typography (fontFamily for heading/body, scale for h1/h2/body/small)`,
    `- Spacing (xs/sm/md/lg/xl)`,
    `- Components (name, variants, source)`,
    ``,
    `If the analyzer found no tokens (greenfield project), propose sensible defaults.`,
    ``,
    `## Step 3: Present Consolidated Proposal and Get User Approval`,
    ``,
    `Build a formatted summary of your full proposal including:`,
    `- The inferred design context (Users, Brand Personality, Aesthetic Direction, Principles)`,
    `- The proposed design tokens (Colors, Typography, Spacing, Components)`,
    `- If import context was captured from a reference (URL, file, or codebase): what was`,
    `  captured and how it will influence the design direction`,
    `- The user's design request (prompt and output type) so they can confirm the full intent`,
    ``,
    `Then you MUST call the \`AskUserQuestion\` tool to present this summary and ask:`,
    `"Here's the design direction I've put together from your codebase and reference.`,
    `Please review and tell me what to change, or approve if it looks right — I'll write`,
    `both files once you confirm."`,
    ``,
    `IMPORTANT: You MUST call the \`AskUserQuestion\` tool here. Do NOT just print the`,
    `question as text. The user cannot respond unless you invoke the tool. Wait for the`,
    `tool_result containing the user's actual response before proceeding.`,
    ``,
    `If the user has corrections: apply them, then call \`AskUserQuestion\` AGAIN to`,
    `re-present the updated proposal. Keep iterating until the user explicitly approves.`,
    `Do NOT walk through each section one-at-a-time unless the user asks to.`,
    ``,
    `## Step 4: Write design-system.json`,
    ``,
    `After approval, write the design system as a JSON object wrapped in a \`\`\`json fence`,
    `to \`.open-claude-design/design-system.json\`. The JSON must match the \`DesignSystemContext\` shape:`,
    `\`\`\`json`,
    `{`,
    `  "version": 1,`,
    `  "name": "<project name>",`,
    `  "colors": { "primary": "...", "secondary": "...", "background": "...", "text": "..." },`,
    `  "typography": { "fontFamily": { "heading": "...", "body": "..." }, "scale": { "h1": "...", "h2": "...", "body": "...", "small": "..." } },`,
    `  "spacing": { "xs": "...", "sm": "...", "md": "...", "lg": "...", "xl": "..." },`,
    `  "components": [],`,
    `  "source": { "framework": "...", "configPath": "..." }`,
    `}`,
    `\`\`\``,
    ``,
    `## Step 5: Write .impeccable.md`,
    ``,
    `Write or update \`.impeccable.md\` at the project root using EXACTLY this structure.`,
    `This is the format that the impeccable skill reads for design context:`,
    ``,
    `\`\`\`markdown`,
    `## Design Context`,
    ``,
    `### Users`,
    `[Who uses this product, their context, the job they are trying to get done]`,
    ``,
    `### Brand Personality`,
    `**[3 words]**`,
    ``,
    `- **Voice:** [How the interface speaks — direct, warm, clinical, playful, etc.]`,
    `- **Tone:** [The emotional register — professional, casual, urgent, calm, etc.]`,
    `- **Emotional goals:** [What users should feel — confidence, delight, trust, etc.]`,
    ``,
    `### Aesthetic Direction`,
    ``,
    `**Visual tone:** [High-level aesthetic description]`,
    ``,
    `**Theme:** [Light / Dark / Both — with rationale based on usage context]`,
    ``,
    `**References:** [1-3 products or sites that capture the right feel, with what specifically about them]`,
    ``,
    `**Anti-references (what to avoid):** [What this should explicitly NOT look like]`,
    ``,
    `### Design Principles`,
    ``,
    `1. **[Principle name].** [One-sentence description of the principle]`,
    `2. **[Principle name].** [One-sentence description]`,
    `3. **[Principle name].** [One-sentence description]`,
    `\`\`\``,
    ``,
    `IMPORTANT: If \`.impeccable.md\` already exists, READ IT FIRST. Merge the new design`,
    `context into the existing content — never overwrite pre-existing sections blindly.`,
    `The \`## Design Context\` section should be updated in place if it exists, or appended if not.`,
    `</METHOD>`,
    ``,
    ASK_USER_QUESTION_ENFORCEMENT,
    ``,
    `<CONSTRAINTS>`,
    `You MUST call the \`AskUserQuestion\` tool before writing any files — never assume approval.`,
    `Do NOT write design-system.json or .impeccable.md until the user explicitly approves via`,
    `the \`AskUserQuestion\` tool response. If you skip the tool call and just print a question,`,
    `the workflow will proceed without user approval, which is a critical failure.`,
    `Write the design system JSON in a \`\`\`json fenced block so it can be parsed downstream.`,
    `The \`.impeccable.md\` MUST use the \`## Design Context\` heading with the four subsections`,
    `(Users, Brand Personality, Aesthetic Direction, Design Principles) — this is what the`,
    `impeccable skill's context gathering protocol looks for.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Read the repo (README, package.json, existing .impeccable.md, docs) to infer design context`,
    `→ organize design tokens → present consolidated proposal by CALLING the \`AskUserQuestion\` tool`,
    `→ wait for user approval → write \`.open-claude-design/design-system.json\` → write \`.impeccable.md\``,
    `with \`## Design Context\` (Users / Brand Personality / Aesthetic Direction / Design Principles).`,
    `REMEMBER: You MUST call the \`AskUserQuestion\` tool — do NOT just print the question as text.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Phase 2 — Import (Reference Classification & Capture)
// ---------------------------------------------------------------------------

/**
 * Build the web capture prompt.
 *
 * Instructs the codebase-online-researcher agent to use playwright-cli to
 * navigate to a URL, take screenshots, and extract design context.
 */
export function buildWebCapturePrompt(url: string): string {
  return [
    `<TASK>`,
    `Use playwright-cli to capture the visual design and CSS styling from: ${url}`,
    `</TASK>`,
    ``,
    `<TARGET_URL>`,
    url,
    `</TARGET_URL>`,
    ``,
    `<SKILLS>`,
    `Use your **playwright-cli** skill throughout. Follow the token-efficient fetch order:`,
    `playwright-cli → screenshot → DOM extraction → CSS inspection.`,
    `</SKILLS>`,
    ``,
    `<METHOD>`,
    `1. **Navigate**: Use playwright-cli to open the URL: \`${url}\``,
    ``,
    `2. **Full-page screenshot**: Take a full-page screenshot and save it.`,
    `   Note the screenshot file path in your output.`,
    ``,
    `3. **DOM structure extraction**: Extract key layout elements:`,
    `   - Page heading structure (h1, h2, h3)`,
    `   - Navigation bar elements and links`,
    `   - Main content sections and their layout`,
    `   - Footer structure`,
    `   - CTA buttons and their text`,
    ``,
    `4. **Computed CSS extraction**: Inspect computed styles for key elements:`,
    `   - Primary colors (background-color, color for headings, CTAs)`,
    `   - Font families (font-family for headings and body text)`,
    `   - Font sizes (computed px values for h1, body, small)`,
    `   - Spacing patterns (padding/margin on container elements)`,
    `   - Border radii on cards, buttons`,
    ``,
    `5. **Return structured summary**:`,
    `   - Screenshot path`,
    `   - Color palette (hex values extracted from computed CSS)`,
    `   - Typography (font families, size scale)`,
    `   - Layout structure (sections, grid columns, spacing)`,
    `   - Key design elements (cards, buttons, navigation patterns)`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Screenshot`,
    `Path: \`<screenshot path>\``,
    ``,
    `### Color Palette`,
    `- Background: \`#...\``,
    `- Primary: \`#...\``,
    `- Text: \`#...\``,
    ``,
    `### Typography`,
    `- Heading font: ...`,
    `- Body font: ...`,
    `- h1 size: ...px`,
    ``,
    `### Layout Structure`,
    `- Navigation: ...`,
    `- Hero section: ...`,
    `- Content sections: ...`,
    ``,
    `### Key Design Elements`,
    `- Buttons: ...`,
    `- Cards: ...`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Use playwright-cli for all browser interactions — do not make HTTP requests directly.`,
    `If the URL is unreachable, report the error and provide whatever context you can.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Navigate to ${url} with playwright-cli, take a full-page screenshot, extract DOM structure`,
    `and computed CSS values (colors, fonts, spacing), and return a structured design summary.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

/**
 * Build the file parse prompt.
 *
 * Instructs an agent to parse a reference file (image, document, or design file)
 * for design context.
 */
export function buildFileParsePrompt(filePath: string): string {
  return [
    `<TASK>`,
    `Parse the reference file at \`${filePath}\` and extract all design-relevant information.`,
    `</TASK>`,
    ``,
    `<FILE_PATH>`,
    filePath,
    `</FILE_PATH>`,
    ``,
    `<METHOD>`,
    `Read or inspect the file at \`${filePath}\` and extract design context based on its type:`,
    ``,
    `**Images** (PNG, JPG, SVG, WEBP, GIF):`,
    `   - Describe the visual layout and composition`,
    `   - Identify the color palette (dominant colors, accent colors, background)`,
    `   - Describe typography (font styles, weights, sizes if estimable)`,
    `   - Note spacing and whitespace patterns`,
    `   - Identify UI components visible (buttons, cards, navigation, forms)`,
    `   - Describe the overall design aesthetic (minimal, bold, playful, corporate, etc.)`,
    ``,
    `**Documents** (PDF, DOCX, TXT, MD):`,
    `   - Extract content structure and information hierarchy`,
    `   - Note any explicit design specifications mentioned`,
    `   - Identify brand guidelines or style rules`,
    ``,
    `**Design / Spec Files** (Figma exports, SVG component libraries):`,
    `   - Extract component specifications (sizes, colors, states)`,
    `   - Identify design tokens referenced`,
    `   - Note interaction specifications if present`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### File Type`,
    `<detected file type>`,
    ``,
    `### Visual Elements`,
    `- Color palette: ...`,
    `- Typography: ...`,
    `- Layout: ...`,
    ``,
    `### Design Context`,
    `<summary of design-relevant information extracted>`,
    ``,
    `### Extracted Specifications`,
    `<any concrete measurements, values, or specifications found>`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `If the file does not exist, report the error clearly.`,
    `Focus on design-relevant information — skip content that has no visual design implication.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Parse \`${filePath}\` and extract: colors, layout, typography, and any design specifications.`,
    `Handle images by describing visual elements, documents by extracting structure.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

/**
 * Build the codebase scan prompt.
 *
 * Instructs an agent to scan a codebase path for design context,
 * component structure, and applied styles.
 */
export function buildCodebaseScanPrompt(refPath: string, root: string): string {
  return [
    `<TASK>`,
    `Scan the codebase path \`${refPath}\` (within project root \`${root}\`) for design context.`,
    `Extract component structure, applied styles, and design patterns used.`,
    `</TASK>`,
    ``,
    `<SCOPE>`,
    `Primary scan path: \`${refPath}\``,
    `Project root: \`${root}\``,
    `</SCOPE>`,
    ``,
    `<WHAT_TO_EXTRACT>`,
    `1. **Component structure** — what components exist, how they are organized,`,
    `   which components are reusable design primitives vs application-specific`,
    ``,
    `2. **Applied styles** — what CSS classes, style props, or CSS Modules are used;`,
    `   which styles are design-system-level (tokens) vs one-off overrides`,
    ``,
    `3. **Design patterns used** — layout patterns (grid, flex, stack), spacing conventions,`,
    `   color usage patterns (semantic vs raw values), typography application`,
    ``,
    `4. **Design system adherence** — are components using design tokens consistently,`,
    `   or are there hard-coded values that should be tokens?`,
    `</WHAT_TO_EXTRACT>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Component Structure`,
    `- \`<absolute path>\` — component name and purpose`,
    ``,
    `### Applied Styles`,
    `- CSS framework/approach: ...`,
    `- Commonly used classes / tokens: ...`,
    ``,
    `### Design Patterns`,
    `- Layout: ...`,
    `- Spacing: ...`,
    `- Colors: ...`,
    ``,
    `### Design System Adherence`,
    `- Consistent usage: ...`,
    `- Hard-coded values found: ...`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Search only within \`${root}\`. Use absolute paths throughout.`,
    `Do NOT read files outside the scope. Focus on design, not logic.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Scan \`${refPath}\` under \`${root}\` — extract component structure, applied styles,`,
    `and design patterns used across the codebase section.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Phase 3 — Generation
// ---------------------------------------------------------------------------

/**
 * Per-output-type instructions injected into the generator prompt.
 */
function buildOutputTypeInstructions(outputType: string): string {
  switch (outputType) {
    case "prototype":
      return [
        `**Output Type: Prototype**`,
        `Create a FULLY INTERACTIVE prototype with:`,
        `- Working hover states on all interactive elements`,
        `- CSS transitions and animations (entry animations, hover effects, focus states)`,
        `- JavaScript interactivity (menu toggles, tab switching, modal dialogs, form validation)`,
        `- Realistic micro-interactions that demonstrate the intended UX flow`,
        `- All clickable elements respond to pointer events`,
      ].join("\n");

    case "wireframe":
      return [
        `**Output Type: Wireframe**`,
        `Create a LAYOUT-FOCUSED wireframe with:`,
        `- Grayscale color scheme only — no colors beyond black, white, and gray shades`,
        `- Placeholder content (Lorem ipsum, gray image boxes, "Heading Text", "Button Label")`,
        `- Clear layout grid showing column structure and spacing rhythm`,
        `- Simplified components showing shape and position, not final styling`,
        `- Annotations where needed to explain interactive elements`,
      ].join("\n");

    case "mockup":
      return [
        `**Output Type: Mockup**`,
        `Create a HIGH-FIDELITY visual mockup with:`,
        `- Full color palette applied from the design system`,
        `- Detailed typography rendering (actual font families, weights, sizes)`,
        `- Real content (not placeholder — use realistic sample text and data)`,
        `- Pixel-perfect spacing aligned to the design system scale`,
        `- All visual states rendered (default, hover if relevant, selected)`,
      ].join("\n");

    case "full-site":
      return [
        `**Output Type: Full Site**`,
        `Create a MULTI-PAGE website with a local dev server:`,
        `- Multiple interconnected HTML pages (minimum: index.html, about.html, contact.html)`,
        `- Shared navigation header with working links between ALL pages`,
        `- Consistent layout structure (header, main content, footer) across all pages`,
        `- A shared \`styles.css\` file imported by all pages`,
        `- JavaScript for interactive elements (\`script.js\`)`,
        `- Responsive layout across all pages (mobile, tablet, desktop)`,
        `- A \`serve.ts\` file for Bun-powered localhost preview`,
        ``,
        `IMPORTANT: You MUST generate a \`serve.ts\` file in the output directory root.`,
        `This file creates a local Bun HTTP server that serves all the HTML/CSS/JS files.`,
        `The server should:`,
        `  - Listen on port 3000`,
        `  - Serve static files from the output directory using \`import.meta.dir\``,
        `  - Map \`/\` to \`/index.html\``,
        `  - Append \`.html\` to extensionless paths (so \`/about\` serves \`/about.html\`)`,
        `  - Set correct MIME types for HTML, CSS, JS, JSON, and image files`,
        `  - Return 404 for missing files`,
        `  - Print the server URL on startup`,
        ``,
        `File structure for full site:`,
        `  \`index.html\` — Home page`,
        `  \`about.html\` — About page (or other secondary page)`,
        `  \`contact.html\` — Contact page (or other tertiary page)`,
        `  \`styles.css\` — Shared styles imported by all pages`,
        `  \`script.js\` — Shared JavaScript (navigation, interactions)`,
        `  \`serve.ts\` — Bun dev server (run with: bun <output-dir>/serve.ts)`,
        `  \`assets/\` — Images, icons, other static files`,
      ].join("\n");

    case "landing-page":
    default:
      return [
        `**Output Type: Landing Page**`,
        `Create a MARKETING-FOCUSED landing page with:`,
        `- Compelling hero section with clear value proposition and primary CTA`,
        `- Scroll animations (use Intersection Observer API for reveal effects)`,
        `- Conversion-optimized layout (CTA buttons in multiple positions, social proof)`,
        `- Marketing copy structure (headline → subheadline → benefits → CTA → footer)`,
        `- Performance-optimized (no external dependencies, inline CSS/JS only)`,
      ].join("\n");
  }
}

/**
 * Build the main generation prompt.
 *
 * Injects design system JSON, import context, user prompt, output type,
 * and output directory. Activates design skills.
 */
export function buildGeneratorPrompt(context: GeneratorContext): string {
  const dsJson = JSON.stringify(context.designSystem, null, 2);
  const outputTypeInstructions = buildOutputTypeInstructions(context.outputType);

  const referenceSection = context.reference.trim().length > 0
    ? [
        `<REFERENCE_CONTEXT>`,
        `The user provided a reference for design inspiration: ${context.reference}`,
        `Use the captured design context from this reference to inform your generation.`,
        `</REFERENCE_CONTEXT>`,
        ``,
      ].join("\n")
    : "";

  return [
    `<DESIGN_REQUEST>`,
    context.prompt,
    `</DESIGN_REQUEST>`,
    ``,
    `<DESIGN_SYSTEM>`,
    `Apply the following design system consistently throughout your output:`,
    ``,
    `\`\`\`json`,
    dsJson,
    `\`\`\``,
    `</DESIGN_SYSTEM>`,
    ``,
    referenceSection,
    `<OUTPUT_TYPE>`,
    outputTypeInstructions,
    `</OUTPUT_TYPE>`,
    ``,
    `<OUTPUT_DIRECTORY>`,
    `Write all generated files to: \`${context.designDir}\``,
    `Primary output file: \`${context.designDir}/index.html\``,
    `Assets (if any): \`${context.designDir}/assets/\``,
    `</OUTPUT_DIRECTORY>`,
    ``,
    `<SKILLS>`,
    `Activate and apply ALL of the following skills:`,
    `- **impeccable**: Apply the impeccable design system skill — pixel-perfect spacing, visual hierarchy, and polish`,
    `- **shape**: Use the shape skill to plan the UX layout and interaction flow before writing code`,
    `- **layout**: Apply the layout skill — grid, spacing rhythm, and visual hierarchy`,
    `- **colorize**: Use the colorize skill to apply the design system's color palette with purpose`,
    `- **typeset**: Use the typeset skill to set typography correctly — font pairing, scale, line-height`,
    `- **delight**: Apply the delight skill — add micro-interactions, transitions, and moments of delight`,
    `</SKILLS>`,
    ``,
    ANTI_PATTERN_GUARDRAILS,
    ``,
    `<REQUIREMENTS>`,
    `1. Follow the output-type file structure above. For single-page types (prototype, wireframe,`,
    `   mockup, landing-page): generate a self-contained \`index.html\` with inline CSS/JS.`,
    `   For \`full-site\`: generate multiple HTML pages with shared \`styles.css\`, \`script.js\`,`,
    `   and a \`serve.ts\` dev server file`,
    `2. Apply the design system tokens from the JSON above — colors, typography, spacing`,
    `3. Follow the output-type instructions above precisely`,
    `4. The output must render correctly in a modern browser with no external dependencies`,
    `   (system fonts or CDN fonts matching the design system are acceptable)`,
    `5. Use semantic HTML5 elements (header, nav, main, section, article, footer)`,
    `6. Ensure responsive layout for mobile (375px), tablet (768px), and desktop (1440px)`,
    `7. After writing all files, open the design in the user's browser so they can preview it:`,
    `   - Run: \`open ${context.designDir}/index.html\` (macOS) or \`xdg-open ${context.designDir}/index.html\` (Linux)`,
    `</REQUIREMENTS>`,
    ``,
    `<DESIGN_REQUEST_REMINDER>`,
    context.prompt,
    `Generate a ${context.outputType} and write it to: \`${context.designDir}/index.html\``,
    `${TRAILING_PROSE_REMINDER}`,
    `</DESIGN_REQUEST_REMINDER>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Phase 4 — Refinement
// ---------------------------------------------------------------------------

/**
 * Build the refinement iteration prompt.
 *
 * Includes iteration count, max iterations, validation feedback, and design system.
 */
export function buildRefinePrompt(context: RefineContext): string {
  const dsJson = JSON.stringify(context.designSystem, null, 2);
  const maxIterations = MAX_REFINEMENT_ITERATIONS;

  const feedbackSection = context.validationFeedback && context.validationFeedback.trim().length > 0
    ? [
        `<VALIDATION_FEEDBACK>`,
        `The previous iteration's critique/validation identified these issues to address:`,
        ``,
        context.validationFeedback.trim(),
        `</VALIDATION_FEEDBACK>`,
        ``,
      ].join("\n")
    : "";

  return [
    `<REFINEMENT_REQUEST>`,
    context.prompt,
    `</REFINEMENT_REQUEST>`,
    ``,
    `<ITERATION_STATUS>`,
    `Current iteration: ${context.iteration} of ${maxIterations} maximum`,
    `Design directory: \`${context.designDir}\``,
    `</ITERATION_STATUS>`,
    ``,
    feedbackSection,
    `<DESIGN_SYSTEM>`,
    `Apply the following design system as reference for all refinements:`,
    ``,
    `\`\`\`json`,
    dsJson,
    `\`\`\``,
    `</DESIGN_SYSTEM>`,
    ``,
    `<SKILLS>`,
    `Apply the following skills during refinement:`,
    `- **impeccable**: Apply the impeccable skill — ensure every detail is polished`,
    `- **critique**: Use the critique skill to evaluate the current design before modifying`,
    `- **polish**: Apply the polish skill — refine transitions, whitespace, and typography`,
    `- **clarify**: Use the clarify skill — when feedback is ambiguous, ask for specifics`,
    `</SKILLS>`,
    ``,
    ANTI_PATTERN_GUARDRAILS,
    ``,
    `<METHOD>`,
    `1. Read the current design files in \`${context.designDir}\``,
    `2. Apply the critique skill to evaluate the current state`,
    `3. Address all validation feedback from the previous iteration`,
    `4. Apply the user's refinement request: "${context.prompt}"`,
    `5. Open the design in the user's browser so they can see it:`,
    `   - Run: \`open ${context.designDir}/index.html\` (macOS) or \`xdg-open ${context.designDir}/index.html\` (Linux)`,
    `   - This lets the user visually inspect the design before deciding`,
    `6. Present the key changes you made to the user`,
    `7. CALL the \`AskUserQuestion\` tool with EXACTLY this question:`,
    ``,
    `   "Choose one:\\n1. Done, looks good.\\n2. Run validation checks.\\n3. I have more changes."`,
    ``,
    `   You MUST call the \`AskUserQuestion\` tool here. Do NOT print the options as text.`,
    `   Do NOT output a JSON decision object. Wait for the tool_result.`,
    ``,
    `8. If the user's response indicates option 3 (or provides feedback directly),`,
    `   CALL the \`AskUserQuestion\` tool AGAIN with:`,
    `   "What changes would you like?"`,
    `   Wait for the tool_result containing the user's feedback.`,
    ``,
    `9. After resolving the user's choice via the tool_result responses,`,
    `   output a JSON summary block:`,
    `   \`\`\`json`,
    `   {"decision": "done"}`,
    `   \`\`\``,
    `   or`,
    `   \`\`\`json`,
    `   {"decision": "validate"}`,
    `   \`\`\``,
    `   or`,
    `   \`\`\`json`,
    `   {"decision": "continue", "feedback": "<user's actual feedback from tool_result>"}`,
    `   \`\`\``,
    `   The "feedback" value MUST be the user's actual words from the tool_result,`,
    `   NOT a placeholder like "Awaiting user choice".`,
    `</METHOD>`,
    ``,
    ASK_USER_QUESTION_ENFORCEMENT,
    ``,
    `<CONSTRAINTS>`,
    `Stay within the design system — do not introduce colors, fonts, or spacing outside the system.`,
    `Focus on the refinement requested; do not rebuild from scratch.`,
    `You MUST call \`AskUserQuestion\` for BOTH the 3-option choice and (if option 3) the follow-up feedback.`,
    `NEVER output {"decision": "continue", "feedback": "Awaiting user choice"} — that means`,
    `you failed to call the tool and fabricated a response instead.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<REFINEMENT_REMINDER>`,
    `Iteration ${context.iteration}/${maxIterations}. Refinement request: "${context.prompt}"`,
    `Design files are in \`${context.designDir}\`. Apply impeccable polish.`,
    `REMEMBER: You MUST call the \`AskUserQuestion\` tool — do NOT just print the question as text.`,
    `Open the design in the browser BEFORE asking the user for their decision.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</REFINEMENT_REMINDER>`,
  ].join("\n");
}

/**
 * Build the continuation prompt for multi-turn refinement within a single stage.
 *
 * Sent after the user chose "I have more changes" (option 3) and the agent
 * applied their feedback. Triggers another round of changes + the 3-option
 * AskUserQuestion. The Claude tmux pane preserves full conversation context,
 * so the agent already knows all prior feedback and changes.
 */
export function buildContinueRefinePrompt(designDir: string): string {
  return [
    `<CONTINUATION>`,
    `The user provided feedback in the previous turn. Apply their requested changes now.`,
    `</CONTINUATION>`,
    ``,
    `<METHOD>`,
    `1. Apply the changes the user requested in their last response`,
    `2. Open the updated design in the browser:`,
    `   - Run: \`open ${designDir}/index.html\` (macOS) or \`xdg-open ${designDir}/index.html\` (Linux)`,
    `3. Present what you changed`,
    `4. CALL the \`AskUserQuestion\` tool with EXACTLY this question:`,
    ``,
    `   "Choose one:\\n1. Done, looks good.\\n2. Run validation checks.\\n3. I have more changes."`,
    ``,
    `   You MUST call the \`AskUserQuestion\` tool here. Do NOT print the options as text.`,
    ``,
    `5. If the user's response indicates option 3 (or provides feedback directly),`,
    `   CALL the \`AskUserQuestion\` tool AGAIN with:`,
    `   "What changes would you like?"`,
    `   Wait for the tool_result containing the user's feedback.`,
    ``,
    `6. Output a JSON summary block:`,
    `   \`\`\`json`,
    `   {"decision": "done"}`,
    `   \`\`\``,
    `   or`,
    `   \`\`\`json`,
    `   {"decision": "validate"}`,
    `   \`\`\``,
    `   or`,
    `   \`\`\`json`,
    `   {"decision": "continue", "feedback": "<user's actual feedback from tool_result>"}`,
    `   \`\`\``,
    `</METHOD>`,
    ``,
    ASK_USER_QUESTION_ENFORCEMENT,
    ``,
    `${TRAILING_PROSE_REMINDER}`,
  ].join("\n");
}

/**
 * Build the critique prompt.
 *
 * Produces a structured design critique following a 5-dimension framework
 * with [Critical], [Moderate], [Minor] severity labels.
 */
export function buildCritiquePrompt(designDir: string, ds: DesignSystemContext): string {
  const dsJson = JSON.stringify(ds, null, 2);

  return [
    `<TASK>`,
    `Conduct a rigorous structured design critique of the design files in \`${designDir}\`.`,
    `</TASK>`,
    ``,
    `<DESIGN_DIRECTORY>`,
    designDir,
    `</DESIGN_DIRECTORY>`,
    ``,
    `<DESIGN_SYSTEM_REFERENCE>`,
    `\`\`\`json`,
    dsJson,
    `\`\`\``,
    `</DESIGN_SYSTEM_REFERENCE>`,
    ``,
    `<SKILLS>`,
    `Activate your **critique** skill for the full design evaluation methodology.`,
    `Activate your **audit** skill for accessibility and performance evaluation.`,
    `</SKILLS>`,
    ``,
    `<CRITIQUE_FRAMEWORK>`,
    `Evaluate the design across SIX dimensions in this order:`,
    ``,
    `**1. First Impression (2-second scan)**`,
    `   - What does the eye land on first? Is it the right element?`,
    `   - What is the immediate emotional reaction? (trust, excitement, confusion?)`,
    `   - Is the primary value proposition clear within 2 seconds?`,
    `   - Overall visual clarity and "at a glance" comprehension`,
    ``,
    `**2. Usability**`,
    `   - Can a user accomplish their primary goal without confusion?`,
    `   - Is navigation clear and consistent?`,
    `   - Are interactive elements (buttons, links, forms) clearly identifiable?`,
    `   - Are there any friction points in the key user flow?`,
    ``,
    `**3. Visual Hierarchy**`,
    `   - Does the reading order flow logically (F-pattern or Z-pattern)?`,
    `   - Is emphasis placed on the right elements (CTA > heading > body)?`,
    `   - Is whitespace used effectively to separate sections?`,
    `   - Are typography size contrasts sufficient to establish hierarchy?`,
    ``,
    `**4. Consistency**`,
    `   - Does the design adhere to the design system above?`,
    `   - Are spacing values from the scale (xs/sm/md/lg/xl)?`,
    `   - Are only the approved colors used (no raw hex values outside the system)?`,
    `   - Are component styles consistent across the page?`,
    ``,
    `**5. Accessibility**`,
    `   - Does color contrast meet WCAG AA (4.5:1 for normal text, 3:1 for large text)?`,
    `   - Are touch targets at least 44×44px on mobile?`,
    `   - Is text readable (no text below 12px, sufficient line-height)?`,
    `   - Are interactive elements keyboard accessible?`,
    ``,
    `**6. Design Originality (anti-slop detection)**`,
    `   - Does the design look like a generic AI-generated template? Flag if so.`,
    `   - Are there cookie-cutter patterns? (3-column card grids, centered-everything,`,
    `     generic hero with stock photo overlay, uniform section spacing)`,
    `   - Is there gratuitous use of: glassmorphism, purple-blue gradients, excessive`,
    `     border-radius, drop shadows on everything, decorative SVG blobs?`,
    `   - Does the typography show intentional pairing and hierarchy, or is it generic?`,
    `   - Does the layout have visual tension and purposeful asymmetry, or is it a template?`,
    `   - Is the content realistic and contextual, or placeholder/generic?`,
    `</CRITIQUE_FRAMEWORK>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `Structure your findings exactly as follows:`,
    ``,
    `### First Impression`,
    `<observations>`,
    ``,
    `### Usability`,
    `<observations>`,
    ``,
    `### Visual Hierarchy`,
    `<observations>`,
    ``,
    `### Consistency`,
    `<observations>`,
    ``,
    `### Accessibility`,
    `<observations>`,
    ``,
    `### Design Originality`,
    `<observations — flag any generic AI template patterns>`,
    ``,
    `### Structured Findings`,
    `Prefix each finding with its severity:`,
    `- **[Critical]** <issue that blocks usability or causes significant harm>`,
    `- **[Moderate]** <issue that degrades experience but has a workaround>`,
    `- **[Minor]** <polish improvement that would enhance quality>`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Be specific — reference actual elements, colors, and measurements in the design files.`,
    `Anchor every finding to a concrete element or measurement, not vague impressions.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Critique the design in \`${designDir}\` across: First Impression, Usability, Visual Hierarchy,`,
    `Consistency (against design system), Accessibility, and Design Originality (anti-slop detection).`,
    `Output severity-labeled findings.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

/**
 * Build the screenshot validation prompt.
 *
 * Instructs an agent to use playwright-cli to screenshot the generated HTML
 * at multiple viewports and report rendering issues.
 */
export function buildScreenshotValidationPrompt(dir: string): string {
  return [
    `<TASK>`,
    `Use playwright-cli to visually validate the generated design at \`${dir}\`.`,
    `Take screenshots at multiple viewport sizes and inspect for rendering issues.`,
    `</TASK>`,
    ``,
    `<DESIGN_DIRECTORY>`,
    dir,
    `</DESIGN_DIRECTORY>`,
    ``,
    `<SKILLS>`,
    `Use your **playwright-cli** skill throughout. Open the HTML file in a headless browser`,
    `and use the browser's viewport and screenshot capabilities.`,
    `</SKILLS>`,
    ``,
    `<VIEWPORTS>`,
    `Take screenshots at each of these viewport widths:`,
    `1. **Mobile**: 375px × 812px (iPhone SE / standard mobile)`,
    `2. **Tablet**: 768px × 1024px (iPad portrait)`,
    `3. **Desktop**: 1440px × 900px (standard desktop)`,
    `</VIEWPORTS>`,
    ``,
    `<METHOD>`,
    `1. Open \`${dir}/index.html\` in playwright's headless browser`,
    `2. For each viewport in the list above:`,
    `   a. Set the viewport size`,
    `   b. Wait for the page to fully render (waitForLoadState: "networkidle")`,
    `   c. Take a full-page screenshot`,
    `   d. Visually inspect for:`,
    `      - Layout breaks (elements overflowing, overlapping, or misaligned)`,
    `      - Text overflow or truncation issues`,
    `      - Images or icons not rendering`,
    `      - Horizontal scrollbars on mobile (indicates overflow)`,
    `      - Elements obscured or hidden unintentionally`,
    `3. Note any JavaScript console errors`,
    `</METHOD>`,
    ``,
    `<OUTPUT_FORMAT>`,
    `### Mobile (375px)`,
    `Screenshot: \`<path>\``,
    `Findings: <list of visual issues, or "No issues found">`,
    ``,
    `### Tablet (768px)`,
    `Screenshot: \`<path>\``,
    `Findings: <list of visual issues, or "No issues found">`,
    ``,
    `### Desktop (1440px)`,
    `Screenshot: \`<path>\``,
    `Findings: <list of visual issues, or "No issues found">`,
    ``,
    `### Console Errors`,
    `<any JavaScript errors observed, or "None">`,
    ``,
    `### Overall Assessment`,
    `<pass/fail and summary of critical issues>`,
    `</OUTPUT_FORMAT>`,
    ``,
    `<CONSTRAINTS>`,
    `Use playwright-cli — do NOT try to open a GUI browser.`,
    `If the file cannot be opened, report the error and skip that step.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Validate \`${dir}/index.html\` with playwright-cli at 375px, 768px, and 1440px viewports.`,
    `Take screenshots, inspect for layout issues and rendering problems.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Phase 5 — Export / Handoff
// ---------------------------------------------------------------------------

/**
 * Build the export prompt.
 *
 * Instructs an agent to review generated design files and produce
 * handoff documentation bundle.
 */
export function buildExportPrompt(context: ExportContext): string {
  const dsJson = JSON.stringify(context.designSystem, null, 2);

  return [
    `<TASK>`,
    `Review the generated design at \`${context.designDir}\` and produce a complete`,
    `handoff documentation bundle at \`${context.finalPath}\`.`,
    `</TASK>`,
    ``,
    `<DESIGN_DIRECTORY>`,
    context.designDir,
    `</DESIGN_DIRECTORY>`,
    ``,
    `<HANDOFF_DESTINATION>`,
    context.finalPath,
    `</HANDOFF_DESTINATION>`,
    ``,
    `<DESIGN_SYSTEM>`,
    `\`\`\`json`,
    dsJson,
    `\`\`\``,
    `</DESIGN_SYSTEM>`,
    ``,
    `<SKILLS>`,
    `Use your **extract** skill to pull design tokens, component specs, and interaction details`,
    `from the generated HTML/CSS/JS files.`,
    `</SKILLS>`,
    ``,
    `<DELIVERABLES>`,
    `Write FOUR documentation files to \`${context.finalPath}/\`:`,
    ``,
    `1. **\`design-intent.md\`** — The "why" behind design decisions:`,
    `   - Visual approach and aesthetic rationale`,
    `   - Color choices and their semantic meaning`,
    `   - Typography pairing rationale`,
    `   - Layout decisions and their UX reasoning`,
    `   - Key trade-offs made and why`,
    ``,
    `2. **\`component-specs.md\`** — Component specifications:`,
    `   - Each component's visual spec (dimensions, colors, spacing, typography)`,
    `   - Component states (default, hover, focus, disabled, error)`,
    `   - Component variants and their differences`,
    `   - Usage guidelines for each component`,
    ``,
    `3. **\`interaction-specs.md\`** — Interaction documentation:`,
    `   - Transitions and animations (what triggers them, duration, easing)`,
    `   - User flow documentation (step-by-step interaction sequences)`,
    `   - Micro-interaction specifications`,
    `   - State transitions and their triggers`,
    ``,
    `4. **\`accessibility-notes.md\`** — Accessibility compliance notes:`,
    `   - WCAG 2.1 AA compliance status`,
    `   - Color contrast ratios for all text/background combinations`,
    `   - Keyboard navigation flow`,
    `   - ARIA attributes used and their purpose`,
    `   - Known accessibility gaps and recommended fixes`,
    `</DELIVERABLES>`,
    ``,
    `<METHOD>`,
    `1. Read \`${context.designDir}/index.html\` in full`,
    `2. Extract design tokens, component definitions, and interaction patterns`,
    `3. Write each of the four documentation files above`,
    `4. Ensure the handoff bundle at \`${context.finalPath}\` is self-contained`,
    `</METHOD>`,
    ``,
    `<CONSTRAINTS>`,
    `Be specific — use concrete values (hex colors, px sizes, ms durations) throughout.`,
    `Every claim must be traceable to the generated HTML/CSS/JS.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Review \`${context.designDir}\` and write to \`${context.finalPath}\`:`,
    `  • design-intent.md (decisions and rationale)`,
    `  • component-specs.md (component specifications)`,
    `  • interaction-specs.md (interaction documentation)`,
    `  • accessibility-notes.md (compliance notes)`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Design Review (pre-generation approval gate)
// ---------------------------------------------------------------------------

export interface DesignReviewContext {
  designSystem: DesignSystemContext;
  importContext: string;
  userPrompt: string;
  outputType: string;
}

/**
 * Build the design review prompt.
 *
 * Used when the user provided a pre-existing design system via --design-system.
 * Presents the loaded design system + any import context + the design request
 * for explicit user approval before generation begins.
 */
export function buildDesignReviewPrompt(context: DesignReviewContext): string {
  const dsJson = JSON.stringify(context.designSystem, null, 2);

  const importSection =
    context.importContext.trim().length > 0
      ? [
          `<IMPORT_CONTEXT>`,
          `The following design context was captured from your reference:`,
          ``,
          context.importContext.trim(),
          `</IMPORT_CONTEXT>`,
          ``,
        ].join("\n")
      : "";

  return [
    `<TASK>`,
    `Review the design direction before generation begins.`,
    `Present the design system, reference context (if any), and design request`,
    `to the user for explicit approval. Do NOT proceed without confirmation.`,
    `</TASK>`,
    ``,
    `<DESIGN_SYSTEM>`,
    `The following design system has been loaded:`,
    ``,
    `\`\`\`json`,
    dsJson,
    `\`\`\``,
    `</DESIGN_SYSTEM>`,
    ``,
    importSection,
    `<DESIGN_REQUEST>`,
    `**Prompt:** ${context.userPrompt}`,
    `**Output Type:** ${context.outputType}`,
    `</DESIGN_REQUEST>`,
    ``,
    `<METHOD>`,
    `1. Read the design system tokens and import context above`,
    `2. Present a consolidated summary to the user showing:`,
    `   - Key design system tokens (colors, typography, spacing)`,
    `   - What was captured from the reference (if applicable) and how it will`,
    `     influence the generated design`,
    `   - What will be generated (output type, based on the prompt)`,
    `3. CALL the \`AskUserQuestion\` tool to ask:`,
    `   "Here's the design direction. Please review and approve, or tell me what to adjust."`,
    `   You MUST invoke the tool — do NOT just print this as text.`,
    `4. If the user requests changes:`,
    `   - If the change is to the design system tokens, update \`.open-claude-design/design-system.json\``,
    `   - Re-present the updated proposal and CALL \`AskUserQuestion\` again`,
    `5. Once approved, confirm and end your response`,
    `</METHOD>`,
    ``,
    ASK_USER_QUESTION_ENFORCEMENT,
    ``,
    `<CONSTRAINTS>`,
    `You MUST call the \`AskUserQuestion\` tool — never assume approval, never just print a question.`,
    `Do NOT generate any design artifacts — your only job is to confirm the design direction.`,
    `If the user updates the design system, write the changes to \`.open-claude-design/design-system.json\`.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</CONSTRAINTS>`,
    ``,
    `<TASK_REMINDER>`,
    `Present the design system + reference context + design request to the user.`,
    `Get explicit approval by CALLING the \`AskUserQuestion\` tool before the workflow proceeds.`,
    `Do NOT just print the question — you MUST invoke the tool so the user can respond.`,
    `${TRAILING_PROSE_REMINDER}`,
    `</TASK_REMINDER>`,
  ].join("\n");
}
