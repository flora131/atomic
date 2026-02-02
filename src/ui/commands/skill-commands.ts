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
// BUILTIN SKILLS (with embedded prompts)
// ============================================================================

/**
 * Built-in skills with embedded prompt content.
 *
 * These skills are self-contained and don't require external files.
 * They take priority over disk-based skill definitions.
 */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "commit",
    description: "Create well-formatted commits with conventional commit format",
    aliases: ["ci"],
    prompt: `# Smart Git Commit

Create well-formatted commit: $ARGUMENTS

## Current Repository State

- Git status: \`git status --porcelain\`
- Current branch: \`git branch --show-current\`
- Staged changes: \`git diff --cached --stat\`
- Unstaged changes: \`git diff --stat\`
- Recent commits: \`git log --oneline -5\`

## What This Command Does

1. Checks which files are staged with \`git status\`
2. If 0 files are staged, automatically adds all modified and new files with \`git add\`
3. Performs a \`git diff\` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit (or the single commit if not split), creates a commit message using conventional commit format

## Best Practices for Commits

- Follow the Conventional Commits specification as described below.

# Conventional Commits 1.0.0

## Summary

The Conventional Commits specification is a lightweight convention on top of commit messages. It provides an easy set of rules for creating an explicit commit history; which makes it easier to write automated tools on top of. This convention dovetails with [SemVer](http://semver.org), by describing the features, fixes, and breaking changes made in commit messages.

The commit message should be structured as follows:

\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

The commit contains the following structural elements, to communicate intent to the consumers of your library:

1.  **fix:** a commit of the _type_ \`fix\` patches a bug in your codebase (this correlates with [\`PATCH\`](http://semver.org/#summary) in Semantic Versioning).
2.  **feat:** a commit of the _type_ \`feat\` introduces a new feature to the codebase (this correlates with [\`MINOR\`](http://semver.org/#summary) in Semantic Versioning).
3.  **BREAKING CHANGE:** a commit that has a footer \`BREAKING CHANGE:\`, or appends a \`'!'\` after the type/scope, introduces a breaking API change (correlating with [\`MAJOR\`](http://semver.org/#summary) in Semantic Versioning). A BREAKING CHANGE can be part of commits of any _type_.
4.  _types_ other than \`fix:\` and \`feat:\` are allowed, for example [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) (based on the [Angular convention](https://github.com/angular/angular/blob/22b96b9/CONTRIBUTING.md#-commit-message-guidelines)) recommends \`build:\`, \`chore:\`, \`ci:\`, \`docs:\`, \`style:\`, \`refactor:\`, \`perf:\`, \`test:\`, and others.
5.  _footers_ other than \`BREAKING CHANGE: <description>\` may be provided and follow a convention similar to [git trailer format](https://git-scm.com/docs/git-interpret-trailers).

Additional types are not mandated by the Conventional Commits specification, and have no implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE). A scope may be provided to a commit's type, to provide additional contextual information and is contained within parenthesis, e.g., \`feat(parser): add ability to parse arrays\`.

## Examples

### Commit message with description and breaking change footer

\`\`\`
feat: allow provided config object to extend other configs

BREAKING CHANGE: \`extends\` key in config file is now used for extending other config files
\`\`\`

### Commit message with \`'!'\` to draw attention to breaking change

\`\`\`
feat!: send an email to the customer when a product is shipped
\`\`\`

### Commit message with scope and \`'!'\` to draw attention to breaking change

\`\`\`
feat(api)!: send an email to the customer when a product is shipped
\`\`\`

### Commit message with both \`'!'\` and BREAKING CHANGE footer

\`\`\`
chore!: drop support for Node 6

BREAKING CHANGE: use JavaScript features not available in Node 6.
\`\`\`

### Commit message with no body

\`\`\`
docs: correct spelling of CHANGELOG
\`\`\`

### Commit message with scope

\`\`\`
feat(lang): add Polish language
\`\`\`

### Commit message with multi-paragraph body and multiple footers

\`\`\`
fix: prevent racing of requests

Introduce a request id and a reference to latest request. Dismiss
incoming responses other than from latest request.

Remove timeouts which were used to mitigate the racing issue but are
obsolete now.

Reviewed-by: Z
Refs: #123
\`\`\`

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

1.  Commits MUST be prefixed with a type, which consists of a noun, \`feat\`, \`fix\`, etc., followed by the OPTIONAL scope, OPTIONAL \`'!'\`, and REQUIRED terminal colon and space.
2.  The type \`feat\` MUST be used when a commit adds a new feature to your application or library.
3.  The type \`fix\` MUST be used when a commit represents a bug fix for your application.
4.  A scope MAY be provided after a type. A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., \`fix(parser):\`
5.  A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes, e.g., _fix: array parsing issue when multiple spaces were contained in string_.
6.  A longer commit body MAY be provided after the short description, providing additional contextual information about the code changes. The body MUST begin one blank line after the description.
7.  A commit body is free-form and MAY consist of any number of newline separated paragraphs.
8.  One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a \`:<space>\` or \`<space>#\` separator, followed by a string value (this is inspired by the [git trailer convention](https://git-scm.com/docs/git-interpret-trailers)).
9.  A footer's token MUST use \`-\` in place of whitespace characters, e.g., \`Acked-by\` (this helps differentiate the footer section from a multi-paragraph body). An exception is made for \`BREAKING CHANGE\`, which MAY also be used as a token.
10. A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.
11. Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.
12. If included as a footer, a breaking change MUST consist of the uppercase text BREAKING CHANGE, followed by a colon, space, and description, e.g., _BREAKING CHANGE: environment variables now take precedence over config files_.
13. If included in the type/scope prefix, breaking changes MUST be indicated by a \`'!'\` immediately before the \`:\`. If \`'!'\` is used, \`BREAKING CHANGE:\` MAY be omitted from the footer section, and the commit description SHALL be used to describe the breaking change.
14. Types other than \`feat\` and \`fix\` MAY be used in your commit messages, e.g., _docs: update ref docs._
15. The units of information that make up Conventional Commits MUST NOT be treated as case sensitive by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
16. BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE, when used as a token in a footer.

## Why Use Conventional Commits

- Automatically generating CHANGELOGs.
- Automatically determining a semantic version bump (based on the types of commits landed).
- Communicating the nature of changes to teammates, the public, and other stakeholders.
- Triggering build and publish processes.
- Making it easier for people to contribute to your projects, by allowing them to explore a more structured commit history.

## Important Notes

- By default, pre-commit checks (defined in \`.pre-commit-config.yaml\`) will run to ensure code quality
  - IMPORTANT: DO NOT SKIP pre-commit checks
- ALWAYS attribute AI-Assisted Code Authorship using trailers (e.g., \`Assistant-model: Claude Code\`)
- If specific files are already staged, the command will only commit those files
- If no files are staged, it will automatically stage all modified and new files
- The commit message will be constructed based on the changes detected
- Before committing, the command will review the diff to identify if multiple commits would be more appropriate
- If suggesting multiple commits, it will help you stage and commit the changes separately
- Always reviews the commit diff to ensure the message matches the changes`,
  },
];

// ============================================================================
// SKILL DEFINITIONS (legacy disk-based)
// ============================================================================

/**
 * Available skill definitions from the system-reminder skill list.
 *
 * Each entry defines a skill command that invokes a specific skill via session.
 * These are loaded from disk and are used as fallback when no built-in skill exists.
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

/**
 * Get a builtin skill by name.
 *
 * @param name - Skill name (or alias)
 * @returns BuiltinSkill if found, undefined otherwise
 */
export function getBuiltinSkill(name: string): BuiltinSkill | undefined {
  const lowerName = name.toLowerCase();
  return BUILTIN_SKILLS.find(
    (s) =>
      s.name.toLowerCase() === lowerName ||
      s.aliases?.some((a) => a.toLowerCase() === lowerName)
  );
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

      // Priority 1: Check for builtin skill with embedded prompt
      const builtinSkill = getBuiltinSkill(metadata.name);
      if (builtinSkill) {
        // Use the embedded prompt directly
        const expandedPrompt = expandArguments(builtinSkill.prompt, skillArgs);
        context.sendMessage(expandedPrompt);
        return {
          success: true,
        };
      }

      // Priority 2: Load the skill prompt from disk
      // This ensures the TUI can stream the agent's response since we send
      // the expanded prompt as a regular message rather than a slash command.
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
