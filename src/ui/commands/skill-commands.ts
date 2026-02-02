/**
 * Skill Commands for Chat UI
 *
 * Registers skill commands that invoke predefined skills via session.
 * Skills are specialized prompts/workflows that can be triggered via slash commands.
 *
 * The skill commands load the skill prompt from disk (from agent config directories)
 * and expand $ARGUMENTS with the user's arguments before sending to the agent.
 *
 * Reference: Feature 4 - Implement skill command registration
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
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

/**
 * Built-in skill definition with embedded prompt content.
 *
 * Unlike SkillMetadata which loads prompts from disk, BuiltinSkill
 * embeds the full prompt content directly, making skills self-contained
 * and not dependent on external files.
 */
export interface BuiltinSkill {
  /** Skill name (without leading slash) - used as command name */
  name: string;
  /** Human-readable description of what the skill does */
  description: string;
  /** Alternative command names for the skill */
  aliases?: string[];
  /** Full prompt content (supports $ARGUMENTS placeholder) */
  prompt: string;
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
// SKILL PROMPT LOADING
// ============================================================================

/**
 * Paths to search for skill/command definitions.
 * Order matters - first found wins.
 */
const SKILL_SEARCH_PATHS = [
  // Claude Code commands
  ".claude/commands",
  // OpenCode commands
  ".opencode/command",
  // GitHub Copilot commands (if they exist)
  ".github/commands",
];

/**
 * Load a skill prompt from disk by searching common paths.
 * Returns the skill content with frontmatter stripped.
 *
 * @param skillName - The skill name (e.g., "research-codebase")
 * @returns The skill prompt content, or null if not found
 */
function loadSkillPrompt(skillName: string): string | null {
  // Handle namespaced skills (e.g., "ralph:ralph-loop" -> "ralph-loop")
  const baseName = skillName.includes(":") ? skillName.split(":").pop()! : skillName;

  for (const searchPath of SKILL_SEARCH_PATHS) {
    const fullPath = join(process.cwd(), searchPath, `${baseName}.md`);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        // Strip YAML frontmatter if present
        return stripFrontmatter(content);
      } catch {
        // Continue to next path
      }
    }
  }

  return null;
}

/**
 * Strip YAML frontmatter from markdown content.
 * Frontmatter is enclosed by "---" delimiters at the start of the file.
 */
function stripFrontmatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return content;
  }

  // Find the closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return content;
  }

  // Return content after frontmatter
  return lines.slice(endIndex + 1).join("\n").trim();
}

/**
 * Expand $ARGUMENTS placeholder in skill prompt with user arguments.
 */
function expandArguments(prompt: string, args: string): string {
  return prompt.replace(/\$ARGUMENTS/g, args || "[no arguments provided]");
}

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
      const skillArgs = args.trim();

      // Load the skill prompt from disk and expand arguments
      // This ensures the TUI can stream the agent's response since we send
      // the expanded prompt as a regular message rather than a slash command.
      //
      // The SDK slash command approach doesn't stream output back through
      // the stream API, so we load and expand the prompt ourselves.
      const skillPrompt = loadSkillPrompt(metadata.name);

      if (skillPrompt) {
        // Expand $ARGUMENTS placeholder with user arguments
        const expandedPrompt = expandArguments(skillPrompt, skillArgs);
        context.sendMessage(expandedPrompt);
      } else {
        // Fallback: send slash command to agent's native skill system
        // This handles skills that aren't defined in local .claude/commands/ etc.
        // The agent SDK may process it internally without streaming output.
        const invocationMessage = skillArgs
          ? `/${metadata.name} ${skillArgs}`
          : `/${metadata.name}`;
        context.sendMessage(invocationMessage);
      }

      return {
        success: true,
        // No message displayed - the agent will handle displaying the skill output
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

// Export helper functions for testing and external use
export { loadSkillPrompt, stripFrontmatter, expandArguments };
