/**
 * open-claude-design / copilot — STUB
 *
 * Copilot provider support is planned but not yet implemented.
 * See claude/index.ts for the reference implementation.
 *
 * TODO: Implement Copilot-specific session handling:
 *   - s.session.send({ prompt }) / s.session.sendAndWait({ prompt })
 *   - s.save(await s.session.getMessages())
 *   - getAssistantText() for message extraction
 *   - HIL via ask_user tool instead of AskUserQuestion
 */

import { defineWorkflow } from "../../../index.ts";

export default defineWorkflow({
  name: "open-claude-design",
  description:
    "AI-powered design workflow: design system onboarding → import → generate → refine → export/handoff",
  inputs: [
    {
      name: "prompt",
      type: "text",
      required: true,
      description:
        "What to design (e.g., 'a dashboard for monitoring API latency')",
    },
    {
      name: "reference",
      type: "text",
      required: false,
      description:
        "URL, file path, or codebase path to import as design reference",
    },
    {
      name: "output-type",
      type: "enum",
      required: false,
      values: ["prototype", "wireframe", "page", "component"],
      default: "prototype",
      description: "Type of design output to generate",
    },
    {
      name: "design-system",
      type: "text",
      required: false,
      description: "Path to existing Design.md (skips onboarding if provided)",
    },
  ],
})
  .for<"copilot">()
  .run(async (_ctx) => {
    throw new Error(
      "open-claude-design is not yet implemented for Copilot. " +
        "Use `-a claude` to run with the Claude provider.",
    );
  })
  .compile();
