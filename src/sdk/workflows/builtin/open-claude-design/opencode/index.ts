/**
 * open-claude-design / opencode — STUB
 *
 * OpenCode provider support is planned but not yet implemented.
 * See claude/index.ts for the reference implementation.
 *
 * TODO: Implement OpenCode-specific session handling:
 *   - s.client.session.prompt({ sessionID, parts, agent })
 *   - s.save(result.data!)
 *   - extractResponseText() for message extraction
 *   - HIL via user-question tool
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
  .for<"opencode">()
  .run(async (_ctx) => {
    throw new Error(
      "open-claude-design is not yet implemented for OpenCode. " +
        "Use `-a claude` to run with the Claude provider.",
    );
  })
  .compile();
