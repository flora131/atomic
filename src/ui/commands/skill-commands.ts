/**
 * Skill Commands for Chat UI
 *
 * Discovers and registers skill commands from local project and global user
 * skill directories. Skills are specialized prompts/workflows that can be
 * triggered via slash commands.
 *
 * Skill discovery paths (local):
 *   - .claude/skills/
 *   - .opencode/skills/
 *   - .github/skills/
 *
 * Skill discovery paths (global):
 *   - ~/.claude/skills/
 *   - ~/.opencode/skills/
 *   - ~/.copilot/skills/
 *   - ~/.atomic/.claude/skills/
 *   - ~/.atomic/.opencode/skills/
 *   - ~/.atomic/.copilot/skills/
 *
 * The $ARGUMENTS placeholder is expanded with user arguments before sending to the agent.
 */

import type {
    CommandDefinition,
    CommandContext,
    CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import {
    existsSync,
    readdirSync,
    readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { parseMarkdownFrontmatter } from "../../utils/markdown.ts";

// ============================================================================
// SKILL PROMPT EXPANSION
// ============================================================================

/**
 * Expand $ARGUMENTS placeholder in skill prompt with user arguments.
 */
function expandArguments(prompt: string, args: string): string {
    return prompt.replace(/\$ARGUMENTS/g, args || "[no arguments provided]");
}

// ============================================================================
// DISK-BASED SKILL DISCOVERY
// ============================================================================

const HOME = homedir();

const SKILL_DISCOVERY_PATHS = [
    join(".claude", "skills"),
    join(".opencode", "skills"),
    join(".github", "skills"),
] as const;

const GLOBAL_SKILL_PATHS = [
    join(HOME, ".claude", "skills"),
    join(HOME, ".opencode", "skills"),
    join(HOME, ".copilot", "skills"),
] as const;

const GLOBAL_ATOMIC_SKILL_PATHS = [
    join(HOME, ".atomic", ".claude", "skills"),
    join(HOME, ".atomic", ".opencode", "skills"),
    join(HOME, ".atomic", ".copilot", "skills"),
] as const;

export type SkillSource = "project" | "user";

export interface DiscoveredSkillFile {
    path: string;
    dirName: string;
    source: SkillSource;
}

export interface DiskSkillDefinition {
    name: string;
    description: string;
    skillFilePath: string;
    source: SkillSource;
    aliases?: string[];
    argumentHint?: string;
    requiredArguments?: string[];
}

function shouldSkillOverride(
    newSource: SkillSource,
    existingSource: SkillSource,
): boolean {
    const priority: Record<SkillSource, number> = {
        project: 2,
        user: 1,
    };
    return priority[newSource] > priority[existingSource];
}

function discoverSkillFiles(): DiscoveredSkillFile[] {
    const files: DiscoveredSkillFile[] = [];
    const cwd = process.cwd();

    for (const discoveryPath of SKILL_DISCOVERY_PATHS) {
        const fullPath = join(cwd, discoveryPath);
        if (!existsSync(fullPath)) continue;

        try {
            const entries = readdirSync(fullPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const skillFile = join(fullPath, entry.name, "SKILL.md");
                if (existsSync(skillFile)) {
                    files.push({
                        path: skillFile,
                        dirName: entry.name,
                        source: "project",
                    });
                }
            }
        } catch {
            // Skip inaccessible directories
        }
    }

    const allGlobalPaths = [...GLOBAL_SKILL_PATHS, ...GLOBAL_ATOMIC_SKILL_PATHS];
    for (const globalPath of allGlobalPaths) {
        if (!existsSync(globalPath)) continue;

        try {
            const entries = readdirSync(globalPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const skillFile = join(globalPath, entry.name, "SKILL.md");
                if (existsSync(skillFile)) {
                    files.push({
                        path: skillFile,
                        dirName: entry.name,
                        source: "user",
                    });
                }
            }
        } catch {
            // Skip inaccessible directories
        }
    }

    return files;
}

function parseSkillFile(
    file: DiscoveredSkillFile,
): DiskSkillDefinition | null {
    try {
        const content = readFileSync(file.path, "utf-8");
        const parsed = parseMarkdownFrontmatter(content);

        if (!parsed) {
            return {
                name: file.dirName,
                description: `Skill: ${file.dirName}`,
                skillFilePath: file.path,
                source: file.source,
            };
        }

        const fm = parsed.frontmatter;
        const name = typeof fm.name === "string" ? fm.name : file.dirName;
        const description =
            typeof fm.description === "string"
                ? fm.description
                : `Skill: ${name}`;

        let aliases: string[] | undefined;
        if (Array.isArray(fm.aliases)) {
            aliases = fm.aliases.filter(
                (a): a is string => typeof a === "string",
            );
        }

        const argumentHint =
            typeof fm["argument-hint"] === "string"
                ? fm["argument-hint"]
                : undefined;

        let requiredArguments: string[] | undefined;
        if (Array.isArray(fm["required-arguments"])) {
            requiredArguments = fm["required-arguments"].filter(
                (a): a is string => typeof a === "string",
            );
        }

        return {
            name,
            description,
            skillFilePath: file.path,
            source: file.source,
            aliases,
            argumentHint,
            requiredArguments,
        };
    } catch {
        return null;
    }
}

function loadSkillContent(skillFilePath: string): string | null {
    try {
        const content = readFileSync(skillFilePath, "utf-8");
        const parsed = parseMarkdownFrontmatter(content);
        const body = parsed ? parsed.body : content;
        
        // Include skill directory path context for multi-file skills
        const skillDir = dirname(skillFilePath);
        const hasAdditionalFiles = existsSync(skillDir) && 
            readdirSync(skillDir).some(entry => entry !== "SKILL.md");
        
        if (hasAdditionalFiles) {
            const pathContext = `<skill-directory path="${skillDir}">\n` +
                `This skill's directory is located at: ${skillDir}\n` +
                `Use this path when accessing additional files referenced in the skill instructions.\n` +
                `</skill-directory>\n\n`;
            return pathContext + body;
        }
        
        return body;
    } catch {
        return null;
    }
}

function createDiskSkillCommand(skill: DiskSkillDefinition): CommandDefinition {
    return {
        name: skill.name,
        description: skill.description,
        category: "skill",
        aliases: skill.aliases,
        argumentHint: skill.argumentHint,
        execute: (args: string, context: CommandContext): CommandResult => {
            const skillArgs = args.trim();

            // Validate required arguments from frontmatter
            if (skill.requiredArguments?.length && !skillArgs) {
                const argList = skill.requiredArguments
                    .map((a) => `<${a}>`)
                    .join(" ");
                return {
                    success: false,
                    message: `Missing required argument.\nUsage: /${skill.name} ${argList}`,
                };
            }

            const body = loadSkillContent(skill.skillFilePath);
            if (!body) {
                // Delegate to the agent's native skill system (e.g. Copilot CLI
                // loads skills itself via skillDirectories passed at session creation)
                const invocationMessage = skillArgs
                    ? `/${skill.name} ${skillArgs}`
                    : `/${skill.name}`;
                context.sendSilentMessage(invocationMessage);
                return { success: true, skillLoaded: skill.name };
            }
            const expandedPrompt = expandArguments(body, skillArgs);
            // Prepend a directive so the model acts on the already-expanded
            // skill content rather than re-loading the raw skill via the SDK's
            // built-in "skill" tool (which would lose the $ARGUMENTS expansion).
            const directive =
                `<skill-loaded name="${skill.name}">\n` +
                `The "${skill.name}" skill has already been loaded with the user's arguments below. ` +
                `Do NOT invoke the Skill tool for "${skill.name}" — follow the instructions directly.\n` +
                `</skill-loaded>\n\n`;
            context.sendSilentMessage(directive + expandedPrompt);
            return { success: true, skillLoaded: skill.name };
        },
    };
}

export async function discoverAndRegisterDiskSkills(): Promise<void> {
    const files = discoverSkillFiles();

    // Build map with priority resolution (project > user)
    const resolved = new Map<string, DiskSkillDefinition>();
    for (const file of files) {
        const skill = parseSkillFile(file);
        if (!skill) continue;

        const existing = resolved.get(skill.name);
        if (
            !existing ||
            shouldSkillOverride(skill.source, existing.source)
        ) {
            resolved.set(skill.name, skill);
        }
    }

    // Register resolved skills
    for (const skill of resolved.values()) {
        const command = createDiskSkillCommand(skill);
        if (globalRegistry.has(skill.name)) {
            const existingCmd = globalRegistry.get(skill.name);
            // Only override if the new skill has higher priority
            if (existingCmd) {
                globalRegistry.unregister(skill.name);
                globalRegistry.register(command);
            }
        } else {
            globalRegistry.register(command);
        }
    }
}
