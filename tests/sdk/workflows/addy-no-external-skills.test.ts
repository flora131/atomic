/**
 * Addy Osmani workflows (addy-define-to-ship-prep, addy-ship-canary,
 * addy-ship-cleanup) must not silently depend on external slash
 * commands or skills that are not bundled with atomic-cli. These
 * workflows are distributed via atomic-cli and must work in a fresh
 * repo where the addyosmani/agent-skills Claude Code plugin has never
 * been installed.
 *
 * Bug: "Neither /spec nor spec-driven-development is available as a
 * skill. I'll follow the prompt's instructions directly. Let me load
 * the tool I need." — the stage prompt invoked `/spec` and the
 * `spec-driven-development` skill, neither of which existed, so the
 * agent silently fell through.
 *
 * Fix: stage prompts must inline the instructions rather than
 * referring to slash commands or skill names the agent cannot resolve.
 * The `SlashCommand` tool should also not be in allowedTools — the
 * workflow is self-contained and does not need to resolve slash
 * commands.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowsRoot = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "sdk",
  "workflows",
  "builtin",
);

const ADDY_WORKFLOWS = [
  "addy-define-to-ship-prep/claude/index.ts",
  "addy-ship-canary/claude/index.ts",
  "addy-ship-cleanup/claude/index.ts",
] as const;

// Slash commands that are defined by the addyosmani/agent-skills plugin
// and therefore not guaranteed to exist in the target repo.
const EXTERNAL_ADDY_SLASH_COMMANDS = [
  "/spec",
  "/plan",
  "/build",
  "/test",
  "/review",
  "/code-simplify",
  "/ship",
  "/idea-refine",
] as const;

// Skill names that are defined by the addyosmani/agent-skills plugin.
// The workflow prompt should not tell the agent to call
// `Skill(<name>)` or phrase instructions as "Follow the <name> skill"
// in a way the agent will interpret as an external skill lookup.
const EXTERNAL_ADDY_SKILLS = [
  "spec-driven-development",
  "planning-and-task-breakdown",
  "incremental-implementation",
  "code-review-and-quality",
  "shipping-and-launch",
  "idea-refine",
  "context-engineering",
  "source-driven-development",
  "frontend-ui-engineering",
  "api-and-interface-design",
  "browser-testing-with-devtools",
  "debugging-and-error-recovery",
  "code-simplification",
  "security-and-hardening",
  "performance-optimization",
  "git-workflow-and-versioning",
  "ci-cd-and-automation",
  "documentation-and-adrs",
  "deprecation-and-migration",
  "test-driven-development",
] as const;

describe("addy workflows — no unbundled skill/command references in prompts", () => {
  for (const relPath of ADDY_WORKFLOWS) {
    const absPath = join(workflowsRoot, relPath);
    const source = readFileSync(absPath, "utf8");

    test(`${relPath} does not tell the agent to run external slash commands`, () => {
      for (const cmd of EXTERNAL_ADDY_SLASH_COMMANDS) {
        // Only a POSITIVE instruction is a problem — e.g. "Run the
        // `/spec` slash command". Negations that warn the agent NOT
        // to invoke those commands are fine and are part of the fix.
        // Match instruction verbs at the start of a phrase, not after
        // "do NOT".
        const positiveInstruction = new RegExp(
          `(^|\\n)\\s*"?\\s*(Run|Execute|Invoke|Use|Call|Issue|Trigger)\\s+(the\\s+)?\\\`${cmd.replace("/", "\\/")}\\\`\\s+slash\\s+command`,
          "i",
        );
        expect(source).not.toMatch(positiveInstruction);
      }
    });

    test(`${relPath} does not include SlashCommand in allowedTools`, () => {
      // SlashCommand only works if the target repo has
      // `.claude/commands/*.md` files that match — which won't be the
      // case for addy-* commands in a fresh repo. Including it is a
      // red flag that the workflow still depends on slash commands.
      const allowedToolsMatch = source.match(
        /"--allowed-tools"\s*,\s*"([^"]+)"/,
      );
      if (allowedToolsMatch) {
        const tools = allowedToolsMatch[1]!.split(",").map((s) => s.trim());
        expect(tools).not.toContain("SlashCommand");
      }
    });

    test(`${relPath} does not phrase instructions as 'Follow <skill> exactly'`, () => {
      // "Follow `spec-driven-development` exactly" and
      // "Follow `spec-driven-development` + `test-driven-development`"
      // cause the agent to look up the skill by name. In a fresh repo
      // that skill won't exist. Inline the instructions or use
      // neutral phrasing ("Follow this process:") instead.
      for (const skill of EXTERNAL_ADDY_SKILLS) {
        const followPattern = new RegExp(
          `Follow\\s+\\\`${skill}\\\``,
          "i",
        );
        expect(source).not.toMatch(followPattern);
      }
    });
  }
});
