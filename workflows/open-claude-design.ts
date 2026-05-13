/**
 * Builtin workflow: open-claude-design
 *
 * Shape: Design-system onboarding → import → generate → refine → export/handoff.
 *
 * Inputs:
 *   reference     — optional text: URL or path to a design reference (Figma, screenshot, doc).
 *   output_type   — optional select: "component" | "page" | "theme" | "tokens" (default "component").
 *   design_system — optional text: name/identifier of the target design system (e.g. "shadcn", "tailwind", "custom").
 *
 * cross-ref spec §5.11; v0.x packages/atomic/src/commands/builtin-[star]/open-claude-design/
 */

import { defineWorkflow } from "../src/index.js";

const OUTPUT_TYPES = ["component", "page", "theme", "tokens"] as const;
type OutputType = (typeof OUTPUT_TYPES)[number];

export default defineWorkflow("open-claude-design")
  .description(
    "Design-system onboarding → import → generate → refine → export/handoff pipeline.",
  )
  .input("reference", {
    type: "text",
    required: false,
    description: "URL or path to a design reference (Figma link, screenshot, design doc, etc.).",
  })
  .input("output_type", {
    type: "select",
    choices: OUTPUT_TYPES,
    default: "component",
    description: "Kind of design artifact to produce.",
  })
  .input("design_system", {
    type: "text",
    required: false,
    description:
      'Name of the target design system (e.g. "shadcn/ui", "Tailwind CSS", "Material UI", or "custom").',
  })
  .run(async (ctx) => {
    const { reference, output_type, design_system } = ctx.inputs as {
      reference?: string;
      output_type?: OutputType;
      design_system?: string;
    };

    const outputType: OutputType =
      output_type && (OUTPUT_TYPES as readonly string[]).includes(output_type)
        ? output_type
        : "component";
    const dsLabel = design_system?.trim() || "the project's design system";
    const refContext = reference?.trim()
      ? `Design reference: ${reference}`
      : "No external design reference provided — infer from the existing codebase.";

    // Stage 1 — Onboarding: understand the design system in use.
    const onboardingStage = ctx.stage("onboarding");
    const onboarding = await onboardingStage.prompt(
      `You are a design-system analyst. Survey the repository to understand its UI stack and design conventions.\n\n${refContext}\nTarget design system: ${dsLabel}\n\nReport:\n1. Design system detected (libraries, tokens, component patterns).\n2. Existing conventions (naming, file structure, theming).\n3. Key constraints or gaps relevant to generating a ${outputType}.`,
    );

    // Stage 2 — Import: extract tokens / primitives from the reference if provided.
    const importStage = ctx.stage("import");
    const importResult = await importStage.prompt(
      `You are a design-import agent. Based on the onboarding report and any provided reference, extract the design tokens, color palette, typography scale, spacing system, and component primitives needed to produce a ${outputType}.\n\nOnboarding report:\n${onboarding}\n\n${refContext}`,
    );

    // Stage 3 — Generate: produce the primary artifact.
    const generateStage = ctx.stage("generate");
    const generated = await generateStage.prompt(
      `You are a UI code-generation agent. Using the imported design tokens and system conventions, generate a production-quality ${outputType} for ${dsLabel}.\n\nDesign tokens and primitives:\n${importResult}\n\nOnboarding context:\n${onboarding}\n\nRequirements:\n- Follow the project's file and naming conventions.\n- Export all public APIs clearly.\n- Include inline documentation.`,
    );

    // Stage 4 — Refine: review and polish the generated artifact.
    const refineStage = ctx.stage("refine");
    const refined = await refineStage.prompt(
      `You are a design-quality reviewer. Review and refine the generated ${outputType} below against the design system conventions and the reference.\n\nGenerated artifact:\n${generated}\n\nDesign system: ${dsLabel}\n${refContext}\n\nFix:\n- Accessibility issues (aria labels, keyboard nav, contrast).\n- Consistency with design tokens.\n- Any TypeScript or lint errors visible in the code.`,
    );

    // Stage 5 — Export/handoff: produce a handoff summary and integration instructions.
    const handoffStage = ctx.stage("export-handoff");
    const handoff = await handoffStage.prompt(
      `Produce a concise handoff document for the following generated ${outputType}.\n\nArtifact:\n${refined}\n\nInclude:\n1. File path recommendation.\n2. Usage example (import + JSX/usage snippet).\n3. Design token dependencies (list names).\n4. Accessibility checklist (checked items only).\n5. Next steps / known limitations.`,
    );

    return {
      output_type: outputType,
      design_system: dsLabel,
      artifact: refined,
      handoff,
      stages: {
        onboarding,
        import: importResult,
        generated,
        refined,
      },
    };
  })
  .compile();
