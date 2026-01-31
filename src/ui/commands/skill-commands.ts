/**
 * Skill Commands for Chat UI
 *
 * Registers skill commands that invoke predefined skills via session.
 * Skills are specialized prompts/workflows that can be triggered via slash commands.
 *
 * Reference: Feature 4 - Implement skill command registration
 */

import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metadata for a skill command definition.
 */
export interface SkillMetadata {
  /** Skill name (without leading slash) - used as command name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Alternative names for the skill */
  aliases?: string[];
  /** Whether this skill is hidden from autocomplete */
  hidden?: boolean;
}

// ============================================================================
// SKILL DEFINITIONS
// ============================================================================

/**
 * Available skill definitions from the system-reminder skill list.
 *
 * Each entry defines a skill command that invokes a specific skill via session.
 */
export const SKILL_DEFINITIONS: SkillMetadata[] = [
  // Core skills
  {
    name: "commit",
    description: "Create well-formatted commits with conventional commit format",
    aliases: ["ci"],
  },
  {
    name: "research-codebase",
    description: "Document codebase as-is with research directory for historical context",
    aliases: ["research"],
  },
  {
    name: "create-spec",
    description: "Create a detailed execution plan for implementing features or refactors",
    aliases: ["spec"],
  },
  {
    name: "create-feature-list",
    description: "Create a detailed feature-list.json and progress.txt for implementation",
    aliases: ["features"],
  },
  {
    name: "implement-feature",
    description: "Implement a SINGLE feature from feature-list.json based on execution plan",
    aliases: ["impl"],
  },
  {
    name: "create-gh-pr",
    description: "Commit unstaged changes, push changes, submit a pull request",
    aliases: ["pr"],
  },
  {
    name: "explain-code",
    description: "Explain code functionality in detail",
    aliases: ["explain"],
  },

  // Ralph skills
  {
    name: "ralph:ralph-loop",
    description: "Start Ralph Loop in current session",
    aliases: ["ralph-loop"], // Note: "loop" alias reserved for atomic workflow
  },
  {
    name: "ralph:cancel-ralph",
    description: "Cancel active Ralph Loop",
    aliases: ["cancel-ralph", "stop-ralph"],
  },
  {
    name: "ralph:ralph-help",
    description: "Explain Ralph Loop plugin and available commands",
    aliases: ["ralph-help"],
  },

  // Additional skills from system-reminder
  {
    name: "prompt-engineer",
    description: "Create, improve, or optimize prompts for Claude using best practices",
    aliases: ["prompt"],
  },
  {
    name: "testing-anti-patterns",
    description: "Identify and prevent testing anti-patterns when writing tests",
    aliases: ["test-patterns"],
    hidden: true, // Helper skill, not typically invoked directly
  },
];

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a skill.
 *
 * @param metadata - Skill metadata
 * @returns Command definition for the skill
 */
function createSkillCommand(metadata: SkillMetadata): CommandDefinition {
  return {
    name: metadata.name,
    description: metadata.description,
    category: "skill",
    aliases: metadata.aliases,
    hidden: metadata.hidden,
    execute: (args: string, context: CommandContext): CommandResult => {
      // Check if session is available
      if (!context.session) {
        return {
          success: false,
          message: `Cannot invoke skill "${metadata.name}": No active session. Send a message first to start a session.`,
        };
      }

      // Build the skill invocation message
      const skillName = metadata.name;
      const skillArgs = args.trim();
      const invocationMessage = skillArgs
        ? `/${skillName} ${skillArgs}`
        : `/${skillName}`;

      // Add a system message indicating skill invocation
      context.addMessage(
        "system",
        `Invoking skill **${skillName}**...${skillArgs ? `\n\nArguments: "${skillArgs}"` : ""}`
      );

      // Return success - the actual skill invocation happens through the session
      // The UI layer should handle sending the invocation message to the agent
      return {
        success: true,
        message: `Skill **${skillName}** invoked.`,
        stateUpdate: {
          // Mark that we're waiting for a skill response
          isStreaming: true,
        },
      };
    },
  };
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Skill commands created from definitions.
 */
export const skillCommands: CommandDefinition[] = SKILL_DEFINITIONS.map(
  createSkillCommand
);

/**
 * Register all skill commands with the global registry.
 *
 * Call this function during application initialization.
 *
 * @example
 * ```typescript
 * import { registerSkillCommands } from "./skill-commands";
 *
 * // In app initialization
 * registerSkillCommands();
 * ```
 */
export function registerSkillCommands(): void {
  for (const command of skillCommands) {
    // Skip if already registered (idempotent)
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}

/**
 * Get a skill by name.
 *
 * @param name - Skill name (or alias)
 * @returns SkillMetadata if found, undefined otherwise
 */
export function getSkillMetadata(name: string): SkillMetadata | undefined {
  const lowerName = name.toLowerCase();
  return SKILL_DEFINITIONS.find(
    (s) =>
      s.name.toLowerCase() === lowerName ||
      s.aliases?.some((a) => a.toLowerCase() === lowerName)
  );
}

/**
 * Check if a skill name is a Ralph skill.
 *
 * @param name - Skill name to check
 * @returns True if this is a Ralph skill
 */
export function isRalphSkill(name: string): boolean {
  return name.toLowerCase().startsWith("ralph:");
}

/**
 * Get all Ralph skills.
 *
 * @returns Array of Ralph skill metadata
 */
export function getRalphSkills(): SkillMetadata[] {
  return SKILL_DEFINITIONS.filter((s) => isRalphSkill(s.name));
}

/**
 * Get all non-Ralph skills.
 *
 * @returns Array of core skill metadata
 */
export function getCoreSkills(): SkillMetadata[] {
  return SKILL_DEFINITIONS.filter((s) => !isRalphSkill(s.name));
}
