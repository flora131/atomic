/**
 * open-claude-design / claude
 *
 * AI-powered design workflow that replicates Anthropic's Claude Design product
 * using the Atomic CLI workflow SDK. Orchestrates five phases:
 *
 *   Phase 1 — Design System Onboarding (headless codebase analysis → visible HIL approval)
 *   Phase 2 — Import (classify reference → headless capture/parse/scan)
 *   Phase 3 — Generation (visible design-generator stage)
 *   Phase 4 — Refinement Loop (visible refiner + parallel headless critique/screenshot)
 *   Phase 5 — Export/Handoff (visible exporter + deterministic bundle packaging)
 *
 * Architectural pattern: Hybrid Fan-out + Bounded Iterative Loop
 *   - Fan-out  (from deep-research-codebase): Phases 1-2 use parallel headless
 *     stages to gather codebase / reference context before visible interactive stages.
 *   - Bounded loop (from ralph): Phase 4 repeats up to MAX_REFINEMENTS times,
 *     exiting when the user signals completion or the limit is reached.
 *
 * Run: atomic workflow -n open-claude-design -a claude --prompt "..."
 */

import { defineWorkflow, extractAssistantText } from "../../../index.ts";

import {
  loadDesignSystem,
  persistDesignSystem,
  getDesignSystemPath,
  type DesignSystemContext,
} from "../helpers/design-system.ts";

import { classifyReference } from "../helpers/web-capture.ts";

import {
  parseRefinementDecision,
  mergeValidationResults,
  formatValidationForRefiner,
} from "../helpers/validation.ts";

import { ensureOutputDirs } from "../helpers/export.ts";

import { packageHandoffBundle } from "../helpers/handoff.ts";

import {
  buildDesignSystemLocatorPrompt,
  buildDesignSystemAnalyzerPrompt,
  buildDesignSystemBuilderPrompt,
  buildDesignReviewPrompt,
  buildWebCapturePrompt,
  buildFileParsePrompt,
  buildCodebaseScanPrompt,
  buildGeneratorPrompt,
  buildRefinePrompt,
  buildContinueRefinePrompt,
  buildCritiquePrompt,
  buildScreenshotValidationPrompt,
  buildExportPrompt,
} from "../helpers/prompts.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_REFINEMENTS = 8;

/**
 * CLI flags passed to every visible Claude stage to bypass interactive
 * permission prompts. Mirrors the pattern used by ralph and deep-research-codebase.
 */
const SKIP_PERMS = [
  "--allow-dangerously-skip-permissions",
  "--dangerously-skip-permissions",
] as const;

/**
 * SDK options shared by every headless sub-agent dispatch.
 * `permissionMode` + `allowDangerouslySkipPermissions` let headless agents
 * use file-system tools without prompting (running unattended).
 */
const SUBAGENT_OPTS = {
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
} as const;

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export default defineWorkflow({
  name: "open-claude-design",
  description:
    "AI-powered design workflow: design system → generate → refine → export/handoff",
  inputs: [
    {
      name: "prompt",
      type: "text",
      required: true,
      description: "Design request — what to create",
    },
    {
      name: "reference",
      type: "text",
      required: false,
      description: "URL, file path, or codebase path for import context",
    },
    {
      name: "output-type",
      type: "enum",
      required: false,
      values: ["prototype", "wireframe", "mockup", "landing-page", "full-site"],
      default: "prototype",
      description: "Type of design output to generate",
    },
    {
      name: "design-system",
      type: "text",
      required: false,
      description:
        "Path to existing design system JSON — skips onboarding if provided",
    },
  ],
})
  .for<"claude">()
  .run(async (ctx) => {
    const root = process.cwd();
    const designSystemPath = getDesignSystemPath(root);
    const reference = ctx.inputs.reference ?? "";
    const outputType = ctx.inputs["output-type"] ?? "prototype";
    const prompt = ctx.inputs.prompt ?? "";

    // ── Classify reference synchronously ────────────────────────────────────
    const refType = reference ? classifyReference(reference) : "none";

    // ── Helper: run the appropriate import capture stage ──────────────────────
    // Dispatches a headless sub-agent based on the reference type (URL, file,
    // or codebase path). Returns the captured import context string.

    const captureImport = async (): Promise<string> => {
      if (refType === "url") {
        const r = await ctx.stage(
          {
            name: "web-capture",
            headless: true,
            description:
              "Capture website design context via playwright-cli (codebase-online-researcher)",
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildWebCapturePrompt(reference),
              { agent: "codebase-online-researcher", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        );
        return r.result;
      }

      if (refType === "file") {
        const r = await ctx.stage(
          {
            name: "file-parser",
            headless: true,
            description:
              "Parse reference file for design context (codebase-analyzer)",
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildFileParsePrompt(reference),
              { agent: "codebase-analyzer", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        );
        return r.result;
      }

      if (refType === "codebase") {
        const r = await ctx.stage(
          {
            name: "codebase-scanner",
            headless: true,
            description:
              "Scan codebase reference path for design patterns (codebase-analyzer)",
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildCodebaseScanPrompt(reference, root),
              { agent: "codebase-analyzer", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        );
        return r.result;
      }

      return "";
    };

    // ── Phase 1+2: Design System + Import (parallel headless) ────────────────
    //
    // Run codebase analysis (locator + analyzer) and reference import capture
    // in parallel to minimize wall-clock time before the user-facing review
    // stage. After all headless work completes, the visible design-system-builder
    // stage presents a CONSOLIDATED proposal — design system tokens, import
    // context, and the user's design request — for explicit user approval
    // before generation begins.

    let designSystem: DesignSystemContext;
    let importContext = "";

    const providedDsPath = ctx.inputs["design-system"];

    if (providedDsPath) {
      // Fast path: load pre-existing design system, skip codebase analysis.
      designSystem = await loadDesignSystem(providedDsPath);

      // Still capture import context if a reference was provided.
      if (refType !== "none") {
        importContext = await captureImport();
      }

      // Design Review: present the loaded design system + import context for
      // user approval before proceeding. Even with a pre-existing design
      // system, the user should confirm the overall design direction.
      await ctx.stage(
        {
          name: "design-review",
          description:
            "Review and approve design direction before generation",
        },
        {
          chatFlags: [
            "--agent",
            "design-system-builder",
            ...SKIP_PERMS,
          ],
        },
        {},
        async (s) => {
          const result = await s.session.query(
            buildDesignReviewPrompt({
              designSystem,
              importContext,
              userPrompt: prompt,
              outputType,
            }),
          );
          s.save(s.sessionId);
          return extractAssistantText(result, 0);
        },
      );

      // Re-load the design system in case the review stage updated it.
      try {
        designSystem = await loadDesignSystem(designSystemPath);
      } catch {
        // If the file wasn't updated, keep the originally loaded system.
      }
    } else {
      // Full path: run codebase analysis and import capture in parallel.
      const importPromise =
        refType !== "none" ? captureImport() : Promise.resolve("");

      const [locatorResult, analyzerResult, captured] = await Promise.all([
        ctx.stage(
          {
            name: "ds-locator",
            headless: true,
            description: "Locate design files in codebase (codebase-locator)",
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildDesignSystemLocatorPrompt(root),
              { agent: "codebase-locator", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        ),
        ctx.stage(
          {
            name: "ds-analyzer",
            headless: true,
            description:
              "Extract design tokens from codebase (codebase-analyzer)",
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildDesignSystemAnalyzerPrompt(root),
              { agent: "codebase-analyzer", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        ),
        importPromise,
      ]);

      importContext = captured;

      // Visible HIL stage — design-system-builder now receives import context
      // alongside codebase analysis, so the user reviews the full design
      // direction in one consolidated proposal before generation begins.
      const dsBuilder = await ctx.stage(
        {
          name: "design-system-builder",
          description:
            "Build design system and approve design direction (design-system-builder)",
        },
        {
          chatFlags: [
            "--agent",
            "design-system-builder",
            ...SKIP_PERMS,
          ],
        },
        {},
        async (s) => {
          const result = await s.session.query(
            buildDesignSystemBuilderPrompt({
              locatorOutput: locatorResult.result,
              analyzerOutput: analyzerResult.result,
              importContext,
              userPrompt: prompt,
              outputType,
            }),
          );
          s.save(s.sessionId);
          return extractAssistantText(result, 0);
        },
      );

      // Deterministic persistence — write design system JSON to disk.
      designSystem = await persistDesignSystem(
        dsBuilder.result,
        designSystemPath,
      );
    }

    // ── Create timestamped output + export dirs with a single shared timestamp ─
    const { outputDir: designDir, exportDir: finalPath } =
      await ensureOutputDirs(root);

    // ── Phase 3: Generation ───────────────────────────────────────────────────
    //
    // Run the visible design-generator stage. The generator applies the design
    // system, import context, and user prompt to produce HTML/CSS/JS artifacts.
    // Output and export dirs were created above with a shared timestamp.

    await ctx.stage(
      {
        name: "design-generator",
        description: "Generate first version of design (design-generator)",
      },
      {
        chatFlags: [
          "--agent",
          "design-generator",
          ...SKIP_PERMS,
        ],
      },
      {},
      async (s) => {
        await s.session.query(
          buildGeneratorPrompt({
            prompt,
            reference: importContext,
            designSystem,
            outputType,
            designDir,
          }),
        );
        s.save(s.sessionId);
      },
    );

    // ── Phase 4: Refinement Loop ──────────────────────────────────────────────
    //
    // Bounded iterative loop with multi-turn inner conversation:
    //
    //   Each iteration spawns a visible refine-{i} stage where the user can
    //   go back and forth with the refiner multiple times (inner loop). The
    //   agent presents three options after each change:
    //     1) Done, looks good.        → exit the entire refinement loop
    //     2) Run validation checks.   → exit stage, run headless validation,
    //                                   start a new iteration with results
    //     3) I have more changes.     → stay in the same stage (multi-turn)
    //
    //   The inner multi-turn loop leverages Claude's tmux pane context —
    //   all prior feedback and changes remain in the conversation history
    //   without needing explicit forwarding. Validation only runs when the
    //   user explicitly requests it (option 2), avoiding unnecessary overhead.

    let validationFeedback = "";

    for (let i = 1; i <= MAX_REFINEMENTS; i++) {
      // Step 4a: Visible refinement stage with multi-turn inner loop.
      // The user can iterate with the refiner multiple times within a single
      // stage before choosing to run validation or finalize.
      const refine = await ctx.stage(
        {
          name: `refine-${i}`,
          description: `Refinement round ${i} of ${MAX_REFINEMENTS} (design-refiner)`,
        },
        {
          chatFlags: [
            "--agent",
            "design-refiner",
            ...SKIP_PERMS,
          ],
        },
        {},
        async (s) => {
          // First turn: apply validation feedback from prior iteration (if any)
          // and present the design with three options.
          let messages = await s.session.query(
            buildRefinePrompt({
              prompt,
              designDir,
              designSystem,
              iteration: i,
              validationFeedback: validationFeedback || undefined,
            }),
          );
          let decision = parseRefinementDecision(messages);

          // Inner multi-turn loop: keep the conversation going while the user
          // chose "I have more changes" (option 3). The Claude tmux pane
          // preserves all prior context, so the agent sees the full history.
          while (!decision.done && !decision.validate) {
            messages = await s.session.query(
              buildContinueRefinePrompt(designDir),
            );
            decision = parseRefinementDecision(messages);
          }

          s.save(s.sessionId);
          return decision;
        },
      );

      // Step 4b: Exit if the user chose option 1 ("Done, looks good.").
      if (refine.result.done) break;

      // Step 4c: User chose option 2 ("Run validation checks.").
      // Parallel headless validation — critique + screenshot.
      const [critiqueResult, screenshotResult] = await Promise.all([
        ctx.stage(
          {
            name: `critique-${i}`,
            headless: true,
            description: `Structured design critique round ${i} (reviewer)`,
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildCritiquePrompt(designDir, designSystem),
              { agent: "reviewer", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        ),
        ctx.stage(
          {
            name: `screenshot-${i}`,
            headless: true,
            description: `Visual validation via playwright round ${i} (codebase-online-researcher)`,
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildScreenshotValidationPrompt(designDir),
              { agent: "codebase-online-researcher", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        ),
      ]);

      // Step 4d: Merge validation results and format for the next iteration.
      const summary = mergeValidationResults(
        critiqueResult.result,
        screenshotResult.result,
      );
      validationFeedback = formatValidationForRefiner(summary);
    }

    // ── Phase 5: Export / Handoff ─────────────────────────────────────────────
    //
    // Step 5a: Visible export stage — agent reads design files and writes
    //          handoff documentation (design-intent, component-specs, etc.).
    // Step 5b: Deterministic bundle packaging — no LLM call, pure TypeScript.
    // Output and export dirs share the same timestamp (created above).

    const exporter = await ctx.stage(
      {
        name: "export",
        description: "Export design and produce handoff bundle (design-exporter)",
      },
      {
        chatFlags: [
          "--agent",
          "design-exporter",
          ...SKIP_PERMS,
        ],
      },
      {},
      async (s) => {
        const result = await s.session.query(
          buildExportPrompt({ designDir, finalPath, designSystem }),
        );
        s.save(s.sessionId);
        return extractAssistantText(result, 0);
      },
    );

    // Step 5b: Deterministic handoff bundle packaging — mirrors the
    // deep-research-codebase pattern of deterministic scratch file writing.
    const handoffDir = await packageHandoffBundle({
      designDir,
      finalPath,
      designSystem,
      exporterNotes: exporter.result,
    });

    // ── Final output ─────────────────────────────────────────────────────────
    // For full-site output type, print instructions for starting the dev server.
    if (outputType === "full-site") {
      console.log(
        `\n  Full site generated. To preview on localhost:\n` +
        `    bun ${designDir}/serve.ts\n` +
        `    Open http://localhost:3000\n`,
      );
    }

    console.log(
      `\n  Design output:  ${designDir}` +
      `\n  Handoff bundle: ${handoffDir}\n`,
    );
  })
  .compile();
