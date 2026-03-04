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
 *   - ~/.config/.opencode/skills/
 *   - ~/.config/.copilot/skills/
 *   - ~/.atomic/.claude/skills/
 *   - ~/.atomic/.opencode/skills/
 *   - ~/.atomic/.copilot/skills/
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
import { isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { parseMarkdownFrontmatter } from "../../utils/markdown.ts";
import {
    getCompatibleDiscoveryRoots,
    resolveDefaultConfigHome,
    type ProviderCompatibilitySelection,
    type ProviderDiscoveryPlan,
} from "../../utils/provider-discovery-plan.ts";
import {
    emitDiscoveryEvent,
    isDiscoveryDebugLoggingEnabled,
} from "../../utils/discovery-events.ts";
import {
    collectDefinitionDiscoveryMatches,
    createAllProviderDiscoveryPlans,
    filterDefinitionMatchesByRuntimeCompatibility,
    getCommandIdentifierPatternDescription,
    getRuntimeCompatibilitySelection,
    isValidCommandIdentifier,
    validateDefinitionCompatibility,
    type DefinitionDiscoveryMatch,
} from "./definition-integrity.ts";

function buildSkillInvocationMessage(skillName: string, args: string): string {
    const trimmedArgs = args.trim();
    return trimmedArgs.length > 0
        ? `/${skillName} ${trimmedArgs}`
        : `/${skillName}`;
}

// ============================================================================
// DISK-BASED SKILL DISCOVERY
// ============================================================================

const HOME = homedir();
const USER_CONFIG_HOME = resolveDefaultConfigHome({
    homeDir: HOME,
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? undefined,
    appDataDir: process.env.APPDATA ?? undefined,
    platform: process.platform,
});
const USER_DISCOVERY_ROOTS = [
    HOME,
    USER_CONFIG_HOME,
    join(HOME, ".atomic"),
];

const SKILL_DISCOVERY_PATHS = [
    join(".claude", "skills"),
    join(".opencode", "skills"),
    join(".github", "skills"),
] as const;

const GLOBAL_SKILL_PATHS = [
    join(HOME, ".claude", "skills"),
    join(HOME, ".opencode", "skills"),
    join(HOME, ".copilot", "skills"),
    join(USER_CONFIG_HOME, ".opencode", "skills"),
    join(USER_CONFIG_HOME, ".copilot", "skills"),
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

export interface BuiltinSkillDefinition {
    name: string;
    description: string;
    aliases?: string[];
    argumentHint?: string;
    requiredArguments?: string[];
}

interface SkillFileParseResult {
    skill: DiskSkillDefinition | null;
    issues: readonly string[];
}

export interface SkillDefinitionIntegrityResult {
    valid: boolean;
    issues: readonly string[];
    discoveryMatches: readonly DefinitionDiscoveryMatch[];
}

function buildRuntimeDiscoveryPlanOptions(): {
    projectRoot: string;
    homeDir?: string;
    xdgConfigHome?: string;
    appDataDir?: string;
    platform: NodeJS.Platform;
} {
    const discoveryPlanOptions: {
        projectRoot: string;
        homeDir?: string;
        xdgConfigHome?: string;
        appDataDir?: string;
        platform: NodeJS.Platform;
    } = {
        projectRoot: process.cwd(),
        platform: process.platform,
    };

    if (process.env.HOME) {
        discoveryPlanOptions.homeDir = process.env.HOME;
    }
    if (process.env.XDG_CONFIG_HOME) {
        discoveryPlanOptions.xdgConfigHome = process.env.XDG_CONFIG_HOME;
    }
    if (process.env.APPDATA) {
        discoveryPlanOptions.appDataDir = process.env.APPDATA;
    }

    return discoveryPlanOptions;
}

export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
    {
        name: "playwright-cli",
        aliases: ["pw", "playwright"],
        description:
            "Browser automation for web research, data extraction, and UI testing with Playwright CLI",
        argumentHint: "[url-or-task]",
    },
];

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

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
    const relativePath = relative(resolve(rootPath), resolve(candidatePath));
    return (
        relativePath === "" ||
        (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
}

function determineSkillSource(discoveryPath: string): SkillSource {
    const resolvedPath = resolve(discoveryPath);

    if (isPathWithinRoot(process.cwd(), resolvedPath)) {
        return "project";
    }

    if (USER_DISCOVERY_ROOTS.some((rootPath) =>
        isPathWithinRoot(rootPath, resolvedPath)
    )) {
        return "user";
    }

    return "project";
}

export function getRuntimeCompatibleSkillDiscoveryPaths(
    discoveryPlans: readonly ProviderDiscoveryPlan[],
): string[] {
    return collectSkillDiscoveryPaths(
        discoveryPlans,
        getRuntimeCompatibilitySelection,
    );
}

function collectSkillDiscoveryPaths(
    discoveryPlans: readonly ProviderDiscoveryPlan[],
    compatibilityResolver: (
        plan: ProviderDiscoveryPlan,
    ) => ProviderCompatibilitySelection,
): string[] {
    const searchPaths: string[] = [];
    const seen = new Set<string>();

    for (const plan of discoveryPlans) {
        const compatibilitySelection = compatibilityResolver(plan);
        const rootsByDescendingPrecedence = [...getCompatibleDiscoveryRoots(
            plan,
            compatibilitySelection,
        )].reverse();
        for (const root of rootsByDescendingPrecedence) {
            const skillPath = resolve(join(root.resolvedPath, "skills"));
            if (seen.has(skillPath)) {
                continue;
            }

            seen.add(skillPath);
            searchPaths.push(skillPath);
        }
    }

    return searchPaths;
}

function warnSkippedSkillDefinition(
    skillFilePath: string,
    issues: readonly string[],
    options: {
        discoveryMatches?: readonly DefinitionDiscoveryMatch[];
        activeDiscoveryPlans?: readonly ProviderDiscoveryPlan[];
        reason: string;
    },
): void {
    if (issues.length === 0) {
        return;
    }

    const providerTags = new Set(
        (options.activeDiscoveryPlans ?? []).map((plan) => plan.provider),
    );

    if (providerTags.size === 0) {
        for (const match of options.discoveryMatches ?? []) {
            providerTags.add(match.provider);
        }
    }

    for (const provider of providerTags) {
        const providerMatch = options.discoveryMatches?.find(
            (match) => match.provider === provider,
        );
        emitDiscoveryEvent("discovery.definition.skipped", {
            level: "warn",
            tags: {
                provider,
                path: resolve(skillFilePath),
                rootId: providerMatch?.rootId,
                rootTier: providerMatch?.tier,
                rootCompatibility: providerMatch?.compatibility,
            },
            data: {
                kind: "skill",
                reason: options.reason,
                issueCount: issues.length,
                issues,
            },
        });
    }

    if (isDiscoveryDebugLoggingEnabled()) {
        console.warn(
            `[skill-commands] Skipping skill definition at ${skillFilePath}: ${issues.join(
                " ",
            )}`,
        );
    }
}

function emitSkillCompatibilityFilteredEvent(
    skillFilePath: string,
    discoveryMatches: readonly DefinitionDiscoveryMatch[],
    runtimeCompatibleMatches: readonly DefinitionDiscoveryMatch[],
    activeDiscoveryPlans: readonly ProviderDiscoveryPlan[],
): void {
    const runtimeCompatibleMatchKeys = new Set(
        runtimeCompatibleMatches.map(
            (match) => `${match.provider}:${match.rootId}:${match.rootPath}`,
        ),
    );

    for (const activePlan of activeDiscoveryPlans) {
        const providerMatches = discoveryMatches.filter(
            (match) => match.provider === activePlan.provider,
        );
        const providerFilteredMatches = providerMatches.filter(
            (match) =>
                !runtimeCompatibleMatchKeys.has(
                    `${match.provider}:${match.rootId}:${match.rootPath}`,
                ),
        );
        const pathContextMatch = providerFilteredMatches[0] ?? providerMatches[0];

        emitDiscoveryEvent("discovery.compatibility.filtered", {
            level: "warn",
            tags: {
                provider: activePlan.provider,
                path: resolve(skillFilePath),
                rootId: pathContextMatch?.rootId,
                rootTier: pathContextMatch?.tier,
                rootCompatibility: pathContextMatch?.compatibility,
            },
            data: {
                kind: "skill",
                runtimeCompatibilitySelection:
                    getRuntimeCompatibilitySelection(activePlan),
                providerMatchCount: providerMatches.length,
                filteredMatchCount: providerFilteredMatches.length,
            },
        });
    }
}

export function validateDiskSkillDefinitionIntegrity(
    skill: DiskSkillDefinition,
    options: {
        discoveryPlans?: readonly ProviderDiscoveryPlan[];
    } = {},
): SkillDefinitionIntegrityResult {
    const issues: string[] = [];
    const plans = options.discoveryPlans ?? createAllProviderDiscoveryPlans();

    if (!skill.skillFilePath.endsWith("SKILL.md")) {
        issues.push(
            `Skill file must point to SKILL.md, received: ${skill.skillFilePath}`,
        );
    }

    if (!isValidCommandIdentifier(skill.name)) {
        issues.push(
            `Invalid skill name "${skill.name}". Use ${getCommandIdentifierPatternDescription()}.`,
        );
    }

    if (skill.description.trim().length === 0) {
        issues.push(`Skill "${skill.name}" must include a non-empty description.`);
    }

    if (skill.aliases) {
        const seenAliases = new Set<string>();
        for (const alias of skill.aliases) {
            if (!isValidCommandIdentifier(alias)) {
                issues.push(
                    `Invalid alias "${alias}" for skill "${skill.name}". Use ${getCommandIdentifierPatternDescription()}.`,
                );
                continue;
            }

            const normalizedAlias = alias.toLowerCase();
            if (normalizedAlias === skill.name.toLowerCase()) {
                issues.push(
                    `Alias "${alias}" duplicates the skill name "${skill.name}".`,
                );
                continue;
            }

            if (seenAliases.has(normalizedAlias)) {
                issues.push(
                    `Alias "${alias}" is duplicated in skill "${skill.name}".`,
                );
                continue;
            }

            seenAliases.add(normalizedAlias);
        }
    }

    if (skill.argumentHint !== undefined && skill.argumentHint.trim().length === 0) {
        issues.push(
            `Skill "${skill.name}" has an empty argument-hint value.`,
        );
    }

    if (skill.requiredArguments) {
        for (const requiredArgument of skill.requiredArguments) {
            if (requiredArgument.trim().length === 0) {
                issues.push(
                    `Skill "${skill.name}" includes an empty required-arguments entry.`,
                );
                continue;
            }

            if (/\s/.test(requiredArgument)) {
                issues.push(
                    `Required argument "${requiredArgument}" for skill "${skill.name}" must not contain spaces.`,
                );
            }
        }
    }

    const compatibilityValidation = validateDefinitionCompatibility(
        skill.skillFilePath,
        "skill",
        plans,
    );
    issues.push(...compatibilityValidation.issues);

    return {
        valid: issues.length === 0,
        issues,
        discoveryMatches: compatibilityValidation.matches,
    };
}

function discoverSkillFiles(
    options: {
        searchPaths?: readonly string[];
    } = {},
): DiscoveredSkillFile[] {
    const files: DiscoveredSkillFile[] = [];
    const cwd = process.cwd();
    const discoveryPaths = options.searchPaths ??
        [
            ...SKILL_DISCOVERY_PATHS.map((searchPath) => resolve(cwd, searchPath)),
            ...GLOBAL_SKILL_PATHS.map((searchPath) => resolve(searchPath)),
        ];

    for (const discoveryPath of discoveryPaths) {
        const fullPath = resolve(discoveryPath);
        if (!existsSync(fullPath)) {
            continue;
        }

        try {
            const entries = readdirSync(fullPath, { withFileTypes: true });
            const source = determineSkillSource(fullPath);
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const skillFile = join(fullPath, entry.name, "SKILL.md");
                if (existsSync(skillFile)) {
                    files.push({
                        path: skillFile,
                        dirName: entry.name,
                        source,
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
): SkillFileParseResult {
    const issues: string[] = [];

    try {
        const content = readFileSync(file.path, "utf-8");
        const parsed = parseMarkdownFrontmatter(content);

        if (content.trimStart().startsWith("---") && !parsed) {
            return {
                skill: null,
                issues: [
                    "Invalid markdown frontmatter block. Ensure SKILL.md starts with a valid '---' header and closing delimiter.",
                ],
            };
        }

        const body = parsed ? parsed.body : content;
        if (body.trim().length === 0) {
            return {
                skill: null,
                issues: [
                    "Skill instructions are empty. Add instructions below the frontmatter block.",
                ],
            };
        }

        if (!parsed) {
            const fallbackName = file.dirName.trim();
            if (fallbackName.length === 0) {
                return {
                    skill: null,
                    issues: [
                        "Skill directory name is empty. Rename the skill directory to a valid command identifier.",
                    ],
                };
            }

            return {
                skill: {
                    name: fallbackName,
                    description: `Skill: ${fallbackName}`,
                    skillFilePath: file.path,
                    source: file.source,
                },
                issues: [],
            };
        }

        const fm = parsed.frontmatter;
        let name = file.dirName.trim();

        if ("name" in fm) {
            if (typeof fm.name !== "string" || fm.name.trim().length === 0) {
                issues.push(
                    "frontmatter.name must be a non-empty string when provided.",
                );
            } else {
                name = fm.name.trim();
            }
        }

        if (name.length === 0) {
            issues.push(
                "Skill name resolved to an empty value. Provide frontmatter.name or a non-empty skill directory name.",
            );
        }

        let description = `Skill: ${name}`;
        if ("description" in fm) {
            if (
                typeof fm.description !== "string" ||
                fm.description.trim().length === 0
            ) {
                issues.push(
                    "frontmatter.description must be a non-empty string when provided.",
                );
            } else {
                description = fm.description.trim();
            }
        }

        let aliases: string[] | undefined;
        if ("aliases" in fm) {
            if (!Array.isArray(fm.aliases)) {
                issues.push("frontmatter.aliases must be an array of strings.");
            } else {
                const normalizedAliases = fm.aliases.map((alias) =>
                    typeof alias === "string" ? alias.trim() : "",
                );
                if (normalizedAliases.some((alias) => alias.length === 0)) {
                    issues.push(
                        "frontmatter.aliases must contain non-empty string values only.",
                    );
                } else {
                    aliases = normalizedAliases;
                }
            }
        }

        let argumentHint: string | undefined;
        if ("argument-hint" in fm) {
            if (
                typeof fm["argument-hint"] !== "string" ||
                fm["argument-hint"].trim().length === 0
            ) {
                issues.push(
                    "frontmatter.argument-hint must be a non-empty string when provided.",
                );
            } else {
                argumentHint = fm["argument-hint"].trim();
            }
        }

        let requiredArguments: string[] | undefined;
        if ("required-arguments" in fm) {
            if (!Array.isArray(fm["required-arguments"])) {
                issues.push(
                    "frontmatter.required-arguments must be an array of strings.",
                );
            } else {
                const normalizedRequiredArgs = fm["required-arguments"].map(
                    (argument) =>
                        typeof argument === "string" ? argument.trim() : "",
                );
                if (normalizedRequiredArgs.some((argument) => argument.length === 0)) {
                    issues.push(
                        "frontmatter.required-arguments must contain non-empty string values only.",
                    );
                } else {
                    requiredArguments = normalizedRequiredArgs;
                }
            }
        }

        if (issues.length > 0) {
            return {
                skill: null,
                issues,
            };
        }

        return {
            skill: {
                name,
                description,
                skillFilePath: file.path,
                source: file.source,
                aliases,
                argumentHint,
                requiredArguments,
            },
            issues: [],
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            skill: null,
            issues: [`Unable to read skill file: ${message}`],
        };
    }
}

function dispatchNativeSkillInvocation(
    skillName: string,
    skillArgs: string,
    context: CommandContext,
): CommandResult {
    context.sendSilentMessage(buildSkillInvocationMessage(skillName, skillArgs));
    return { success: true, skillLoaded: skillName };
}

function createBuiltinSkillCommand(skill: BuiltinSkillDefinition): CommandDefinition {
    return {
        name: skill.name,
        description: skill.description,
        category: "skill",
        aliases: skill.aliases,
        argumentHint: skill.argumentHint,
        execute: (args: string, context: CommandContext): CommandResult => {
            const skillArgs = args.trim();

            // Validate required arguments from built-in definition
            if (skill.requiredArguments?.length && !skillArgs) {
                const argList = skill.requiredArguments
                    .map((a) => `<${a}>`)
                    .join(" ");
                return {
                    success: false,
                    message: `Missing required argument.\nUsage: /${skill.name} ${argList}`,
                };
            }

            return dispatchNativeSkillInvocation(skill.name, skillArgs, context);
        },
    };
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

            return dispatchNativeSkillInvocation(skill.name, skillArgs, context);
        },
    };
}

export function registerBuiltinSkills(): void {
    for (const skill of BUILTIN_SKILLS) {
        if (globalRegistry.has(skill.name)) {
            continue;
        }
        globalRegistry.register(createBuiltinSkillCommand(skill));
    }
}

export async function discoverAndRegisterDiskSkills(
    providerDiscoveryPlan?: ProviderDiscoveryPlan,
): Promise<void> {
    registerBuiltinSkills();
    const allDiscoveryPlans = createAllProviderDiscoveryPlans(
        buildRuntimeDiscoveryPlanOptions(),
    );
    const activeDiscoveryPlans = providerDiscoveryPlan
        ? [providerDiscoveryPlan]
        : allDiscoveryPlans;
    const runtimeCompatibleSearchPaths = getRuntimeCompatibleSkillDiscoveryPaths(
        activeDiscoveryPlans,
    );
    const crossProviderProjectSearchPaths = SKILL_DISCOVERY_PATHS.map((searchPath) =>
        resolve(process.cwd(), searchPath),
    );
    const runtimeCompatiblePathSet = new Set(runtimeCompatibleSearchPaths);
    const discoverySearchPaths = [
        ...runtimeCompatibleSearchPaths,
        ...crossProviderProjectSearchPaths.filter((searchPath) =>
            !runtimeCompatiblePathSet.has(searchPath)
        ),
    ];
    const files = discoverSkillFiles({
        searchPaths:
            discoverySearchPaths.length > 0
                ? discoverySearchPaths
                : undefined,
    });
    const activeRuntimeProviders = activeDiscoveryPlans
        .map((plan) => plan.provider)
        .join(", ");

    // Build map with priority resolution (project > user)
    const resolved = new Map<string, DiskSkillDefinition>();
    for (const file of files) {
        const parsed = parseSkillFile(file);
        if (!parsed.skill) {
            warnSkippedSkillDefinition(file.path, parsed.issues, {
                reason: "parse_failed",
                discoveryMatches: collectDefinitionDiscoveryMatches(
                    file.path,
                    "skill",
                    allDiscoveryPlans,
                ),
                activeDiscoveryPlans,
            });
            continue;
        }

        const integrity = validateDiskSkillDefinitionIntegrity(parsed.skill, {
            discoveryPlans: allDiscoveryPlans,
        });
        if (!integrity.valid) {
            warnSkippedSkillDefinition(file.path, integrity.issues, {
                reason: "integrity_validation_failed",
                discoveryMatches: integrity.discoveryMatches,
                activeDiscoveryPlans,
            });
            continue;
        }

        const runtimeCompatibleMatches =
            filterDefinitionMatchesByRuntimeCompatibility(
                integrity.discoveryMatches,
                activeDiscoveryPlans,
            );
        if (runtimeCompatibleMatches.length === 0) {
            emitSkillCompatibilityFilteredEvent(
                file.path,
                integrity.discoveryMatches,
                runtimeCompatibleMatches,
                activeDiscoveryPlans,
            );
            warnSkippedSkillDefinition(file.path, [
                `Definition is not compatible with active provider runtime(s): ${activeRuntimeProviders}.`,
            ], {
                reason: "runtime_incompatible",
                discoveryMatches: integrity.discoveryMatches,
                activeDiscoveryPlans,
            });
            continue;
        }

        const skill = parsed.skill;

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
                try {
                    globalRegistry.register(command);
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : String(error);
                    warnSkippedSkillDefinition(skill.skillFilePath, [
                        `Command registration failed: ${message}`,
                    ], {
                        reason: "command_registration_failed",
                        discoveryMatches: collectDefinitionDiscoveryMatches(
                            skill.skillFilePath,
                            "skill",
                            allDiscoveryPlans,
                        ),
                        activeDiscoveryPlans,
                    });
                    try {
                        globalRegistry.register(existingCmd);
                    } catch {
                        // Best effort recovery only.
                    }
                }
            }
        } else {
            try {
                globalRegistry.register(command);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                warnSkippedSkillDefinition(skill.skillFilePath, [
                    `Command registration failed: ${message}`,
                ], {
                    reason: "command_registration_failed",
                    discoveryMatches: collectDefinitionDiscoveryMatches(
                        skill.skillFilePath,
                        "skill",
                        allDiscoveryPlans,
                    ),
                    activeDiscoveryPlans,
                });
            }
        }
    }
}
